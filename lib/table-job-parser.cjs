/**
 * 招聘岗位表行解析（表头识别 + 动态列映射，适用于全国事业单位 xlsx 透视文本）
 */

const {
  normalizeEducationValue,
  isLikelyEducationCell,
} = require("./education-utils.js");
const {
  sanitizeOrganizationName,
} = require("./job-posting-text.js");
const {
  formatMajorRequirement,
} = require("./major-utils.js");
const {
  columnIndexForMajor,
  columnIndexForPostCode,
  columnIndexByHeader,
  inferMajorColumnIndex,
  looksLikeMajorCell,
} = require("./table-column-utils.js");
const { buildJobProvinceCity } = require("./region-display.js");
const {
  resolveCompositeHeaderLayout,
  isDataRowStart,
} = require("./table-header-utils.cjs");

const AGE_LIMIT_PATTERNS = [
  /(\d{1,3})\s*周岁\s*及?\s*以[下内]/u,
  /(\d{1,3})\s*周岁以下/u,
  /不超过\s*(\d{1,3})\s*周岁/u,
  /年龄\s*(?:在\s*)?(\d{1,3})\s*周岁/u,
];

function cleanCell(value) {
  return String(value ?? "")
    .replace(/^"|"$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTabRow(line) {
  return String(line ?? "")
    .split("\t")
    .map(cleanCell);
}

function findHeaderRowIndex(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const joined = rows[i].join("\t");
    if (/序号/u.test(joined) && /(?:专业|岗位)/u.test(joined)) return i;
    if (/专业/u.test(joined) && /(?:人数|岗位|学历|年龄)/u.test(joined)) return i;
    if (/(?:招聘人数|计划数|名额|岗位名称)/u.test(joined) && /学历/u.test(joined)) {
      return i;
    }
  }
  return -1;
}

function columnIndexByHeaderLocal(headers, pattern) {
  return columnIndexByHeader(headers, pattern);
}

function columnIndexForDept(headers) {
  const list = headers.map(cleanCell);
  const patterns = [
    /^部门$/u,
    /^所属部门$/u,
    /^院系$/u,
    /^所属科室$/u,
    /^科室$/u,
  ];
  for (const pattern of patterns) {
    const idx = list.findIndex((h) => pattern.test(h));
    if (idx >= 0) return idx;
  }
  return -1;
}

function buildHeaderMap(headers) {
  return {
    seq: columnIndexByHeaderLocal(headers, /^(?:序号|编号)$/u),
    unit: columnIndexByHeaderLocal(
      headers,
      /(?:招聘)?单位|用人单位|^学校$/u,
    ),
    supervisor: columnIndexByHeaderLocal(headers, /^主管部门$/u),
    dept: columnIndexForDept(headers),
    postName: columnIndexByHeaderLocal(
      headers,
      /(?:岗位|职位)(?:名称)?|招聘职位|^岗位$/u,
    ),
    postCode: columnIndexForPostCode(headers),
    slots: columnIndexByHeaderLocal(
      headers,
      /(?:招聘)?(?:人数|计划数)|计划(?:招聘)?数|^计划数$|名额|岗位数/u,
    ),
    education: columnIndexByHeaderLocal(
      headers,
      /(?:学历|文化程度)(?:学位|要求)?|^学历$|^学位$|^学历学位$/u,
    ),
    major: columnIndexForMajor(headers),
    age: columnIndexByHeaderLocal(headers, /年龄(?:要求|条件)?/u),
    other: columnIndexByHeaderLocal(
      headers,
      /(?:其他|备注|资格|条件)(?:要求|条件|说明)?|特殊要求|附加条件|岗位条件|^其他要求$/u,
    ),
  };
}

function pickCell(row, index) {
  if (index < 0) return "";
  return cleanCell(row[index] ?? "");
}

function extractAgeLimitText(text) {
  const raw = cleanCell(text).replace(
    /\s*(?:实操|面试|直接考核)\s*$/u,
    "",
  );
  if (!raw) return "";
  for (const pattern of AGE_LIMIT_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      if (match[1]) return `${match[1]}周岁以下`;
      return raw;
    }
  }
  if (/周岁|岁以下/u.test(raw) && raw.length <= 40) return raw;
  return "";
}

