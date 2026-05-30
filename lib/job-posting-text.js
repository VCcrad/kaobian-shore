/** 检测岗位文本是否乱码或含 Excel / 网页抓取垃圾（API / seed / 爬虫共用） */

import {
  isNavigationMenuText,
  hasNonRecruitmentTitleSignal,
} from "./recruitment-announcement-filters.js";

/** 政府站常见导航栏、CSS 片段、页脚链接串 */
export function containsWebScrapJunk(text) {
  const value = String(text ?? "");
  if (!value.trim()) return false;

  if (/^首页\s/u.test(value) || isNavigationMenuText(value)) return true;

  return (
    /\.[a-zA-Z][\w-]*\s*\{|dropselect|SimpleSelect|li\.hover/i.test(value) ||
    /\{\s*[^}]{0,120}\}/u.test(value) ||
    /[|｜]\s*中国(?:政府网|(?:人民共和国)?[\u4e00-\u9fa5]{2,24}部)/u.test(value) ||
    /(?:^|[·•.])\s*\.[a-zA-Z_-]/u.test(value)
  );
}

/** 截掉 CSS、页脚链接等网页垃圾，保留前面的有效中文标题/单位名 */
export function stripWebScrapJunk(text) {
  let s = String(text ?? "").trim();
  if (!s) return "";

  const cutAt = s.search(
    /[·•.]\s*\.[a-zA-Z_-]|\.[a-zA-Z_-][\w-]*\s*\{|\s*[{][^}]*[}]|\s*中国政府网\s*[|｜]/u,
  );
  if (cutAt > 0) {
    s = s.slice(0, cutAt).trim();
  }

  s = s.replace(/\s*[|｜]\s*中国(?:政府网|(?:人民共和国)?[\u4e00-\u9fa5]{2,24}部).*$/u, "");
  s = s.replace(/[·•.]+$/u, "").trim();
  return s;
}

export function isGarbledText(text) {
  const value = String(text ?? "").trim();
  if (!value) return true;

  if (/工作表:\s*Sheet/i.test(value)) return true;
  if (/^---+\s*$/u.test(value)) return true;
  if (/[ÃÂÐÞæœ]|ï¿½|â€/.test(value)) return true;
  if (/nèh\s*kâ|nánh|tuổi/i.test(value)) return true;
  if (containsWebScrapJunk(value)) return true;

  const cjk = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (value.length > 40 && cjk < 2) return true;

  return false;
}

/** 不适合作为前台卡片标题（正文首句、附件名、表单名等） */
export function isBadJobCardTitle(title) {
  const value = stripWebScrapJunk(String(title ?? "").trim());
  if (!value) return true;
  if (isGarbledText(value)) return true;
  if (isNavigationMenuText(value)) return true;
  if (hasNonRecruitmentTitleSignal(value)) return true;

  if (/报名表|申请表|(?:^|[\s，,])岗位表(?:$|[\s，,])|附件\s*\d|\.xlsx|\.pdf|\.docx|\.doc$/iu.test(value)) {
    return true;
  }
  // 「XX公开招聘…一览表」整段文件名在 pickJobCardTitle 里单独处理，此处不一律判坏
  if (/一览表$/u.test(value) && !/公开招聘/u.test(value)) return true;
  if (/^工作表:|^Sheet\d+|^---+\s*工作表/iu.test(value)) return true;
  if (isTableHeaderLine(value)) return true;

  if (/^--\s*\d+\s+of\s+\d+/i.test(value)) return true;
  if (/^及名额\s/u.test(value)) return true;

  if (/^(因工作需要|根据《|经研究|各校属|各学院|现将|现予?以公示|为做好)/u.test(value)) {
    return true;
  }
  if (/是经教育部批准|办学层次|博士学位授予|校园环境优美/u.test(value)) {
    return true;
  }

  if (value.length > 36 && /[，。；：]/.test(value)) return true;

  return false;
}

