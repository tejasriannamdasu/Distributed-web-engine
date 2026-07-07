const os = require("os");
const CrawlWorker = require("./crawl-worker");
const config = require("../../config");

const WORKER_COUNT = config.workers.count || Math.max(1, os.cpus().length - 1);
const workers = [];

async function main() {
  console.log("Starting worker pool, count:", WORKER_COUNT, "pid:", process.pid);

  for (let i = 0; i < WORKER_COUNT; i++) {
    const w = new CrawlWorker("w" + (i + 1) + "-" + process.pid);
    workers.push(w);
    w.start().catch((err) => {
      console.error("Worker crashed:", w.id, err.message);
    });
  }

  const shutdown = async (signal) => {
    console.log("Shutdown signal received:", signal);
    await Promise.all(workers.map((w) => w.stop()));
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  setInterval(() => {
    const total = workers.reduce(
      (acc, w) => ({ crawled: acc.crawled + w.stats.crawled, errors: acc.errors + w.stats.errors }),
      { crawled: 0, errors: 0 }
    );
    console.log("Worker pool stats:", total, "workers:", workers.length);
  }, 30000);
}

main().catch((err) => {
  console.error("Fatal error in worker process:", err.message);
  process.exit(1);
});
