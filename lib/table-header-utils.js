/**
 * 双行/多行错位表头识别（常见于高校岗位表）
 */

function cleanHeader(value) {
  return String(value ?? "").trim();
}

function cleanCell(value) {
  return String(value ?? "")
    .replace(/^"|"$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isDataRowStart(row) {
  const c0 = cleanCell(row[0] ?? "");
  if (/^\d{1,3}$/u.test(c0)) return true;
  if (/^\d{1,3}\s+[\u4e00-\u9fa5]/u.test(c0)) return true;
  const joined = row.join("\t");
  return /^\d+\t/u.test(joined);
}

function isHeaderRow(row) {
  const joined = row.map(cleanHeader).join("\t");
  if (isDataRowStart(row)) return false;
  return /(?:序号|计划数|学历|专业要求|年龄要求|其他要求|岗位代码|岗位名称|笔试|主管部门|招聘单位)/u.test(
    joined,
  );
}

function findHeaderBlockEnd(rows, headerIdx) {
  let end = headerIdx;
  while (end + 1 < rows.length && isHeaderRow(rows[end + 1])) {
    end += 1;
  }
  return end;
}

export function findSubHeaderRowIndex(rows, headerIdx) {
  if (headerIdx < 0 || headerIdx + 1 >= rows.length) return -1;
  const next = rows[headerIdx + 1].map(cleanHeader);
  const joined = next.join("\t");
  if (/^\d+$/u.test(next[0] ?? "")) return -1;
  if (
    /(?:计划数|学历|专业要求|年龄要求|其他要求)/u.test(joined) &&
    !/序号/u.test(joined)
  ) {
    return headerIdx + 1;
  }
  return -1;
}

export function inferSubHeaderStartColumn(
  dataRow,
  subHeaders,
  normalizeEducation,
  mainHeaderCount = 0,
) {
  const cells = dataRow.map(cleanCell);
  const searchFrom = Math.max(1, mainHeaderCount);

  const eduSubIdx = subHeaders.findIndex((h) => /学历|学位/u.test(h));
  if (eduSubIdx >= 0) {
    for (let i = searchFrom; i < cells.length; i += 1) {
      if (normalizeEducation(cells[i])) {
        const start = i - eduSubIdx;
        if (start >= 1) return start;
      }
    }
  }

  const slotsSubIdx = subHeaders.findIndex((h) => /计划数|人数|名额/u.test(h));
  if (slotsSubIdx >= 0) {
    for (let i = searchFrom; i < cells.length; i += 1) {
      if (/^[1-9]\d{0,2}$/u.test(cells[i])) {
        const start = i - slotsSubIdx;
        if (start >= 1) return start;
      }
    }
  }

  const majorSubIdx = subHeaders.findIndex(
    (h) => /专业/u.test(h) && !/代码|类别/u.test(h),
  );
  if (majorSubIdx >= 0) {
    for (let i = searchFrom; i < cells.length; i += 1) {
      if (
        /(?:不限专业|\(\d{1,2}\)|[\u4e00-\u9fa5]{2,}(?:学|类|技术|医学|康复))/u.test(
          cells[i],
        )
      ) {
        const start = i - majorSubIdx;
        if (start >= 1) return start;
      }
    }
  }

  return Math.max(mainHeaderCount, cells.length - subHeaders.length);
}

export function buildExtendedHeaders(mainHeaders, subHeaders, subStartCol) {
  const len = Math.max(mainHeaders.length, subStartCol + subHeaders.length);
  const extended = new Array(len).fill("");
  for (let i = 0; i < mainHeaders.length; i += 1) {
    extended[i] = mainHeaders[i];
  }
  for (let i = 0; i < subHeaders.length; i += 1) {
    const idx = subStartCol + i;
    if (subHeaders[i]) extended[idx] = subHeaders[i];
  }
  return extended;
}

function overlayHeaderLabels(extended, labels, startOffset = 0) {
  const out = [...extended];
  for (let i = 0; i < labels.length; i += 1) {
    const idx = startOffset + i;
    const label = cleanHeader(labels[i]);
    if (!label) continue;
    while (out.length <= idx) out.push("");
    if (!out[idx]) out[idx] = label;
    else if (!out[idx].includes(label)) out[idx] = `${out[idx]}${label}`;
  }
  return out;
}

function overlayMiddleHeaderRow(extended, mainHeaders, midHeaders) {
  if (!midHeaders?.length) return extended;
  const nameIdx = midHeaders.findIndex(
    (h) => /名称/u.test(h) && !/单位|岗位代码|部门/u.test(h),
  );
  const postCol = mainHeaders.findIndex(
    (h) => /岗位/u.test(h) && !/代码|类别|等级|计划/u.test(h),
  );
  const startOffset =
    nameIdx >= 0 && postCol >= 0 ? postCol - nameIdx : mainHeaders.length - 1;
  return overlayHeaderLabels(extended, midHeaders, Math.max(0, startOffset));
}

export function resolveCompositeHeaderLayout(rows, headerIdx, normalizeEducation) {
  const mainHeaders = rows[headerIdx].map(cleanHeader);
  const headerEnd = findHeaderBlockEnd(rows, headerIdx);
  const headerSlices = rows
    .slice(headerIdx, headerEnd + 1)
    .map((row) => row.map(cleanHeader));

  const tailHeaders = headerSlices[headerSlices.length - 1] || mainHeaders;

  let dataStartIdx = headerEnd + 1;
  let sampleRow = rows[dataStartIdx];
  while (
    sampleRow &&
    !isDataRowStart(sampleRow) &&
    sampleRow.filter((c) => cleanCell(c)).length < 4
  ) {
    dataStartIdx += 1;
    sampleRow = rows[dataStartIdx];
  }

  const subStartCol = sampleRow
    ? inferSubHeaderStartColumn(
        sampleRow,
        tailHeaders,
        normalizeEducation,
        mainHeaders.length,
      )
    : mainHeaders.length;

  let extendedHeaders = buildExtendedHeaders(mainHeaders, tailHeaders, subStartCol);
  if (headerSlices.length === 2) {
    extendedHeaders = overlayMiddleHeaderRow(
      extendedHeaders,
      mainHeaders,
      headerSlices[1],
    );
  } else if (headerSlices.length > 2) {
    for (const slice of headerSlices.slice(1, -1)) {
      extendedHeaders = overlayMiddleHeaderRow(extendedHeaders, mainHeaders, slice);
    }
  }

  return {
    extendedHeaders,
    dataStartIdx,
    headerEnd,
  };
}

export { isHeaderRow, isDataRowStart };