/** Excel/附件表头行（非标题） */
export function isTableHeaderLine(line) {
  const value = String(line ?? "")
    .replace(/\t+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value || !/序号/u.test(value)) return false;
  return /(?:主管部门|招聘单位|岗位名称|岗位代码|计划数|部门)/u.test(value);
}

/** 「…公开招聘…一览表」类附件名 → 公告标题 */
export function normalizeAttachmentListTitle(title) {
  const raw = stripWebScrapJunk(String(title ?? "").trim());
  if (!raw || !/一览表|计划数及要求/u.test(raw)) return "";

  const cleaned = raw
    .replace(/(?:岗位、计划数及要求|岗位计划及要求|岗位、计划数|计划数及要求)?一览表.*$/u, "")
    .replace(/表\s*\d*\.(?:xlsx|xls|pdf|docx)?$/iu, "")
    .trim();

  if (cleaned.length >= 8 && /招聘/u.test(cleaned) && !isBadJobCardTitle(cleaned)) {
    return cleaned.slice(0, 120);
  }
  return "";
}

/** 从校内招聘正文提取岗位名（如「研究生秘书兼学科建设秘书」） */
export function extractPostNameFromProse(text) {
  const blob = String(text ?? "").replace(/\s+/g, " ");

  const acceptPost = (post) => {
    const value = stripWebScrapJunk(String(post ?? "").trim());
    if (value.length < 2 || value.length > 40) return "";
    if (/岗位名称|职数|岗位职责|任职基本/u.test(value)) return "";
    if (isBadJobCardTitle(value)) return "";
    return value;
  };

  const section = blob.match(
    /(?:一、)?(?:招聘岗位及人数|招聘岗位及岗位职责|招聘岗位)[：:\s]*([^\n。；]{2,40}?)(?:\d+\s*名|[。\n])/u,
  );
  const fromSection = acceptPost(section?.[1]);
  if (fromSection) return fromSection;

  const tableRow = blob.match(
    /岗位职责\s+([\u4e00-\u9fa5]{2,24}(?:员|师|专员|科员|秘书|人员|工程师|助理|管理))\s*\d+\s*名/u,
  );
  const fromTable = acceptPost(tableRow?.[1]);
  if (fromTable) return fromTable;

  const deptHire = blob.match(
    /([\u4e00-\u9fa5]{2,24}(?:学院|中心|书院|馆|处|部))(?:决定)?面向(?:全校|校内).*?公开招聘([\u4e00-\u9fa5]{2,20}(?:人员|教师|专员|秘书|科员|工程师|管理))/u,
  );
  const fromDept = acceptPost(deptHire?.[2]);
  if (fromDept) return fromDept;

  return "";
}

/** 清洗招聘单位名称 */
export function sanitizeOrganizationName(name, fallback = "") {
  const stripped = stripWebScrapJunk(String(name ?? "").trim());
  if (!stripped || isGarbledText(stripped)) return fallback;
  return stripped.slice(0, 60);
}

export function buildJobPostingDisplayText(job, requirements = {}, other = {}) {
  const majorRequirements = Array.isArray(requirements.majorRequirements)
    ? requirements.majorRequirements
    : requirements.majorRequirements
      ? [String(requirements.majorRequirements)]
      : [];
  const majorText =
    majorRequirements.length > 0 ? majorRequirements.join("、") : "";

  const parts = [
    job.title,
    other.organization || job.source?.name,
    requirements.ageLimit ? `年龄要求：${requirements.ageLimit}` : "",
    requirements.politicalStatus ? `政治面貌：${requirements.politicalStatus}` : "",
    majorText ? `专业要求：${majorText}` : "",
    other.education ? `学历：${other.education}` : "",
    requirements.notes || "",
  ].filter(Boolean);

  const rebuilt = parts.join(" ").trim();
  const raw = String(job.rawText ?? "").trim();

  if (raw && !isGarbledText(raw)) return raw;
  return rebuilt || String(job.title ?? "").trim();
}

