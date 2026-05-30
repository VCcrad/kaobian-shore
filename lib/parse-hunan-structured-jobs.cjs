/**
 * 从湖南人社厅穿透行数组中解析结构化岗位（附件 xlsx 表格行）
 * 列映射由表头动态识别，兼容不同单位/地区的岗位表格式。
 */

const { readCachedLines } = require("./hunan-demo-lines-cache.cjs");
const {
  resolveDeadlineEndDate,
  isJobOnPublicFeed,
} = require("./deadline-utils.cjs");
const {
  parseStructuredJobsFromTabLines,
  parseTabRow,
  buildHeaderMapFromRows,
  rowToJobFromHeaders,
  parseJobsFromTabularRows,
  collectTabularRowsFromLines,
  normalizeEducationValue,
} = require("./table-job-parser.cjs");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function extractSignupDeadline(lines) {
  const blob = lines.join(" ");

  const rangeMatch = blob.match(
    /(?:网上)?报名时间[\s\S]{0,600}?[至到]\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:24时|\d{1,2}时)?/u,
  );
  if (rangeMatch) {
    return `${rangeMatch[1]}-${pad2(rangeMatch[2])}-${pad2(rangeMatch[3])}`;
  }

  const afterZhi = blob.match(/[至到]\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:24时|\d{1,2}时)?/u);
  if (afterZhi) {
    return `${afterZhi[1]}-${pad2(afterZhi[2])}-${pad2(afterZhi[3])}`;
  }

  const iso = blob.match(/(\d{4})-(\d{1,2})-(\d{1,2})/u);
  if (iso) {
    return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
  }

  return null;
}

function calcDaysLeft(deadlineStr, now = new Date()) {
  const end = resolveDeadlineEndDate(deadlineStr);
  if (!end) return null;
  const diff = Math.ceil((end - now) / 86400000);
  return diff;
}

function formatDaysLeft(days) {
  if (days == null) return "详见公告";
  if (days < 0) return "已截止";
  if (days === 0) return "今日截止";
  return `剩余 ${days} 天`;
}

function parseStructuredJobsFromLines(lines, meta = {}, now = new Date()) {
  if (!Array.isArray(lines) || lines.length === 0) return [];

  const deadline = extractSignupDeadline(lines);
  const daysLeft = calcDaysLeft(deadline, now);
  const regionMeta = {
    province: meta.province || "",
    city: meta.city || "",
    provinceCity: meta.provinceCity || "",
    deadline,
    daysLeft,
    daysLeftLabel: formatDaysLeft(daysLeft),
    now,
  };

  let jobs = parseStructuredJobsFromTabLines(lines, regionMeta);

  if (jobs.length === 0) {
    jobs = parseBufferedDigitRows(lines, regionMeta);
  }

  return jobs.filter((job) => {
    if (!regionMeta.deadline) return true;
    return isJobOnPublicFeed(job, now, 7);
  });
}

/** 兜底：合并被换行拆开的「序号\\t…」数据行后再按表头解析 */
function parseBufferedDigitRows(lines, meta) {
  const tabRows = collectTabularRowsFromLines(lines);
  if (tabRows.length === 0) return [];
  return parseJobsFromTabularRows(tabRows, meta);
}

function getStructuredHunanJobs() {
  const lines = readCachedLines();
  if (!lines) return [];
  return parseStructuredJobsFromLines(lines);
}

module.exports = {
  parseStructuredJobsFromLines,
  getStructuredHunanJobs,
  calcDaysLeft,
  formatDaysLeft,
  normalizeEducationValue,
};
