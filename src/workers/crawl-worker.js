const { v4: uuidv4 } = require("uuid");
const fetcher = require("../crawler/fetcher");
const parser = require("../crawler/parser");
const frontier = require("../scheduler/frontier");
const db = require("../storage/postgres");
const { getClient } = require("../storage/redis");
const config = require("../../config");

class CrawlWorker {
  constructor(id) {
    this.id = id || "worker-" + uuidv4().slice(0, 8);
    this.running = false;
    this.stats = { crawled: 0, errors: 0, startedAt: Date.now() };
    this._results = [];
  }

  async start() {
    this.running = true;
    console.log("Worker starting:", this.id);
    await this._registerWorker();
    this._heartbeatTimer = setInterval(() => this._heartbeat(), config.workers.heartbeatIntervalMs);
    this._flushTimer = setInterval(() => this._flush(), config.storage.flushIntervalMs);
    await this._loop();
  }

  async stop() {
    console.log("Worker stopping:", this.id);
    this.running = false;
    clearInterval(this._heartbeatTimer);
    clearInterval(this._flushTimer);
    await this._flush();
    await this._deregisterWorker();
  }

  async _loop() {
    while (this.running) {
      const items = await frontier.dequeue(5);
      if (!items.length) {
        await this._sleep(500);
        continue;
      }
      await Promise.all(items.map((item) => this._processUrl(item)));
    }
  }

  async _processUrl(item) {
    const { url, jobId, depth, priority } = item;
    const start = Date.now();
    try {
      const response = await fetcher.fetch(url);
      if (response.blocked) {
        await frontier.complete(url);
        return;
      }
      let parsed = { title: "", description: "", bodyText: "", links: [], canonicalUrl: null };
      if (response.html) {
        parsed = parser.parse(response.html, response.finalUrl);
      }
      const durationMs = Date.now() - start;
      this._results.push({
        jobId,
        url,
        canonicalUrl: parsed.canonicalUrl,
        domain: new URL(response.finalUrl).hostname,
        depth,
        statusCode: response.statusCode,
        contentType: response.contentType,
        contentLength: response.contentLength,
        title: parsed.title,
        description: parsed.description,
        bodyText: parsed.bodyText,
        linksOut: parsed.links,
        crawlDurationMs: durationMs,
        workerId: this.id,
      });
      const job = await this._getJobConfig(jobId);
      if (depth < (job ? job.max_depth : config.crawler.maxDepth)) {
        const sameDomain = parsed.links.filter((l) => this._isSameDomain(l, url));
        const crossLinks = parsed.links.filter((l) => !this._isSameDomain(l, url));
        await frontier.enqueueBatch(sameDomain.slice(0, 100), { jobId, depth: depth + 1, priority: priority * 0.9 });
        await frontier.enqueueBatch(crossLinks.slice(0, 20), { jobId, depth: depth + 1, priority: priority * 0.5 });
      }
      this.stats.crawled++;
      await frontier.complete(url);
      await db.query("UPDATE crawl_jobs SET pages_crawled = pages_crawled + 1 WHERE id = $1", [jobId]);
      console.log("Crawled:", url, "status:", response.statusCode, "ms:", durationMs);
    } catch (err) {
      this.stats.errors++;
      await frontier.fail(url);
      await db.query(
        "INSERT INTO crawl_errors (job_id, url, error_type, error_msg, worker_id) VALUES ($1, $2, $3, $4, $5)",
        [jobId, url, err.code || "UNKNOWN", err.message.slice(0, 500), this.id]
      );
      console.error("Crawl error:", url, err.message);
    }
  }

  async _flush() {
    if (!this._results.length) return;
    const batch = this._results.splice(0, this._results.length);
    await db.bulkInsert(
      "pages",
      ["job_id","url","canonical_url","domain","depth","status_code","content_type","content_length","title","description","body_text","links_out","crawl_duration_ms","worker_id"],
      batch.map(r => [r.jobId, r.url, r.canonicalUrl, r.domain, r.depth, r.statusCode, r.contentType, r.contentLength, r.title, r.description, r.bodyText, r.linksOut, r.crawlDurationMs, r.workerId])
    );
    console.log("Flushed batch:", batch.length);
  }

  async _registerWorker() {
    await db.query(
      "INSERT INTO workers (id, hostname, pid, status, started_at) VALUES ($1, $2, $3, 'idle', NOW()) ON CONFLICT (id) DO UPDATE SET status = 'idle', last_heartbeat = NOW()",
      [this.id, require("os").hostname(), process.pid]
    );
  }

  async _deregisterWorker() {
    await db.query("UPDATE workers SET status = 'offline' WHERE id = $1", [this.id]);
  }

  async _heartbeat() {
    try {
      const r = await getClient();
      await r.hset(config.redis.keys.workerHeartbeats, this.id, Date.now());
      await db.query(
        "UPDATE workers SET last_heartbeat = NOW(), urls_crawled = $1, errors = $2, status = $3 WHERE id = $4",
        [this.stats.crawled, this.stats.errors, this._results.length > 0 ? "busy" : "idle", this.id]
      );
    } catch (err) {
      console.error("Heartbeat failed:", err.message);
    }
  }

  _jobCache = new Map();

  async _getJobConfig(jobId) {
    if (this._jobCache.has(jobId)) return this._jobCache.get(jobId);
    const { rows } = await db.query("SELECT max_depth, max_pages FROM crawl_jobs WHERE id = $1", [jobId]);
    if (rows[0]) this._jobCache.set(jobId, rows[0]);
    return rows[0] || null;
  }

  _isSameDomain(url, base) {
    try {
      return new URL(url).hostname === new URL(base).hostname;
    } catch {
      return false;
    }
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = CrawlWorker;
