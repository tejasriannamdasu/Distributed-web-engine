const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const db = require("../storage/postgres");
const frontier = require("../scheduler/frontier");
const Scheduler = require("../scheduler/scheduler");
const config = require("../../config");

const eventBus = new EventEmitter();
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "1mb" }));

const scheduler = new Scheduler(eventBus);

app.get("/health", async (_req, res) => {
  const fStats = await frontier.stats().catch(() => null);
  res.json({ status: "ok", frontier: fStats, uptime: process.uptime() });
});

app.post("/api/jobs", async (req, res, next) => {
  try {
    const { name, seedUrls, maxDepth = 3, maxPages = 10000, priority = 5 } = req.body;
    if (!name || !Array.isArray(seedUrls) || seedUrls.length === 0) {
      return res.status(400).json({ error: "name and seedUrls[] are required" });
    }
    const id = uuidv4();
    await db.query(
      "INSERT INTO crawl_jobs (id, name, seed_urls, max_depth, max_pages, priority) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, name, seedUrls, maxDepth, maxPages, priority]
    );
    console.log("Job created:", id, name);
    res.status(201).json({ id, name, status: "pending" });
  } catch (err) { next(err); }
});

app.get("/api/jobs", async (_req, res, next) => {
  try {
    const { rows } = await db.query(
      "SELECT id, name, status, priority, pages_crawled, pages_failed, max_pages, created_at, started_at, completed_at FROM crawl_jobs ORDER BY created_at DESC LIMIT 100"
    );
    res.json(rows);
  } catch (err) { next(err); }
});

app.get("/api/jobs/:id", async (req, res, next) => {
  try {
    const { rows } = await db.query("SELECT * FROM job_progress WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Job not found" });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

app.post("/api/jobs/:id/start", async (req, res, next) => {
  try {
    const result = await scheduler.startJob(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

app.post("/api/jobs/:id/pause", async (req, res, next) => {
  try {
    await scheduler.pauseJob(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.delete("/api/jobs/:id", async (req, res, next) => {
  try {
    await db.query("DELETE FROM crawl_jobs WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get("/api/jobs/:id/pages", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, parseInt(req.query.limit || "20", 10));
    const offset = (page - 1) * limit;
    const { rows } = await db.query(
      "SELECT id, url, title, status_code, content_type, crawled_at, crawl_duration_ms FROM pages WHERE job_id = $1 ORDER BY crawled_at DESC LIMIT $2 OFFSET $3",
      [req.params.id, limit, offset]
    );
    res.json({ pages: rows, page, limit });
  } catch (err) { next(err); }
});

app.get("/api/jobs/:id/errors", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM crawl_errors WHERE job_id = $1 ORDER BY occurred_at DESC LIMIT 100",
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

app.get("/api/stats", async (_req, res, next) => {
  try {
    const [fStats, { rows: jobStats }, { rows: workerRows }] = await Promise.all([
      frontier.stats(),
      db.query("SELECT COUNT(*) FILTER (WHERE status = 'running') AS running, COUNT(*) FILTER (WHERE status = 'completed') AS completed, COUNT(*) FILTER (WHERE status = 'pending') AS pending, SUM(pages_crawled) AS total_pages FROM crawl_jobs"),
      db.query("SELECT id, status, urls_crawled, errors, last_heartbeat FROM workers"),
    ]);
    res.json({ frontier: fStats, jobs: jobStats[0], workers: workerRows });
  } catch (err) { next(err); }
});

app.get("/api/workers", async (_req, res, next) => {
  try {
    const { rows } = await db.query("SELECT * FROM workers ORDER BY started_at DESC");
    res.json(rows);
  } catch (err) { next(err); }
});

app.use((err, _req, res, _next) => {
  console.error("API error:", err.message);
  res.status(500).json({ error: err.message });
});

const start = async () => {
  scheduler.start();
  return new Promise((resolve) => {
    app.listen(config.app.port, config.app.host, () => {
      console.log("API listening on " + config.app.host + ":" + config.app.port);
      resolve({ app, scheduler });
    });
  });
};

module.exports = { app, start };
