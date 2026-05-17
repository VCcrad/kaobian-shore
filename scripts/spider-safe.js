/**
 * anBian-web · 多高校招聘官网安全爬虫（列表 + 详情正文 + 附件解析 + 入库）
 * 运行：node scripts/spider-safe.js
 *
 * 附件解析依赖（若未安装）：
 *   npm install mammoth xlsx
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const mammoth = require("mammoth");
const xlsx = require("xlsx");
const { prisma } = require("../lib/prisma.cjs");

/** 单条详情页最多解析附件数，防止异常页面拖垮爬虫 */
const MAX_ATTACHMENTS_PER_PAGE = 8;

const ATTACHMENT_EXT_RE = /\.(docx|doc|xlsx|xls)(\?|#|$)/i;

/** 每校每轮最多抓取列表条数 */
const MAX_LIST_ITEMS_PER_SCHOOL = 20;

// ─── 多校配置（专用选择器暗号）────────────────────────────────────────
const SCHOOL_CONFIGS = [
  {
    name: "湖南大学",
    homeUrl: "https://rsc.hnu.edu.cn/",
    listUrl: "https://rsc.hnu.edu.cn/zpxx.htm",
    // 实站为 .newslist（无下划线），保留 .news_list 作兼容
    listSelector: ".newslist li, .news_list li",
    dateSelector: ".time, span:last-child, .date",
    contentSelector:
      ".wp_article_content, .v_news_content, #content, .content",
  },
  {
    name: "湖南中医药大学",
    homeUrl: "https://www.hnucm.edu.cn/",
    listUrl: "https://www.hnucm.edu.cn/qtsw/tzgg.htm",
    listSelector: "div.right_list ul li, .news_list2 li",
    dateSelector: ".time",
    contentSelector: ".v_news_content, .content, article",
    /** 真公告详情 URL 必含 /info/，过滤导航栏杂质链接 */
    linkMustInclude: "/info/",
  },
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
];

let circuitTripped = false;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomHumanDelayMs() {
  return Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
}

async function humanPause(label) {
  const ms = randomHumanDelayMs();
  console.log(`[防封延迟] ${label}，等待 ${(ms / 1000).toFixed(1)}s …`);
  await sleep(ms);
}

function pickRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function tripCircuit(reason) {
  circuitTripped = true;
  console.error("\n╔══════════════════════════════════════╗");
  console.error("║  ⚠ 安全熔断已触发，停止后续请求以保护 IP ║");
  console.error("╚══════════════════════════════════════╝");
  console.error(`[熔断原因] ${reason}\n`);
}

function buildSafeHeaders(referer) {
  return {
    "User-Agent": pickRandomUserAgent(),
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    Referer: referer,
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };
}

function splitSelectors(selectorStr) {
  return String(selectorStr ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeWhitespace(text) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageSafely(url, options = {}) {
  if (circuitTripped) {
    throw new Error("熔断已开启，拒绝继续请求");
  }

  const referer = options.referer ?? url;
  const pauseBefore = options.pauseBefore ?? "请求前（模拟打开页面）";
  const pauseAfter = options.pauseAfter ?? "请求后（模拟浏览页面）";

  await humanPause(pauseBefore);

  const headers = buildSafeHeaders(referer);
  console.log(`[防封 UA] ${headers["User-Agent"].slice(0, 55)}…`);

  try {
    const response = await axios.get(url, {
      headers,
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });

    if (response.status === 403) {
      tripCircuit("服务器返回 403 Forbidden");
      throw new Error("HTTP 403 Forbidden");
    }

    if (response.status === 429) {
      tripCircuit("HTTP 429 Too Many Requests");
      throw new Error("HTTP 429");
    }

    if (response.status < 200 || response.status >= 300) {
      consecutiveFailures += 1;
      throw new Error(`HTTP ${response.status}`);
    }

    consecutiveFailures = 0;
    console.log(`[请求成功] ${url} · 状态 ${response.status}`);

    await humanPause(pauseAfter);

    return response.data;
  } catch (err) {
    consecutiveFailures += 1;
    console.error("[错误] 请求失败:", err.message);

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      tripCircuit(`连续失败 ${consecutiveFailures} 次`);
    }

    throw err;
  }
}

function extractArticleContent($, contentSelectorStr) {
  $("script, style, noscript, iframe").remove();

  const selectors = splitSelectors(contentSelectorStr);

  for (const selector of selectors) {
    const $node = $(selector).first();
    if ($node.length === 0) continue;

    const text = normalizeWhitespace($node.text());
    if (text.length >= 80) {
      console.log(`[正文解析] 命中 ${selector}（${text.length} 字）`);
      return text;
    }
  }

  const bodyText = normalizeWhitespace($("body").text());
  console.log(`[正文解析] body 兜底（${bodyText.length} 字）`);
  return bodyText;
}

function getUrlExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    return path.extname(pathname).toLowerCase();
  } catch {
    const match = String(url).match(/\.(docx|doc|xlsx|xls)(\?|#|$)/i);
    return match ? `.${match[1].toLowerCase()}` : "";
  }
}

function findAttachmentUrls(html, pageUrl) {
  const $ = cheerio.load(html);
  const urls = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const lowerHref = href.toLowerCase();
    if (
      !lowerHref.includes(".docx") &&
      !lowerHref.includes(".doc") &&
      !lowerHref.includes(".xlsx") &&
      !lowerHref.includes(".xls")
    ) {
      return;
    }

    if (!ATTACHMENT_EXT_RE.test(lowerHref.split("?")[0])) {
      return;
    }

    urls.add(resolveUrl(href, pageUrl));
  });

  return [...urls].slice(0, MAX_ATTACHMENTS_PER_PAGE);
}