function normalizeOtherCell(text) {
  const raw = cleanCell(text);
  if (!raw) return "";
  if (/^1:\d+$/u.test(raw)) return "";
  if (/^(?:实操|面试)$/u.test(raw)) return "";
  if (/网站|咨询电话|举报电话/u.test(raw) && !/限|职称|高校/u.test(raw)) return "";
  return raw;
}

function isLikelyOtherRequirement(text) {
  return (
    /限高校|职称|放宽|应届|经验|优先|户籍|定向|留学|海归|资格/u.test(text) &&
    text.length <= 120
  );
}

function pickOtherRequirement(cols, map) {
  const direct = normalizeOtherCell(pickCell(cols, map.other));
  if (direct && isLikelyOtherRequirement(direct)) return direct;
  for (let offset = -2; offset <= 2; offset += 1) {
    const idx = map.other + offset;
    if (idx < 0 || idx >= cols.length) continue;
    const candidate = normalizeOtherCell(pickCell(cols, idx));
    if (candidate && isLikelyOtherRequirement(candidate)) return candidate;
  }
  return direct;
}

function inferPostCodeFromRow(cols, map) {
  const fromMap = pickCell(cols, map.postCode);
  if (fromMap) return fromMap;
  if (map.postName >= 0) {
    const next = pickCell(cols, map.postName + 1);
    if (/^\d{2,4}$/u.test(next)) return next;
  }
  return "";
}

function isHeaderLikeLine(trimmed) {
  if (!trimmed.includes("\t")) return false;
  return (
    (/序号/u.test(trimmed) && /岗位/u.test(trimmed)) ||
    (/计划数/u.test(trimmed) && /专业要求/u.test(trimmed)) ||
    /(?:岗位代码|笔试科目)/u.test(trimmed)
  );
}

/** 「2 湖南科技学院」→「2\t湖南科技学院」避免首列错位 */
function normalizeDataLineDelimiters(line) {
  return String(line ?? "").replace(
    /^(\d{1,3})\s+(?=[\u4e00-\u9fa5])/u,
    "$1\t",
  );
}

/**
 * 续行含 tab：专业片段拼入上一格，年龄/其他等拼到行尾
 * @param {string[]} baseCols
 * @param {string} contLine
 */
function appendContinuationRow(baseCols, contLine) {
  const cont = parseTabRow(normalizeDataLineDelimiters(contLine));
  const out = baseCols.map((c) => cleanCell(c));

  let contIdx = 0;
  while (
    contIdx < cont.length &&
    !/(?:周岁|限高校|实操|面试|1:\d|咨询电话|举报电话)/u.test(cont[contIdx])
  ) {
    const piece = cleanCell(cont[contIdx]);
    if (piece) {
      if (/^[（(]\s*\d{1,2}\s*[)）]/u.test(piece) && out.length > 0) {
        const last = out.length - 1;
        out[last] = `${out[last]} ${piece}`.trim();
      } else {
        const emptyIdx = out.findIndex((c) => !c);
        if (emptyIdx >= 0) out[emptyIdx] = piece;
        else out.push(piece);
      }
    }
    contIdx += 1;
  }

  for (; contIdx < cont.length; contIdx += 1) {
    const piece = cleanCell(cont[contIdx]);
    if (!piece) continue;
    const emptyIdx = out.findIndex((c, idx) => idx >= 5 && !c);
    if (emptyIdx >= 0) out[emptyIdx] = piece;
    else out.push(piece);
  }

  return out;
}

/** 首列「2 单位名」拆成序号 + 单位 */
function normalizeLeadingSeqColumn(row) {
  const out = row.map((c) => cleanCell(c));
  const c0 = out[0] ?? "";
  const split = c0.match(/^(\d{1,3})\s+(.+)$/u);
  if (split) {
    out[0] = split[1];
    out.splice(1, 0, split[2]);
  }
  return out;
}