export function sanitizeJobPostingTitle(title, fallback = "未命名岗位") {
  const value = stripWebScrapJunk(String(title ?? "").trim());
  if (!value || isBadJobCardTitle(value)) return fallback;
  return value.slice(0, 120);
}

/** 从正文/摘要中提取较像公告标题的短行（兼容历史脏数据） */
export function extractJobTitleFromProse(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/u)
    .map((line) => stripWebScrapJunk(line.trim()))
    .filter(Boolean);

  for (const line of lines.slice(0, 40)) {
    if (isTableHeaderLine(line)) continue;
    if (
      /招聘|岗位|引进|招贤|公开招聘/u.test(line) &&
      line.length >= 6 &&
      line.length <= 60 &&
      !isBadJobCardTitle(line)
    ) {
      return line.slice(0, 120);
    }
  }

  return "";
}

function isGenericUniversityAnnouncementTitle(title) {
  const value = stripWebScrapJunk(String(title ?? "").trim());
  if (!value) return true;
  return /管理辅助岗位|校内(?:招聘|选聘)|公开招聘(?:管理|专技)?(?:人员|公告)/u.test(value);
}

/** 公告/正文是否明确为非事业编制（非事业编、非事业编制等） */
export function hasNonInstitutionalStaffingSignal(...sources) {
  const combined = sources
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join("\n");
  if (!combined) return false;
  return /非事业编(?:制)?/u.test(combined);
}

const NON_INSTITUTIONAL_TITLE_PREFIX = "非事业编制";

/** 前台卡片标题：明确为非事业编时在岗位名前加前缀 */
export function formatJobCardDisplayTitle(title, context = {}) {
  const clean = String(title ?? "").trim() || "未命名岗位";
  if (new RegExp(`^${NON_INSTITUTIONAL_TITLE_PREFIX}`, "u").test(clean)) {
    return clean;
  }

  const { announcementTitle, rawText, fallbackTitle } = context;
  if (
    !hasNonInstitutionalStaffingSignal(
      announcementTitle,
      fallbackTitle,
      typeof rawText === "string" ? rawText.slice(0, 2000) : "",
    )
  ) {
    return clean;
  }

  return `${NON_INSTITUTIONAL_TITLE_PREFIX} · ${clean}`;
}

/** 统一解析前台/入库卡片标题 */
export function pickJobCardTitle({
  title,
  announcementTitle,
  rawText,
  organization,
  sourceName,
}) {
  const fromAttachmentName = normalizeAttachmentListTitle(title);
  if (fromAttachmentName) return fromAttachmentName;

  const direct = sanitizeJobPostingTitle(title, "");
  if (direct) return direct;

  const fromPost = extractPostNameFromProse(rawText);
  if (fromPost) return fromPost;

  const fromAnnouncement = sanitizeJobPostingTitle(announcementTitle, "");
  if (fromAnnouncement && !isGenericUniversityAnnouncementTitle(fromAnnouncement)) {
    return fromAnnouncement;
  }

  const fromProse = extractJobTitleFromProse(rawText);
  if (fromProse) return fromProse;

  if (fromAnnouncement) return fromAnnouncement;

  // 避免「湖南大学 · 湖南大学」：无更好标题时用通用占位，不用单位名重复
  if (organization || sourceName) return "招聘岗位";

  return "招聘公告";
}

/** 解析 JobPosting 卡片展示标题（API / 后台共用） */
export function resolveJobCardTitle(job, other = {}, organization = "") {
  const base = pickJobCardTitle({
    title: job.title,
    announcementTitle: other.announcementTitle,
    rawText: job.rawText,
    organization,
    sourceName: job.source?.name,
  });
  return formatJobCardDisplayTitle(base, {
    announcementTitle: other.announcementTitle,
    fallbackTitle: job.title,
    rawText: job.rawText,
  });
}
