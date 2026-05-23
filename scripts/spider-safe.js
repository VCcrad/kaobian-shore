/**
 * anBian-web · 多高校招聘官网安全爬虫（列表 + 详情正文 + 附件穿透解析 + 入库）
 * 运行：node scripts/spider-safe.js
 *
 * 附件穿透：XLSX / pdf-parse / mammoth(docx) / axios（arraybuffer 下载二进制流）
 * 规范：本文件仅 CommonJS（require），禁止 import，避免终端闪退。
 */

const { PrismaClient } = require("@prisma/client");
const XLSX = require("xlsx");
const pdfParse = require("pdf-parse");
const axios = require("axios");
const mammoth = require("mammoth");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const { runTrashJanitor } = require("../lib/trash-janitor.cjs");

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const prisma =
  globalThis.prismaSpider ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL ?? "file:./dev.db",
    }),
  });
if (process.env.NODE_ENV !== "production") {
  globalThis.prismaSpider = prisma;
}
const {
  DIFY_CLASSIFICATION_GUIDE,
  logBlueListRejected,
  passesBlueListGate,
  titlePassesBlueList,
} = require("../lib/track-filters.cjs"); // 单源策略：BlueList + 分类 Prompt

// ─── 附件穿透解析（xls / xlsx / pdf / docx）──────────────────────────────

/** 单条详情页最多解析附件数，防止 Token 撑爆 */
const MAX_ATTACHMENTS_PER_PAGE = 3;

