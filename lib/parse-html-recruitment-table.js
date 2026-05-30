/**
 * 招聘公告详情页 HTML 表格解析（全国高校/事业单位通用）
 * 典型表头：岗位名称 | 招聘人数 | 岗位职责 | 任职条件
 */

import * as cheerio from "cheerio";
import { normalizeEducationValue } from "./education-utils.js";

const COLUMN_ALIASES = {
  title: /^(?:岗位名称|职位名称|岗位|职位|招聘岗位|岗位类型|岗位类别)$/u,
  slots: /^(?:招聘人数|计划数|名额|人数|招聘数量|拟招人数)$/u,
  duty: /^(?:岗位职责|工作职责|主要职责|职责)$/u,
  requirements: /^(?:任职条件|招聘条件|岗位要求|资格条件|基本要求|应聘条件)$/u,
  major: /^(?:专业要求|专业|学科专业|需求专业)$/u,
  age: /^(?:年龄要求|年龄|年龄条件)$/u,
  education: /^(?:学历要求|学历|学历学位|学位要求)$/u,
};

const LABELED_FIELD_MARKERS = [
  { field: "ageLimit", labels: ["年龄要求", "年龄"] },
  { field: "education", labels: ["学历学位", "学历要求", "学历"] },
  { field: "majorRequirement", labels: ["专业要求", "专业"] },
  { field: "experience", labels: ["工作经历要求", "工作经历"] },
  { field: "otherRequirement", labels: ["其它要求", "其他要求"] },
  { field: "politicalStatus", labels: ["政治面貌"] },
];

const DEFAULT_CONTENT_SELECTORS =
  "#vsb_content, .v_news_content, .TRS_Editor, .wp_articlecontent, .view-content, article, .content";

function normalizeCell(value) {
  return String(value ?? "")
    .replace(/\u200b/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectColumnMap(headerCells) {
  const map = {};
  headerCells.forEach((cell, index) => {
    const text = normalizeCell(cell);
    for (const [key, pattern] of Object.entries(COLUMN_ALIASES)) {
      if (pattern.test(text)) map[key] = index;
    }
  });
  return map;
}

function isRecruitmentTableHeader(colMap) {
  if (colMap.title != null) return true;
  return colMap.requirements != null && (colMap.slots != null || colMap.duty != null);
}

/** 解析「年龄：…学历：…专业要求：…」连写任职条件 */
export function parseLabeledRequirementBlock(text) {
  const raw = normalizeCell(text);
  if (!raw) return {};

  const result = {};
  const markers = [];

  for (const { field, labels } of LABELED_FIELD_MARKERS) {
    for (const label of labels) {
      let idx = raw.indexOf(`${label}：`);
      let len = label.length + 1;
      if (idx < 0) {
        idx = raw.indexOf(`${label}:`);
        len = label.length + 1;
      }
      if (idx >= 0) markers.push({ field, idx, len });
    }
  }

  markers.sort((a, b) => a.idx - b.idx);

  for (let i = 0; i < markers.length; i += 1) {
    const { field, idx, len } = markers[i];
    const start = idx + len;
    const end = i + 1 < markers.length ? markers[i + 1].idx : raw.length;
    const value = raw.slice(start, end).trim().replace(/[。；;]+$/u, "");
    if (value) result[field] = value;
  }

  if (result.education) {
    const edu = normalizeEducationValue(result.education);
    if (edu) result.education = edu;
  }

  if (result.experience) {
    const exp = `工作经历：${result.experience}`;
    result.otherRequirement = result.otherRequirement
      ? `${exp}；${result.otherRequirement}`
      : exp;
    delete result.experience;
  }

  return result;
}

function parseSlots(value) {
  const text = String(value ?? "");
  const match = text.match(/(\d+)/);
  if (match) return Number.parseInt(match[1], 10);
  return undefined;
}

function isDataRowTitle(title) {
  const t = normalizeCell(title);
  if (!t || t.length < 2) return false;
  if (/^(?:岗位名称|序号|合计|总计|小计|备注)$/u.test(t)) return false;
  return true;
}

/**
 * @param {string} html
 * @param {{ contentSelector?: string, organization?: string }} [options]
 */
export function parseRecruitmentTablesFromHtml(html, options = {}) {
  if (!html?.trim()) return [];

  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const selector = options.contentSelector || DEFAULT_CONTENT_SELECTORS;
  const root = $(selector).first();
  const scope = root.length ? root : $("body");
  const jobs = [];

  scope.find("table").each((_, table) => {
    const rows = [];
    $(table)
      .find("tr")
      .each((__, tr) => {
        const cells = $(tr)
          .find("th,td")
          .map((___, cell) => normalizeCell($(cell).text()))
          .get();
        if (cells.some((cell) => cell.length > 0)) rows.push(cells);
      });

    if (rows.length < 2) return;

    let headerIdx = -1;
    let colMap = {};
    for (let i = 0; i < Math.min(rows.length, 4); i += 1) {
      const candidate = detectColumnMap(rows[i]);
      if (isRecruitmentTableHeader(candidate)) {
        headerIdx = i;
        colMap = candidate;
        break;
      }
    }
    if (headerIdx < 0) return;

    for (let ri = headerIdx + 1; ri < rows.length; ri += 1) {
      const cells = rows[ri];
      if (cells.every((cell) => !cell || /^[-—－]+$/.test(cell))) continue;

      const get = (key) =>
        colMap[key] != null ? normalizeCell(cells[colMap[key]] ?? "") : "";

      const title = get("title");
      if (!isDataRowTitle(title)) continue;

      const reqCell = get("requirements");
      const parsed = parseLabeledRequirementBlock(reqCell);

      if (colMap.major != null && get("major")) {
        parsed.majorRequirement = get("major");
      }
      if (colMap.age != null && get("age")) {
        parsed.ageLimit = parsed.ageLimit || get("age");
      }
      if (colMap.education != null && get("education")) {
        const edu = normalizeEducationValue(get("education"));
        if (edu) parsed.education = edu;
      }

      const slots = parseSlots(get("slots"));
      const duty = get("duty");

      jobs.push({
        title,
        slots,
        numPositions: slots,
        duty,
        ageRequirement: parsed.ageLimit || "",
        education: parsed.education || "",
        majorRequirement: parsed.majorRequirement || "",
        otherRequirement: parsed.otherRequirement || "",
        politicalStatus: parsed.politicalStatus || "",
        organization: options.organization || "",
        text: [title, duty, reqCell].filter(Boolean).join("\n"),
      });
    }
  });

  return jobs;
}

/** 将 HTML 表格序列化为可读文本（供正文兜底解析） */
export function serializeRecruitmentTablesFromHtml(html, options = {}) {
  const jobs = parseRecruitmentTablesFromHtml(html, options);
  if (jobs.length === 0) return "";

  return jobs
    .map((job) => {
      const parts = [`岗位：${job.title}`];
      if (job.slots) parts.push(`人数：${job.slots}`);
      if (job.ageRequirement) parts.push(`年龄：${job.ageRequirement}`);
      if (job.education) parts.push(`学历：${job.education}`);
      if (job.majorRequirement) parts.push(`专业：${job.majorRequirement}`);
      if (job.otherRequirement) parts.push(`其它：${job.otherRequirement}`);
      return parts.join(" ");
    })
    .join("\n");
}
