const axios = require("axios");
const robotsParser = require("robots-parser");
const config = require("../../config");

const robotsCache = new Map();

class Fetcher {
  constructor() {
    this.http = axios.create({
      timeout: config.crawler.timeoutMs,
      maxRedirects: config.crawler.maxRedirects,
      headers: {
        "User-Agent": config.crawler.userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      maxContentLength: config.crawler.maxContentSizeMb * 1024 * 1024,
      validateStatus: (status) => status < 500,
      decompress: true,
    });
  }

  async fetch(url) {
    const start = Date.now();

    if (config.politeness.respectRobotsTxt) {
      const allowed = await this._isAllowed(url);
      if (!allowed) {
        return { url, finalUrl: url, statusCode: 0, blocked: true, durationMs: 0 };
      }
    }

    try {
      const response = await this.http.get(url, { responseType: "text" });
      const durationMs = Date.now() - start;
      const contentType = response.headers["content-type"] || "";
      const contentLength = parseInt(response.headers["content-length"] || "0", 10);
      const finalUrl = response.request && response.request.res && response.request.res.responseUrl ? response.request.res.responseUrl : url;

      return {
        url,
        finalUrl,
        statusCode: response.status,
        contentType,
        contentLength,
        html: this._isHtml(contentType) ? response.data : null,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      if (axios.isAxiosError(err)) {
        const code = err.response ? err.response.status : 0;
        const msg = err.code || err.message;
        return { url, finalUrl: url, statusCode: code, error: msg, html: null, durationMs };
      }
      throw err;
    }
  }

  async _isAllowed(url) {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const hostname = parsed.hostname;
    const cached = robotsCache.get(hostname);
    const now = Date.now();

    let parser;
    if (cached && now - cached.fetchedAt < config.politeness.robotsCacheTtlMs) {
      parser = cached.parser;
    } else {
      const robotsUrl = origin + "/robots.txt";
      try {
        const res = await this.http.get(robotsUrl, { responseType: "text", timeout: 10000 });
        parser = robotsParser(robotsUrl, res.data);
      } catch {
        parser = robotsParser(robotsUrl, "");
      }
      robotsCache.set(hostname, { parser, fetchedAt: now });
    }

    return parser.isAllowed(url, config.crawler.userAgent) !== false;
  }

  _isHtml(contentType) {
    return contentType.includes("text/html") || contentType.includes("application/xhtml");
  }
}

module.exports = new Fetcher();
