/**
 * anBian-web · 可配置来源爬虫（Source → JobPosting）
 *
 * 运行：
 *   npx tsx scripts/crawler.ts
 *   npx tsx scripts/crawler.ts --source="湖南大学"
 *   npx tsx scripts/crawler.ts --full
 *   npx tsx scripts/crawler.ts --dry-run
 */

import axios, { type AxiosError } from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import type { Prisma, Source } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import {
  parseAttachmentWithMainText,
  parseMainText,
  mergeHybridParseResults,
  extractStructuredJobsFromParseResults,
  structuredJobToCrawlerItem,
  type ParsedRequirements,
  type ParseResult,
} from "../lib/parse-attachment";
import { normalizeEducationValue } from "../lib/education-utils.js";
import { isLikelyMajorCell, MAJOR_FALLBACK_LABEL } from "../lib/major-utils.js";
import { parseDeadlineDate } from "../lib/deadline-utils.js";
import {
  isGarbledText,
  containsWebScrapJunk,
  sanitizeOrganizationName,
  sanitizeJobPostingTitle,
  isBadJobCardTitle,
  pickJobCardTitle,
} from "../lib/job-posting-text.js";
import {
  isRegistrationFormAttachment,
  parseUniversityJobsFromProse,
} from "../lib/parse-university-prose.js";
import {
  passesRecruitmentAnnouncementFilter,
  isNavigationMenuText,
  isLikelyUniversityDetailUrl,
  isLikelyColumnNavUrl,
} from "../lib/recruitment-announcement-filters.js";
import {
  parseRecruitmentTablesFromHtml,
  serializeRecruitmentTablesFromHtml,
} from "../lib/parse-html-recruitment-table.js";

const require = createRequire(import.meta.url);
const { parseStructuredJobsFromLines } = require("../lib/parse-hunan-structured-jobs.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const SUPPORTED_ATTACHMENT_EXTS = [".xlsx", ".xls", ".pdf", ".docx"];

type ParserConfig = {
  type?: string;
  listUrl?: string;
  listSelector?: string;
  linkSelector?: string;
  dateSelector?: string;
  linkMustInclude?: string;
  linkHostIncludes?: string;
  detailContentSelectors?: string[];
  maxListItems?: number;
  maxAttachments?: number;
  requestDelayMs?: number;
  province?: string;
};

const DEFAULT_HUNAN_RST_CONFIG: ParserConfig = {
  type: "hunan-rst",
  listUrl: "https://rst.hunan.gov.cn/rst/xxgk/zpzl/sydwzp/index.html",
  listSelector: "ul.list li, .list li, table.list tr, .xxgk-list li",
  linkSelector: "a",
  dateSelector: "span, em, .time, td:last-child",
  linkMustInclude: "sydwzp",
  detailContentSelectors: [
    "#content",
    ".content",
    ".TRS_Editor",
    ".zw",
    "article",
    ".main",
  ],
  maxListItems: 15,
  maxAttachments: 3,
  requestDelayMs: 2000,
};

/** [NEW] 湖南重点高校列表页默认解析配置（与 parser-config-hunan-university.json 一致） */
const DEFAULT_HUNAN_UNIVERSITY_CONFIG: ParserConfig = {
  type: "hunan-university",
  listSelector: "ul.list li, .news-list li, .newslist li, .news_list li, .xxgk-list li, table tr",
  linkSelector: "a",
  dateSelector: "span, .time, .date, td:last-child",
  linkMustInclude: "/info/",
  detailContentSelectors: [
    "#vsb_content",
    ".v_news_content",
    ".wp_articlecontent",
    ".TRS_Editor",
    ".view-content",
    ".news-content",
    ".article",
    ".content-main",
    "#article",
    ".xxgk-content",
    ".content",
    "#content",
    "article",
    ".main",
  ],
  maxListItems: 20,
  maxAttachments: 3,
  requestDelayMs: 1500,
};

/** [NEW] 高校详情页常见反爬 / 内联 JS 片段（extractDetailText 会剔除） */
const JS_ANTI_CRAWL_PATTERNS: RegExp[] = [
  /function\s+dosubao\s*\([^)]*\)\s*\{[\s\S]*?\}/gi,
  /function\s+_nl_ys_check\s*\([^)]*\)\s*\{[\s\S]*?\}/gi,
  /function\s+_nl_\w+\s*\([^)]*\)\s*\{[\s\S]*?\}/gi,
  /var\s+_nl_\w+\s*=[\s\S]*?;/gi,
  /document\.(?:write|cookie|getElementById|createElement)\([^)]*\)/gi,
  /window\.(?:location|open|onload)\b[^;]*/gi,
  /eval\s*\([^)]*\)/gi,
  /\$\(\s*['"][^'"]+['"]\s*\)\.(?:html|text|click|ready)\([^)]*\)/gi,
];

const SUPPORTED_PARSER_TYPES = new Set([
  "hunan-rst",
  "generic-list",
  "hunan-university",
]);

/** 增量模式：lastCrawled 向前缓冲，避免漏抓边界公告 */
const INCREMENTAL_BUFFER_MS = 48 * 60 * 60 * 1000;
/** 全量模式单来源列表上限（--full） */
const FULL_CRAWL_MAX_LIST_ITEMS = 500;

type CrawlOptions = {
  dryRun: boolean;
  /** true = --full 强制全量；false = 默认增量（lastCrawled + 48h 缓冲） */
  fullMode: boolean;
};

type ListAnnouncement = {
  title: string;
  url: string;
  publishDate?: Date;
  publishDateLabel?: string;
};

type CrawlStats = {
  listed: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};

type StructuredHunanJob = {
  title: string;
  organization?: string;
  publishDate?: string;
  deadline?: string;
  majorRequirement?: string;
  ageRequirement?: string;
  education?: string;
  otherRequirement?: string;
  slots?: number;
  text?: string;
  id?: string;
};

// ─── 环境 & Prisma ───────────────────────────────────────────────

