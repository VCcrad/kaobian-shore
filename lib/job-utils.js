import { resolveDeadlineEndDate } from "./deadline-utils.js";

const CITY_KEYWORDS = ["长沙", "北京", "上海", "武汉"];

const CATEGORY_RULES = [
  { category: "公务员", keywords: ["公务员", "选调", "国考", "省考"] },
  { category: "事业编", keywords: ["事业编", "事业单位"] },
  {
    category: "高校教师",
    keywords: ["高校", "大学", "学院", "辅导员", "教师岗"],
  },
  { category: "申博", keywords: ["申博", "博士", "读博", "博士研究生"] },
];

/** @returns {number|null} 剩余天数；无有效截止日期时返回 null */
export function calcDaysLeft(deadline, now = new Date()) {
  const end = resolveDeadlineEndDate(deadline);
  if (!end) return null;
  const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

/** 前台列表是否展示：必须有有效截止日期且未过期 */
export function isPublishedJobVisible(job, now = new Date()) {
  const end = resolveDeadlineEndDate(job.deadline);
  if (!end) return false;
  return end >= now;
}

function inferCity(text) {
  const found = CITY_KEYWORDS.find((city) => text.includes(city));
  return found || "长沙";
}

function inferCategory(text) {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return rule.category;
    }
  }
  return "事业编";
}

function categoryTagLabel(category) {
  if (category === "高校教师") return "高校编制";
  return category;
}

export function formatTitle(title) {
  const trimmed = title.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("《") && trimmed.endsWith("》")) return trimmed;
  return `《${trimmed}》`;
}

/** 去掉书名号，供前台卡片标题展示 */
export function stripBookTitle(title) {
  const t = String(title ?? "").trim();
  if (t.startsWith("《") && t.endsWith("》")) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** 从后台标题 `[学校名] 公告标题` 提取单位 */
export function extractOrganizationFromTitle(title) {
  const t = String(title ?? "").trim();
  const bracket = t.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bracket) {
    return { organization: bracket[1].trim(), title: bracket[2].trim() || t };
  }
  const uni = t.match(/^(.{2,24}?(?:大学|学院|研究院|研究所|教育厅|人社局))/);
  if (uni) {
    return { organization: uni[1].trim(), title: t };
  }
  return { organization: "", title: t };
}

function inferEducation(text) {
  const s = String(text ?? "");
  if (/博士|博士研究生|博后/.test(s)) return "博士";
  if (/硕士|研究生/.test(s)) return "硕士及以上";
  if (/本科/.test(s)) return "本科及以上";
  if (/大专|专科/.test(s)) return "大专及以上";
  return "";
}

function formatPublishDate(job) {
  if (job.publishDate && String(job.publishDate).trim()) {
    return String(job.publishDate).trim();
  }
  if (job.createdAt) {
    const d = new Date(job.createdAt);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  return "";
}

function buildSummary(job, content) {
  const stored = String(job.summary ?? "").trim();
  if (stored) return stored;
  const c = String(content ?? "").replace(/\s+/g, " ").trim();
  if (c.length > 320) return `${c.slice(0, 320)}…`;
  return c;
}

/** 将数据库 Job 转为首页 HomeClient 所需结构 */
export function mapJobToHomeCard(job) {
  const parsed = extractOrganizationFromTitle(job.title);
  const displayTitle = stripBookTitle(parsed.title || job.title);
  const organization =
    String(job.organization ?? "").trim() || parsed.organization || "招聘单位";
  const majors = String(job.majors ?? "").trim();
  const content = String(job.content ?? "").trim();
  const context = `${organization}${displayTitle}${majors}${content}`;
  const cityKeyword = inferCity(context);
  const provinceCity =
    String(job.provinceCity ?? "").trim() ||
    (cityKeyword ? cityKeyword : "待定");
  const dbCategory = String(job.category ?? "").trim();
  const displayCategory =
    dbCategory || categoryTagLabel(inferCategory(context));

  return {
    id: job.id,
    organization,
    title: displayTitle,
    publishDate: formatPublishDate(job),
    deadline: job.deadline || "",
    category: displayCategory,
    provinceCity,
    slots: job.slots > 0 ? job.slots : 0,
    majors,
    ageRequirement:
      String(job.ageRequirement ?? "").trim() || "详见招聘公告",
    education:
      String(job.education ?? "").trim() ||
      inferEducation(`${majors}${content}${displayTitle}`) ||
      "详见原文",
    summary: buildSummary(job, content || majors),
    content: content || buildSummary(job, majors),
    sourceUrl: job.sourceUrl || "",
  };
}

/** @deprecated 使用 mapJobToHomeCard */
export function mapJobToCard(job) {
  const card = mapJobToHomeCard(job);
  return {
    id: card.id,
    title: formatTitle(card.title),
    deadline: card.deadline,
    major: card.majors,
    majors: card.majors,
    slots: card.slots,
    sourceUrl: card.sourceUrl,
    category: card.category,
    city: card.provinceCity.split("·").pop() || card.provinceCity,
    tags: [card.provinceCity, card.category, card.majors].filter(Boolean),
    daysLeft: calcDaysLeft(card.deadline),
    createdAt: job.createdAt,
  };
}

export function parseSlots(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  const parsed = parseInt(digits, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
