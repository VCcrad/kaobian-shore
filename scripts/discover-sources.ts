/**
 * discover-sources.ts · 半自动发现招聘来源（扫描汇总页 → 建议 add-source 命令）
 *
 * 用法：
 *   npx tsx scripts/discover-sources.ts --province=湖南
 *   npx tsx scripts/discover-sources.ts --province=湖南 --dry-run
 *   npx tsx scripts/discover-sources.ts --province=湖南 --seed=hunan-jyt --deep
 *   npx tsx scripts/discover-sources.ts --apply   # 直接写入 Source（非 dry-run）
 *
 * 默认 --dry-run：只打印建议命令，不写库。
 */

import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const PAGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const PARSER_CONFIG_UNIVERSITY = path.join(ROOT, "parser-config-hunan-university.json");

const DEFAULT_RST_PARSER_CONFIG: Prisma.InputJsonValue = {
  type: "hunan-rst",
  listSelector: "ul.list li, .list li, table.list tr, .xxgk-list li",
  linkSelector: "a",
  dateSelector: "span, em, .time, td:last-child",
  detailContentSelectors: ["#content", ".content", ".TRS_Editor", ".zw", "article"],
  maxListItems: 15,
  requestDelayMs: 2000,
};

type SourceKind = "高校" | "事业单位" | "人社厅" | "其他";

type DiscoverySeed = {
  id: string;
  label: string;
  province: string;
  url: string;
  followDetailLinks?: boolean;
  maxDetailFollow?: number;
};

type DiscoveredCandidate = {
  name: string;
  url: string;
  type: SourceKind;
  province: string;
  score: number;
  seedId: string;
  seedLabel: string;
  linkTitle: string;
  status: "new" | "exists";
  matchedSourceName?: string;
};

type CliArgs = {
  province: string;
  dryRun: boolean;
  apply: boolean;
  deep: boolean;
  seedFilter?: string;
  help: boolean;
};

// ─── 扫描入口（可按 province 过滤）────────────────────────────────

const DISCOVERY_SEEDS: DiscoverySeed[] = [
  {
    id: "hunan-rst-sydwzp",
    label: "湖南省人社厅 · 事业单位公开招聘",
    province: "湖南",
    url: "https://rst.hunan.gov.cn/rst/xxgk/zpzl/sydwzp/index.html",
    followDetailLinks: true,
    maxDetailFollow: 12,
  },
  {
    id: "hunan-jyt-tzgg",
    label: "湖南省教育厅 · 通知公告",
    province: "湖南",
    url: "https://jyt.hunan.gov.cn/jyt/sjyt/xxgk/tzgg/index.html",
    followDetailLinks: true,
    maxDetailFollow: 8,
  },
  {
    id: "hunan-jyt-xxgk",
    label: "湖南省教育厅 · 政府信息公开",
    province: "湖南",
    url: "https://jyt.hunan.gov.cn/jyt/sjyt/xxgk/index.html",
  },
];

/** 教育部专业目录入口（用于扩展扫描外链，通常不含直链列表页） */
const MOE_CATALOG_SEEDS: DiscoverySeed[] = [
  {
    id: "moe-undergraduate-catalog",
    label: "教育部 · 普通高等学校本科专业目录（公开）",
    province: "*",
    url: "http://www.moe.gov.cn/jyb_xxgk/xxgk/neirong/fenlei/sxml_gdjy/gdjy_bkzysz/bkzysz_bkzyml/",
  },
  {
    id: "moe-graduate-catalog",
    label: "教育部 · 高等教育分类目录（含研究生目录入口）",
    province: "*",
    url: "http://www.moe.gov.cn/jyb_xxgk/xxgk/neirong/fenlei/sxml_gdjy/",
  },
];

// ─── 环境 & Prisma ─────────────────────────────────────────────

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

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    province: "湖南",
    dryRun: true,
    apply: false,
    deep: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      args.apply = false;
      continue;
    }
    if (arg === "--apply") {
      args.apply = true;
      args.dryRun = false;
      continue;
    }
    if (arg === "--deep") {
      args.deep = true;
      continue;
    }
    if (arg.startsWith("--province=")) {
      args.province = stripQuotes(arg.slice("--province=".length));
      continue;
    }
    if (arg.startsWith("--seed=")) {
      args.seedFilter = stripQuotes(arg.slice("--seed=".length));
      continue;
    }
    throw new Error(`未知参数: ${arg}（使用 --help 查看用法）`);
  }

  return args;
}

