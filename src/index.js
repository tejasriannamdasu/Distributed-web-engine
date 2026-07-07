const { start } = require("./api/server");

async function main() {
  console.log("Distributed Web Engine starting...");
  console.log("Node version:", process.version);
  console.log("Environment:", process.env.NODE_ENV || "development");

  await start();

  process.on("SIGTERM", graceful("SIGTERM"));
  process.on("SIGINT",  graceful("SIGINT"));
}

function graceful(signal) {
  return async () => {
    console.log("Shutting down, signal:", signal);
    const { close: closeRedis } = require("./storage/redis");
    const { close: closePg }    = require("./storage/postgres");
    await Promise.allSettled([closeRedis(), closePg()]);
    process.exit(0);
  };
}

main().catch((err) => {
  console.error("Fatal startup error:", err.message);
  process.exit(1);
});
