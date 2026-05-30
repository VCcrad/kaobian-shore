/**
 * 高校校内招聘正文解析（湖南大学等：正文为主，附件多为报名表）
 */

import { normalizeEducationValue } from "./education-utils.js";
import { stripWebScrapJunk, isBadJobCardTitle } from "./job-posting-text.js";

export const REGISTRATION_FORM_PATTERN =
  /(?:报名|申请|登记|推荐|应聘)(?:表|材料|表\s*\d*)|(?:管理辅助)?岗位招聘报名表|zpbmb|glfzgw/u;

/** 附件是否为报名表（非岗位计划表） */
export function isRegistrationFormAttachment(fileName = "", title = "") {
  return REGISTRATION_FORM_PATTERN.test(`${fileName} ${title}`);
}

/** 是否为校内/编制内招聘正文 */
export function isUniversityInternalRecruitment(text) {
  return /面向(?:全校|校内)|编制内|管理辅助岗位|任职基本(?:条件|资格)|应聘条件/u.test(
    String(text ?? ""),
  );
}

function parseCount(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 && n <= 999 ? n : null;
}

function cleanClause(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[（(][一二三四五六七八九十]+[）)]\s*/u, "")
    .trim();
}

/** 「一、招聘岗位及人数/职责」段落 */
export function extractPostSectionText(text) {
  const blob = String(text ?? "").replace(/\s+/g, " ");
  const match = blob.match(
    /(?:一、)?(?:招聘岗位及人数|招聘岗位及岗位职责|招聘岗位(?:及人数)?)\s*([\s\S]{0,3500}?)(?=(?:二、|三、|四、|五、|六、|报名(?:方式|时间|截止|须知)|联系(?:方式|电话)|附件|附：|$))/u,
  );
  return match?.[1]?.trim() ?? "";
}

/** 「任职基本条件 / 应聘条件」段落 */
export function extractQualificationSection(text) {
  const blob = String(text ?? "").replace(/\s+/g, " ");
  const match = blob.match(
    /(?:二、|三、)?(?:任职基本条件|应聘条件|任职资格|报名条件)(?:及?(?:任职资格|条件))?[\s\S]{0,3500}?(?=(?:[三四五六七八九十]、|报名(?:方式|时间|截止|须知)|联系(?:方式|电话)|附件|附：|$))/u,
  );
  return match?.[0]?.trim() ?? "";
}

/** 「三、岗位职责」段落（部分公告岗位表在此） */
export function extractDutySectionText(text) {
  const blob = String(text ?? "").replace(/\s+/g, " ");
  const match = blob.match(
    /(?:三、)?岗位职责[\s\S]{0,3500}?(?=(?:[四五]、|报名(?:方式|时间|截止|须知)|联系(?:方式|电话)|附件|附：|$))/u,
  );
  return match?.[0]?.trim() ?? "";
}

/** 从「招聘岗位及人数」汇总总人数 */
export function sumUniversityPostHeadcount(text) {
  const section = extractPostSectionText(text);
  const tableBlob = collectPostTableBlob(text);
  const blob = tableBlob || section || String(text ?? "");

  if (/岗位名称\s+职数/u.test(blob)) {
    let sum = 0;
    let any = false;
    const body =
      blob.split(/岗位名称\s+职数\s*(?:岗位职责|岗位概述\s*)?/u)[1] ?? blob;
    for (const m of body.matchAll(
      /([\u4e00-\u9fa5（）()A-Za-z·、\d]{2,28}(?:员|师|秘书|专员|管理|工程|科员|助理))\s+(\d+)/gu,
    )) {
      const n = parseCount(m[2]);
      if (n) {
        sum += n;
        any = true;
      }
    }
    if (any) return sum;
  }

  if (section) {
    let sum = 0;
    for (const m of section.matchAll(/(\d+)\s*名/gu)) {
      const n = parseCount(m[1]);
      if (n) sum += n;
    }
    if (sum > 0) return sum;
  }

  const lead =
    String(text ?? "").match(
      /(?:公开)?招聘(?:管理|专技|技术)?(?:人员|工作人员|(?:管理)?(?:人员|专员|教师|科员))?(\d+)\s*名/u,
    ) ??
    String(text ?? "").match(
      /面向(?:全校|校内).*?招聘[\u4e00-\u9fa5]{0,12}(?:人员|专员|教师|科员|管理)?(\d+)\s*名/u,
    );
  if (lead?.[1]) return parseCount(lead[1]);

  return undefined;
}

function collectPostTableBlob(text) {
  const parts = [extractPostSectionText(text), extractDutySectionText(text)].filter(
    Boolean,
  );
  return parts.join(" ");
}

/** 从任职条件段提取学历 */
export function extractUniversityEducation(text) {
  const qual = extractQualificationSection(text) || String(text ?? "");

  const labeled = qual.match(
    /(?:具有|需(?:要|具备)?|应(?:具备|具有)?)([^（；。\n]{2,32}(?:及以上)?(?:文化)?程度)/u,
  );
  if (labeled?.[1]) {
    const edu = normalizeEducationValue(labeled[1]);
    if (edu) return edu;
  }

  const parenthetical = qual.match(
    /[（(]([^）)]{2,28}(?:研究生|硕士|本科|博士)[^）)]{0,16})[）)]/u,
  );
  if (parenthetical?.[1]) {
    const edu = normalizeEducationValue(parenthetical[1]);
    if (edu) return edu;
  }

  const fromQual = normalizeEducationValue(qual);
  return fromQual || undefined;
}