function loadEnvFile(relativePath: string) {
  const envPath = path.join(ROOT, relativePath);
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

loadEnvFile(".env");
loadEnvFile(".env.local");

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

// ─── CLI ─────────────────────────────────────────────────────────

function parseCliArgs() {
  const args = process.argv.slice(2);
  let sourceName: string | undefined;
  let dryRun = false;
  let fullMode = false;

  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--full") fullMode = true;
    else if (arg.startsWith("--source=")) {
      sourceName = arg.slice("--source=".length).replace(/^["']|["']$/g, "");
    }
  }

  return { sourceName, dryRun, fullMode };
}

function resolveCrawlModeLabel(fullMode: boolean): string {
  return fullMode ? "全量模式" : "增量模式";
}

/** 增量截止点：lastCrawled 往前 48h；全量或无 lastCrawled 时返回 null */
function getIncrementalCutoff(source: Source, fullMode: boolean): Date | null {
  if (fullMode) return null;
  if (!source.lastCrawled) return null;
  return new Date(source.lastCrawled.getTime() - INCREMENTAL_BUFFER_MS);
}

function formatCutoffForLog(cutoff: Date): string {
  return cutoff.toISOString().slice(0, 19).replace("T", " ");
}

function resolveMaxListItems(config: ParserConfig, fullMode: boolean): number {
  if (fullMode) return FULL_CRAWL_MAX_LIST_ITEMS;
  return config.maxListItems ?? 15;
}

/** 增量：仅保留 publishDate >= cutoff 的公告（无日期则保留以防漏抓） */
function filterAnnouncementsByIncrementalCutoff(
  announcements: ListAnnouncement[],
  cutoff: Date | null,
  fullMode: boolean,
): ListAnnouncement[] {
  if (fullMode || !cutoff) return announcements;

  return announcements.filter((item) => {
    if (!item.publishDate) return true;
    return item.publishDate.getTime() >= cutoff.getTime();
  });
}

// ─── 工具函数 ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(text: string) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function getUrlExtension(url: string): string {
  try {
    return path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    const match = String(url).match(/\.(xlsx|xls|pdf|docx)(\?|#|$)/i);
    return match ? `.${match[1].toLowerCase()}` : "";
  }
}

function resolveAttachmentFileType(
  url: string,
): "pdf" | "xlsx" | "docx" | null {
  const ext = getUrlExtension(url);
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx" || ext === ".xls") return "xlsx";
  return null;
}

function parsePublishDateLabel(text: string): Date | undefined {
  const value = String(text ?? "").trim();
  if (!value) return undefined;

  const iso = value.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (iso) {
    const date = new Date(
      `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}T12:00:00+08:00`,
    );
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const cn = value.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cn) {
    const date = new Date(
      `${cn[1]}-${cn[2].padStart(2, "0")}-${cn[3].padStart(2, "0")}T12:00:00+08:00`,
    );
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
}

function mergeParserConfig(source: Source): ParserConfig {
  const raw = (source.parserConfig ?? {}) as ParserConfig;
  const type = raw.type ?? "hunan-rst";

  if (type === "hunan-rst") {
    return {
      ...DEFAULT_HUNAN_RST_CONFIG,
      ...raw,
      type: "hunan-rst",
      listUrl: raw.listUrl || DEFAULT_HUNAN_RST_CONFIG.listUrl,
      listSelector: DEFAULT_HUNAN_RST_CONFIG.listSelector,
    };
  }

  // [NEW] 高校来源：复用列表/详情/附件解析链路，listUrl 默认取 Source.url
  if (type === "hunan-university") {
    const defaultSelectors = DEFAULT_HUNAN_UNIVERSITY_CONFIG.detailContentSelectors ?? [];
    const rawSelectors = raw.detailContentSelectors ?? [];
    const mergedSelectors = [...new Set([...defaultSelectors, ...rawSelectors])];

    return {
      ...DEFAULT_HUNAN_UNIVERSITY_CONFIG,
      ...raw,
      type: "hunan-university",
      listUrl: raw.listUrl || source.url,
      linkMustInclude:
        raw.linkMustInclude ?? DEFAULT_HUNAN_UNIVERSITY_CONFIG.linkMustInclude,
      province: raw.province || source.province,
      detailContentSelectors: mergedSelectors,
    };
  }

  return {
    ...DEFAULT_HUNAN_RST_CONFIG,
    ...raw,
    type,
  };
}

function isUniversitySource(config: ParserConfig): boolean {
  return config.type === "hunan-university";
}

function logInfo(message: string) {
  console.log(`[Crawler] ${message}`);
}

function logWarn(message: string) {
  console.warn(`[Crawler][WARN] ${message}`);
}

function logError(message: string, error?: unknown) {
  const detail =
    error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : "";
  console.error(`[Crawler][ERROR] ${message}${detail}`);
}

function formatAxiosError(error: unknown): string {
  const err = error as AxiosError;
  if (err.response) {
    return `HTTP ${err.response.status} ${err.config?.url ?? ""}`;
  }
  if (err.code) return `${err.code} ${err.message}`;
  return err.message ?? String(error);
}

// ─── HTTP ─────────────────────────────────────────────────────────

/** 单次请求超时（高校站响应慢，由 30s 提高到 60s） */
const HTTP_TIMEOUT_MS = 60_000;
/** 失败后最多再重试 2 次（共 3 次请求） */
const HTTP_MAX_RETRIES = 2;
/** 重试间隔（非 429 的普通重试） */
const HTTP_RETRY_DELAY_MS = 3_000;

/** 防封：请求前基础延迟 + 随机 jitter 上限 */
const DEFAULT_BASE_DELAY_MS = 1500;
const HTTP_JITTER_MAX_MS = 2000;
/** 同一来源连续失败次数达到阈值即熔断 */
const MAX_CONSECUTIVE_HTTP_FAILURES = 3;
/** 429 指数退避：30s → 60s → 120s */
const RATE_LIMIT_BACKOFF_MS = [30_000, 60_000, 120_000];

class HttpCircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpCircuitOpenError";
  }
}

type SourceCrawlHttpContext = {
  sourceName: string;
  baseDelayMs: number;
  consecutiveFailures: number;
  tripped: boolean;
  tripReason?: string;
};

/** 当前来源抓取会话的 HTTP 防封上下文（crawlSource 内生效） */
let activeSourceHttpContext: SourceCrawlHttpContext | null = null;

function beginSourceHttpContext(sourceName: string, baseDelayMs: number): void {
  activeSourceHttpContext = {
    sourceName,
    baseDelayMs: baseDelayMs > 0 ? baseDelayMs : DEFAULT_BASE_DELAY_MS,
    consecutiveFailures: 0,
    tripped: false,
  };
}

function endSourceHttpContext(): void {
  activeSourceHttpContext = null;
}

function isSourceHttpCircuitTripped(): boolean {
  return activeSourceHttpContext?.tripped === true;
}

function assertHttpRequestAllowed(): void {
  if (!activeSourceHttpContext?.tripped) return;
  throw new HttpCircuitOpenError(
    activeSourceHttpContext.tripReason ??
      `[熔断] 已停止来源 ${activeSourceHttpContext.sourceName} 剩余抓取`,
  );
}

function getHttpResponseStatus(error: unknown): number | null {
  const status = (error as AxiosError)?.response?.status;
  return typeof status === "number" ? status : null;
}

/** 每次 HTTP 请求前：baseDelay + random(0, 2000ms) */
async function pauseBeforeHttpRequest(): Promise<void> {
  const base = activeSourceHttpContext?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const jitter = Math.floor(Math.random() * (HTTP_JITTER_MAX_MS + 1));
  await sleep(base + jitter);
}

function tripSourceHttpCircuit(reason: string): void {
  if (!activeSourceHttpContext || activeSourceHttpContext.tripped) return;
  activeSourceHttpContext.tripped = true;
  activeSourceHttpContext.tripReason = reason;

  if (reason.includes("403")) {
    logError(
      `[熔断] HTTP 403，停止来源 ${activeSourceHttpContext.sourceName} 剩余抓取`,
    );
    return;
  }
  if (reason.includes("连续失败")) {
    logError(
      `[熔断] 连续失败 ${MAX_CONSECUTIVE_HTTP_FAILURES} 次，停止该来源 ${activeSourceHttpContext.sourceName} 剩余抓取`,
    );
    return;
  }
  logError(
    `[熔断] ${reason}，停止该来源 ${activeSourceHttpContext.sourceName} 剩余抓取`,
  );
}

function recordHttpSuccess(): void {
  if (activeSourceHttpContext) {
    activeSourceHttpContext.consecutiveFailures = 0;
  }
}

function recordHttpFinalFailure(error: unknown): void {
  if (!activeSourceHttpContext || activeSourceHttpContext.tripped) return;

  if (getHttpResponseStatus(error) === 403) {
    tripSourceHttpCircuit("HTTP 403 Forbidden");
    return;
  }

  activeSourceHttpContext.consecutiveFailures += 1;
  if (
    activeSourceHttpContext.consecutiveFailures >= MAX_CONSECUTIVE_HTTP_FAILURES
  ) {
    tripSourceHttpCircuit(`连续失败 ${MAX_CONSECUTIVE_HTTP_FAILURES} 次`);
  }
}

async function applyRateLimitBackoff(backoffIndex: number, url: string): Promise<void> {
  const ms =
    RATE_LIMIT_BACKOFF_MS[
      Math.min(backoffIndex, RATE_LIMIT_BACKOFF_MS.length - 1)
    ];
  logWarn(`[429] 指数退避 ${ms / 1000}s: ${url}`);
  await sleep(ms);
}

function throwIfCircuitOpen(): void {
  if (activeSourceHttpContext?.tripped) {
    throw new HttpCircuitOpenError(
      activeSourceHttpContext.tripReason ?? "HTTP 熔断已开启",
    );
  }
}

async function executeHttpGet<T>(
  action: "fetchText" | "downloadToMemory",
  url: string,
  referer: string,
  buildConfig: (attempt: number) => Parameters<typeof axios.get>[1],
): Promise<T> {
  let lastError: unknown;
  let rateLimitBackoffIndex = 0;

  for (let attempt = 0; attempt <= HTTP_MAX_RETRIES; attempt += 1) {
    assertHttpRequestAllowed();
    await pauseBeforeHttpRequest();

    try {
      const { data } = await axios.get<T>(url, buildConfig(attempt));
      recordHttpSuccess();
      if (attempt > 0) {
        logInfo(
          `[HTTP] ${action} 重试成功 (第 ${attempt + 1}/${HTTP_MAX_RETRIES + 1} 次): ${url}`,
        );
      }
      return data;
    } catch (error) {
      lastError = error;
      const status = getHttpResponseStatus(error);

      if (status === 403) {
        logHttpFailure(action, url, error, attempt, true);
        recordHttpFinalFailure(error);
        throwIfCircuitOpen();
        throw new HttpCircuitOpenError("HTTP 403 Forbidden");
      }

      if (status === 429 && attempt < HTTP_MAX_RETRIES) {
        logHttpFailure(action, url, error, attempt, false);
        await applyRateLimitBackoff(rateLimitBackoffIndex, url);
        rateLimitBackoffIndex += 1;
        continue;
      }

      const canRetry =
        attempt < HTTP_MAX_RETRIES && isRetryableHttpError(error);

      if (canRetry) {
        logHttpFailure(action, url, error, attempt, false);
        logWarn(
          `[HTTP] ${action} ${HTTP_RETRY_DELAY_MS / 1000}s 后重试: ${url}`,
        );
        await sleep(HTTP_RETRY_DELAY_MS);
        continue;
      }

      logHttpFailure(action, url, error, attempt, true);
      recordHttpFinalFailure(error);
      throwIfCircuitOpen();
      throw error;
    }
  }

  recordHttpFinalFailure(lastError);
  throwIfCircuitOpen();
  throw lastError;
}

/** 常见桌面浏览器 User-Agent 池（每次请求/重试轮换） */
const BROWSER_USER_AGENT_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
];

function pickUserAgent(attempt: number): string {
  return BROWSER_USER_AGENT_POOL[attempt % BROWSER_USER_AGENT_POOL.length];
}

function isAxiosTimeout(error: AxiosError): boolean {
  const code = error.code ?? "";
  if (code === "ETIMEDOUT" || code === "ECONNABORTED") return true;
  return /timeout|timed out/i.test(error.message ?? "");
}

function isRetryableHttpError(error: unknown): boolean {
  const err = error as AxiosError;
  if (isAxiosTimeout(err)) return true;
  const code = err.code ?? "";
  if (
    ["ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EPIPE"].includes(
      code,
    )
  ) {
    return true;
  }
  const status = err.response?.status;
  return status === 502 || status === 503 || status === 504;
}

function buildBrowserHeaders(
  userAgent: string,
  referer: string,
  accept: string,
): Record<string, string> {
  return {
    "User-Agent": userAgent,
    Accept: accept,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: referer,
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  };
}

function logHttpFailure(
  action: "fetchText" | "downloadToMemory",
  url: string,
  error: unknown,
  attempt: number,
  final: boolean,
): void {
  const err = error as AxiosError;
  const code = err.code ?? "UNKNOWN";
  const timedOut = isAxiosTimeout(err);
  const attemptLabel = `${attempt + 1}/${HTTP_MAX_RETRIES + 1}`;
  const prefix = final ? "最终失败" : "失败";

  if (timedOut) {
    logError(
      `[HTTP] ${action} ${prefix}·超时 (${HTTP_TIMEOUT_MS}ms, 第 ${attemptLabel} 次) [${code}]: ${url}`,
      error,
    );
    return;
  }

  logWarn(
    `[HTTP] ${action} ${prefix} (第 ${attemptLabel} 次) [${code}]: ${url} — ${formatAxiosError(error)}`,
  );
}

async function fetchText(url: string, referer?: string): Promise<string> {
  const ref = referer ?? url;
  const data = await executeHttpGet<string>(
    "fetchText",
    url,
    ref,
    (attempt) => ({
      timeout: HTTP_TIMEOUT_MS,
      maxRedirects: 5,
      responseType: "text",
      headers: buildBrowserHeaders(
        pickUserAgent(attempt),
        ref,
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      ),
      validateStatus: (status) => status >= 200 && status < 400,
    }),
  );
  return String(data ?? "");
}

async function downloadToMemory(url: string, referer: string): Promise<Buffer> {
  const data = await executeHttpGet<ArrayBuffer>(
    "downloadToMemory",
    url,
    referer,
    (attempt) => ({
      timeout: HTTP_TIMEOUT_MS,
      maxRedirects: 5,
      responseType: "arraybuffer",
      headers: buildBrowserHeaders(pickUserAgent(attempt), referer, "*/*"),
      validateStatus: (status) => status >= 200 && status < 400,
    }),
  );
  return Buffer.from(data);
}

// ─── 列表页解析 ─────────────────────────────────────────────────

function isValidAnnouncementLink(
  url: string,
  config: ParserConfig,
  listPageUrl?: string,
): boolean {
  if (config.linkMustInclude && !url.includes(config.linkMustInclude)) {
    return false;
  }
  if (config.linkHostIncludes) {
    try {
      const host = new URL(url).hostname;
      if (!host.includes(config.linkHostIncludes)) return false;
    } catch {
      return false;
    }
  }
  if (!/^https?:\/\//i.test(url)) return false;

  if (isUniversitySource(config)) {
    if (isLikelyColumnNavUrl(url)) return false;
    if (!config.linkMustInclude && !isLikelyUniversityDetailUrl(url, listPageUrl ?? config.listUrl ?? "")) {
      return false;
    }
  }

  return true;
}

/** [NEW] 标题是否含招聘核心词 */
function hasRecruitmentCoreSignal(title: string): boolean {
  return passesRecruitmentAnnouncementFilter(title, { requireRecruitmentKeyword: true }) ||
    /招聘|岗位|辅导员|遴选/u.test(normalizeWhitespace(title));
}

/** [NEW] 标题是否含非招聘信号 */
function hasNonRecruitmentTitleSignal(title: string): boolean {
  return isNavigationMenuText(title) || !passesRecruitmentAnnouncementFilter(title);
}

/** [NEW] 高校来源严格过滤：有核心词 + 无排除词 */
function passesStrictRecruitmentFilter(title: string): boolean {
  return passesRecruitmentAnnouncementFilter(title);
}

function isLikelyAnnouncement(
  item: ListAnnouncement,
  listPageUrl: string,
  config?: ParserConfig,
): boolean {
  if (!item.title || item.title.length < 6) return false;
  if (/[{<>]/.test(item.title) || containsWebScrapJunk(item.title)) return false;
  if (item.url === listPageUrl) return false;
  if (isLikelyColumnNavUrl(item.url)) return false;
  if (isNavigationMenuText(item.title)) return false;
  if (/\/index\.html?(\?|#|$)/i.test(item.url) && item.title.length < 12) return false;

  // [NEW] hunan-university：严格招聘信号过滤
  if (isUniversitySource(config ?? {}) && !passesStrictRecruitmentFilter(item.title)) {
    return false;
  }

  return true;
}

function shouldSkipUniversityPersist(title: string, config: ParserConfig): boolean {
  if (!isUniversitySource(config)) return false;
  return !passesStrictRecruitmentFilter(title);
}

/** 表格行岗位名（短标题）是否可信 */
function looksLikeTableRowTitle(title: string): boolean {
  const t = normalizeWhitespace(title);
  if (!t || isBadJobCardTitle(t)) return false;
  if (t === "岗位" || t === "未命名岗位") return false;
  if (/ · /u.test(t)) return true;
  if (t.length <= 32 && !/[，。；：]/.test(t)) return true;
  return t.length <= 24;
}

/** 入库标题：列表页公告标题优先，避免正文首句 / 附件名 */
function resolveJobPostingTitle(
  announcement: ListAnnouncement,
  opts: { rowTitle?: string; parseTitle?: string; detailText?: string } = {},
): string {
  if (opts.rowTitle && looksLikeTableRowTitle(opts.rowTitle)) {
    return sanitizeJobPostingTitle(opts.rowTitle, announcement.title);
  }

  return pickJobCardTitle({
    title: opts.parseTitle,
    announcementTitle: announcement.title,
    rawText: opts.detailText || opts.parseTitle || announcement.title,
    organization: "",
    sourceName: "",
  });
}

function scrapeAnnouncementList(
  html: string,
  listPageUrl: string,
  config: ParserConfig,
  listLimit?: number,
): ListAnnouncement[] {
  const $ = cheerio.load(html);
  const items: ListAnnouncement[] = [];
  const seen = new Set<string>();
  let strictFiltered = 0;
  const strictFilterEnabled = isUniversitySource(config);

  const listSelector = config.listSelector ?? "ul li";
  const linkSelector = config.linkSelector ?? "a";
  const dateSelector = config.dateSelector ?? "span";

  const tryPushItem = (
    title: string,
    href: string,
    publishDate?: Date,
    publishDateLabel?: string,
  ) => {
    if (!title || title.length < 4 || !href) return;

    // [NEW] 解析标题后立即强过滤（hunan-university）
    if (strictFilterEnabled && !passesStrictRecruitmentFilter(title)) {
      strictFiltered += 1;
      return;
    }

    const url = resolveUrl(href, listPageUrl);
    if (!url || seen.has(url) || !isValidAnnouncementLink(url, config, listPageUrl)) return;

    seen.add(url);
    items.push({
      title,
      url,
      publishDate,
      publishDateLabel,
    });
  };

  $(listSelector).each((_, el) => {
    const node = $(el);
    const linkEl = node.find(linkSelector).first();
    const title = normalizeWhitespace(linkEl.text());
    const href = linkEl.attr("href") ?? "";

    const dateText = normalizeWhitespace(node.find(dateSelector).first().text());
    const publishDate = parsePublishDateLabel(dateText);

    tryPushItem(title, href, publishDate, dateText || undefined);
  });

  if (items.length === 0) {
    logWarn(`列表选择器未命中，尝试 a 标签兜底: ${listSelector}`);
    $("a[href]").each((_, el) => {
      const title = normalizeWhitespace($(el).text());
      const href = $(el).attr("href") ?? "";
      if (title.length < 6) return;
      if (strictFilterEnabled) {
        const absolute = resolveUrl(href, listPageUrl);
        if (!absolute || !isLikelyUniversityDetailUrl(absolute, listPageUrl)) return;
        if (isLikelyColumnNavUrl(absolute)) return;
      }
      tryPushItem(title, href);
    });
  }

  if (strictFilterEnabled && strictFiltered > 0) {
    logInfo(`[高校] 列表强过滤剔除 ${strictFiltered} 条非招聘公告`);
  }

  const max = listLimit ?? config.maxListItems ?? 15;
  return items
    .filter((item) => isLikelyAnnouncement(item, listPageUrl, config))
    .slice(0, max * 3);
}

function dedupeAnnouncements(items: ListAnnouncement[]): ListAnnouncement[] {
  const seen = new Set<string>();
  const out: ListAnnouncement[] = [];
  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

/** 首页/栏目页上发现 rczp、zpgg 等招聘子列表（高校站通用） */
function discoverUniversityListPageUrls(
  html: string,
  listPageUrl: string,
  config: ParserConfig,
): string[] {
  if (!isUniversitySource(config)) return [];

  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: string[] = [];

  const pushUrl = (href: string) => {
    const abs = resolveUrl(href, listPageUrl);
    if (!abs || seen.has(abs) || abs === listPageUrl) return;
    try {
      if (new URL(abs).hostname !== new URL(listPageUrl).hostname) return;
    } catch {
      return;
    }
    if (!/\.htm/i.test(abs)) return;
    if (!/(?:rczp|zpgg|zpxx|\/zp)/i.test(abs)) return;
    seen.add(abs);
    out.push(abs);
  };

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = normalizeWhitespace($(el).text());
    if (/(?:rczp|zpgg|zpxx|人才招聘|招聘信息|教辅|辅导员|非事业编)/i.test(`${href} ${text}`)) {
      pushUrl(href);
    }
  });

  return out.slice(0, 8);
}

async function scrapeAllAnnouncements(
  listHtml: string,
  listUrl: string,
  config: ParserConfig,
  maxListItems?: number,
): Promise<ListAnnouncement[]> {
  const max = maxListItems ?? config.maxListItems ?? 15;
  let items = scrapeAnnouncementList(listHtml, listUrl, config, max);

  if (isUniversitySource(config)) {
    const extraUrls = discoverUniversityListPageUrls(listHtml, listUrl, config);
    for (const extraUrl of extraUrls) {
      logInfo(`[高校] 补充子栏目列表: ${extraUrl}`);
      try {
        const extraHtml = await fetchText(extraUrl, listUrl);
        const extraItems = scrapeAnnouncementList(extraHtml, extraUrl, config, max);
        items = dedupeAnnouncements([...items, ...extraItems]);
      } catch (error) {
        if (error instanceof HttpCircuitOpenError) throw error;
        logWarn(`子栏目列表抓取失败: ${extraUrl}`, error);
      }
    }
  }

  return items.slice(0, max);
}

// ─── 详情页 & 附件 ───────────────────────────────────────────────

/** [NEW] 加载 HTML 并移除 script/style，避免正文提取混入 JS */
function loadHtmlWithoutScripts(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe").remove();
  return $;
}

/** [NEW] 剔除反爬函数等内联 JS 残留 */
function sanitizeExtractedText(text: string): string {
  let value = String(text ?? "");

  for (const pattern of JS_ANTI_CRAWL_PATTERNS) {
    value = value.replace(pattern, " ");
  }

  value = value
    .replace(/\bfunction\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?\}/gi, " ")
    .replace(/\bvar\s+\w+\s*=\s*function\s*\([^)]*\)\s*\{[\s\S]*?\};?/gi, " ");

  return normalizeWhitespace(value);
}

/** [NEW] 检测文本是否仍含大量 JS（用于触发正文兜底） */
function containsHeavyJsCode(text: string): boolean {
  const value = String(text ?? "");
  if (!value) return false;

  if (JS_ANTI_CRAWL_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  })) {
    return true;
  }

  const functionCount = (value.match(/\bfunction\s+\w+\s*\(/g) || []).length;
  const cjk = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  const jsKeywordCount = (
    value.match(/\b(?:var|let|const|document|window|eval|jQuery|\$\()\b/g) || []
  ).length;

  if (functionCount >= 2) return true;
  if (functionCount >= 1 && cjk < 20) return true;
  if (jsKeywordCount >= 4 && cjk / Math.max(value.length, 1) < 0.08) return true;

  return false;
}

/** [NEW] 乱码/JS 污染时优先回退到详情主正文 */
function resolvePostingText(primary: string, detailFallback?: string): string {
  const cleanedPrimary = sanitizeExtractedText(primary);

  if (cleanedPrimary && !containsHeavyJsCode(cleanedPrimary) && !isGarbledText(cleanedPrimary)) {
    return cleanedPrimary;
  }

  if (detailFallback) {
    const cleanedFallback = sanitizeExtractedText(detailFallback);
    if (
      cleanedFallback &&
      !containsHeavyJsCode(cleanedFallback) &&
      !isGarbledText(cleanedFallback)
    ) {
      logInfo(
        `正文 JS/乱码兜底: 使用详情主正文 (${cleanedFallback.length} 字，原 ${cleanedPrimary.length} 字)`,
      );
      return cleanedFallback;
    }
  }

  if (containsHeavyJsCode(cleanedPrimary) && detailFallback) {
    const cleanedFallback = sanitizeExtractedText(detailFallback);
    if (cleanedFallback.length >= 40) {
      logInfo(`正文 JS 污染兜底: 强制使用详情主正文 (${cleanedFallback.length} 字)`);
      return cleanedFallback;
    }
  }

  return cleanedPrimary || primary;
}

function extractDetailText(html: string, config: ParserConfig): string {
  const $ = loadHtmlWithoutScripts(html);
  const selectors =
    config.detailContentSelectors ?? DEFAULT_HUNAN_RST_CONFIG.detailContentSelectors!;

  let bestFallback = "";
  let bestSelector = "";

  for (const selector of selectors) {
    const raw = $(selector).first().text();
    const text = sanitizeExtractedText(raw);

    if (text.length >= 80 && !containsHeavyJsCode(text) && !isGarbledText(text)) {
      bestFallback = text;
      bestSelector = selector;
      break;
    }

    if (text.length > bestFallback.length && !containsHeavyJsCode(text)) {
      bestFallback = text;
      bestSelector = selector;
    }
  }

  let result = bestFallback;
  if (!result || result.length < 80) {
    const bodyText = sanitizeExtractedText($("body").text());
    if (bodyText.length >= 80 && !containsHeavyJsCode(bodyText) && !isGarbledText(bodyText)) {
      result = bodyText;
    } else if (bestFallback.length >= 40) {
      result = bestFallback;
    } else {
      result = bodyText || bestFallback;
    }
  }

  const tableSummary = serializeRecruitmentTablesFromHtml(html, {
    contentSelector: bestSelector || selectors[0],
  });
  if (tableSummary) {
    result = `${result}\n\n${tableSummary}`;
  }

  return result;
}

function findAttachmentLinks(
  html: string,
  pageUrl: string,
  config: ParserConfig,
): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      return;
    }

    const absolute = resolveUrl(href, pageUrl);
    if (!absolute) return;

    const ext = getUrlExtension(absolute);
    if (!SUPPORTED_ATTACHMENT_EXTS.includes(ext)) return;
    if (!urls.includes(absolute)) urls.push(absolute);
  });

  return urls.slice(0, config.maxAttachments ?? 3);
}

