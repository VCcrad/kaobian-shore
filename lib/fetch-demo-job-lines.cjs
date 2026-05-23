/**
 * 湖南人社厅 demo：页面抓取 + 附件穿透 → 按行切分（供 API / scripts 共用）
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const { parseAttachmentToText } = require("../scripts/spider-safe.js");
const { resolveCacheFile } = require("./hunan-demo-lines-cache.cjs");

const HUNAN_DEMO_URL =
  "https://rst.hunan.gov.cn/rst/xxgk/zpzl/sydwzp/202604/t20260427_33965434.html";

const MAX_ATTACHMENTS = 3;
const SUPPORTED_EXTS = [".xlsx", ".xls", ".docx", ".pdf"];

const CONTENT_SELECTORS = [
  "#content",
  ".content",
  "article",
  ".article",
  ".main",
  ".TRS_Editor",
  ".zw",
  "body",
];

const PAGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function normalizeWhitespace(text) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getUrlExtension(url) {
  try {
    return path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    const match = String(url).match(/\.(xlsx|xls|pdf|docx)(\?|#|$)/i);
    return match ? `.${match[1].toLowerCase()}` : "";
  }
}

function extractPageText($) {
  for (const selector of CONTENT_SELECTORS) {
    const text = normalizeWhitespace($(selector).first().text());
    if (text.length >= 80) return text;
  }
  return normalizeWhitespace($("body").text());
}

function findAttachmentLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const urls = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      return;
    }

    let absolute;
    try {
      absolute = new URL(href, pageUrl).href;
    } catch {
      return;
    }

    const ext = getUrlExtension(absolute);
    if (!SUPPORTED_EXTS.includes(ext)) return;
    if (!urls.includes(absolute)) urls.push(absolute);
  });

  return urls.slice(0, MAX_ATTACHMENTS);
}

async function fetchAndCleanPage(url) {
  const { data: html } = await axios.get(url, {
    timeout: 30000,
    maxRedirects: 5,
    headers: {
      "User-Agent": PAGE_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
    responseType: "text",
  });

  const $ = cheerio.load(html);
  let content = extractPageText($);

  const attachmentUrls = findAttachmentLinks(html, url);

  for (const fileUrl of attachmentUrls) {
    const attachmentText = await parseAttachmentToText(fileUrl, url);
    if (attachmentText && attachmentText.trim()) {
      const fileName = decodeURIComponent(
        String(fileUrl.split("/").pop() || "附件").split("?")[0],
      );
      content += `\n\n--- 发现附件透视文本: ${fileName} ---\n${attachmentText}`;
    }
  }

  return content;
}

function contentToLines(content) {
  return String(content ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readCachedLines() {
  const cacheFile = resolveCacheFile();
  if (!fs.existsSync(cacheFile)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (Array.isArray(raw.lines) && raw.lines.length > 0) {
      return raw.lines;
    }
  } catch {
    /* 缓存损坏则忽略 */
  }
  return null;
}

function writeCachedLines(lines) {
  const cacheFile = resolveCacheFile();
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify(
        {
          sourceUrl: HUNAN_DEMO_URL,
          lineCount: lines.length,
          fetchedAt: new Date().toISOString(),
          lines,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    /* 写缓存失败不影响返回 */
  }
}

/**
 * @param {{ useCache?: boolean, url?: string }} [options]
 * @returns {Promise<string[]>}
 */
async function getHunanDemoLines(options = {}) {
  const useCache = options.useCache !== false;
  const url = options.url || HUNAN_DEMO_URL;

  if (useCache) {
    const cached = readCachedLines();
    if (cached) return cached;
  }

  const content = await fetchAndCleanPage(url);
  const lines = contentToLines(content);

  if (lines.length > 0) {
    writeCachedLines(lines);
  }

  return lines;
}

module.exports = {
  HUNAN_DEMO_URL,
  fetchAndCleanPage,
  contentToLines,
  getHunanDemoLines,
};