const ATTACHMENT_EXT_RE = /\.(xlsx|xls|pdf|docx)(\?|#|$)/i;

const ATTACHMENT_SCAN_EXTS = [".xls", ".xlsx", ".pdf", ".docx"];

/** 通用内容净化网：导航/页脚杂质词（命中 >3 个即拦截） */
const SPAM_NAV_WORDS = [
  "站内搜索",
  "版权所有",
  "办事指南",
  "机构设置",
  "政策规章",
  "师资队伍",
  "常用下载",
  "联系我们",
];

/** 招聘核心词：正文须至少命中其一 */
const RECRUITMENT_KEYWORDS = [
  "招聘",
  "公告",
  "岗位",
  "计划",
  "人员",
  "选聘",
  "编制",
];

const MIN_VALID_CONTENT_LENGTH = 150;
const MAX_SPAM_NAV_WORD_HITS = 3;

/** 红榜特征词：拟聘用/录用结果类马后炮公示 */
const RED_LIST_KEYWORDS = [
  "拟聘用",
  "拟录用",
  "录用名单",
  "聘用人员公示",
  "入围名单",
  "结果公示",
];

/** 正文同时命中以下词组 → 录用结果公示特征 */
const RED_LIST_CONTENT_MARKERS = ["拟聘用", "公示期", "名单如下"];

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
  {
    name: "山东大学",
    homeUrl: "https://www.rsrczp.sdu.edu.cn/index.htm",
    listUrl: "https://www.rsrczp.sdu.edu.cn/index/zpgg.htm",
    /**
     * 列表 DOM：ul.list > li > a(标题) + span(日期)
     * 首页 15 条中约 10 条为各学院外链域名，约 5 条为本站 rsrczp；
     * 勿设 linkHostIncludes，否则 15 条会被砍成 5 条。
     */
    listSelector: "ul.list li, .list li",
    dateSelector: "span",
    contentSelector: ".v_news_content, #vsb_content, .wp_article_content",
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

/** 通用 DOM 净化：正文提取前移除导航/页脚等噪声节点 */
function purifyDom($) {
  $(
    "nav, footer, header, script, style, .sidebar, #sidebar, .footer, #footer, .header, #header, .nav, #nav, .menu, #menu",
  ).remove();
  $("noscript, iframe").remove();
}

/**
 * 通用正文熔断器：拦截导航杂质页、过短页、无招聘信号页
 * @returns {{ valid: boolean, content: string, reason: string }}
 */
function sanitizeAnnouncementContent(rawContent) {
  const content = normalizeWhitespace(rawContent);

  if (!content) {
    return { valid: false, content: "", reason: "正文为空" };
  }

  if (content.length < MIN_VALID_CONTENT_LENGTH) {
    return {
      valid: false,
      content: "",
      reason: `正文过短（${content.length} 字 < ${MIN_VALID_CONTENT_LENGTH}）`,
    };
  }

  const spamHits = SPAM_NAV_WORDS.filter((word) => content.includes(word));
  if (spamHits.length > MAX_SPAM_NAV_WORD_HITS) {
    return {
      valid: false,
      content: "",
      reason: `导航杂质词命中 ${spamHits.length} 个（>${MAX_SPAM_NAV_WORD_HITS}）：${spamHits.join("、")}`,
    };
  }

  const hasRecruitmentSignal = RECRUITMENT_KEYWORDS.some((word) =>
    content.includes(word),
  );
  if (!hasRecruitmentSignal) {
    return {
      valid: false,
      content: "",
      reason: `缺少招聘核心词（需含：${RECRUITMENT_KEYWORDS.join(" / ")} 之一）`,
    };
  }

  return { valid: true, content, reason: "" };
}

/** 反向特征熔断：拦截拟聘用/录用结果等马后炮公示 */
function isRedListAnnouncement(title, content) {
  const titleText = String(title ?? "");
  const bodyText = String(content ?? "");

  if (RED_LIST_KEYWORDS.some((word) => titleText.includes(word))) {
    return true;
  }

  if (RED_LIST_CONTENT_MARKERS.every((word) => bodyText.includes(word))) {
    return true;
  }

  return false;
}

function logRedListBlocked(title) {
  console.log(`[拦截红榜] 自动过滤马后炮公示: ${title}`);
}

function applyRedListFilter(title, content) {
  if (!isRedListAnnouncement(title, content)) {
    return content;
  }

  logRedListBlocked(title);
  return "";
}

/** 列表阶段：标题须含 BlueList 任一关键词 */
function filterListItemByBlueList(schoolName, title) {
  const fullTitle = String(title ?? "").trim();
  if (titlePassesBlueList(fullTitle)) {
    return true;
  }
  logBlueListRejected(fullTitle || `[${schoolName}] (空标题)`);
  return false;
}

/** 正文阶段：标题+正文须含 BlueList 任一关键词，否则 content 置空 */
function applyBlueListFilter(title, content) {
  if (passesBlueListGate(title, content)) {
    return content;
  }
  logBlueListRejected(title);
  return "";
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

    if (response.status === 404 && options.allowNotFound) {
      const notFoundErr = new Error("HTTP 404 Not Found");
      notFoundErr.code = "HTTP_NOT_FOUND";
      throw notFoundErr;
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
    const isSkippable404 =
      options.allowNotFound && err.code === "HTTP_NOT_FOUND";

    if (!isSkippable404) {
      consecutiveFailures += 1;
      console.error("[错误] 请求失败:", err.message);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        tripCircuit(`连续失败 ${consecutiveFailures} 次`);
      }
    }

    throw err;
  }
}

function extractArticleContent($, contentSelectorStr) {
  purifyDom($);

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
    const match = String(url).match(/\.(xlsx|xls|pdf|docx)(\?|#|$)/i);
    return match ? `.${match[1].toLowerCase()}` : "";
  }
}

function hrefLooksLikeAttachment(href) {
  const lower = String(href).toLowerCase().split("?")[0].split("#")[0];
  return ATTACHMENT_SCAN_EXTS.some((ext) => lower.endsWith(ext));
}

/** 扫描详情页 <a>，收集 xls / xlsx / pdf / docx 绝对链接（最多 MAX_ATTACHMENTS_PER_PAGE 个） */
function findAttachmentUrls(html, pageUrl) {
  const $ = cheerio.load(html);
  const urls = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      return;
    }

    if (!hrefLooksLikeAttachment(href)) return;

    const withoutQuery = href.split("?")[0];
    if (!ATTACHMENT_EXT_RE.test(withoutQuery)) return;

    try {
      const absolute = resolveUrl(href, pageUrl);
      if (!urls.includes(absolute)) {
        urls.push(absolute);
      }
    } catch {
      /* 无效链接跳过 */
    }
  });

  return urls.slice(0, MAX_ATTACHMENTS_PER_PAGE);
}

const DEFAULT_ATTACH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** mammoth：.docx → 纯文本（不支持旧版 .doc） */
async function extractDocxText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return String(result?.value ?? "").trim();
}

/** pdf-parse v1 函数式；v2 为 PDFParse 类（当前 npm 包） */
async function extractPdfText(buffer) {
  if (typeof pdfParse === "function") {
    const pdfData = await pdfParse(buffer);
    return pdfData?.text ?? "";
  }

  const Parser = pdfParse.PDFParse;
  if (typeof Parser !== "function") {
    throw new Error("pdf-parse 未导出可用的解析接口");
  }

  const parser = new Parser({ data: buffer });
  try {
    const result = await parser.getText();
    return result?.text ?? "";
  } finally {
    if (typeof parser.destroy === "function") {
      await parser.destroy();
    }
  }
}