async function downloadAttachmentBuffer(url, referer) {
  if (circuitTripped) {
    throw new Error("熔断已开启，拒绝下载附件");
  }

  await humanPause("附件下载前（模拟点击下载）");

  const headers = {
    ...buildSafeHeaders(referer),
    Accept:
      "application/octet-stream,application/vnd.openxmlformats-officedocument.*,*/*;q=0.8",
  };

  const response = await axios.get(url, {
    headers,
    responseType: "arraybuffer",
    timeout: 60000,
    maxRedirects: 5,
    validateStatus: (status) => status < 500,
  });

  if (response.status === 403) {
    tripCircuit("附件下载 403 Forbidden");
    throw new Error("HTTP 403 Forbidden");
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) {
    throw new Error("附件为空");
  }

  console.log(
    `[附件下载] ${path.basename(new URL(url).pathname)} · ${(buffer.length / 1024).toFixed(1)} KB`,
  );

  await humanPause("附件下载后");

  return buffer;
}

function sheetToPlainText(sheet) {
  if (typeof xlsx.utils.sheet_to_txt === "function") {
    return xlsx.utils.sheet_to_txt(sheet);
  }
  return xlsx.utils.sheet_to_csv(sheet, { FS: "\t", RS: "\n" });
}

function parseExcelBuffer(buffer) {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const parts = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    parts.push(`【${sheetName}】`);
    parts.push(sheetToPlainText(sheet));
  }

  return normalizeWhitespace(parts.join("\n"));
}

/**
 * 下载并解析 Word / Excel 附件为纯文本
 * @param {string} url 附件绝对地址
 * @param {string} [referer] 详情页 URL，用于 Referer
 */
async function parseAttachment(url, referer) {
  const ext = getUrlExtension(url);

  if (![".docx", ".doc", ".xlsx", ".xls"].includes(ext)) {
    return "";
  }

  if (ext === ".doc") {
    console.warn("[附件] .doc 旧版格式 mammoth 不支持，已跳过:", url);
    return "";
  }

  try {
    const buffer = await downloadAttachmentBuffer(url, referer || url);

    if (process.env.SPIDER_DEBUG_ATTACH === "1") {
      const debugDir = path.join(__dirname, "_attachment_debug");
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const safeName =
        path.basename(new URL(url).pathname) || `attach-${Date.now()}.bin`;
      fs.writeFileSync(path.join(debugDir, safeName), buffer);
    }

    if (ext === ".docx") {
      const { value } = await mammoth.extractRawText({ buffer });
      const text = normalizeWhitespace(value);
      console.log(`[附件解析] docx → ${text.length} 字`);
      return text;
    }

    if (ext === ".xlsx" || ext === ".xls") {
      const text = parseExcelBuffer(buffer);
      console.log(`[附件解析] ${ext} → ${text.length} 字`);
      return text;
    }

    return "";
  } catch (err) {
    console.error(`[附件] 解析失败 ${url}: ${err.message}`);
    return "";
  }
}

