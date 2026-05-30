/**
 * 专业要求展示（全国事业单位招聘通用）
 */

export const MAJOR_FALLBACK_LABEL = "无要求";

const UNLIMITED_MAJOR_PATTERN =
  /(?:不限专业|专业不限|无专业要求|不作专业要求|专业不作要求|各类专业|所有专业|不限(?:报考)?专业|不限制专业|专业不限制|无专业限制)/u;

/** 研究生/本科目录 4 位代码、岗位代码 A01 等 */
const STANDALONE_CODE = /\b(?:0?\d{3,4}|[A-Z]\d{1,3})\b/gu;

const LIST_MARKER = /[（(]\s*\d{1,2}\s*[)）]/gu;

/**
 * @param {unknown} text
 * @returns {boolean}
 */
export function isUnlimitedMajor(text) {
  const s = String(text ?? "").trim();
  if (!s) return false;
  if (UNLIMITED_MAJOR_PATTERN.test(s)) return true;
  if (/^专业\s*[:：]?\s*(?:不限|无)/u.test(s)) return true;
  if (/^(?:不限|无)$/u.test(s)) return true;
  return false;
}

/**
 * @param {unknown} name
 * @returns {boolean}
 */
export function isValidMajorName(name) {
  const s = String(name ?? "").trim();
  if (!s || s.length < 2 || s.length > 24) return false;
  if (/^[A-Z]\d{1,3}$/u.test(s)) return false;
  if (/^\d+$/u.test(s)) return false;
  if (!/[\u4e00-\u9fa5]/u.test(s)) return false;
  if (/^(?:详见|附件|同上|无|不限)$/u.test(s)) return false;
  return true;
}

/**
 * 去掉目录序号与数字代号，保留中文专业名片段
 * @param {unknown} text
 * @returns {string}
 */
export function stripMajorCatalogNoise(text) {
  let s = String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!s) return "";

  s = s.replace(LIST_MARKER, " ");
  s = s.replace(/[（(【\[]\s*0?\d{3,6}\s*[)）\]】]/gu, " ");
  s = s.replace(STANDALONE_CODE, " ");
  s = s.replace(/^[A-Z]\d{3,6}(?=[\u4e00-\u9fa5])/u, "");
  s = s.replace(/^\d{4,6}(?=[\u4e00-\u9fa5])/u, "");
  s = s.replace(/\s+/gu, " ").trim();
  return s;
}

/**
 * 从单元格原文提取专业名称列表（支持 (1) 教育学 0402 (2) 心理学 格式）
 * @param {unknown} rawText
 * @returns {string[]}
 */
export function extractMajorNamesFromCell(rawText) {
  const raw = String(rawText ?? "").trim();
  if (!raw || isUnlimitedMajor(raw)) return [];

  const segments = raw.split(/(?=[（(]\s*\d{1,2}\s*[)）])/u).filter(Boolean);
  const chunks = segments.length > 1 ? segments : raw.split(/[、,，;；/|]+/u);

  const names = [];

  for (const chunk of chunks) {
    const cleaned = stripMajorCatalogNoise(chunk);
    if (!cleaned) continue;

    const chineseParts = cleaned.match(/[\u4e00-\u9fa5]{2,20}/gu) || [];
    for (const part of chineseParts) {
      if (isValidMajorName(part)) names.push(part);
    }
  }

  return [...new Set(names)];
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function splitMajorTokens(value) {
  return extractMajorNamesFromCell(value);
}

/**
 * 规范为卡片展示用专业字段
 * @param {unknown} input 字符串或 string[]
 * @returns {string}
 */
export function formatMajorRequirement(input) {
  const raw = Array.isArray(input)
    ? input.join(" ")
    : String(input ?? "").trim();

  if (!raw || raw === "—" || raw === "详见官网原文") return MAJOR_FALLBACK_LABEL;
  if (isUnlimitedMajor(raw)) return "不限专业";

  const names = extractMajorNamesFromCell(raw);
  if (names.length > 0) return names.join("、");

  const fallback = stripMajorCatalogNoise(raw);
  if (isValidMajorName(fallback)) return fallback;

  return MAJOR_FALLBACK_LABEL;
}

/** 非专业列常见误匹配（备注/其他要求、职称年龄说明） */
const NON_MAJOR_CELL_SIGNAL =
  /(?:试用期满|获得职称|专技岗位|年龄可放宽|周岁|职称者|资格证书|面试|实操|直接考核|咨询电话|举报电话|方案发布)/u;

/**
 * 判断单元格是否像「专业要求」列内容
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLikelyMajorCell(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  if (isUnlimitedMajor(raw)) return true;
  if (NON_MAJOR_CELL_SIGNAL.test(raw)) return false;
  if (/[（(]\s*\d{1,2}\s*[)）]/u.test(raw)) {
    return raw.length <= 4000;
  }
  if (raw.length > 200) return false;
  if (/^\d+[、.．]\s*/u.test(raw) && /；\s*\d+[、.]/u.test(raw)) return false;
  const names = extractMajorNamesFromCell(raw);
  if (names.length > 0) return true;
  if (raw.length <= 24 && isValidMajorName(stripMajorCatalogNoise(raw))) return true;
  return false;
}

/** @deprecated 兼容旧调用 */
export function stripMajorCode(text) {
  return stripMajorCatalogNoise(text);
}