/** Excel 工作表 → 纯文本（sheet_to_txt 对部分政府 xlsx 会 UTF-16 乱码，改用 csv/json） */
function worksheetToPlainText(worksheet) {
  if (!worksheet || !worksheet["!ref"]) return "";

  try {
    return XLSX.utils.sheet_to_csv(worksheet, {
      FS: "\t",
      RS: "\n",
      raw: false,
      blankrows: false,
    });
  } catch {
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    return rows
      .map((row) =>
        row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join("\t"),
      )
      .filter((line) => line.length > 0)
      .join("\n");
  }
}

async function parseAttachmentToText(fileUrl, referer) {
  try {
    const ext = getUrlExtension(fileUrl).toLowerCase();
    if (![".xlsx", ".xls", ".pdf", ".docx"].includes(ext)) return "";

    const response = await axios({
      method: "get",
      url: fileUrl,
      responseType: "arraybuffer",
      timeout: 15000,
      headers: buildSafeHeaders(referer),
    });
    const buffer = response.data;

    if (ext === ".xlsx" || ext === ".xls") {
      const u8array = new Uint8Array(buffer);
      const workbook = XLSX.read(u8array, { type: "array" });
      let excelText = "";
      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) return;
        excelText += `\n--- 工作表: ${sheetName} ---\n${worksheetToPlainText(sheet)}`;
      });
      return excelText.trim();
    }
    if (ext === ".pdf") {
      if (typeof pdfParse === "function") {
        const pdfData = await pdfParse(buffer);
        return pdfData.text;
      }
      const parser = new pdfParse.PDFParse({ data: Buffer.from(buffer) });
      try {
        const result = await parser.getText();
        return result?.text ?? "";
      } finally {
        if (typeof parser.destroy === "function") await parser.destroy();
      }
    }
    if (ext === ".docx") {
      const docResult = await mammoth.extractRawText({ buffer: buffer });
      return docResult.value;
    }
    return "";
  } catch (err) {
    console.log(
      `[附件穿透失败] 无法解析附件: ${fileUrl}, 错误: ${err.message}`,
    );
    return "";
  }
}

/**
 * 详情页正文抓取后：扫描附件链接并拼接「附件透视文本」
 */
async function appendAttachmentsToContent(html, pageUrl, content) {
  const attachmentUrls = findAttachmentUrls(html, pageUrl);

  if (attachmentUrls.length === 0) {
    console.log(
      "[附件] 未发现可下载的 .xls / .xlsx / .pdf / .docx 链接（仅文字提及附件不会触发穿透）",
    );
    return content;
  }

  console.log(
    `[附件] 发现 ${attachmentUrls.length} 个候选（最多处理 ${MAX_ATTACHMENTS_PER_PAGE} 个）`,
  );

  let mergedCount = 0;

  for (const url of attachmentUrls) {
    if (circuitTripped) break;

    const attachmentText = await parseAttachmentToText(url, pageUrl);

    if (attachmentText && attachmentText.trim()) {
      const fileName = decodeURIComponent(
        String(url.split("/").pop() || "附件").split("?")[0],
      );
      content += `\n\n--- 发现附件透视文本: ${fileName} ---\n${attachmentText}`;
      mergedCount += 1;
      console.log(`[附件穿透成功] 已成功扒出附件文本并追加至正文末尾`);
    }
  }

  if (mergedCount > 0) {
    console.log(
      `[附件] 共穿透合并 ${mergedCount} 个附件，总正文 ${content.length} 字`,
    );
  }

  return content;
}

/**
 * 正文抓取 + 附件穿透（不做蓝榜/红榜/净化过滤，供单点测试导出）
 */
async function fetchJobContentWithAttachments(detailUrl, school) {
  if (circuitTripped) {
    console.warn("[正文] 熔断中，跳过:", detailUrl);
    return "";
  }

  console.log(`\n[正文][${school.name}] ${detailUrl}`);

  const html = await fetchPageSafely(detailUrl, {
    referer: school.listUrl || detailUrl,
    allowNotFound: true,
    pauseBefore: `详情页请求前（${school.name}）`,
    pauseAfter: `详情页请求后（${school.name}）`,
  });

  const $ = cheerio.load(html);
  let content = extractArticleContent($, school.contentSelector);
  return appendAttachmentsToContent(html, detailUrl, content);
}

