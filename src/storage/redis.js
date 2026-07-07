const Redis = require("ioredis");
const config = require("../../config");

let client = null;

const getClient = async () => {
  if (!client) {
    client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 10) return null;
        return Math.min(times * 1000, 10000);
      },
    });

    client.on("connect", () => console.log("Redis connected"));
    client.on("error", (err) => console.error("Redis error:", err.message));
  }
  return client;
};

const close = async () => {
  if (client) {
    await client.quit();
    client = null;
    console.log("Redis connection closed");
  }
};

module.exports = { getClient, close };
