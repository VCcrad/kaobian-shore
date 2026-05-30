/**
 * 学历字段提取与校验（全国事业单位招聘公告通用）
 * 对外展示统一为五种标准表述。
 */

export const CANONICAL_EDUCATION_LABELS = [
  "博士研究生及以上",
  "硕士研究生及以上",
  "本科及以上",
  "大专及以上",
  "无要求",
];

const PLACEHOLDER_FIELD =
  /^(?:暂未公布|暂未确定|待定|另行通知|详见(?:公告)?|以公告为准|—|-+|无|暂无|\/|NULL|N\/A)$/iu;

const NO_REQUIREMENT_PATTERN =
  /(?:无要求|不限学历|学历不限|不作学历要求|无学历要求|学历不作要求|不限)/u;

/** 可识别的学历层级短语（按长度降序，避免「研究生」截断「硕士研究生」） */
const EDUCATION_LEVEL_PATTERN =
  /(?:全日制)?(?:博士研究生|硕士研究生|大学(?:本科|专科)|研究生|博士|硕士|本科学[历位]|本科|大专|专科|高中|中专|技校|高职)(?:及以上|以上|及以下|以下|学位|学历)?/gu;

const NON_EDUCATION_SIGNAL =
  /(?:招聘|岗位|计划|一览表|附件|序号|单位名称|用人单位|咨询电话|报名|中学|小学|学院|大学校|专业要求|年龄要求|政治面貌|资格条件|代码|人数)/u;

/** 表格单元格若含下列特征，则不是学历列（常见误取学校简介段落） */
const PROSE_EDUCATION_BLOCK =
  /(?:坐落于|占地面积|年历史|追溯到|设有.*(?:学院|专业)|本科专业|湖岸线|美誉|人事管|学位证书原件|学信网|毕业生就业推荐)/u;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlaceholderEducation(value) {
  const str = String(value ?? "").trim();
  if (!str) return true;
  return PLACEHOLDER_FIELD.test(str);
}

/**
 * @param {unknown} text
 * @returns {string}
 */
export function extractEducationPhrase(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";

  const matches = [...raw.matchAll(EDUCATION_LEVEL_PATTERN)]
    .map((m) => m[0].trim())
    .filter((part) => part.length >= 2 && !NON_EDUCATION_SIGNAL.test(part));

  if (matches.length === 0) return "";

  matches.sort((a, b) => b.length - a.length);
  return matches[0];
}

/**
 * 将任意学历表述规范为五种标准标签之一
 * @param {unknown} text
 * @returns {string}
 */
export function canonicalizeEducationValue(text) {
  const raw = String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!raw || isPlaceholderEducation(raw)) return "";

  if (NO_REQUIREMENT_PATTERN.test(raw)) return "无要求";

  const phrase = extractEducationPhrase(raw) || raw;

  if (/博士/u.test(phrase)) return "博士研究生及以上";
  if (/硕士|研究生/u.test(phrase)) return "硕士研究生及以上";
  if (/本科|学士/u.test(phrase) && !/专科/u.test(phrase)) return "本科及以上";
  if (/大专|专科|高职/u.test(phrase)) return "大专及以上";

  return "";
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidEducationValue(value) {
  const canonical = canonicalizeEducationValue(value);
  return Boolean(canonical);
}

/**
 * 判断表格单元格是否像学历要求（排除学校简介等长段落）
 * @param {unknown} text
 * @returns {boolean}
 */
export function isLikelyEducationCell(text) {
  const raw = String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!raw || raw.length > 48) return false;
  if (PROSE_EDUCATION_BLOCK.test(raw)) return false;
  if (NON_EDUCATION_SIGNAL.test(raw) && raw.length > 16) return false;
  return Boolean(normalizeEducationValue(raw));
}

/**
 * 规范化学历字段（表格单元格、公告正文、API 展示共用）
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeEducationValue(text) {
  const raw = String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!raw || isPlaceholderEducation(raw)) return "";

  if (NO_REQUIREMENT_PATTERN.test(raw)) return "无要求";

  const labeledPatterns = [
    /学历(?:学位)?(?:要求)?[:：]\s*([^\n\r，,；;]{2,48})/u,
    /学位(?:类别|要求)?[:：]\s*([^\n\r，,；;]{2,48})/u,
  ];

  for (const pattern of labeledPatterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      const canonical = canonicalizeEducationValue(match[1]);
      if (canonical) return canonical;
    }
  }

  if (raw.length <= 32) {
    const canonical = canonicalizeEducationValue(raw);
    if (canonical) return canonical;
  }

  const phrase = extractEducationPhrase(raw);
  if (phrase) {
    const canonical = canonicalizeEducationValue(phrase);
    if (canonical) return canonical;
  }

  return canonicalizeEducationValue(raw);
}

/**
 * 从长文中提取学历（主公告散文，非表格单元格）
 * @param {unknown} text
 * @returns {string|undefined}
 */
export function extractEducationFromProse(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return undefined;

  const normalized = normalizeEducationValue(raw);
  if (normalized) return normalized;

  const sectionMatch = raw.match(
    /(?:学历|学位)(?:条件|要求)?[:：]([\s\S]{4,120}?)(?:\n{2,}|(?=\d+[、.．])|(?=四、|五、|六、|七、|八、|九、|十、))/u,
  );
  if (sectionMatch?.[1]) {
    const fromSection = normalizeEducationValue(sectionMatch[1]);
    if (fromSection) return fromSection;
  }

  return undefined;
}