async function parseAttachmentFromUrl(
  fileUrl: string,
  referer: string,
  mainText: string,
): Promise<ParseResult | null> {
  const fileType = resolveAttachmentFileType(fileUrl);
  if (!fileType) {
    logWarn(`不支持的附件类型: ${fileUrl}`);
    return null;
  }

  const fileName = decodeURIComponent(
    String(fileUrl.split("/").pop() ?? "attachment").split("?")[0],
  );

  logInfo(`下载附件到内存: ${fileName}`);
  const buffer = await downloadToMemory(fileUrl, referer);
  logInfo(`附件大小 ${buffer.length} bytes，开始 parseAttachmentWithMainText`);

  return parseAttachmentWithMainText(mainText, buffer, fileType, fileName);
}

function contentToLines(content: string): string[] {
  return String(content ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 文本兜底时只用工作表透视区，避免与「结构化岗位表」摘要重复解析 */
function extractWorksheetLinesForFallback(combinedRawText: string): string[] {
  const lines = contentToLines(combinedRawText);
  const sheetLines: string[] = [];
  let inSheet = false;

  for (const line of lines) {
    if (/---+\s*工作表:/u.test(line)) {
      inSheet = true;
      continue;
    }
    if (/---+\s*结构化岗位表/u.test(line)) {
      inSheet = false;
      continue;
    }
    if (inSheet) sheetLines.push(line);
  }

  if (sheetLines.length > 0) return sheetLines;
  return lines.filter((line) => line.includes("\t"));
}

function isDashPlaceholder(value: unknown): boolean {
  const str = String(value ?? "").trim();
  return !str || str === "—" || str === "-";
}

function dedupeStructuredHunanJobs(jobs: StructuredHunanJob[]): StructuredHunanJob[] {
  const byKey = new Map<string, StructuredHunanJob>();
  for (const job of jobs) {
    const key = `${job.title}|${job.organization ?? ""}|${job.id ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, job);
      continue;
    }
    const score = (j: StructuredHunanJob) =>
      j.majorRequirement &&
      j.majorRequirement !== "—" &&
      j.majorRequirement !== MAJOR_FALLBACK_LABEL
        ? j.majorRequirement.length
        : 0;
    if (score(job) > score(existing)) byKey.set(key, job);
  }
  return [...byKey.values()];
}

function filterValidTableMajors(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((v) => String(v ?? "").trim())
        .filter((v) => v && isLikelyMajorCell(v)),
    ),
  ];
}

function mergeRequirementsForPosting(
  parseResult: ParseResult,
  mainText: string,
  item?: StructuredHunanJob,
): { requirements: Prisma.InputJsonObject; deadline?: Date } {
  const merged: ParsedRequirements = mainText.trim()
    ? mergeHybridParseResults(mainText, parseResult)
    : { ...parseResult.requirements };

  if (item) {
    if (item.slots != null && item.slots > 0) {
      merged.numPositions = item.slots;
    }

    if (!merged.politicalStatus && item.politicalStatus) {
      merged.politicalStatus = item.politicalStatus;
    }

    if (!merged.ageLimit && !isDashPlaceholder(item.ageRequirement)) {
      merged.ageLimit = item.ageRequirement;
    }
    if (
      item?.majorRequirement &&
      !isDashPlaceholder(item.majorRequirement) &&
      item.majorRequirement !== MAJOR_FALLBACK_LABEL
    ) {
      merged.majorRequirements = [String(item.majorRequirement).trim()];
    } else if (merged.majorRequirements?.length) {
      const filtered = filterValidTableMajors(merged.majorRequirements);
      if (filtered.length > 0) merged.majorRequirements = filtered;
      else delete merged.majorRequirements;
    }

    const itemEducation = normalizeEducationValue(item.education);
    const mergedEducation = normalizeEducationValue(merged.education);
    if (itemEducation) {
      merged.education = itemEducation;
    } else if (mergedEducation) {
      merged.education = mergedEducation;
    } else {
      delete merged.education;
    }
  } else {
    const mergedEducation = normalizeEducationValue(merged.education);
    if (mergedEducation) merged.education = mergedEducation;
    else delete merged.education;
  }

  const deadline = parseDeadlineDate(merged.deadline) ?? undefined;

  const otherBase =
    typeof merged.other === "object" &&
    merged.other !== null &&
    !Array.isArray(merged.other)
      ? (merged.other as Record<string, unknown>)
      : {};

  const sanitizedOrg = item?.organization
    ? sanitizeOrganizationName(item.organization, "")
    : "";

  const rowOtherRequirement =
    item?.otherRequirement && !isDashPlaceholder(item.otherRequirement)
      ? String(item.otherRequirement).trim()
      : "";

  const requirements: Prisma.InputJsonObject = {
    ...merged,
    other: {
      ...otherBase,
      ...(item?.id ? { jobCode: item.id } : {}),
      ...(sanitizedOrg ? { organization: sanitizedOrg } : {}),
      ...(rowOtherRequirement ? { otherRequirement: rowOtherRequirement } : {}),
      ...(item?.slots != null && item.slots > 0 ? { slots: item.slots } : {}),
      ...(merged.numPositions != null
        ? { announcementHeadcount: merged.numPositions }
        : {}),
      parserUsed: parseResult.parserUsed,
    },
  };

  if (mainText.trim()) {
    const mainPreview = parseMainText(mainText);
    logInfo(
      `主正文解析: deadline=${mainPreview.deadline ?? "—"} numPositions=${mainPreview.numPositions ?? "—"}`,
    );
  }

  return { requirements, deadline };
}

function enrichJobRequirements(
  requirements: Prisma.InputJsonObject,
  source: Source,
  item?: StructuredHunanJob,
  announcementTitle?: string,
): Prisma.InputJsonObject {
  const other =
    typeof requirements.other === "object" &&
    requirements.other !== null &&
    !Array.isArray(requirements.other)
      ? { ...(requirements.other as Record<string, unknown>) }
      : {};

  if (source.city) other.city = source.city;
  if (announcementTitle?.trim()) {
    other.announcementTitle = announcementTitle.trim();
  }
  if (
    item?.majorRequirement &&
    !isDashPlaceholder(item.majorRequirement) &&
    item.majorRequirement !== MAJOR_FALLBACK_LABEL
  ) {
    other.majorRequirement = item.majorRequirement;
  }
  if (item?.education && !isDashPlaceholder(item.education)) {
    const edu = normalizeEducationValue(item.education);
    if (edu) other.education = edu;
  }

  return { ...requirements, other };
}

async function removeStaleAnnouncementPlaceholder(params: {
  sourceId: string;
  sourceUrl: string;
  announcementTitle: string;
  structuredJobTitles: string[];
  dryRun: boolean;
}): Promise<void> {
  const jobTitleSet = new Set(
    params.structuredJobTitles
      .map((title) =>
        sanitizeJobPostingTitle(
          sanitizeExtractedText(String(title ?? "")),
          "",
        ),
      )
      .filter(Boolean),
  );
  if (jobTitleSet.size === 0) return;

  const announcementTitle = String(params.announcementTitle ?? "").trim();
  if (!announcementTitle) return;

  const staleRows = await prisma.jobPosting.findMany({
    where: {
      sourceId: params.sourceId,
      sourceUrl: params.sourceUrl,
    },
    select: { id: true, title: true },
  });

  for (const row of staleRows) {
    const title = String(row.title ?? "").trim();
    if (!title || jobTitleSet.has(title)) continue;
    if (title !== announcementTitle) continue;

    if (params.dryRun) {
      logInfo(`[dry-run] 将删除公告占位: ${title}`);
      continue;
    }
    await prisma.jobPosting.delete({ where: { id: row.id } });
    logInfo(`🗑️ 已删除公告占位旧记录: ${title}`);
  }
}

async function upsertJobPosting(params: {
  sourceId: string;
  sourceUrl: string;
  title: string;
  province: string;
  publishDate?: Date;
  deadline?: Date;
  requirements: Prisma.InputJsonValue;
  rawText: string;
  detailTextFallback?: string;
  dryRun: boolean;
}): Promise<"created" | "updated" | "skipped"> {
  const cleanTitle = sanitizeJobPostingTitle(
    sanitizeExtractedText(String(params.title ?? "")),
    "未命名岗位",
  );
  if (!cleanTitle || isGarbledText(cleanTitle)) {
    logWarn(`跳过乱码/空标题: ${cleanTitle.slice(0, 40)}`);
    return "skipped";
  }

  const resolvedRawText = resolvePostingText(
    String(params.rawText ?? "").trim(),
    params.detailTextFallback,
  );
  if (!resolvedRawText) {
    logWarn(`跳过空 rawText: ${cleanTitle}`);
    return "skipped";
  }
  if (isGarbledText(resolvedRawText)) {
    logWarn(`跳过乱码 rawText: ${cleanTitle}`);
    return "skipped";
  }

  if (params.dryRun) {
    logInfo(`[dry-run] 将写入: ${cleanTitle}`);
    return "created";
  }

  const existing = await prisma.jobPosting.findFirst({
    where: {
      sourceId: params.sourceId,
      sourceUrl: params.sourceUrl,
      title: cleanTitle,
    },
  });

  let existingRecord = existing;
  if (!existingRecord) {
    const sameUrl = await prisma.jobPosting.findMany({
      where: { sourceId: params.sourceId, sourceUrl: params.sourceUrl },
      take: 2,
      select: { id: true, title: true },
    });
    if (sameUrl.length === 1 && isBadJobCardTitle(sameUrl[0].title ?? "")) {
      existingRecord = await prisma.jobPosting.findUnique({
        where: { id: sameUrl[0].id },
      });
    }
  }

  const data = {
    title: cleanTitle,
    province: params.province,
    publishDate: params.publishDate,
    deadline: params.deadline,
    requirements: params.requirements,
    rawText: resolvedRawText,
    matchStatus: null,
  };

  if (existingRecord) {
    await prisma.jobPosting.update({
      where: { id: existingRecord.id },
      data,
    });
    logInfo(`♻️ 已更新: ${cleanTitle}`);
    return "updated";
  }

  await prisma.jobPosting.create({
    data: {
      sourceId: params.sourceId,
      sourceUrl: params.sourceUrl,
      ...data,
    },
  });
  logInfo(`✅ 已入库: ${cleanTitle}`);
  return "created";
}

async function persistFromParseResults(params: {
  source: Source;
  config: ParserConfig;
  announcement: ListAnnouncement;
  parseResults: ParseResult[];
  detailText: string;
  detailHtml?: string;
  dryRun: boolean;
}): Promise<CrawlStats> {
  const stats: CrawlStats = {
    listed: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  // [NEW] 入库前二次校验：标题无招聘核心词则跳过（hunan-university）
  if (shouldSkipUniversityPersist(params.announcement.title, params.config)) {
    logWarn(`[高校] 跳过非招聘公告: ${params.announcement.title}`);
    stats.skipped += 1;
    return stats;
  }

  const province = params.config.province ?? params.source.province;
  const publishDate =
    params.announcement.publishDate ??
    parsePublishDateLabel(params.announcement.publishDateLabel ?? "");

  const combinedRawText = [
    params.detailText,
    ...params.parseResults.map((item) => item.rawText),
  ]
    .filter(Boolean)
    .join("\n\n");

  let structuredJobs: StructuredHunanJob[] = [];

  if (params.detailHtml?.trim()) {
    structuredJobs = parseRecruitmentTablesFromHtml(params.detailHtml, {
      organization: params.source.name,
    }) as StructuredHunanJob[];
    if (structuredJobs.length > 0) {
      logInfo(
        `[HTML表格] 结构化 ${structuredJobs.length} 条岗位: ${params.announcement.title}`,
      );
    }
  }

  if (structuredJobs.length === 0 && isUniversitySource(params.config) && params.detailText.trim()) {
    structuredJobs = parseUniversityJobsFromProse(params.detailText, {
      province,
      city: params.source.city ?? "",
    }) as StructuredHunanJob[];
    if (structuredJobs.length > 0) {
      logInfo(
        `[高校] 正文结构化 ${structuredJobs.length} 条岗位: ${params.announcement.title}`,
      );
    }
  }

  if (structuredJobs.length === 0) {
    structuredJobs = extractStructuredJobsFromParseResults(
      params.parseResults,
    ).map((job) => structuredJobToCrawlerItem(job) as StructuredHunanJob);
  }

  if (structuredJobs.length === 0 && combinedRawText.trim()) {
    const lines = extractWorksheetLinesForFallback(combinedRawText);
    structuredJobs = parseStructuredJobsFromLines(lines, {
      province,
      city: params.source.city ?? "",
    }) as StructuredHunanJob[];
    if (structuredJobs.length > 0) {
      logInfo(
        `文本兜底结构化 ${structuredJobs.length} 条岗位: ${params.announcement.title}`,
      );
    }
  }

  structuredJobs = dedupeStructuredHunanJobs(structuredJobs);

  if (structuredJobs.length > 0) {
    logInfo(`入库岗位 ${structuredJobs.length} 条: ${params.announcement.title}`);

    for (const item of structuredJobs) {
      stats.processed += 1;
      const parseResult =
        params.parseResults.find((result) => result.success) ??
        params.parseResults[0] ?? {
          title: item.title,
          requirements: {},
          rawText: item.text ?? "",
          success: false,
          parserUsed: "rule" as const,
        };

      const { requirements, deadline } = mergeRequirementsForPosting(
        parseResult,
        params.detailText,
        item,
      );
      const finalRequirements = enrichJobRequirements(
        requirements,
        params.source,
        item,
        params.announcement.title,
      );
      const rawText = resolvePostingText(
        params.detailText ||
          (parseResult.rawText && !containsHeavyJsCode(parseResult.rawText)
            ? parseResult.rawText
            : String(item.text ?? combinedRawText).trim()),
        params.detailText,
      );

      try {
        const action = await upsertJobPosting({
          sourceId: params.source.id,
          sourceUrl: params.announcement.url,
          title: resolveJobPostingTitle(params.announcement, {
            rowTitle: item.title,
            parseTitle: parseResult.title,
            detailText: params.detailText,
          }),
          province,
          publishDate: parsePublishDateLabel(item.publishDate ?? "") ?? publishDate,
          deadline,
          requirements: finalRequirements,
          rawText,
          detailTextFallback: params.detailText,
          dryRun: params.dryRun,
        });
        if (action === "created") stats.created += 1;
        else if (action === "updated") stats.updated += 1;
        else stats.skipped += 1;
      } catch (error) {
        stats.failed += 1;
        logError(`入库失败: ${item.title}`, error);
      }
    }

    await removeStaleAnnouncementPlaceholder({
      sourceId: params.source.id,
      sourceUrl: params.announcement.url,
      announcementTitle: params.announcement.title,
      structuredJobTitles: structuredJobs.map((job) => job.title ?? ""),
      dryRun: params.dryRun,
    });

    return stats;
  }

  stats.processed += 1;
  const primary =
    params.parseResults.find((item) => item.success && item.rawText.length > 0) ??
    params.parseResults[0];

  if (!primary && !params.detailText.trim()) {
    logWarn(`无可用解析结果，跳过: ${params.announcement.url}`);
    stats.skipped += 1;
    return stats;
  }

  const parseResult =
    primary ??
    ({
      title: params.announcement.title,
      requirements: {},
      rawText: params.detailText,
      success: false,
      parserUsed: "rule",
    } satisfies ParseResult);

  const { requirements, deadline } = mergeRequirementsForPosting(
    parseResult,
    params.detailText,
  );
  const finalRequirements = enrichJobRequirements(
    requirements,
    params.source,
    undefined,
    params.announcement.title,
  );

  try {
    const action = await upsertJobPosting({
      sourceId: params.source.id,
      sourceUrl: params.announcement.url,
      title: resolveJobPostingTitle(params.announcement, {
        parseTitle: parseResult.title,
        detailText: params.detailText,
      }),
      province,
      publishDate,
      deadline,
      requirements: finalRequirements,
      rawText: resolvePostingText(
        parseResult.rawText || params.detailText,
        params.detailText,
      ),
      detailTextFallback: params.detailText,
      dryRun: params.dryRun,
    });

    if (action === "created") stats.created += 1;
    else if (action === "updated") stats.updated += 1;
    else stats.skipped += 1;
  } catch (error) {
    stats.failed += 1;
    logError(`入库失败: ${params.announcement.title}`, error);
  }

  return stats;
}

async function processAnnouncement(
  source: Source,
  config: ParserConfig,
  announcement: ListAnnouncement,
  dryRun: boolean,
): Promise<CrawlStats> {
  const tag = isUniversitySource(config) ? "[高校]" : "[公告]";
  logInfo(`${tag} 处理公告 · ${source.name}: ${announcement.title}`);
  logInfo(`${tag} 详情页: ${announcement.url}`);

  const detailHtml = await fetchText(announcement.url, config.listUrl ?? source.url);
  const detailText = extractDetailText(detailHtml, config);
  const attachmentUrls = findAttachmentLinks(detailHtml, announcement.url, config)
    .filter((url) => {
      if (!isUniversitySource(config)) return true;
      const fileName = decodeURIComponent(
        String(url.split("/").pop() ?? "").split("?")[0],
      );
      if (isRegistrationFormAttachment(fileName)) {
        logInfo(`[高校] 跳过报名表附件: ${fileName}`);
        return false;
      }
      return true;
    });

  logInfo(`正文 ${detailText.length} 字，附件 ${attachmentUrls.length} 个`);

  if (isUniversitySource(config)) {
    logInfo(
      `[高校] ${source.name} · 附件 ${attachmentUrls.length} 个 · 正文 ${detailText.length} 字`,
    );
  }

  const parseResults: ParseResult[] = [];

  for (const attachmentUrl of attachmentUrls) {
    try {
      const result = await parseAttachmentFromUrl(attachmentUrl, announcement.url, detailText);
      if (result) parseResults.push(result);
    } catch (error) {
      logError(`附件解析失败: ${attachmentUrl}`, error);
    }
  }

  if (parseResults.length === 0 && detailText.length >= 80) {
    logInfo("无附件，使用详情页正文做规则解析 fallback");
    const fallbackBuffer = Buffer.from(detailText, "utf-8");
    parseResults.push(
      await parseAttachmentWithMainText(
        detailText,
        fallbackBuffer,
        "xlsx",
        `${announcement.title}.txt`,
      ),
    );
  }

  return persistFromParseResults({
    source,
    config,
    announcement,
    parseResults,
    detailText,
    detailHtml: detailHtml,
    dryRun,
  });
}

// ─── 来源调度 ─────────────────────────────────────────────────────

async function crawlSource(source: Source, options: CrawlOptions): Promise<CrawlStats> {
  const { dryRun, fullMode } = options;
  const config = mergeParserConfig(source);
  const handlerType = config.type ?? "hunan-rst";
  const modeLabel = resolveCrawlModeLabel(fullMode);
  const cutoff = getIncrementalCutoff(source, fullMode);
  const maxListItems = resolveMaxListItems(config, fullMode);

  if (handlerType === "hunan-university") {
    logInfo(`[高校][${modeLabel}] 开始抓取: ${source.name} (${handlerType})`);
  } else {
    logInfo(`[${modeLabel}] 开始抓取来源: ${source.name} (${handlerType})`);
  }

  if (fullMode) {
    logInfo(
      `[${modeLabel}] ${source.name}：抓取列表全部可见历史（单来源上限 ${maxListItems} 条）`,
    );
  } else if (cutoff) {
    logInfo(
      `[${modeLabel}] ${source.name}：仅处理发布于 ${formatCutoffForLog(cutoff)} 之后的公告（lastCrawled 缓冲 48h）`,
    );
  } else {
    logInfo(
      `[${modeLabel}] ${source.name}：尚无 lastCrawled，按当前列表页同步（上限 ${maxListItems} 条）`,
    );
  }

  const stats: CrawlStats = {
    listed: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  const listUrl = config.listUrl ?? source.url;
  if (!listUrl) {
    throw new Error(`来源 ${source.name} 缺少 listUrl / url`);
  }

  const baseDelayMs = config.requestDelayMs ?? DEFAULT_BASE_DELAY_MS;
  beginSourceHttpContext(source.name, baseDelayMs);
  logInfo(
    `[防封] ${source.name} 请求节奏 baseDelay=${baseDelayMs}ms + jitter(0-${HTTP_JITTER_MAX_MS}ms)，连续失败 ${MAX_CONSECUTIVE_HTTP_FAILURES} 次熔断`,
  );

  try {
    const listHtml = await fetchText(listUrl, source.url);
    let announcements = await scrapeAllAnnouncements(
      listHtml,
      listUrl,
      config,
      maxListItems,
    );
    const listedBeforeDateFilter = announcements.length;
    announcements = filterAnnouncementsByIncrementalCutoff(
      announcements,
      cutoff,
      fullMode,
    );
    if (!fullMode && cutoff && listedBeforeDateFilter > announcements.length) {
      logInfo(
        `[增量模式] ${source.name} 日期过滤：${listedBeforeDateFilter} → ${announcements.length} 条`,
      );
    }
    stats.listed = announcements.length;

    if (isUniversitySource(config)) {
      logInfo(`[高校] ${source.name} 列表页 ${listUrl} → ${announcements.length} 条`);
    } else {
      logInfo(`列表页 ${listUrl} → ${announcements.length} 条公告`);
    }

    if (announcements.length === 0) {
      logWarn(
        isUniversitySource(config)
          ? `[高校] ${source.name} 未解析到招聘列表，请检查 listSelector / url`
          : `来源 ${source.name} 未解析到公告，请检查 parserConfig`,
      );
      return stats;
    }

    const delayMs = config.requestDelayMs ?? DEFAULT_BASE_DELAY_MS;

    for (let i = 0; i < announcements.length; i += 1) {
      if (isSourceHttpCircuitTripped()) {
        logWarn(
          `[熔断] 跳过 ${source.name} 剩余 ${announcements.length - i} 条公告`,
        );
        break;
      }

      const item = announcements[i];
      logInfo(`[${i + 1}/${announcements.length}] ${item.title}`);

      try {
        const itemStats = await processAnnouncement(source, config, item, dryRun);
        stats.processed += itemStats.processed;
        stats.created += itemStats.created;
        stats.updated += itemStats.updated;
        stats.skipped += itemStats.skipped;
        stats.failed += itemStats.failed;
      } catch (error) {
        if (error instanceof HttpCircuitOpenError) {
          logError(error.message);
          break;
        }
        stats.failed += 1;
        logError(`公告处理失败: ${item.url}`, error);
        if (isSourceHttpCircuitTripped()) {
          break;
        }
      }

      if (i < announcements.length - 1 && delayMs > 0 && !isSourceHttpCircuitTripped()) {
        await sleep(delayMs);
      }
    }

    if (!dryRun) {
      const circuitTripped = isSourceHttpCircuitTripped();
      const hasChanges = stats.created + stats.updated > 0;
      const nextStatus = circuitTripped
        ? "error"
        : stats.failed > 0 && stats.created + stats.updated === 0
          ? "error"
          : "active";

      if (fullMode) {
        await prisma.source.update({
          where: { id: source.id },
          data: {
            lastCrawled: new Date(),
            status: nextStatus,
          },
        });
        logInfo(`[全量模式] 已更新 ${source.name} lastCrawled`);
      } else if (hasChanges) {
        await prisma.source.update({
          where: { id: source.id },
          data: {
            lastCrawled: new Date(),
            status: nextStatus,
          },
        });
        logInfo(
          `[增量模式] 有新增/更新岗位，已更新 ${source.name} lastCrawled`,
        );
      } else {
        await prisma.source.update({
          where: { id: source.id },
          data: { status: nextStatus },
        });
        logInfo(
          `[增量模式] 无新增/更新岗位，保留 ${source.name} lastCrawled 不变`,
        );
      }
    }

    logInfo(
      isUniversitySource(config)
        ? `[高校] ${source.name} 完成: 列表 ${stats.listed} · 处理 ${stats.processed} · 新增 ${stats.created} · 更新 ${stats.updated} · 跳过 ${stats.skipped} · 失败 ${stats.failed}`
        : `来源 ${source.name} 完成: 列表 ${stats.listed} · 处理 ${stats.processed} · 新增 ${stats.created} · 更新 ${stats.updated} · 跳过 ${stats.skipped} · 失败 ${stats.failed}`,
    );
  } catch (error) {
    if (error instanceof HttpCircuitOpenError) {
      logError(`来源 ${source.name} 因熔断终止: ${error.message}`);
      if (!dryRun) {
        await prisma.source.update({
          where: { id: source.id },
          data: { status: "error" },
        });
      }
      return stats;
    }
    logError(`来源 ${source.name} 抓取失败`, error);
    if (!dryRun) {
      await prisma.source.update({
        where: { id: source.id },
        data: { status: "error" },
      });
    }
    throw error;
  } finally {
    endSourceHttpContext();
  }

  return stats;
}

async function ensureHunanSource() {
  let source = await prisma.source.findFirst({
    where: { name: "湖南省人社厅" },
  });

  if (source) return source;

  logInfo("未找到湖南省人社厅 Source，自动创建默认记录");
  return prisma.source.create({
    data: {
      name: "湖南省人社厅",
      province: "湖南",
      type: "人社厅",
      url: "https://rst.hunan.gov.cn/",
      priority: 10,
      updateFrequency: "daily",
      status: "active",
      parserConfig: DEFAULT_HUNAN_RST_CONFIG,
    },
  });
}

async function main() {
  const { sourceName, dryRun, fullMode } = parseCliArgs();

  logInfo("anBian 可配置爬虫启动");
  if (dryRun) logInfo("dry-run 模式：不写数据库");
  if (fullMode) {
    logInfo("运行模式：全量模式（--full，抓取列表全部可见历史）");
  } else {
    logInfo(
      "运行模式：增量模式（默认，lastCrawled 之后 + 48h 缓冲；有新增/更新才推进 lastCrawled）",
    );
  }

  let sources: Source[];

  if (sourceName) {
    const found = await prisma.source.findFirst({
      where: { name: sourceName, status: "active" },
    });
    if (!found) {
      if (sourceName === "湖南省人社厅") {
        sources = [await ensureHunanSource()];
      } else {
        logError(`未找到 active 来源: ${sourceName}`);
        process.exitCode = 1;
        return;
      }
    } else {
      sources = [found];
    }
  } else {
    sources = await prisma.source.findMany({
      where: { status: "active" },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    });

    if (sources.length === 0) {
      sources = [await ensureHunanSource()];
    }
  }

  logInfo(`待处理来源 ${sources.length} 个`);

  const total: CrawlStats = {
    listed: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const source of sources) {
    const config = mergeParserConfig(source);
    if (!SUPPORTED_PARSER_TYPES.has(config.type ?? "")) {
      logWarn(`来源 ${source.name} 的 parserConfig.type=${config.type} 暂未实现，跳过`);
      continue;
    }

    try {
      const stats = await crawlSource(source, { dryRun, fullMode });
      total.listed += stats.listed;
      total.processed += stats.processed;
      total.created += stats.created;
      total.updated += stats.updated;
      total.skipped += stats.skipped;
      total.failed += stats.failed;
    } catch (error) {
      logError(`来源 ${source.name} 异常终止`, formatAxiosError(error));
    }
  }

  logInfo(
    `全部完成: 列表 ${total.listed} · 处理 ${total.processed} · 新增 ${total.created} · 更新 ${total.updated} · 跳过 ${total.skipped} · 失败 ${total.failed}`,
  );
}

main()
  .catch((error) => {
    logError("爬虫未捕获异常", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
