const { createLogger, format, transports } = require("winston");
const config = require("../config");

const logger = createLogger({
  level: config.app.logLevel,
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, module, ...meta }) => {
      const mod = module ? "[" + module + "]" : "";
      const extra = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
      return timestamp + " " + level + " " + mod + " " + message + extra;
    })
  ),
  transports: [new transports.Console()],
});

logger.forModule = (name) => ({
  debug: (msg, meta = {}) => logger.debug(msg, { module: name, ...meta }),
  info:  (msg, meta = {}) => logger.info(msg,  { module: name, ...meta }),
  warn:  (msg, meta = {}) => logger.warn(msg,  { module: name, ...meta }),
  error: (msg, meta = {}) => logger.error(msg, { module: name, ...meta }),
});

module.exports = logger;