function printHelp() {
  console.log(`
discover-sources.ts · 半自动发现招聘来源

用法：
  npx tsx scripts/discover-sources.ts --province=湖南
  npx tsx scripts/discover-sources.ts --province=湖南 --seed=hunan-rst-sydwzp --deep
  npx tsx scripts/discover-sources.ts --province=湖南 --apply

选项：
  --province=湖南     只扫描该省份相关入口（默认：湖南）
  --seed=ID           只跑指定 seed（见脚本内 DISCOVERY_SEEDS）
  --deep              对人社厅公告详情页再扫一层，提取高校 rsc 外链
  --dry-run           只打印建议命令（默认）
  --apply             直接写入 Source 表（等同批量 add-source）
  --help              显示帮助

输出：每条新来源一行 add-source.ts 命令，可直接复制执行。
`);
}

// ─── HTTP & 解析 ─────────────────────────────────────────────────

async function fetchHtml(url: string, referer?: string): Promise<string> {
  const { data } = await axios.get<string>(url, {
    timeout: 30000,
    maxRedirects: 5,
    responseType: "text",
    headers: {
      "User-Agent": PAGE_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: referer ?? url,
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });
  return String(data ?? "");
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function normalizeWhitespace(text: string): string {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSourceUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    let pathname = u.pathname.replace(/\/index\.html?$/iu, "");
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    return `${u.protocol}//${u.host}${pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function extractLinks(html: string, pageUrl: string): Array<{ title: string; url: string }> {
  const $ = cheerio.load(html);
  const out: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
    const absolute = resolveUrl(href, pageUrl);
    if (!absolute || seen.has(absolute)) return;
    seen.add(absolute);
    const title = normalizeWhitespace($(el).text());
    out.push({ title, url: absolute });
  });

  return out;
}

const HUNAN_DOMAIN_HINTS: Record<string, string> = {
  "hnu.edu.cn": "湖南大学",
  "hunnu.edu.cn": "湖南师范大学",
  "csu.edu.cn": "中南大学",
  "hnucm.edu.cn": "湖南中医药大学",
  "xtu.edu.cn": "湘潭大学",
  "csust.edu.cn": "长沙理工大学",
  "csuft.edu.cn": "中南林业科技大学",
  "hunau.edu.cn": "湖南农业大学",
  "hnust.edu.cn": "湖南科技大学",
  "hnut.edu.cn": "湖南工业大学",
  "usc.edu.cn": "南华大学",
  "hnuc.edu.cn": "湖南城市学院",
};

/** 公告标题命中校名时，建议对应人事/招聘列表页（半自动推断） */
const KNOWN_HUNAN_UNIVERSITY_RSC: Array<{
  pattern: RegExp;
  name: string;
  url: string;
}> = [
  { pattern: /湖南大学(?!科技)/, name: "湖南大学", url: "https://rsc.hnu.edu.cn/zpxx.htm" },
  { pattern: /湖南师范大学/, name: "湖南师范大学", url: "https://rsc.hunnu.edu.cn/" },
  { pattern: /中南大学(?!林业)/, name: "中南大学", url: "https://rsc.csu.edu.cn/" },
  { pattern: /湖南中医药大学/, name: "湖南中医药大学", url: "https://www.hnucm.edu.cn/qtsw/tzgg.htm" },
  { pattern: /湘潭大学/, name: "湘潭大学", url: "https://rsc.xtu.edu.cn/" },
  { pattern: /长沙理工大学/, name: "长沙理工大学", url: "https://www.csust.edu.cn/rsc/zpxx.htm" },
  { pattern: /中南林业科技大学/, name: "中南林业科技大学", url: "https://rscn.csuft.edu.cn/rczp/zpxx.htm" },
  { pattern: /湖南农业大学/, name: "湖南农业大学", url: "https://rsc.hunau.edu.cn/" },
  { pattern: /湖南科技大学/, name: "湖南科技大学", url: "https://rsc.hnust.edu.cn/" },
  { pattern: /湖南工业大学/, name: "湖南工业大学", url: "https://rsc.hnut.edu.cn/" },
  { pattern: /南华大学/, name: "南华大学", url: "https://rsc.usc.edu.cn/" },
  { pattern: /湖南工商大学/, name: "湖南工商大学", url: "https://rsc.hutb.edu.cn/" },
  { pattern: /湖南理工学院/, name: "湖南理工学院", url: "https://rsc.hnist.cn/" },
  { pattern: /吉首大学/, name: "吉首大学", url: "https://rsc.jsu.edu.cn/" },
  { pattern: /衡阳师范学院/, name: "衡阳师范学院", url: "https://rsc.hynu.edu.cn/" },
  { pattern: /湖南文理学院/, name: "湖南文理学院", url: "https://rsc.huas.edu.cn/" },
];

function suggestUniversityFromTitle(title: string): { name: string; url: string } | null {
  const text = normalizeWhitespace(title);
  for (const item of KNOWN_HUNAN_UNIVERSITY_RSC) {
    if (item.pattern.test(text)) {
      return { name: item.name, url: item.url };
    }
  }
  return null;
}

function extractTextUrls(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+\.edu\.cn[^\s"'<>]*/gi)) {
    found.add(match[0].replace(/[),.;，。；]+$/u, ""));
  }
  return [...found];
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function inferNameFromTitle(title: string, url: string): string {
  const cleaned = normalizeWhitespace(title);
  const fromTitle =
    cleaned.match(/([\u4e00-\u9fa5]{2,30}(?:大学|学院|学校|研究院|医院|中心))/)?.[1] ??
    cleaned.match(/(湖南[\u4e00-\u9fa5]{2,20})/)?.[1];

  if (fromTitle && fromTitle.length >= 4) return fromTitle;

  const host = hostnameOf(url);
  for (const [domain, name] of Object.entries(HUNAN_DOMAIN_HINTS)) {
    if (host.includes(domain)) return name;
  }

  if (host.includes(".edu.cn")) {
    const sub = host.split(".")[0];
    return sub ? `${sub}.edu.cn` : host;
  }

  return cleaned.slice(0, 40) || host || "未命名来源";
}

function inferSourceType(name: string, url: string): SourceKind {
  const text = `${name} ${url}`;
  if (/大学|学院|学校/.test(name) && /\.edu\.cn/i.test(url)) return "高校";
  if (/医院|中心|研究所/.test(name)) return "事业单位";
  if (/rst\.hunan\.gov|人社|人事/.test(text)) return "事业单位";
  if (/教育厅|jyt\./.test(url)) return "其他";
  return "事业单位";
}

function scoreRecruitmentListUrl(url: string, title: string): number {
  const u = url.toLowerCase();
  const t = title.toLowerCase();
  let score = 0;

  if (/\.edu\.cn/.test(u)) score += 2;
  if (/rsc\.|rs\.|hr\.|renshi|rlzy|rczp|zpxx|zp\.|zhaopin|rsxx|rszp|招聘/.test(u)) {
    score += 3;
  }
  if (/招聘|招贤|引才|人才|人事/.test(t)) score += 2;
  if (/\.(pdf|doc|docx|xlsx|xls|zip|rar)(\?|#|$)/i.test(u)) score -= 5;
  if (/javascript:|#/.test(u)) score -= 5;
  if (/login|register|javascript/.test(u)) score -= 3;

  // 人社厅公告详情（非列表页）降权，deep 模式再跟进
  if (/rst\.hunan\.gov\.cn.*\/t20\d{6}_\d+\.html/i.test(u)) score -= 2;
  if (/index\.html?(\?|#|$)/i.test(u) && /zpxx|zp|rsxx|招聘/.test(u)) score += 1;

  return score;
}

function isLikelyRecruitmentList(url: string, title: string): boolean {
  return scoreRecruitmentListUrl(url, title) >= 4;
}

function isGovAnnouncementDetail(url: string): boolean {
  return /(?:rst|jyt)\.hunan\.gov\.cn.*\/t20\d{6}_\d+\.html/i.test(url);
}

function collectUniversityFromAnnouncementTitle(
  seed: DiscoverySeed,
  title: string,
  province: string,
  bucket: Map<string, DiscoveredCandidate>,
  contextLabel: string,
) {
  const hit = suggestUniversityFromTitle(title);
  if (!hit) return;

  const key = normalizeSourceUrl(hit.url);
  const score = 7;
  const existing = bucket.get(key);
  if (existing && existing.score >= score) return;

  bucket.set(key, {
    name: hit.name,
    url: hit.url,
    type: "高校",
    province,
    score,
    seedId: seed.id,
    seedLabel: seed.label,
    linkTitle: `${contextLabel} → ${title}`,
    status: "new",
  });
}

function provinceMatchesSeed(seedProvince: string, filterProvince: string): boolean {
  if (seedProvince === "*") return true;
  return seedProvince === filterProvince;
}

function loadParserConfig(kind: SourceKind, listUrl: string): Prisma.InputJsonValue {
  if (kind === "高校" && fs.existsSync(PARSER_CONFIG_UNIVERSITY)) {
    const cfg = JSON.parse(
      fs.readFileSync(PARSER_CONFIG_UNIVERSITY, "utf8"),
    ) as Record<string, unknown>;
    return { ...cfg, listUrl: cfg.listUrl ?? listUrl } as Prisma.InputJsonValue;
  }

  if (kind === "高校") {
    return { type: "hunan-university", listUrl };
  }

  return { ...DEFAULT_RST_PARSER_CONFIG, listUrl } as Prisma.InputJsonValue;
}

function buildAddSourceCommand(candidate: DiscoveredCandidate): string {
  if (candidate.type === "高校") {
    return [
      "npx tsx scripts/add-source.ts",
      `--name="${candidate.name}"`,
      `--province="${candidate.province}"`,
      `--type="${candidate.type}"`,
      `--url="${candidate.url}"`,
      `--parserConfigFile="parser-config-hunan-university.json"`,
    ].join(" ");
  }

  const cfg = JSON.stringify({
    type: "hunan-rst",
    listUrl: candidate.url,
  });

  return [
    "npx tsx scripts/add-source.ts",
    `--name="${candidate.name}"`,
    `--province="${candidate.province}"`,
    `--type="${candidate.type}"`,
    `--url="${candidate.url}"`,
    `--parserConfig='${cfg}'`,
  ].join(" ");
}

// ─── 发现逻辑 ───────────────────────────────────────────────────

async function collectFromPage(
  seed: DiscoverySeed,
  pageUrl: string,
  province: string,
  bucket: Map<string, DiscoveredCandidate>,
) {
  let html: string;
  try {
    html = await fetchHtml(pageUrl, seed.url);
  } catch (error) {
    console.warn(`  ⚠ 无法抓取: ${pageUrl} (${error instanceof Error ? error.message : error})`);
    return;
  }

  for (const link of extractLinks(html, pageUrl)) {
    if (!isLikelyRecruitmentList(link.url, link.title)) continue;

    const host = hostnameOf(link.url);
    const isHunanEdu =
      host.endsWith(".edu.cn") &&
      (link.title.includes("湖南") ||
        host.includes("hn") ||
        Object.keys(HUNAN_DOMAIN_HINTS).some((d) => host.includes(d)));

    const isHunanGov =
      host.includes("hunan.gov.cn") && /招聘|招贤|人事/.test(link.title);

    if (seed.province === "湖南" && province === "湖南") {
      if (!isHunanEdu && !isHunanGov && !link.title.includes("湖南")) continue;
    }

    // --province=湖南 时不收录中央部委站点（教育部门户导航等）
    if (province === "湖南" && /(?:^|\.)moe\.gov\.cn$/i.test(host)) continue;

    const name = inferNameFromTitle(link.title, link.url);
    const type = inferSourceType(name, link.url);
    const key = normalizeSourceUrl(link.url);

    const existing = bucket.get(key);
    const score = scoreRecruitmentListUrl(link.url, link.title);
    if (existing && existing.score >= score) continue;

    bucket.set(key, {
      name,
      url: link.url,
      type,
      province,
      score,
      seedId: seed.id,
      seedLabel: seed.label,
      linkTitle: link.title,
      status: "new",
    });
  }
}

async function followGovDetails(
  seed: DiscoverySeed,
  links: Array<{ title: string; url: string }>,
  province: string,
  bucket: Map<string, DiscoveredCandidate>,
  maxFollow: number,
) {
  const details = links
    .filter((l) => isGovAnnouncementDetail(l.url))
    .slice(0, maxFollow);

  for (const detail of details) {
    collectUniversityFromAnnouncementTitle(
      seed,
      detail.title,
      province,
      bucket,
      "公告标题推断",
    );

    try {
      const html = await fetchHtml(detail.url, seed.url);

      for (const textUrl of extractTextUrls(html)) {
        if (!/\.edu\.cn/i.test(textUrl)) continue;
        const name = inferNameFromTitle(detail.title, textUrl);
        const key = normalizeSourceUrl(textUrl);
        const score = scoreRecruitmentListUrl(textUrl, detail.title) + 2;
        bucket.set(key, {
          name,
          url: textUrl,
          type: inferSourceType(name, textUrl),
          province,
          score,
          seedId: seed.id,
          seedLabel: `${seed.label} → 公告正文链接`,
          linkTitle: `${detail.title} / ${textUrl}`,
          status: "new",
        });
      }

      for (const link of extractLinks(html, detail.url)) {
        if (!/\.edu\.cn/i.test(link.url)) continue;
        if (!isLikelyRecruitmentList(link.url, link.title)) {
          if (!/rsc\.|rs\.|hr\.|zpxx|zp\./i.test(link.url)) continue;
        }
        const name =
          inferNameFromTitle(detail.title, link.url) ||
          inferNameFromTitle(link.title, link.url);
        const key = normalizeSourceUrl(link.url);
        const score = scoreRecruitmentListUrl(link.url, `${detail.title} ${link.title}`) + 1;
        bucket.set(key, {
          name,
          url: link.url,
          type: inferSourceType(name, link.url),
          province,
          score,
          seedId: seed.id,
          seedLabel: `${seed.label} → 公告详情`,
          linkTitle: `${detail.title} / ${link.title}`,
          status: "new",
        });
      }
    } catch {
      // 单条失败不影响整体
    }
  }
}

async function discoverFromSeed(
  seed: DiscoverySeed,
  province: string,
  deep: boolean,
  bucket: Map<string, DiscoveredCandidate>,
) {
  console.log(`\n📡 扫描: ${seed.label}`);
  console.log(`   ${seed.url}`);

  let html: string;
  try {
    html = await fetchHtml(seed.url);
  } catch (error) {
    console.warn(
      `   ⚠ 入口页抓取失败: ${error instanceof Error ? error.message : error}`,
    );
    return;
  }

  const links = extractLinks(html, seed.url);
  await collectFromPage(seed, seed.url, province, bucket);

  for (const link of links) {
    if (/招聘|公开招聘|引才|人才/.test(link.title)) {
      collectUniversityFromAnnouncementTitle(
        seed,
        link.title,
        province,
        bucket,
        "列表标题推断",
      );
    }
  }

  // 同站分页/栏目（浅层）
  const sameSite = links
    .filter((l) => {
      try {
        return new URL(l.url).hostname === new URL(seed.url).hostname;
      } catch {
        return false;
      }
    })
    .filter((l) => /招聘|zp|rsxx|rsgz|gsgg|sydwzp/i.test(`${l.url} ${l.title}`))
    .slice(0, 5);

  for (const page of sameSite) {
    await collectFromPage(seed, page.url, province, bucket);
  }

  if ((deep || seed.followDetailLinks) && seed.maxDetailFollow) {
    console.log(`   ↳ deep: 跟进 ${seed.maxDetailFollow} 条人社厅公告详情…`);
    await followGovDetails(seed, links, province, bucket, seed.maxDetailFollow);
  }
}

async function markExisting(
  candidates: Map<string, DiscoveredCandidate>,
  province: string,
) {
  const existingSources = await prisma.source.findMany({
    where: province ? { province } : undefined,
  });

  const byUrl = new Map<string, { name: string }>();
  for (const source of existingSources) {
    byUrl.set(normalizeSourceUrl(source.url), { name: source.name });
  }

  for (const candidate of candidates.values()) {
    const hit = byUrl.get(normalizeSourceUrl(candidate.url));
    if (hit) {
      candidate.status = "exists";
      candidate.matchedSourceName = hit.name;
    }
  }
}

async function applyCandidates(candidates: DiscoveredCandidate[]) {
  const toApply = candidates.filter((c) => c.status === "new");
  if (toApply.length === 0) {
    console.log("\n没有需要写入的新来源。");
    return;
  }

  console.log(`\n📝 --apply 模式：写入 ${toApply.length} 条 Source…`);

  for (const candidate of toApply) {
    const parserConfig = loadParserConfig(candidate.type, candidate.url);
    const existing = await prisma.source.findFirst({
      where: { name: candidate.name },
    });

    if (existing) {
      await prisma.source.update({
        where: { id: existing.id },
        data: {
          province: candidate.province,
          type: candidate.type,
          url: candidate.url,
          parserConfig,
          status: "active",
        },
      });
      console.log(`   ♻ 更新: ${candidate.name}`);
    } else {
      await prisma.source.create({
        data: {
          name: candidate.name,
          province: candidate.province,
          type: candidate.type,
          url: candidate.url,
          parserConfig,
          priority: 5,
          updateFrequency: "daily",
          status: "active",
        },
      });
      console.log(`   ✅ 创建: ${candidate.name}`);
    }
  }
}

function printReport(candidates: DiscoveredCandidate[], dryRun: boolean) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const fresh = sorted.filter((c) => c.status === "new");
  const exists = sorted.filter((c) => c.status === "exists");

  console.log("\n" + "=".repeat(72));
  console.log(`发现 ${sorted.length} 条候选 · 新 ${fresh.length} · 已存在 ${exists.length}`);
  console.log("=".repeat(72));

  if (fresh.length === 0) {
    console.log("\n暂无新来源建议。可尝试 --deep 或检查 seed 入口是否可访问。");
  }

  for (const [index, item] of fresh.entries()) {
    console.log(`\n【新 ${index + 1}】${item.name} (${item.type})`);
    console.log(`  列表页: ${item.url}`);
    console.log(`  来源入口: ${item.seedLabel}`);
    console.log(`  链接文字: ${item.linkTitle || "—"}`);
    console.log(`  置信分: ${item.score}`);
    console.log(`  建议命令:`);
    console.log(`  ${buildAddSourceCommand(item)}`);
  }

  if (exists.length > 0) {
    console.log(`\n--- 已入库 (${exists.length}) ---`);
    for (const item of exists.slice(0, 20)) {
      console.log(`  ✓ ${item.name} ← ${item.url}`);
      if (item.matchedSourceName && item.matchedSourceName !== item.name) {
        console.log(`    (库中名称: ${item.matchedSourceName})`);
      }
    }
    if (exists.length > 20) {
      console.log(`  … 另有 ${exists.length - 20} 条`);
    }
  }

  if (dryRun && fresh.length > 0) {
    console.log("\n" + "-".repeat(72));
    console.log("批量复制（PowerShell，项目根目录执行）:\n");
    for (const item of fresh) {
      console.log(buildAddSourceCommand(item));
    }
    console.log("\n提示: 去掉 --dry-run 不会自动写库；需写入请使用 --apply");
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const seeds = [...DISCOVERY_SEEDS, ...MOE_CATALOG_SEEDS].filter((seed) => {
    if (!provinceMatchesSeed(seed.province, args.province)) return false;
    if (args.seedFilter && seed.id !== args.seedFilter) return false;
    return true;
  });

  if (seeds.length === 0) {
    throw new Error(`没有匹配的 seed（province=${args.province}, seed=${args.seedFilter ?? "全部"}）`);
  }

  console.log("🔎 discover-sources · 半自动发现招聘来源");
  console.log(`   省份过滤: ${args.province}`);
  console.log(`   模式: ${args.apply ? "apply（写库）" : "dry-run（仅建议）"}`);
  console.log(`   deep: ${args.deep ? "是" : "否"}`);
  console.log(`   seeds: ${seeds.map((s) => s.id).join(", ")}`);

  const bucket = new Map<string, DiscoveredCandidate>();

  for (const seed of seeds) {
    await discoverFromSeed(seed, args.province, args.deep, bucket);
  }

  await markExisting(bucket, args.province);
  const candidates = [...bucket.values()];

  printReport(candidates, args.dryRun);

  if (args.apply) {
    await applyCandidates(candidates);
  }
}

main()
  .catch((error) => {
    console.error("❌ discover-sources 失败:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
