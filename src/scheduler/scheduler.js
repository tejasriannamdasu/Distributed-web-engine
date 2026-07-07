const frontier = require("./frontier");
const db = require("../storage/postgres");
const config = require("../../config");

class Scheduler {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._tick = setInterval(() => this._onTick(), config.scheduler.tickMs);
    this._recovery = setInterval(() => this._recoverStale(), 30000);
    this._jobPoller = setInterval(() => this._pollJobs(), 5000);
    console.log("Scheduler started");
  }

  stop() {
    this._running = false;
    clearInterval(this._tick);
    clearInterval(this._recovery);
    clearInterval(this._jobPoller);
    console.log("Scheduler stopped");
  }

  async startJob(jobId) {
    const { rows } = await db.query("SELECT * FROM crawl_jobs WHERE id = $1", [jobId]);
    if (!rows[0]) throw new Error("Job " + jobId + " not found");
    const job = rows[0];
    await db.query("UPDATE crawl_jobs SET status = 'running', started_at = NOW() WHERE id = $1", [jobId]);
    let seeded = 0;
    for (const url of job.seed_urls) {
      const added = await frontier.enqueue(url, { jobId, depth: 0, priority: job.priority });
      if (added) seeded++;
    }
    console.log("Job started:", jobId, "seeded:", seeded);
    this.eventBus && this.eventBus.emit("job:started", { jobId, name: job.name });
    return { jobId, seeded };
  }

  async pauseJob(jobId) {
    await db.query("UPDATE crawl_jobs SET status = 'paused' WHERE id = $1", [jobId]);
    this.eventBus && this.eventBus.emit("job:paused", { jobId });
  }

  async resumeJob(jobId) {
    await db.query("UPDATE crawl_jobs SET status = 'running' WHERE id = $1", [jobId]);
    this.eventBus && this.eventBus.emit("job:resumed", { jobId });
  }

  async _onTick() {
    try {
      const stats = await frontier.stats();
      this.eventBus && this.eventBus.emit("frontier:stats", stats);
      if (stats.pending === 0 && stats.processing === 0) {
        await this._checkJobCompletion();
      }
    } catch (err) {
      console.error("Scheduler tick error:", err.message);
    }
  }

  async _recoverStale() {
    try {
      await frontier.recoverStale(config.workers.staleTimeoutMs);
    } catch (err) {
      console.error("Stale recovery error:", err.message);
    }
  }

  async _checkJobCompletion() {
    const { rows } = await db.query("SELECT id, max_pages, pages_crawled FROM crawl_jobs WHERE status = 'running'");
    for (const job of rows) {
      if (job.pages_crawled >= job.max_pages) {
        await db.query("UPDATE crawl_jobs SET status = 'completed', completed_at = NOW() WHERE id = $1", [job.id]);
        console.log("Job completed:", job.id);
        this.eventBus && this.eventBus.emit("job:completed", { jobId: job.id });
      }
    }
  }

  async _pollJobs() {
    try {
      const { rows } = await db.query(
        "SELECT id FROM crawl_jobs WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 5"
      );
      for (const { id } of rows) {
        await this.startJob(id);
      }
    } catch (err) {
      console.error("Job poll error:", err.message);
    }
  }
}

module.exports = Scheduler;
