/**
 * 从湖南人社厅穿透行数组中解析结构化岗位（附件 xlsx 表格行）
 */

const { readCachedLines } = require("./hunan-demo-lines-cache.cjs");
const {
  resolveDeadlineEndDate,
  isJobOnPublicFeed,
} = require("./deadline-utils.cjs");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function extractSignupDeadline(lines) {
  const blob = lines.slice(0, 10).join(" ");
  const m =
    blob.match(/至(\d{4})年(\d{1,2})月(\d{1,2})日24时/) ||
    blob.match(/至(\d{4})年(\d{1,2})月(\d{1,2})日/) ||
    blob.match(/(\d{4})年(\d{1,2})月(\d{1,2})日24时/);

  if (!m) return "2026-05-10";

  const y = m[1];
  const mo = m[2];
  const d = m[3];
  return `${y}-${pad2(mo)}-${pad2(d)}`;
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

function cleanCell(value) {
  return String(value ?? "")
    .replace(/^"|"$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTabRow(line) {
  return line.split("\t").map(cleanCell);
}

function buildMatcherText(fields) {
  return [
    fields.title,
    fields.majorRequirement,
    fields.ageRequirement,
    fields.education,
    fields.otherRequirement,
  ]
    .filter(Boolean)
    .join(" ");
}

function rowToJob(cols, meta) {
  const seq = cols[0];
  if (!/^\d+$/.test(seq)) return null;

  const unit = cols[2] || cols[1] || "南华大学";
  const dept = cols[3] || "";
  const postName = cols[4] || "岗位";
  const postCode = cols[5] || "";
  const slots = Number.parseInt(cols[9], 10) || 0;
  const education = cols[10] || "";
  const majorRequirement = cols[11] || "";
  const ageRequirement = cols[12] || "";
  const otherRequirement = cols[13] || "";

  const title = postCode ? `${postName} · ${postCode}` : postName;
  const organization = dept ? `${unit} · ${dept}` : unit;

  const fields = {
    title,
    majorRequirement,
    ageRequirement,
    education,
    otherRequirement,
  };

  return {
    id: postCode || `hunan-${seq}`,
    publishDate: "2026-04-27",
    organization,
    title,
    provinceCity: meta.provinceCity,
    slots,
    slotsLabel: slots > 0 ? `${slots} 人` : "详见附件",
    education: education || "—",
    majorRequirement: majorRequirement || "—",
    ageRequirement: ageRequirement || "—",
    deadline: meta.deadline,
    daysLeft: meta.daysLeft,
    daysLeftLabel: formatDaysLeft(meta.daysLeft),
    text: buildMatcherText(fields),
  };
}

/**
 * @param {string[]} lines
 * @returns {object[]}
 */
function parseStructuredJobsFromLines(lines, now = new Date()) {
  if (!Array.isArray(lines) || lines.length === 0) return [];

  const deadline = extractSignupDeadline(lines);
  const daysLeft = calcDaysLeft(deadline, now);
  const meta = {
    provinceCity: "湖南 · 衡阳",
    deadline,
    daysLeft,
    now,
  };

  const jobs = [];
  let buffer = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] ?? "").trim();
    if (!line) continue;
    if (line.startsWith("---")) continue;
    if (line.includes("附件") && line.includes("透视")) continue;

    if (/^\d+\t/.test(line)) {
      if (buffer) {
        const job = rowToJob(parseTabRow(buffer), meta);
        if (job) jobs.push(job);
      }
      buffer = line;
      continue;
    }

    if (buffer && !line.startsWith('"注：')) {
      buffer += ` ${line}`;
    }
  }

  if (buffer) {
    const job = rowToJob(parseTabRow(buffer), meta);
    if (job) jobs.push(job);
  }

  return jobs.filter((job) => isJobOnPublicFeed(job, now, 7));
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
};