async function appendAttachmentsToContent(html, pageUrl, content) {
  const attachmentUrls = findAttachmentUrls(html, pageUrl);

  if (attachmentUrls.length === 0) {
    return content;
  }

  console.log(`[附件] 发现 ${attachmentUrls.length} 个候选链接`);

  const attachmentTexts = [];

  for (const attachUrl of attachmentUrls) {
    if (circuitTripped) break;

    const fileName = (() => {
      try {
        return path.basename(new URL(attachUrl).pathname);
      } catch {
        return attachUrl;
      }
    })();

    const text = await parseAttachment(attachUrl, pageUrl);
    if (text) {
      attachmentTexts.push(`【${fileName}】\n${text}`);
    }
  }

  if (attachmentTexts.length === 0) {
    return content;
  }

  const merged =
    content +
    "\n--- 附件内容 ---\n" +
    attachmentTexts.join("\n\n");

  console.log(
    `[附件] 已合并 ${attachmentTexts.length} 个附件，总正文 ${merged.length} 字`,
  );

  return merged;
}

async function fetchJobContent(detailUrl, school) {
  if (circuitTripped) {
    console.warn("[正文] 熔断中，跳过:", detailUrl);
    return "";
  }

  console.log(`\n[正文][${school.name}] ${detailUrl}`);

  try {
    const html = await fetchPageSafely(detailUrl, {
      referer: school.listUrl,
      pauseBefore: `详情页请求前（${school.name}）`,
      pauseAfter: `详情页请求后（${school.name}）`,
    });

    const $ = cheerio.load(html);
    let content = extractArticleContent($, school.contentSelector);
    content = await appendAttachmentsToContent(html, detailUrl, content);

    return content;
  } catch (err) {
    console.error(`[正文] 抓取失败，content 留空: ${err.message}`);
    return "";
  }
}

function cleanDateText(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/[[\]【】]/g, "")
    .trim();
}

function extractPublishedAt($, el, dateSelectorStr) {
  const $el = $(el);
  const parts = splitSelectors(dateSelectorStr);

  for (const sel of parts) {
    let raw = "";

    if (sel === "span:last-child") {
      raw = $el.find("span").last().text();
    } else {
      raw = $el.find(sel).first().text();
    }

    const cleaned = cleanDateText(raw);
    if (cleaned) return cleaned;
  }

  return "";
}

function findListNodes($, listSelectorStr) {
  for (const sel of splitSelectors(listSelectorStr)) {
    const found = $(sel);
    if (found.length > 0) {
      console.log(`[解析] 命中列表选择器「${sel}」共 ${found.length} 条`);
      return found;
    }
  }
  return null;
}

/** 按学校规则校验是否为真公告详情链接（非导航杂质） */
function isValidAnnouncementLink(school, link) {
  const rule = school.linkMustInclude;
  if (!rule) return true;

  if (!link.includes(rule)) {
    return false;
  }
  return true;
}

function parseJobList(html, baseUrl, school) {
  const $ = cheerio.load(html);
  const items = [];

  const nodes = findListNodes($, school.listSelector);

  if (!nodes || nodes.length === 0) {
    console.log(`[解析][${school.name}] 未命中列表，启用 a 标签兜底`);
    $("a[href]").each((_, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href");
      if (title.length < 4 || !href) return;

      const link = resolveUrl(href, baseUrl);
      if (!isValidAnnouncementLink(school, link)) return;

      items.push({
        schoolName: school.name,
        title: `[${school.name}] ${title}`,
        link,
        publishedAt: "",
        content: "",
      });
    });
    return items.slice(0, MAX_LIST_ITEMS_PER_SCHOOL);
  }

  let filteredNav = 0;

  nodes.each((_, el) => {
    const aTag = $(el).find("a").first();
    if (aTag.length === 0) return;

    const title = aTag.text().trim();
    const href = aTag.attr("href");
    if (!title || title.length < 4 || !href) return;

    const link = resolveUrl(href, baseUrl);

    if (!isValidAnnouncementLink(school, link)) {
      filteredNav += 1;
      return;
    }

    items.push({
      schoolName: school.name,
      title: `[${school.name}] ${title}`,
      link,
      publishedAt: extractPublishedAt($, el, school.dateSelector),
      content: "",
    });
  });

  if (filteredNav > 0) {
    console.log(
      `[解析][${school.name}] 已过滤 ${filteredNav} 条非公告链接（需含 ${school.linkMustInclude}）`,
    );
  }

  console.log(`[解析][${school.name}] 有效列表 ${items.length} 条`);
  return items.slice(0, MAX_LIST_ITEMS_PER_SCHOOL);
}

function resolveUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

async function upsertRawJob(job) {
  return prisma.rawJob.upsert({
    where: { link: job.link },
    create: {
      title: job.title,
      link: job.link,
      publishedAt: job.publishedAt || "",
      content: job.content || null,
    },
    update: {
      title: job.title,
      publishedAt: job.publishedAt || "",
      content: job.content || null,
    },
  });
}

/** 抓取并入库一所学校 */
async function crawlSchool(school) {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  开始爬取：${school.name}`);
  console.log(`  列表页：${school.listUrl}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const stats = { school: school.name, listed: 0, skipped: 0, fetched: 0, saved: 0 };

  const listHtml = await fetchPageSafely(school.listUrl, {
    referer: school.homeUrl,
    pauseBefore: `列表页请求前（${school.name}）`,
    pauseAfter: `列表页请求后（${school.name}）`,
  });

  const listJobs = parseJobList(listHtml, school.listUrl, school).slice(
    0,
    MAX_LIST_ITEMS_PER_SCHOOL,
  );

  stats.listed = listJobs.length;

  if (listJobs.length === 0) {
    console.log(`[${school.name}] 未解析到列表，跳过`);
    return stats;
  }

  console.log(
    `[二级抓取][${school.name}] 增量模式，待检 ${listJobs.length} 条…`,
  );

  for (let i = 0; i < listJobs.length; i++) {
    if (circuitTripped) {
      console.warn(`[${school.name}] 熔断触发，停止详情抓取`);
      break;
    }

    const job = listJobs[i];

    const exists = await prisma.rawJob.findUnique({
      where: { link: job.link },
    });

    if (exists) {
      console.log(`[增量跳过][${school.name}] ${job.title}`);
      stats.skipped += 1;
      continue;
    }

    console.log(
      `\n[进度][${school.name}] ${i + 1}/${listJobs.length} · ${job.title}`,
    );

    job.content = await fetchJobContent(job.link, school);
    stats.fetched += 1;

    try {
      await upsertRawJob(job);
      stats.saved += 1;
      console.log(`  ✓ 入库 | 正文 ${(job.content || "").length} 字`);
    } catch (err) {
      console.error(`  ✗ 入库失败: ${err.message}`);
    }
  }

  return stats;
}

async function main() {
  console.log("════════════════════════════════════════");
  console.log("  anBian-web · 多校安全爬虫");
  console.log("════════════════════════════════════════");
  console.log(
    `[配置] 共 ${SCHOOL_CONFIGS.length} 所高校 · 每校最多 ${MAX_LIST_ITEMS_PER_SCHOOL} 条`,
  );
  console.log("[策略] 串行 · 随机 UA · 3–7s 延迟 · 增量跳过 · 失败熔断\n");

  const allStats = [];

  try {
    for (let i = 0; i < SCHOOL_CONFIGS.length; i++) {
      if (circuitTripped) break;

      const school = SCHOOL_CONFIGS[i];

      if (i > 0) {
        await humanPause(`切换学校（即将爬取 ${school.name}）`);
      }

      const stats = await crawlSchool(school);
      allStats.push(stats);
    }

    console.log("\n══════════ 本轮汇总 ══════════");
    for (const s of allStats) {
      console.log(
        `  ${s.school}：列表 ${s.listed} · 跳过 ${s.skipped} · 新抓 ${s.fetched} · 入库 ${s.saved}`,
      );
    }

    const totalSaved = allStats.reduce((n, s) => n + s.saved, 0);
    console.log(`\n[完成] 各校合计新入库 ${totalSaved} 条。`);
  } catch (err) {
    if (circuitTripped) process.exitCode = 1;
    console.error("\n[终止]", err?.message || "抓取流程已安全退出");
  } finally {
    await prisma.$disconnect();
  }
}

main();