/** 用人范围：编制内、校内教职工等 */
export function extractUniversityEmploymentScope(text) {
  const qual = extractQualificationSection(text) || String(text ?? "");
  const full = String(text ?? "");
  const items = [];

  if (/学校编制内(?:在)?(?:岗)?(?:职工|教职工)/u.test(qual)) {
    items.push("学校编制内在岗教职工");
  }
  if (/面向(?:全校|校内)(?:教职工|职工)/u.test(full)) {
    items.push("面向校内教职工");
  }
  if (/符合学校跨部门流动条件/u.test(qual)) {
    items.push("须符合学校跨部门流动条件");
  }
  if (/本校(?:在编|编制内)/u.test(qual)) {
    items.push("本校编制内人员");
  }

  return [...new Set(items)];
}

/** 任职条件全文（供 notes / 其他要求展示） */
export function extractUniversityQualificationNotes(text) {
  const qual = extractQualificationSection(text);
  if (!qual) return undefined;

  const bullets = [...qual.matchAll(/[（(]([一二三四五六七八九十]+)[）)]([^（(]{4,240})/gu)]
    .map((m) => cleanClause(m[2]))
    .filter(Boolean);

  if (bullets.length > 0) return bullets.join("\n");
  return qual.slice(0, 600);
}

/** 从正文拆出结构化岗位（校内招聘一公告多岗） */
export function parseUniversityJobsFromProse(text, meta = {}) {
  if (!isUniversityInternalRecruitment(text)) return [];

  const section = extractPostSectionText(text);
  const tableBlob = collectPostTableBlob(text);
  const blob = tableBlob || section || String(text ?? "");
  const jobs = [];
  const seen = new Set();

  const pushJob = (title, slots, organization = "") => {
    const t = stripWebScrapJunk(String(title ?? "").trim());
    const n = parseCount(slots) ?? 1;
    if (!t || isBadJobCardTitle(t) || /岗位名称|职数|岗位职责|序号|岗位概述/u.test(t)) {
      return;
    }
    const key = `${t}|${n}`;
    if (seen.has(key)) return;
    seen.add(key);

    const scope = extractUniversityEmploymentScope(text);
    jobs.push({
      title: t,
      slots: n,
      numPositions: n,
      organization: organization || meta.organization || "",
      education: extractUniversityEducation(text) || "",
      otherRequirement: scope.join("；"),
      text: String(text ?? "").slice(0, 800),
      province: meta.province ?? "",
      city: meta.city ?? "",
    });
  };

  const deptMatch = String(text ?? "").match(
    /^因工作需要，([\u4e00-\u9fa5]{2,24}(?:学院|中心|书院|馆|处|部))/u,
  );
  const dept = deptMatch?.[1] ?? "";

  if (/岗位名称\s+职数/u.test(blob)) {
    const body =
      blob.split(/岗位名称\s+职数\s*(?:岗位职责|岗位概述\s*)?/u)[1] ?? blob;
    for (const m of body.matchAll(
      /([\u4e00-\u9fa5（）()A-Za-z·、]+(?:员|师|秘书|专员|管理|工程|科员|助理))\s+(\d+)\s*(?:名|\s+[\d.]|$)/gu,
    )) {
      pushJob(m[1], m[2], dept);
    }
    if (jobs.length > 0) return jobs;
  }

  for (const m of blob.matchAll(
    /([\u4e00-\u9fa5（）()·、A-Za-z\d]{2,32}?)(\d+)\s*名/gu,
  )) {
    if (/^[一二三四五六七八九十]+$/.test(m[1])) continue;
    pushJob(m[1], m[2], dept);
  }

  if (jobs.length === 0) {
    const open = String(text ?? "").match(
      /(?:公开)?招聘([\u4e00-\u9fa5]{2,24}(?:人员|教师|专员|秘书|科员|工程师|管理))(\d+)\s*名/u,
    );
    if (open) pushJob(open[1], open[2], dept);
  }

  return jobs;
}

/** 并入 parseMainText 的高校字段增强 */
export function enrichUniversityMainTextRequirements(text) {
  if (!isUniversityInternalRecruitment(text)) return {};

  const result = {};
  const headcount = sumUniversityPostHeadcount(text);
  if (headcount != null) result.numPositions = headcount;

  const education = extractUniversityEducation(text);
  if (education) result.education = education;

  const scope = extractUniversityEmploymentScope(text);
  const qualNotes = extractUniversityQualificationNotes(text);
  const notesParts = [];
  if (scope.length) notesParts.push(`用人范围：${scope.join("；")}`);
  if (qualNotes) notesParts.push(qualNotes);
  if (notesParts.length) result.notes = notesParts.join("\n");

  if (scope.length) {
    result.other = {
      employmentScope: scope,
      internalRecruitment: true,
    };
  }

  return result;
}