/** 专业要求续行：(1) 教育学、(2) 100215 … */
function isMajorContinuationLine(trimmed) {
  const t = String(trimmed ?? "").trim();
  if (!t) return true;
  if (/^[（(]\s*\d{1,2}\s*[)）]/u.test(t)) return true;
  if (!t.includes("\t") && /^[\u4e00-\u9fa5(\d（(]/u.test(t)) return true;
  return false;
}

function isNewDataRow(trimmed) {
  if (isHeaderLikeLine(trimmed)) return false;
  const t = normalizeDataLineDelimiters(trimmed);
  const tabs = (t.match(/\t/g) || []).length;
  if (/^\d+\t/u.test(t) && tabs >= 1) return true;
  if (/^\d+\s+\S/u.test(t) && tabs >= 2) return true;
  if (/^\t[\u4e00-\u9fa5]/u.test(t) && tabs >= 2) return true;
  return false;
}

/** 含 tab、且不是专业续行的独立数据行（序号列可能为空） */
function isIndependentTableRow(trimmed) {
  if (isMajorContinuationLine(trimmed)) return false;
  if (isHeaderLikeLine(trimmed)) return false;
  const tabs = (trimmed.match(/\t/g) || []).length;
  if (tabs < 2) return false;
  if (/^\d+\t/u.test(trimmed)) return true;
  if (/^\t[\u4e00-\u9fa5]/u.test(trimmed)) return true;
  const cols = parseTabRow(trimmed);
  const filled = cols.filter((c) => cleanCell(c)).length;
  return filled >= 4;
}

function padMissingOrgColumn(row, referenceRow) {
  if (!referenceRow || row.length >= referenceRow.length) return row;
  const ref1 = cleanCell(referenceRow[1]);
  const ref2 = cleanCell(referenceRow[2]);
  if (!ref1 || ref1 !== ref2) return row;
  const cur1 = cleanCell(row[1]);
  if (cur1 !== ref1) return row;
  const cur2 = cleanCell(row[2] ?? "");
  if (cur2 === ref1) return row;
  const out = [...row];
  out.splice(2, 0, ref1);
  return out;
}

function splitAgeInterviewColumns(row, map) {
  const out = [...row];
  const ageIdx = map.age;
  if (ageIdx < 0 || ageIdx >= out.length) return out;
  const cell = cleanCell(out[ageIdx]);
  const interviewMatch = cell.match(
    /(.+?)(\s+(?:实操|面试|直接考核))\s*$/u,
  );
  if (!interviewMatch || !/周岁/u.test(cell)) return out;
  out[ageIdx] = interviewMatch[1].trim();
  const interview = interviewMatch[2].trim();
  const next = cleanCell(out[ageIdx + 1] ?? "");
  if (/^1:\d+$/u.test(next) || !next) {
    out.splice(ageIdx + 1, 0, interview);
  }
  return out;
}

function alignJobDataRow(row, referenceRow, map) {
  let out = normalizeLeadingSeqColumn(row);
  if (!referenceRow) return out;
  out = padMissingOrgColumn(out, referenceRow);
  out = splitAgeInterviewColumns(out, map);
  return out;
}

function isValidPostCodeCell(value) {
  const v = cleanCell(value);
  if (!v) return true;
  if (/专技岗位|^(?:岗位|专技|教师|学位|无)$/u.test(v)) return false;
  return /^(?:[A-Z]{1,3})?\d{1,4}$/iu.test(v);
}

function isJobDataRowCandidate(row, map) {
  const cells = row.map((c) => cleanCell(c));
  if (!cells.some(Boolean)) return false;
  const joined = cells.join(" ");
  if (/^合计|总计|小计|备注[:：]|说明[:：]|注[:：]/u.test(joined)) return false;
  if (/^序号$|^计划数$|^专业要求$/u.test(cells[0] || cells[1] || "")) return false;

  const postCode = inferPostCodeFromRow(row, map);
  if (postCode && !isValidPostCodeCell(postCode)) return false;

  const postName = pickCell(row, map.postName);
  if (postName && postName.length >= 2 && postName !== "岗位") {
    if (/^(?:学历|年龄|专业|学位|其他要求)$/u.test(postName)) return false;
    if (/周岁|硕士|博士|研究生|本科/u.test(postName)) return false;
    return true;
  }

  const major = pickCell(row, map.major);
  if (looksLikeMajorCell(major)) return true;

  const unit = pickCell(row, map.unit) || pickCell(row, map.dept);
  const edu = pickCell(row, map.education);
  if (unit && unit.length >= 3 && (edu || major || postName)) return true;

  return cells.filter(Boolean).length >= 5;
}

/**
 * 为缺序号/合并单元格行补序号（原地修改 row[0] 或在首列前插入）
 * @param {string[]} row
 * @param {ReturnType<typeof buildHeaderMap>} map
 * @param {{ value: number }} autoSeq
 * @returns {string[]|null}
 */
function prepareJobDataRow(row, map, autoSeq) {
  let out = row.map((c) => cleanCell(c));
  while (out.length > 0 && !out[out.length - 1]) out.pop();
  if (!isJobDataRowCandidate(out, map)) return null;

  const c0 = out[0] ?? "";
  if (/^\d+$/.test(c0)) {
    autoSeq.value = Number.parseInt(c0, 10);
    return out;
  }

  autoSeq.value += 1;
  const seqStr = String(autoSeq.value);

  if (!c0) {
    out[0] = seqStr;
    return out;
  }

  if (map.seq === 0 && /[\u4e00-\u9fa5]{2,}/u.test(c0)) {
    return [seqStr, ...out];
  }

  out[0] = seqStr;
  return out;
}

/**
 * 从已分好的二维表行解析岗位（XLSX matrix / 合并后的 tab 行通用）
 * @param {string[][]} tabRows
 * @param {object} [meta]
 * @returns {object[]}
 */
function parseJobsFromTabularRows(tabRows, meta = {}) {
  if (!Array.isArray(tabRows) || tabRows.length === 0) return [];

  const { headerIdx, map, headers, dataStartIdx } = buildHeaderMapFromRows(tabRows);
  if (headerIdx < 0 || !map) return [];

  const jobs = [];
  const start = dataStartIdx >= 0 ? dataStartIdx : headerIdx + 1;
  const autoSeq = { value: 0 };
  let referenceRow = null;

  for (let r = start; r < tabRows.length; r += 1) {
    const row = alignJobDataRow(tabRows[r], referenceRow, map);
    const prepared = prepareJobDataRow(row, map, autoSeq);
    if (!prepared) continue;

    if (!referenceRow || prepared.length > referenceRow.length) {
      referenceRow = prepared;
    }

    const job = rowToJobFromHeaders(prepared, map, meta, headers);
    if (job) {
      job._meta = { rawCells: prepared, rowIndex: r, headers };
      jobs.push(job);
    }
  }

  return jobs;
}

/**
 * 合并跨行单元格（专业要求常占多行）并保留双行表头
 * @param {string[]} lines
 * @returns {string[][]}
 */
function collectTabularRowsFromLines(lines) {
  const tabRows = [];
  let pendingCols = null;

  function flushPending() {
    if (pendingCols?.length) {
      tabRows.push(pendingCols);
      pendingCols = null;
    }
  }

  for (const line of lines) {
    let trimmed = String(line ?? "").trim();
    if (!trimmed || trimmed.startsWith("---")) continue;
    if (trimmed.includes("附件") && trimmed.includes("透视")) continue;
    if (/^注[:：]?$/u.test(trimmed)) break;
    if (/^结构化岗位表/u.test(trimmed)) break;

    trimmed = normalizeDataLineDelimiters(trimmed);

    if (isHeaderLikeLine(trimmed)) {
      flushPending();
      tabRows.push(parseTabRow(trimmed));
      continue;
    }

    if (isNewDataRow(trimmed)) {
      flushPending();
      pendingCols = normalizeLeadingSeqColumn(parseTabRow(trimmed));
      continue;
    }

    if (pendingCols && trimmed.includes("\t") && isIndependentTableRow(trimmed)) {
      flushPending();
      pendingCols = normalizeLeadingSeqColumn(parseTabRow(trimmed));
      continue;
    }

    if (pendingCols) {
      if (trimmed.includes("\t")) {
        pendingCols = appendContinuationRow(pendingCols, trimmed);
      } else {
        const last = pendingCols.length - 1;
        pendingCols[last] = `${pendingCols[last]} ${trimmed}`.trim();
      }
      continue;
    }

    if (trimmed.includes("\t") && /计划数|专业要求/u.test(trimmed)) {
      tabRows.push(parseTabRow(trimmed));
    }
  }

  flushPending();
  return tabRows;
}

/**
 * @param {string[][]} rows
 * @param {{ headerIdx?: number }} [options]
 */
function buildHeaderMapFromRows(rows, options = {}) {
  const headerIdx =
    options.headerIdx != null ? options.headerIdx : findHeaderRowIndex(rows);
  if (headerIdx < 0) {
    return { headerIdx: -1, map: null, headers: [], dataStartIdx: -1 };
  }

  const { extendedHeaders, dataStartIdx } = resolveCompositeHeaderLayout(
    rows,
    headerIdx,
    normalizeEducationValue,
  );

  return {
    headerIdx,
    map: buildHeaderMap(extendedHeaders),
    headers: extendedHeaders,
    dataStartIdx,
  };
}

/**
 * @param {string[]} cols
 * @param {ReturnType<typeof buildHeaderMap>} map
 * @param {object} [meta]
 * @param {string[]} [headers]
 */
function rowToJobFromHeaders(cols, map, meta = {}, headers = []) {
  const seq = cols[0];
  if (!/^\d+$/.test(seq)) return null;

  const recruitingUnit = pickCell(cols, map.unit);
  const supervisor = pickCell(cols, map.supervisor);
  const dept = pickCell(cols, map.dept);
  const unit = recruitingUnit || supervisor || meta.defaultUnit || "";
  const postName = pickCell(cols, map.postName) || "岗位";
  const postCode = inferPostCodeFromRow(cols, map);

  let majorRaw = pickCell(cols, map.major);
  if (!looksLikeMajorCell(majorRaw)) {
    const majorIdx = inferMajorColumnIndex(headers, cols, map.postCode);
    if (majorIdx >= 0) majorRaw = pickCell(cols, majorIdx);
  }
  const majorRequirement =
    majorRaw && majorRaw !== "—" && looksLikeMajorCell(majorRaw)
      ? formatMajorRequirement(majorRaw)
      : formatMajorRequirement("");

  const ageRequirement =
    extractAgeLimitText(pickCell(cols, map.age)) || pickCell(cols, map.age);
  const otherRequirement = pickOtherRequirement(cols, map);

  const slotsRaw = pickCell(cols, map.slots);
  const slots = Number.parseInt(slotsRaw, 10) || 0;

  const educationRaw = pickCell(cols, map.education);
  const education = isLikelyEducationCell(educationRaw)
    ? normalizeEducationValue(educationRaw)
    : "";

  const title = postCode ? `${postName} · ${postCode}` : postName;
  const organization = sanitizeOrganizationName(
    dept && unit ? `${unit} · ${dept}` : unit || dept || meta.defaultUnit || "",
    meta.defaultUnit || "",
  );

  const fields = {
    title,
    majorRequirement,
    ageRequirement,
    education,
    otherRequirement,
  };

  return {
    id: postCode || `job-${seq}`,
    publishDate: meta.publishDate || "",
    organization,
    title,
    provinceCity:
      buildJobProvinceCity({
        province: meta.province,
        city: meta.city,
        sourceProvince: meta.province,
        sourceCity: meta.city,
      }) || meta.provinceCity || "",
    slots,
    slotsLabel: slots > 0 ? `${slots} 人` : "详见附件",
    education: education || "—",
    majorRequirement: majorRequirement || "—",
    ageRequirement: ageRequirement || "—",
    otherRequirement: otherRequirement || "",
    deadline: meta.deadline ?? null,
    daysLeft: meta.daysLeft ?? null,
    daysLeftLabel: meta.daysLeftLabel ?? "",
    text: [
      fields.title,
      fields.majorRequirement,
      fields.ageRequirement,
      fields.education,
      fields.otherRequirement,
    ]
      .filter(Boolean)
      .join(" "),
    _raw: {
      educationRaw,
      educationValid: Boolean(education),
    },
  };
}

/**
 * @param {string[]} lines
 * @param {object} meta
 * @returns {object[]}
 */
function parseStructuredJobsFromTabLines(lines, meta = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return [];

  const tabRows = collectTabularRowsFromLines(lines);
  if (tabRows.length === 0) return [];

  return parseJobsFromTabularRows(tabRows, meta);
}

function inferEducationFromRow(cols) {
  for (let i = cols.length - 1; i >= 0; i -= 1) {
    const raw = cols[i];
    if (isLikelyEducationCell(raw)) return normalizeEducationValue(raw);
  }
  return "";
}

module.exports = {
  parseTabRow,
  findHeaderRowIndex,
  buildHeaderMapFromRows,
  rowToJobFromHeaders,
  parseStructuredJobsFromTabLines,
  parseJobsFromTabularRows,
  collectTabularRowsFromLines,
  normalizeEducationValue,
  inferEducationFromRow,
};
