require("dotenv").config();

module.exports = {
  env: process.env.NODE_ENV || "development",
  isDev: (process.env.NODE_ENV || "development") === "development",

  app: {
    port: parseInt(process.env.APP_PORT || "3000"),
    host: process.env.APP_HOST || "0.0.0.0",
    wsPort: parseInt(process.env.WS_PORT || "3001"),
    logLevel: process.env.LOG_LEVEL || "info",
  },

  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    keys: {
      urlQueue: "engine:queue:urls",
      processing: "engine:queue:processing",
      domainTimers: "engine:domain:timers",
      workerHeartbeats: "engine:workers",
      stats: "engine:stats",
    },
  },

  pg: {
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432"),
    database: process.env.PG_DATABASE || "web_engine",
    user: process.env.PG_USER || "engine_user",
    password: process.env.PG_PASSWORD || "engine_pass",
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },

  crawler: {
    userAgent: process.env.CRAWLER_USER_AGENT || "DistributedWebEngine/1.0",
    concurrency: parseInt(process.env.CRAWLER_CONCURRENCY || "5"),
    maxDepth: parseInt(process.env.CRAWLER_MAX_DEPTH || "3"),
    timeoutMs: parseInt(process.env.CRAWLER_TIMEOUT_MS || "30000"),
    maxContentSizeMb: parseInt(process.env.CRAWLER_MAX_CONTENT_SIZE_MB || "10"),
    followRedirects: true,
    maxRedirects: 5,
  },

  workers: {
    count: parseInt(process.env.WORKER_COUNT || "4"),
    queueSize: parseInt(process.env.WORKER_QUEUE_SIZE || "1000"),
    heartbeatIntervalMs: 5000,
    staleTimeoutMs: 30000,
  },

  scheduler: {
    tickMs: 1000,
    maxUrlsPerTick: 50,
  },

  rateLimit: {
    crawlDelayMs: parseInt(process.env.RATE_LIMIT_CRAWL_DELAY_MS || "500"),
  },

  bloom: {
    capacity: 10000000,
    errorRate: 0.01,
  },

  politeness: {
    respectRobotsTxt: true,
    robotsCacheTtlMs: 3600000,
  },

  storage: {
    batchSize: parseInt(process.env.STORAGE_BATCH_SIZE || "100"),
    flushIntervalMs: 5000,
  },
};
