/**
 * 考编 / 申博 / 高校院所 — 赛道准入（BlueList）与 Dify 三类分类
 * CommonJS 单源：供 scripts/*.js 与 Next.js（经 track-filters.js 桥接）共用
 */

const BLUE_LIST_KEYWORDS = [
  "编制",
  "事业编",
  "高校",
  "大学",
  "学院",
  "研究所",
  "博士",
  "申博",
  "博士后",
  "人才引进",
  "辅导员",
  "科研助理",
];

/** 三大赛道常量（键名供代码引用，值为入库 / 展示文案） */
const TRACK_CATEGORIES = {
  HIGH_SCHOOL: "高校院所招聘",
  PHD: "博士/申博/博后",
  LOCAL_GOV: "地方编制求职",
};

/** 下拉框与校验用的有序列表 */
const TRACK_CATEGORY_LIST = Object.values(TRACK_CATEGORIES);

const DIFY_CLASSIFICATION_GUIDE = `你是高校与编制类招聘公告的结构化提取助手。请阅读用户提供的招聘公告全文（raw_text），输出合法 JSON。

【必填字段】除 title、deadline、majors、slots 等常规字段外，必须包含 category 字段。

【category 分类规则 — 必须且只能是以下三者之一，禁止任何其他字符串】
1. "${TRACK_CATEGORIES.PHD}" — 博士招生简章、申请考核制博士、硕博连读、博士后招收、博后岗位等
2. "${TRACK_CATEGORIES.HIGH_SCHOOL}" — 高校/科研院所的人事招聘：辅导员、行政、教师、科研助理、实验室助理等
3. "${TRACK_CATEGORIES.LOCAL_GOV}" — 各级事业单位公开招聘、人才引进、事业编、地方编制、选调等

【判断优先级】博士/博后类招生招聘 > 高校院所人事岗位 > 地方事业编/人才引进。
【输出要求】category 的值必须与上述三个字符串完全一致（含标点），并与其他字段一并写入 JSON。
【输出示例】{"title":"…","deadline":"2026-06-01","majors":"…","slots":2,"category":"${TRACK_CATEGORIES.HIGH_SCHOOL}"}`;

/**
 * 标题或「标题+正文」是否命中赛道准入词
 * @param {string} title
 * @param {string} [content]
 */
function passesBlueListGate(title, content = "") {
  const text = `${String(title ?? "")}\n${String(content ?? "")}`;
  return BLUE_LIST_KEYWORDS.some((word) => text.includes(word));
}

/** 仅校验标题（列表阶段） */
function titlePassesBlueList(title) {
  const t = String(title ?? "");
  return BLUE_LIST_KEYWORDS.some((word) => t.includes(word));
}

function logBlueListRejected(title) {
  console.log(`[赛道拦截] 非考编高校方向，自动过滤: ${title}`);
}

/**
 * 将大模型或人工输入的 category 归一化为三大赛道之一
 * @param {string} value
 * @returns {string} 合法 category，无法识别时返回空字符串
 */
function normalizeTrackCategory(value) {
  const str = String(value ?? "").trim();
  if (TRACK_CATEGORY_LIST.includes(str)) return str;

  if (/博士|申博|博后|招生简章|考核制|博士后/.test(str)) {
    return TRACK_CATEGORIES.PHD;
  }
  if (/事业编|事业单位|人才引进|编制|选调/.test(str)) {
    return TRACK_CATEGORIES.LOCAL_GOV;
  }
  if (/高校|大学|学院|辅导员|科研助理|研究所|院所/.test(str)) {
    return TRACK_CATEGORIES.HIGH_SCHOOL;
  }

  return "";
}

module.exports = {
  BLUE_LIST_KEYWORDS,
  TRACK_CATEGORIES,
  TRACK_CATEGORY_LIST,
  DIFY_CLASSIFICATION_GUIDE,
  passesBlueListGate,
  titlePassesBlueList,
  logBlueListRejected,
  normalizeTrackCategory,
};
