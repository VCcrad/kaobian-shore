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

export function calcDaysLeft(deadline) {
  if (!deadline) return 0;
  const end = new Date(`${deadline}T23:59:59`);
  if (Number.isNaN(end.getTime())) return 0;
  const diff = Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
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

/** 将数据库 Job 记录转为首页卡片展示结构 */
export function mapJobToCard(job) {
  const title = formatTitle(job.title);
  const major = job.majors || "";
  const context = `${title}${major}`;
  const city = inferCity(context);
  const category = inferCategory(context);
  const headcountTag = job.slots > 0 ? `招${job.slots}人` : "";

  const tags = [city, categoryTagLabel(category), headcountTag, major]
    .filter(Boolean)
    .filter((tag, i, arr) => arr.indexOf(tag) === i);

  return {
    id: job.id,
    title,
    deadline: job.deadline,
    major,
    majors: job.majors,
    slots: job.slots,
    sourceUrl: job.sourceUrl || "",
    category,
    city,
    tags,
    daysLeft: calcDaysLeft(job.deadline),
    createdAt: job.createdAt,
  };
}

export function parseSlots(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  const parsed = parseInt(digits, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
