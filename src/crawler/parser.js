const cheerio = require("cheerio");

const IGNORE_TAGS = new Set(["script", "style", "noscript", "iframe", "svg", "head"]);
const BAD_SCHEMES = /^(mailto|tel|javascript|ftp|data|#)/i;

class Parser {
  parse(html, baseUrl) {
    const $ = cheerio.load(html, { decodeEntities: true });
    const base = this._getBase($, baseUrl);
    return {
      title:        this._title($),
      description:  this._description($),
      canonicalUrl: this._canonical($, base),
      bodyText:     this._bodyText($),
      links:        this._links($, base),
    };
  }

  _title($) {
    return ($("title").first().text() || $("h1").first().text() || "").trim().slice(0, 1024);
  }

  _description($) {
    return (
      $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      ""
    ).trim().slice(0, 2048);
  }

  _canonical($, base) {
    const href = $("link[rel='canonical']").attr("href");
    if (!href) return null;
    return this._resolve(href, base);
  }

  _getBase($, pageUrl) {
    const baseHref = $("base").attr("href");
    if (baseHref) {
      try { return new URL(baseHref, pageUrl).toString(); } catch {}
    }
    return pageUrl;
  }

  _bodyText($) {
    const $body = $("body").clone();
    IGNORE_TAGS.forEach(tag => $body.find(tag).remove());
    $body.find("[aria-hidden='true']").remove();
    $body.find("nav, footer, aside").remove();
    return $body.text().replace(/\s+/g, " ").trim().slice(0, 50000);
  }

  _links($, base) {
    const seen = new Set();
    const links = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (!href || BAD_SCHEMES.test(href.trim())) return;
      const resolved = this._resolve(href, base);
      if (!resolved || seen.has(resolved)) return;
      seen.add(resolved);
      links.push(resolved);
    });
    return links;
  }

  _resolve(href, base) {
    try {
      const url = new URL(href, base);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }
}

module.exports = new Parser();
