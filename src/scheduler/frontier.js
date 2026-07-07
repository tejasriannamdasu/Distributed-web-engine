const { getClient } = require("../storage/redis");
const config = require("../../config");

class BloomFilter {
  constructor(capacity, errorRate) {
    const k = Math.ceil(-Math.log(errorRate) / Math.log(2));
    const m = Math.ceil((-capacity * Math.log(errorRate)) / (Math.log(2) ** 2));
    this.k = k;
    this.m = m;
    this.bits = new Uint8Array(Math.ceil(m / 8));
    this.size = 0;
  }

  _hash(str, seed) {
    let h = seed ^ 0xdeadbeef;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9);
      h ^= h >>> 16;
    }
    return Math.abs(h) % this.m;
  }

  add(item) {
    for (let i = 0; i < this.k; i++) {
      const bit = this._hash(item, i * 0x5f3759df);
      this.bits[bit >> 3] |= 1 << (bit & 7);
    }
    this.size++;
  }

  has(item) {
    for (let i = 0; i < this.k; i++) {
      const bit = this._hash(item, i * 0x5f3759df);
      if (!(this.bits[bit >> 3] & (1 << (bit & 7)))) return false;
    }
    return true;
  }
}

class UrlFrontier {
  constructor() {
    this.bloom = new BloomFilter(config.bloom.capacity, config.bloom.errorRate);
    this.keys = config.redis.keys;
    this._redis = null;
  }

  async _r() {
    if (!this._redis) this._redis = await getClient();
    return this._redis;
  }

  async enqueue(url, { jobId, depth = 0, priority = 5 }) {
    const normalized = this._normalize(url);
    if (!normalized) return false;
    if (this.bloom.has(normalized)) return false;
    this.bloom.add(normalized);
    const r = await this._r();
    const domain = new URL(normalized).hostname;
    const score = priority * 10 - depth;
    const payload = JSON.stringify({ url: normalized, jobId, depth, priority, domain });
    await r.zadd(this.keys.urlQueue, "NX", score, payload);
    return true;
  }

  async enqueueBatch(urls, opts) {
    const r = await this._r();
    const pipe = r.pipeline();
    let count = 0;
    for (const url of urls) {
      const normalized = this._normalize(url);
      if (!normalized || this.bloom.has(normalized)) continue;
      this.bloom.add(normalized);
      const domain = new URL(normalized).hostname;
      const score = opts.priority * 10 - (opts.depth || 0);
      const payload = JSON.stringify({ url: normalized, jobId: opts.jobId, depth: opts.depth || 0, priority: opts.priority || 5, domain });
      pipe.zadd(this.keys.urlQueue, "NX", score, payload);
      count++;
    }
    if (count) await pipe.exec();
    return count;
  }

  async dequeue(n = 10) {
    const r = await this._r();
    const now = Date.now();
    const raw = await r.zpopmax(this.keys.urlQueue, n * 3);
    if (!raw.length) return [];
    const results = [];
    const requeue = [];
    for (let i = 0; i < raw.length; i += 2) {
      const item = JSON.parse(raw[i]);
      const { domain } = item;
      const nextAllowed = await r.zscore(this.keys.domainTimers, domain);
      if (nextAllowed && parseFloat(nextAllowed) > now) {
        requeue.push([parseFloat(raw[i + 1]), raw[i]]);
        continue;
      }
      await r.hset(this.keys.processing, item.url, JSON.stringify({ ...item, pickedAt: now }));
      await r.zadd(this.keys.domainTimers, now + config.rateLimit.crawlDelayMs, domain);
      results.push(item);
      if (results.length >= n) break;
    }
    if (requeue.length) {
      const pipe = r.pipeline();
      for (const [score, member] of requeue) {
        pipe.zadd(this.keys.urlQueue, score, member);
      }
      await pipe.exec();
    }
    return results;
  }

  async complete(url) {
    const r = await this._r();
    await r.hdel(this.keys.processing, url);
  }

  async fail(url, { maxRetries = 3 } = {}) {
    const r = await this._r();
    const raw = await r.hget(this.keys.processing, url);
    await r.hdel(this.keys.processing, url);
    if (!raw) return;
    const item = JSON.parse(raw);
    if ((item.retries || 0) < maxRetries) {
      item.retries = (item.retries || 0) + 1;
      item.priority = Math.max(1, item.priority - 2);
      const score = item.priority * 10 - item.depth;
      await r.zadd(this.keys.urlQueue, score, JSON.stringify(item));
    }
  }

  async recoverStale(maxAgeMs = 60000) {
    const r = await this._r();
    const all = await r.hgetall(this.keys.processing);
    if (!all) return 0;
    let recovered = 0;
    const now = Date.now();
    for (const [url, raw] of Object.entries(all)) {
      const item = JSON.parse(raw);
      if (now - item.pickedAt > maxAgeMs) {
        await this.fail(url, { maxRetries: 5 });
        recovered++;
      }
    }
    return recovered;
  }

  async stats() {
    const r = await this._r();
    const [pending, processing] = await Promise.all([
      r.zcard(this.keys.urlQueue),
      r.hlen(this.keys.processing),
    ]);
    return { pending, processing, total: pending + processing, bloomSize: this.bloom.size };
  }

  _normalize(url) {
    try {
      const u = new URL(url);
      if (!["http:", "https:"].includes(u.protocol)) return null;
      u.hash = "";
      u.searchParams.sort();
      return u.toString();
    } catch {
      return null;
    }
  }
}

module.exports = new UrlFrontier();
