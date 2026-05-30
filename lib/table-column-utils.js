import { isLikelyMajorCell } from "./major-utils.js";

function cleanHeader(value) {
  return String(value ?? "").trim();
}

/**
 * 专业要求列：优先「专业要求/所学专业」，排除「专业代码/目录/类别」
 * @param {string[]} headers
 * @returns {number}
 */
export function columnIndexForMajor(headers) {
  const list = headers.map(cleanHeader);
  const patterns = [
    /^专业(?:要求|条件)$/u,
    /^所学专业$/u,
    /^专业$/u,
    /^专业名称$/u,
    /专业(?:要求|条件)/u,
    /所学专业/u,
  ];

  for (const pattern of patterns) {
    const idx = list.findIndex(
      (h) => pattern.test(h) && !/代码|目录|类别|编号|序号/u.test(h),
    );
    if (idx >= 0) return idx;
  }

  const loose = list.findIndex(
    (h) => /专业/u.test(h) && !/代码|目录|类别|编号|岗位/u.test(h),
  );
  return loose;
}

/**
 * 岗位代码列
 * @param {string[]} headers
 * @returns {number}
 */
export function columnIndexForPostCode(headers) {
  const list = headers.map(cleanHeader);
  const patterns = [
    /(?:岗位|职位|报名)代码/u,
    /^代码$/u,
    /岗位编号/u,
  ];
  for (const pattern of patterns) {
    const idx = list.findIndex((h) => pattern.test(h));
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * @param {string[]} headers
 * @param {RegExp} pattern
 * @returns {number}
 */
export function columnIndexByHeader(headers, pattern) {
  return headers.findIndex((h) => pattern.test(cleanHeader(h)));
}

/**
 * 单元格是否像岗位代码而非专业名
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikePostCode(value) {
  const s = String(value ?? "").trim();
  return /^[A-Z]\d{1,3}$/u.test(s) || /^\d{2,4}$/u.test(s);
}

/**
 * 单元格是否像专业要求（含中文专业名或「不限专业」）
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikeMajorCell(value) {
  return isLikelyMajorCell(value);
}

/**
 * 表头映射失败时，从数据行推断专业列
 * @param {string[]} headers
 * @param {string[]} row
 * @param {number} postCodeIdx
 * @returns {number}
 */
export function inferMajorColumnIndex(headers, row, postCodeIdx = -1) {
  const byHeader = columnIndexForMajor(headers);
  if (byHeader >= 0) {
    const cell = String(row[byHeader] ?? "").trim();
    if (/[（(]\s*\d{1,2}\s*[)）]/u.test(cell)) return byHeader;
    if (looksLikeMajorCell(cell) || !cell) return byHeader;
  }

  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < row.length; i += 1) {
    if (i === postCodeIdx) continue;
    const cell = String(row[i] ?? "").trim();
    if (
      /(?:学院|大学|学校|研究院|单位)$/u.test(cell) &&
      !/[（(]\s*\d{1,2}\s*[)）]/u.test(cell)
    ) {
      continue;
    }
    if (!looksLikeMajorCell(cell)) continue;
    let score = 1;
    if (/(?:不限专业|专业不限)/u.test(cell)) score += 5;
    if (/[（(]\s*\d{1,2}\s*[)）]/u.test(cell)) score += 3;
    if (/[\u4e00-\u9fa5]{2,}/u.test(cell)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx >= 0 ? bestIdx : byHeader;
}