async function fetchJobContent(detailUrl, school, title = "") {
  if (circuitTripped) {
    console.warn("[正文] 熔断中，跳过:", detailUrl);
    return "";
  }

  try {
    let content = await fetchJobContentWithAttachments(detailUrl, school);

    const purified = sanitizeAnnouncementContent(content);
    if (!purified.valid) {
      console.warn(`[净化拦截] 非招聘公告杂质页 · ${purified.reason}`);
      return "";
    }

    const afterRedList = applyRedListFilter(title, purified.content);
    if (!afterRedList) {
      return "";
    }

    const afterBlueList = applyBlueListFilter(title, afterRedList);
    if (!afterBlueList) {
      return "";
    }

    console.log(`[净化通过] 有效正文 ${afterBlueList.length} 字`);
    return afterBlueList;
  } catch (err) {
    if (err.code === "HTTP_NOT_FOUND") {
      console.warn(`[URL错漏] 链接地址有误: ${detailUrl}`);
      return null;
    }
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
  if (school.linkHostIncludes) {
    try {
      const host = new URL(link).hostname;
      if (!host.includes(school.linkHostIncludes)) {
        return false;
      }
    } catch {
      return false;
    }
  }

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
      if (!link || !isValidAnnouncementLink(school, link)) return;

      const fullTitle = `[${school.name}] ${title}`;
      if (!filterListItemByBlueList(school.name, fullTitle)) return;

      items.push({
        schoolName: school.name,
        title: fullTitle,
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
    if (!link) return;

    if (!isValidAnnouncementLink(school, link)) {
      filteredNav += 1;
      return;
    }

    const fullTitle = `[${school.name}] ${title}`;
    if (!filterListItemByBlueList(school.name, fullTitle)) return;

    items.push({
      schoolName: school.name,
      title: fullTitle,
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

  if (school.linkHostIncludes) {
    console.log(
      `[解析][${school.name}] 域名限定 ${school.linkHostIncludes}，当前有效列表 ${items.length} 条`,
    );
  } else {
    console.log(`[解析][${school.name}] 有效列表 ${items.length} 条`);
  }
  return items.slice(0, MAX_LIST_ITEMS_PER_SCHOOL);
}

/** 已是 http(s) 绝对地址则原样返回，避免与列表 base 二次拼接 */
function isAbsoluteHttpUrl(href) {
  return /^https?:\/\//i.test(String(href ?? "").trim());
}

/**
 * 列表/详情页链接规范化：跨二级域名外链直接使用绝对 URL
 * @param {string} href a 标签原始 href
 * @param {string} listOrPageUrl 当前列表页或详情页 URL（作相对路径基准）
 */
function resolveUrl(href, listOrPageUrl) {
  const raw = String(href ?? "").trim();
  if (!raw || raw.startsWith("javascript:") || raw.startsWith("mailto:")) {
    return "";
  }

  if (isAbsoluteHttpUrl(raw)) {
    return raw;
  }

  if (raw.startsWith("//")) {
    try {
      return new URL(raw, listOrPageUrl).href;
    } catch {
      return raw;
    }
  }

  try {
    return new URL(raw, listOrPageUrl).href;
  } catch {
    return raw;
  }
}

function schoolStatusId(schoolName) {
  return String(schoolName).trim();
}

/** 写入 / 更新高校爬虫健康战报 */
async function upsertSchoolStatus({
  schoolName,
  status,
  successCount,
  errorMsg,
}) {
  const name = String(schoolName).trim();
  const id = schoolStatusId(name);

  try {
    await prisma.schoolStatus.upsert({
      where: { schoolName: name },
      create: {
        id,
        schoolName: name,
        lastRunTime: new Date(),
        status,
        successCount: successCount ?? 0,
        errorMsg: errorMsg ?? null,
      },
      update: {
        lastRunTime: new Date(),
        status,
        successCount: successCount ?? 0,
        errorMsg: errorMsg ?? null,
      },
    });
    console.log(
      `[健康监控] ${name} → ${status} · 入库 ${successCount ?? 0}${
        errorMsg ? ` · ${errorMsg}` : ""
      }`,
    );
  } catch (err) {
    console.error(`[健康监控] 写入 SchoolStatus 失败: ${err.message}`);
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

  let successCount = 0;

  const stats = {
    school: school.name,
    listed: 0,
    skipped: 0,
    fetched: 0,
    rejected: 0,
    saved: 0,
    successCount: 0,
  };

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

    if (isRedListAnnouncement(job.title, "")) {
      logRedListBlocked(job.title);
      stats.rejected += 1;
      continue;
    }

    job.content = await fetchJobContent(job.link, school, job.title);
    stats.fetched += 1;

    if (job.content == null) {
      console.log(`  ⊘ 跳过 · 详情页 404 或链接无效，不入库`);
      stats.rejected += 1;
      continue;
    }

    if (!job.content.trim()) {
      console.log(`  ⊘ 拦截跳过 · 无有效正文（含红榜/赛道/净化），不入库 RawJob`);
      stats.rejected += 1;
      continue;
    }

    try {
      await upsertRawJob(job);
      stats.saved += 1;
      successCount += 1;
      console.log(`  ✓ 入库 | 正文 ${job.content.length} 字`);
    } catch (err) {
      console.error(`  ✗ 入库失败: ${err.message}`);
    }
  }

  stats.successCount = successCount;
  return stats;
}

/** 智能过期清道夫：过期即软删除 + 垃圾桶 7 天物理蒸发 */
async function runSpiderTrashJanitor() {
  console.log("\n[清道夫] 启动智能垃圾桶维护…");
  console.log("[清道夫] 前台规则：已过期或无有效截止日期（如「未明确」）即入桶");
  console.log("[清道夫] 蒸发阈值：deletedAt 早于 7 天前");

  const result = await runTrashJanitor(prisma);

  console.log(
    `[清道夫] 完成 · 过期软删 Job ${result.softDeleted} 条 · 物理蒸发 Job ${result.evaporatedJobs} · RawJob ${result.evaporatedRawJobs}\n`,
  );
}

async function main() {
  console.log("════════════════════════════════════════");
  console.log("  anBian-web · 多校安全爬虫");
  console.log("════════════════════════════════════════");
  console.log(
    `[配置] 共 ${SCHOOL_CONFIGS.length} 所高校 · 每校最多 ${MAX_LIST_ITEMS_PER_SCHOOL} 条`,
  );
  console.log(
    "[策略] 串行 · 随机 UA · 3–7s 延迟 · 增量跳过 · 净化网 · 红榜/赛道准入 · 清道夫 · 失败熔断\n",
  );
  console.log(
    "[Dify] 分类 Prompt 请在工作流中引用 inputs.classification_guide，详见 lib/track-filters.js\n",
  );
  console.log(DIFY_CLASSIFICATION_GUIDE.split("\n")[0] + "…\n");

  await runSpiderTrashJanitor();

  const allStats = [];

  for (let i = 0; i < SCHOOL_CONFIGS.length; i++) {
    if (circuitTripped) break;

    const school = SCHOOL_CONFIGS[i];

    if (i > 0) {
      await humanPause(`切换学校（即将爬取 ${school.name}）`);
    }

    try {
      const stats = await crawlSchool(school);
      allStats.push(stats);

      await upsertSchoolStatus({
        schoolName: school.name,
        status: "HEALTHY",
        successCount: stats.successCount,
        errorMsg: null,
      });
    } catch (err) {
      const message = err?.message || String(err);
      console.error(`\n[学校异常] ${school.name} 抓取失败，继续下一所: ${message}`);

      await upsertSchoolStatus({
        schoolName: school.name,
        status: "BROKEN",
        successCount: 0,
        errorMsg: message,
      });

      allStats.push({
        school: school.name,
        listed: 0,
        skipped: 0,
        fetched: 0,
        rejected: 0,
        saved: 0,
        successCount: 0,
        broken: true,
      });
    }
  }

  try {
    console.log("\n══════════ 本轮汇总 ══════════");
    for (const s of allStats) {
      const tag = s.broken ? " · ⚠ BROKEN" : "";
      console.log(
        `  ${s.school}：列表 ${s.listed} · 跳过 ${s.skipped} · 新抓 ${s.fetched} · 净化拦截 ${s.rejected} · 入库 ${s.saved}${tag}`,
      );
    }

    const totalSaved = allStats.reduce((n, s) => n + s.saved, 0);
    console.log(`\n[完成] 各校合计新入库 ${totalSaved} 条。`);

    if (circuitTripped) process.exitCode = 1;
  } catch (err) {
    console.error("\n[汇总异常]", err?.message);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  fetchJobContent,
  fetchJobContentWithAttachments,
  parseAttachmentToText,
  SCHOOL_CONFIGS,
};

if (require.main === module) {
  main();
}
