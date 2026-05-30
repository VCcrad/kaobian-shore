/**
 * parse-attachment.ts · 主公告正文 + 附件 XLSX 岗位表 · 混合结构解析
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 业务规则（合并优先级，2026-05 明确）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. numPositions（招聘人数）
 *    · 优先：附件表格中各岗位「计划数/招聘人数」加总（structuredJobs 每行 slots）
 *    · 其次：附件表格层面的 numPositions（若可信）
 *    · 兜底：主正文「招聘计划 XX 名 / 计划 XX 名」等总人数
 *    · 无附件或无表格人数时，才使用主正文总人数
 *
 * 2. deadline（报名截止日期）
 *    · 始终优先：主正文中的日期（如「报名时间 … 至 …」取结束日）
 *    · 表格单元格「暂未公布 / 待定 / 详见公告」等占位符永不写入 deadline
 *    · 仅当主正文无日期时，才考虑附件表格中的可信日期
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 数据流：
 *   主正文 → parseMainText → deadline / 总招聘人数 / 总体要求
 *   附件 XLSX → parseTableToStructuredJobs → 每行 StructuredJob（含 slots）
 *   合并 → mergeMainTextAndTable（mergeHybridParseResults 入口）
 */

import type { Prisma } from "@prisma/client";
import { createRequire } from "node:module";
import {
  extractEducationFromProse,
  normalizeEducationValue,
} from "./education-utils.js";
import {
  formatMajorRequirement,
  isUnlimitedMajor,
  extractMajorNamesFromCell,
  isLikelyMajorCell,
} from "./major-utils.js";
import { isGarbledText, stripWebScrapJunk } from "./job-posting-text.js";
import { enrichUniversityMainTextRequirements } from "./parse-university-prose.js";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const require = createRequire(import.meta.url);
const {
  collectTabularRowsFromLines,
  parseJobsFromTabularRows,
} = require("./table-job-parser.cjs");

/** pdf-parse v1 为函数；v2 为 PDFParse 类 */
type PdfParseModule = {
  (buffer: Buffer): Promise<{ text?: string }>;
  PDFParse?: new (opts: { data: Buffer }) => {
    getText: () => Promise<{ text?: string }>;
    destroy?: () => Promise<void>;
  };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as PdfParseModule;

// ==================== 公开类型 ====================

export type ParsedRequirements = {
  ageLimit?: string;
  politicalStatus?: string;
  majorRequirements?: string[];
  education?: string;
  gender?: string;
  numPositions?: number | string;
  deadline?: string;
  freshGraduateOnly?: boolean;
  notes?: string;
  other?: Prisma.InputJsonValue;
};

export type ParseResult = {
  title: string;
  requirements: ParsedRequirements;
  rawText: string;
  success: boolean;
  parserUsed: "rule" | "minimax";
};

/** 表格单行结构化岗位（每行一个独立对象） */
export type StructuredJob = {
  sheetName: string;
  rowIndex: number;
  title: string;
  postName?: string;
  postCode?: string;
  organization?: string;
  department?: string;
  major?: string;
  majorRequirement?: string;
  age?: string;
  ageLimit?: string;
  numPositions?: number | string;
  slots?: number;
  deadline?: string;
  education?: string;
  gender?: string;
  notes?: string;
  otherRequirement?: string;
  politicalStatus?: string;
  /** 表头名 → 单元格值（保留列结构） */
  columns: Record<string, string>;
  /** 原始行（按列索引） */
  rawCells: string[];
};

type WorksheetStats = {
  totalRows: number;
  collectedRows: number;
  colCount: number;
};

type ParserRowJob = {
  title?: string;
  organization?: string;
  majorRequirement?: string;
  ageRequirement?: string;
  education?: string;
  otherRequirement?: string;
  slots?: number;
  id?: string;
};

// ==================== 常量 ====================

const MIN_RAW_TEXT_LENGTH = 200;
const MIN_RULE_TEXT_LENGTH = 80;

const PLACEHOLDER_FIELD =
  /^(?:暂未公布|暂未确定|待定|另行通知|详见(?:公告)?|以公告为准|—|-+|无|暂无|\/|NULL|N\/A)$/iu;

/** [NEW] 非招聘公告：通知、考核公示、名单公布等（不提取 deadline / numPositions） */
const RECRUITMENT_POSITIVE_PATTERNS = [
  /公开招聘(?:公告|启事|方案|简章)/u,
  /(?:面向社会|面向(?:国内外|社会))(?:公开)?招聘/u,
  /面向(?:全校|校内)(?:教职工|职工).*?(?:公开)?招聘/u,
  /(?:拟|计划)(?:公开)?招聘(?:工作人员|人员|专技人员|管理人员|专员|科员)/u,
  /(?:公开)?招聘(?:管理|专技|技术)?(?:人员|工作人员|管理人员|专员|科员)/u,
  /招聘(?:工作)?人员(?:公告|启事)?/u,
  /(?:人才|高层次(?:人才|骨干))(?:引进|招聘)(?:公告|启事)/u,
  /引进(?:高层次|优秀)?(?:人才|教师|博士)(?:公告|启事)?/u,
  /(?:一、)?(?:招聘岗位及人数|招聘岗位及岗位职责|招聘岗位)/u,
];

const NON_RECRUITMENT_PATTERNS = [
  /关于.{2,100}的(?:通知|意见|办法|方案|安排|说明)(?!.*公开招聘)/u,
  /(?:转发|印发).{2,80}通知/u,
  /(?:考核|审查|体检|考察)(?:合格|通过)?人员.*(?:公示|公布|名单)/u,
  /(?:合格|通过)人员(?:名单)?(?:予以)?(?:公示|公布)/u,
  /(?:资格)?审查(?:合格|通过).*(?:公示|公布|名单)/u,
  /(?:聘期|试用期满|年度|中期)(?:考核|评价)(?:结果)?(?:公示|通知|工作)/u,
  /(?:考核|评估|评议)(?:结果)?公示/u,
  /(?:特殊津(?:贴|补)|政府津贴|骨干(?:教师)?培养)/u,
  /(?:教师|辅导员|思政)(?:培训|培养|进修|选派)/u,
  /(?:名单|结果)(?:予以)?公示(?!.*招聘)/u,
  /(?:公布|发布).{0,20}(?:考核|审查|体检|考察)/u,
  /(?:二级教授|教授)风采/u,
  /(?:创新创[业]?大赛|好声音|德育实践)/u,
];

const AGE_LIMIT_PATTERNS = [
  /(\d{1,3})\s*周岁\s*及?\s*以[下内]/u,
  /(\d{1,3})\s*周岁以下/u,
  /不超过\s*(\d{1,3})\s*周岁/u,
  /年龄\s*(?:在\s*)?(\d{1,3})\s*周岁/u,
];

const PARTY_REQUIRED_KEYWORDS = [
  "中共党员",
  "中共预备党员",
  "预备党员",
  "限党员",
  "面向党员",
  "须为中共党员",
  "须中共党员",
  "限中共党员",
];

const MINIMAX_API_URL =
  process.env.MINIMAX_API_URL ??
  "https://api.minimax.chat/v1/text/chatcompletion_v2";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? "";
const MINIMAX_MODEL = process.env.MINIMAX_MODEL ?? "abab6.5s-chat";
const DIFY_API_URL =
  process.env.DIFY_API_URL ?? "http://localhost/v1/workflows/run";
const DIFY_API_KEY = process.env.DIFY_API_KEY ?? "";

const REQUIREMENTS_EXTRACTION_PROMPT = `你是湖南省人社厅及高校编制招聘公告的结构化提取助手。
输入通常包含两部分：
① 【主公告正文】—— 散文段落，含报名时间、招聘计划总人数、总体应聘条件
② 【附件岗位表】—— 多行表格，每行一个岗位的具体明细（专业、学历、单行人数、年龄等）

只输出一个合法 JSON 对象，禁止 markdown 与多余说明。

{
  "title": "公告标题",
  "requirements": {
    "numPositions": 15,
    "deadline": "2026-05-10",
    "majorRequirements": ["专业1", "专业2"],
    "ageLimit": "35周岁以下",
    "education": "硕士研究生及以上",
    "notes": "总体要求",
    "other": {}
  }
}

**必须严格遵守的合并规则**：
1. **deadline（报名截止日期）—— 始终优先主正文**
   - 如「报名时间 2026年4月29日至2026年5月10日24时」→ deadline 取「至」后结束日 2026-05-10
   - 表格里「暂未公布」「待定」「详见公告」等占位符 **禁止** 写入 deadline
   - 只有主正文完全没有日期时，才可参考表格中的明确日期
2. **numPositions（招聘人数）—— 优先表格各岗位人数**
   - 从表格「计划数 / 招聘人数 / 名额」列读取 **每一行** 的人数，requirements.numPositions 填各岗位人数之和
   - 如表格有 3+3+5=11，则 numPositions = 11（不要用主正文「招聘 55 名」覆盖）
   - **仅当** 表格无明确人数、或无附件时，才从主正文提取：「招聘计划15名」「计划15名」→ numPositions = 15
3. 表格提供每个岗位的具体明细（专业、学历、单行人数、年龄、备注），structuredJobs 语义由规则解析承担
4. majorRequirements 汇总表格「专业要求/所学专业」列的去重列表
5. 无法确定则省略字段，不要编造`;

// ==================== 公开 API ====================

/**
 * 从 XLSX Buffer 完整读取所有工作表，按行解析为结构化岗位数组。
 * 使用 sheet_to_json({ header: 1, defval: "" })，不限制行数/列数。
 */
export async function parseTableToStructuredJobs(
  buffer: Buffer,
): Promise<StructuredJob[]> {
  if (!isExcelBuffer(buffer) || isPlainUtf8TextBuffer(buffer)) {
    const text = decodeBufferAsUtf8(buffer);
    return parseStructuredJobsFromLines(text.split(/\r?\n/u), "utf8-text");
  }

  const workbook = readXlsxWorkbook(buffer);
  const allJobs: StructuredJob[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = readAllWorksheetRows(sheet).map((row) =>
      row.map((cell) => cleanCellValue(cell)),
    );

    const sheetJobs = parseStructuredJobsFromMatrix(rows, sheetName);
    allJobs.push(...sheetJobs);

    console.log(
      `[Parse] 结构化解析「${sheetName}」${rows.length} 行 → ${sheetJobs.length} 条岗位`,
    );
  }

  return allJobs;
}

export async function parseAttachment(
  buffer: Buffer,
  fileType: "pdf" | "xlsx" | "docx",
  fileName?: string,
): Promise<ParseResult> {
  try {
    let result = await parseWithRules(buffer, fileType);

    if (!result.success || result.rawText.length < MIN_RAW_TEXT_LENGTH) {
      console.log(`[Parse] 规则解析不理想，切换到 MiniMax: ${fileName ?? fileType}`);
      result = await parseWithMiniMax(buffer, fileType, fileName);
    }

    return finalizeResult(result);
  } catch (error) {
    console.error("[Parse Error]", fileName ?? fileType, error);
    return {
      title: "解析失败",
      requirements: {},
      rawText: bufferToUtf8Preview(buffer),
      success: false,
      parserUsed: "minimax",
    };
  }
}

export async function parseAttachmentWithMainText(
  mainText: string,
  buffer: Buffer,
  fileType: "pdf" | "xlsx" | "docx",
  fileName?: string,
): Promise<ParseResult> {
  const attachment = await parseAttachment(buffer, fileType, fileName);
  const requirements = cleanRequirements(
    mergeHybridParseResults(mainText, attachment),
  );
  const hasMainGlobal = Boolean(
    requirements.deadline || requirements.numPositions != null,
  );

  return {
    ...attachment,
    requirements,
    success:
      attachment.success || hasMainGlobal || hasUsefulRequirements(requirements),
  };
}

/** Phase 1：从主公告正文提取全局 deadline、总招聘人数、总体要求 */
export function parseMainText(text: string): ParsedRequirements {
  const prose = cleanText(text);
  if (!prose) return {};

  // [NEW] 非招聘公告不提取全局 deadline / numPositions，避免考核公示等误解析
  if (isNonRecruitmentAnnouncement(prose)) {
    return {
      other: { nonRecruitmentAnnouncement: true },
    };
  }

  const requirements: ParsedRequirements = {};

  const deadline = extractGlobalDeadline(prose);
  if (deadline) {
    requirements.deadline = deadline;
    requirements.other = {
      ...(typeof requirements.other === "object" && requirements.other !== null
        ? (requirements.other as Record<string, unknown>)
        : {}),
      mainTextDeadline: deadline,
    };
  }

  const numPositions = extractGlobalNumPositions(prose);
  if (numPositions != null) {
    requirements.numPositions = numPositions;
    requirements.other = {
      ...(typeof requirements.other === "object" && requirements.other !== null
        ? (requirements.other as Record<string, unknown>)
        : {}),
      mainTextHeadcount: numPositions,
    };
  }

  const overall = extractOverallRequirements(prose);
  if (overall) requirements.notes = overall;

  const ageLimit = extractAgeLimitText(prose);
  if (ageLimit) requirements.ageLimit = ageLimit;

  const politicalStatus = extractPoliticalStatus(prose);
  if (politicalStatus) requirements.politicalStatus = politicalStatus;

  const education = extractEducationFromProse(prose);
  if (education) requirements.education = education;

  const gender = extractGenderText(prose);
  if (gender) requirements.gender = gender;

  const freshGraduateOnly = extractFreshGraduateOnly(prose);
  if (freshGraduateOnly != null) requirements.freshGraduateOnly = freshGraduateOnly;

  const labeledNotes = extractNotesText(prose);
  if (labeledNotes) {
    requirements.notes = requirements.notes
      ? `${requirements.notes}\n${labeledNotes}`
      : labeledNotes;
  }

  if (overall || labeledNotes) {
    requirements.other = {
      ...(typeof requirements.other === "object" && requirements.other !== null
        ? (requirements.other as Record<string, unknown>)
        : {}),
      overallRequirements: overall ?? labeledNotes ?? "",
    };
  }

  const university = enrichUniversityMainTextRequirements(prose);
  if (university.numPositions != null) {
    requirements.numPositions = university.numPositions;
  }
  if (university.education) {
    requirements.education = university.education;
  }
  if (university.notes) {
    requirements.notes = requirements.notes
      ? `${requirements.notes}\n${university.notes}`
      : university.notes;
  }
  if (university.other) {
    requirements.other = {
      ...(typeof requirements.other === "object" && requirements.other !== null
        ? (requirements.other as Record<string, unknown>)
        : {}),
      ...(university.other as Record<string, unknown>),
    };
  }

  return requirements;
}

export function mergeHybridParseResults(
  mainText: string,
  attachment: ParseResult,
): ParsedRequirements {
  const mainReq = parseMainText(mainText);
  return mergeMainTextAndTable(mainReq, attachment.requirements);
}

/**
 * ═══ 合并规则（业务优先级）═══
 *
 * deadline：
 *   1. 主正文 parseMainText 提取的可信日期（「报名时间…至…」取结束日）
 *   2. 主正文无日期时，才采用附件表格中的可信日期
 *   3. 表格「暂未公布 / 待定 / 详见公告」等占位符永不写入
 *
 * numPositions：
 *   1. 附件 structuredJobs 各行 slots / 计划数加总
 *   2. 附件 tableHeadcountSum 或 table.numPositions（若可信）
 *   3. 表格无明确人数时，fallback 主正文「招聘计划 N 名」等总人数
 */
export function mergeMainTextAndTable(
  main: ParsedRequirements,
  table: ParsedRequirements,
): ParsedRequirements {
  const tableOther = getRequirementsOther(table);
  const mainOther = getRequirementsOther(main);

  if (mainOther.nonRecruitmentAnnouncement) {
    const stripped: ParsedRequirements = { ...table };
    delete stripped.deadline;
    delete stripped.numPositions;
    stripped.other = {
      ...tableOther,
      nonRecruitmentAnnouncement: true,
    };
    return stripped;
  }

  const merged = mergeSupplementalRequirements(main, table);

  // ★ deadline：始终主正文优先
  merged.deadline = resolveMergedDeadline(main, table);

  // ★ numPositions：表格岗位人数优先，无表格才主正文
  merged.numPositions = resolveMergedNumPositions(main, table, tableOther);

  merged.other = {
    ...tableOther,
    ...mainOther,
    source: "main+table",
    mergeRules: {
      deadline: "main-first",
      numPositions: "table-rows-first",
    },
    ...(Array.isArray(tableOther.structuredJobs)
      ? { structuredJobs: tableOther.structuredJobs }
      : {}),
    ...(typeof tableOther.tableHeadcountSum === "number"
      ? { tableHeadcountSum: tableOther.tableHeadcountSum }
      : {}),
    ...(main.deadline && isTrustworthyDeadline(main.deadline)
      ? { mainTextDeadline: main.deadline }
      : {}),
    ...(main.numPositions != null && isTrustworthyNumPositions(main.numPositions)
      ? { mainTextHeadcount: main.numPositions }
      : {}),
    ...(merged.deadline && merged.deadline === normalizeDeadlineString(String(main.deadline ?? ""))
      ? { deadlineSource: "main" }
      : merged.deadline
        ? { deadlineSource: "table-fallback" }
        : {}),
    ...(typeof merged.numPositions === "number" &&
    (typeof tableOther.tableHeadcountSum === "number" ||
      hasStructuredJobSlots(tableOther))
      ? { numPositionsSource: "table" }
      : merged.numPositions != null
        ? { numPositionsSource: "main-fallback" }
        : {}),
  };

  return merged;
}

/** @deprecated 内部别名，统一走 mergeMainTextAndTable */
function mergeMainAndTableRequirements(
  main: ParsedRequirements,
  table: ParsedRequirements,
): ParsedRequirements {
  return mergeMainTextAndTable(main, table);
}

/** 合并除 deadline / numPositions 外的字段（表格明细 + 主正文补充） */
function mergeSupplementalRequirements(
  main: ParsedRequirements,
  table: ParsedRequirements,
): ParsedRequirements {
  const merged: ParsedRequirements = { ...table };

  if (main.ageLimit) merged.ageLimit = main.ageLimit;
  else if (table.ageLimit) merged.ageLimit = table.ageLimit;

  if (main.politicalStatus) merged.politicalStatus = main.politicalStatus;
  else if (table.politicalStatus) merged.politicalStatus = table.politicalStatus;

  if (main.education) {
    const mainEducation = normalizeEducationValue(main.education);
    if (mainEducation) merged.education = mainEducation;
  } else if (table.education) {
    const tableEducation = normalizeEducationValue(table.education);
    if (tableEducation) merged.education = tableEducation;
  }

  if (main.gender) merged.gender = main.gender;
  else if (table.gender) merged.gender = table.gender;

  if (main.freshGraduateOnly != null) {
    merged.freshGraduateOnly = main.freshGraduateOnly;
  } else if (table.freshGraduateOnly != null) {
    merged.freshGraduateOnly = table.freshGraduateOnly;
  }

  if (main.majorRequirements?.length) {
    merged.majorRequirements = main.majorRequirements;
  }
  if (table.majorRequirements?.length) {
    merged.majorRequirements = [
      ...new Set([...(merged.majorRequirements ?? []), ...table.majorRequirements]),
    ];
  }

  if (main.notes && table.notes && main.notes !== table.notes) {
    merged.notes = `${main.notes}\n${table.notes}`;
  } else if (main.notes) {
    merged.notes = main.notes;
  } else if (table.notes) {
    merged.notes = table.notes;
  }

  return merged;
}

function hasStructuredJobSlots(tableOther: Record<string, unknown>): boolean {
  const jobs = tableOther.structuredJobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return false;
  return (jobs as StructuredJob[]).some(
    (job) => normalizeNumPositions(job.slots ?? job.numPositions) != null,
  );
}

function sumStructuredJobSlots(tableOther: Record<string, unknown>): number | undefined {
  const jobs = tableOther.structuredJobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return undefined;

  let sum = 0;
  let hasAny = false;
  for (const raw of jobs) {
    const job = raw as StructuredJob;
    const slots = normalizeNumPositions(job.slots ?? job.numPositions);
    if (typeof slots === "number" && slots > 0) {
      sum += slots;
      hasAny = true;
    }
  }

  return hasAny && sum > 0 ? sum : undefined;
}

/** 从附件 parse 结果提取结构化岗位（优先于文本二次解析） */
export function extractStructuredJobsFromParseResults(
  parseResults: ParseResult[],
): StructuredJob[] {
  const all: StructuredJob[] = [];
  for (const result of parseResults) {
    all.push(...getStructuredJobsFromRequirements(result.requirements));
  }
  return dedupeStructuredJobs(all);
}

function dedupeStructuredJobs(jobs: StructuredJob[]): StructuredJob[] {
  const byKey = new Map<string, StructuredJob>();

  for (const job of jobs) {
    const key =
      job.postCode && job.postCode !== `job-${job.rowIndex}`
        ? `code:${job.postCode}`
        : `${job.sheetName}|${job.title}|${job.organization ?? ""}|${job.rowIndex}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, job);
      continue;
    }

    const score = (j: StructuredJob) =>
      (j.majorRequirement?.length ?? 0) + Object.keys(j.columns ?? {}).length;
    if (score(job) > score(existing)) byKey.set(key, job);
  }

  return [...byKey.values()];
}

/** 供 crawler 使用的 Hunan 结构化岗位映射 */
export function structuredJobToCrawlerItem(job: StructuredJob) {
  return {
    id: job.postCode,
    title: job.title,
    organization: job.organization,
    majorRequirement: job.majorRequirement ?? job.major,
    ageRequirement: job.ageLimit ?? job.age,
    education: job.education,
    otherRequirement: job.otherRequirement ?? job.notes,
    slots: typeof job.slots === "number" ? job.slots : undefined,
    text: [
      job.title,
      job.organization,
      job.majorRequirement,
      job.ageRequirement ?? job.age,
      job.education,
      job.otherRequirement,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

// ==================== 结构化表格解析 ====================

function parseStructuredJobsFromMatrix(
  rows: string[][],
  sheetName: string,
): StructuredJob[] {
  if (rows.length === 0) return [];

  const parsedJobs = parseJobsFromTabularRows(rows, {}) as Array<
    ParserRowJob & { _meta?: { rawCells?: string[]; rowIndex?: number; headers?: string[] } }
  >;

  return parsedJobs.map((parsed) =>
    mapParserJobToStructured(
      parsed,
      parsed._meta?.headers ?? [],
      parsed._meta?.rawCells ?? [],
      sheetName,
      parsed._meta?.rowIndex ?? 0,
    ),
  );
}

function parseStructuredJobsFromLines(
  lines: string[],
  sheetName: string,
): StructuredJob[] {
  const tabRows = collectTabularRowsFromLines(lines).map((row: string[]) =>
    row.map((cell: string) => cleanCellValue(cell)),
  );
  return parseStructuredJobsFromMatrix(tabRows, sheetName);
}

function mapParserJobToStructured(
  parsed: ParserRowJob,
  headers: string[],
  rawCells: string[],
  sheetName: string,
  rowIndex: number,
): StructuredJob {
  const columns: Record<string, string> = {};
  headers.forEach((header, i) => {
    const key = cleanCellValue(header);
    const value = rawCells[i] ?? "";
    if (key && value) columns[key] = value;
  });

  const majorRaw = parsed.majorRequirement ?? "";
  const major =
    majorRaw && majorRaw !== "—"
      ? formatMajorRequirement(majorRaw)
      : undefined;

  const educationRaw = parsed.education ?? "";
  const education =
    educationRaw && educationRaw !== "—"
      ? normalizeEducationValue(educationRaw)
      : undefined;

  const slots = typeof parsed.slots === "number" ? parsed.slots : undefined;

  return {
    sheetName,
    rowIndex,
    title: String(parsed.title ?? "岗位"),
    postName: String(parsed.title ?? "").split(" · ")[0] || undefined,
    postCode: parsed.id && /^\d+$/.test(String(parsed.id)) ? undefined : parsed.id,
    organization: parsed.organization || undefined,
    major,
    majorRequirement: major,
    age: parsed.ageRequirement && parsed.ageRequirement !== "—" ? parsed.ageRequirement : undefined,
    ageLimit: parsed.ageRequirement && parsed.ageRequirement !== "—" ? parsed.ageRequirement : undefined,
    numPositions: slots,
    slots,
    education: education || undefined,
    notes: parsed.otherRequirement || undefined,
    otherRequirement: parsed.otherRequirement || undefined,
    columns,
    rawCells,
  };
}

/** 结构化岗位数组 → 带列分隔符的清晰文本（供规则/LLM 阅读） */
function structuredJobsToTabText(jobs: StructuredJob[]): string {
  if (jobs.length === 0) return "";

  const header =
    "岗位\t单位\t专业要求\t学历\t年龄\t人数\t其他要求";
  const lines = jobs.map((job) =>
    [
      job.title,
      job.organization ?? "",
      job.majorRequirement ?? job.major ?? "",
      job.education ?? "",
      job.ageLimit ?? job.age ?? "",
      job.numPositions ?? job.slots ?? "",
      job.notes ?? job.otherRequirement ?? "",
    ]
      .map((v) => cleanCellValue(v))
      .join("\t"),
  );

  return [header, ...lines].join("\n");
}

/** 汇总结构化岗位 → ParsedRequirements（不含全局 deadline/总人数，防占位符污染） */
function aggregateStructuredJobsToRequirements(
  jobs: StructuredJob[],
): ParsedRequirements {
  if (jobs.length === 0) return {};

  const majorSet = new Set<string>();
  let tableHeadcountSum = 0;
  let hasSlotValues = false;
  let sampleAge: string | undefined;
  let sampleEducation: string | undefined;
  let sampleGender: string | undefined;
  let sampleNotes: string | undefined;

  for (const job of jobs) {
    const majorRaw = job.majorRequirement ?? job.major ?? "";
    if (majorRaw && majorRaw !== "—" && isLikelyMajorCell(majorRaw)) {
      if (isUnlimitedMajor(majorRaw)) {
        majorSet.add("不限专业");
      } else {
        extractMajorNamesFromCell(majorRaw).forEach((m) => majorSet.add(m));
      }
    }

    const slots = normalizeNumPositions(job.numPositions ?? job.slots);
    if (typeof slots === "number") {
      tableHeadcountSum += slots;
      hasSlotValues = true;
    }

    if (!sampleAge && job.ageLimit) sampleAge = job.ageLimit;
    if (!sampleEducation && job.education) sampleEducation = job.education;
    if (!sampleGender && job.gender) sampleGender = job.gender;
    if (!sampleNotes && job.notes) sampleNotes = job.notes;
  }

  const requirements: ParsedRequirements = {
    other: {
      structuredJobs: jobs as unknown as Prisma.InputJsonValue,
      jobRowCount: jobs.length,
      tableOnly: true,
    },
  };

  const majors = [...majorSet];
  if (majors.length > 0) requirements.majorRequirements = majors;
  if (sampleAge) requirements.ageLimit = sampleAge;
  if (sampleEducation) requirements.education = sampleEducation;
  if (sampleGender) requirements.gender = sampleGender;
  if (sampleNotes) requirements.notes = sampleNotes;

  if (hasSlotValues && tableHeadcountSum > 0) {
    requirements.numPositions = tableHeadcountSum;
    const other =
      typeof requirements.other === "object" && requirements.other !== null
        ? (requirements.other as Record<string, unknown>)
        : {};
    other.tableHeadcountSum = tableHeadcountSum;
    other.tableHeadcountNote =
      "各岗位计划数加总；无表格人数时 fallback 主正文「招聘计划N名」";
    requirements.other = other;
  }

  return requirements;
}

function getStructuredJobsFromRequirements(
  requirements: ParsedRequirements,
): StructuredJob[] {
  const other = requirements.other;
  if (!other || typeof other !== "object" || Array.isArray(other)) return [];
  const list = (other as Record<string, unknown>).structuredJobs;
  if (!Array.isArray(list)) return [];
  return list as StructuredJob[];
}

// ==================== 规则解析入口 ====================

async function parseWithRules(
  buffer: Buffer,
  fileType: "pdf" | "xlsx" | "docx",
): Promise<ParseResult> {
  if (fileType === "xlsx") return parseXLSX(buffer);
  if (fileType === "pdf") return parsePDF(buffer);
  if (fileType === "docx") return parseDOCX(buffer);

  return {
    title: "未知格式",
    requirements: {},
    rawText: "",
    success: false,
    parserUsed: "rule",
  };
}

async function parseXLSX(buffer: Buffer): Promise<ParseResult> {
  if (!isExcelBuffer(buffer) || isPlainUtf8TextBuffer(buffer)) {
    const text = decodeBufferAsUtf8(buffer);
    const jobs = parseStructuredJobsFromLines(text.split(/\r?\n/u), "utf8-text");
    const tableReq = aggregateStructuredJobsToRequirements(jobs);
    const structuredText = structuredJobsToTabText(jobs);
    const rawText = structuredText ? `${text}\n\n${structuredText}` : text;
    return buildRuleResult(rawText, tableReq, "岗位表");
  }

  try {
    const structuredJobs = await parseTableToStructuredJobs(buffer);
    const tableRequirements = aggregateStructuredJobsToRequirements(structuredJobs);
    const structuredText = structuredJobsToTabText(structuredJobs);

    const workbook = readXlsxWorkbook(buffer);
    const parts: string[] = [];
    let totalRows = 0;
    let totalCols = 0;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const stats: WorksheetStats = { totalRows: 0, collectedRows: 0, colCount: 0 };
      const sheetText = worksheetToPlainText(sheet, stats);
      totalRows += stats.totalRows;
      totalCols = Math.max(totalCols, stats.colCount);

      console.log(
        `[Parse] XLSX 工作表「${sheetName}」${stats.totalRows} 行 × ${stats.colCount} 列，采集 ${stats.collectedRows} 行非空数据`,
      );

      if (sheetText) {
        parts.push(
          `--- 工作表: ${sheetName} (${stats.totalRows}行×${stats.colCount}列) ---\n${sheetText}`,
        );
      }
    }

    console.log(
      `[Parse] XLSX 合计 ${workbook.SheetNames.length} 个工作表，${totalRows} 行，最大 ${totalCols} 列，结构化岗位 ${structuredJobs.length} 条`,
    );

  if (structuredText) {
      parts.push(
        `--- 结构化岗位表 (${structuredJobs.length} 条) ---\n${structuredText}`,
      );
    }

    const rawText = parts.join("\n\n");

    if (looksLikeGarbledText(rawText)) {
      console.warn("[Parse] XLSX 解析结果疑似乱码，回退 UTF-8 纯文本");
      return buildRuleResult(decodeBufferAsUtf8(buffer), {}, "岗位表");
    }

    return buildRuleResult(rawText, tableRequirements, "岗位表");
  } catch (error) {
    console.warn("[Parse] XLSX.read 失败，回退 UTF-8 纯文本", error);
    const text = decodeBufferAsUtf8(buffer);
    return buildRuleResult(text, {}, "岗位表");
  }
}

async function parsePDF(buffer: Buffer): Promise<ParseResult> {
  if (!isPdfBuffer(buffer)) {
    return buildRuleResult(decodeBufferAsUtf8(buffer), {}, "PDF 岗位");
  }
  const text = await extractPdfText(buffer);
  return buildRuleResult(text, {}, "PDF 岗位");
}

async function parseDOCX(buffer: Buffer): Promise<ParseResult> {
  if (!isZipBuffer(buffer)) {
    return buildRuleResult(decodeBufferAsUtf8(buffer), {}, "Word 岗位");
  }
  const result = await mammoth.extractRawText({ buffer });
  const text = decodeBufferAsUtf8(String(result?.value ?? ""));
  return buildRuleResult(text, {}, "Word 岗位");
}

function buildRuleResult(
  rawText: string,
  tableRequirements: ParsedRequirements,
  fallbackTitle: string,
): ParseResult {
  const cleanedText = cleanText(rawText);
  const requirements = extractRequirementsFromText(cleanedText, tableRequirements);

  const title = extractTitleFromText(cleanedText) || fallbackTitle;
  const success =
    cleanedText.length >= MIN_RULE_TEXT_LENGTH &&
    (hasUsefulRequirements(requirements) || cleanedText.length >= MIN_RAW_TEXT_LENGTH);

  return {
    title,
    requirements,
    rawText: cleanedText,
    success,
    parserUsed: "rule",
  };
}

function finalizeResult(result: ParseResult): ParseResult {
  const rawText = cleanText(result.rawText);
  const title =
    cleanTitle(result.title) ||
    extractTitleFromText(rawText) ||
    result.title ||
    "未命名公告";

  const requirements = cleanRequirements(result.requirements);

  const qualityOk =
    rawText.length >= MIN_RULE_TEXT_LENGTH &&
    (hasUsefulRequirements(requirements) || rawText.length >= MIN_RAW_TEXT_LENGTH);

  return {
    ...result,
    title,
    requirements,
    rawText,
    success:
      qualityOk ||
      (result.success && rawText.length > 0 && !looksLikeGarbledText(rawText)),
  };
}

// ==================== 两阶段混合提取 + 智能合并 ====================

function splitHybridText(text: string): { mainText: string; tableText: string } {
  const lines = text.split(/\r?\n/u);
  const mainLines: string[] = [];
  const tableLines: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^---+\s*(?:工作表:|结构化岗位表)/u.test(trimmed)) {
      inTable = true;
      continue;
    }

    const tabCount = (line.match(/\t/g) || []).length;
    const looksLikeTableRow =
      tabCount >= 2 ||
      /^\d+\t/u.test(trimmed) ||
      (inTable && tabCount >= 1 && /[\u4e00-\u9fa5]/u.test(trimmed));

    if (looksLikeTableRow) {
      inTable = true;
      tableLines.push(line);
    } else if (!inTable) {
      mainLines.push(line);
    } else {
      mainLines.push(line);
    }
  }

  return {
    mainText: mainLines.join("\n"),
    tableText: tableLines.join("\n"),
  };
}

function isPlaceholderField(value: unknown): boolean {
  const str = cleanText(String(value ?? ""));
  if (!str) return true;
  return PLACEHOLDER_FIELD.test(str);
}

function isTrustworthyDeadline(value: unknown): boolean {
  if (isPlaceholderField(value)) return false;
  return Boolean(normalizeDeadlineString(String(value)));
}

function isTrustworthyNumPositions(value: unknown): boolean {
  if (isPlaceholderField(value)) return false;
  return normalizeNumPositions(value) != null;
}

/**
 * 两阶段提取 + 合并（deadline 主正文优先，numPositions 表格各行优先）
 */
function extractRequirementsFromText(
  text: string,
  preParsedTable: ParsedRequirements = {},
): ParsedRequirements {
  const { mainText, tableText } = splitHybridText(text);

  const mainReq = parseMainText(mainText || (tableText ? "" : text));

  let tableReq: ParsedRequirements = { ...preParsedTable };

  const existingJobs = getStructuredJobsFromRequirements(preParsedTable);
  if (existingJobs.length === 0 && tableText.trim()) {
    const lines = tableText.split(/\r?\n/u);
    const jobs = parseStructuredJobsFromLines(lines, "embedded");
    if (jobs.length > 0) {
      tableReq = mergeMainAndTableRequirements(
        tableReq,
        aggregateStructuredJobsToRequirements(jobs),
      );
    }
  }

  if (!mainText && !tableText) {
    return mergeMainAndTableRequirements(parseMainText(text), tableReq);
  }

  return mergeMainAndTableRequirements(mainReq, tableReq);
}

function getRequirementsOther(
  requirements: ParsedRequirements,
): Record<string, unknown> {
  const other = requirements.other;
  if (other && typeof other === "object" && !Array.isArray(other)) {
    return other as Record<string, unknown>;
  }
  return {};
}

/** deadline：始终优先主正文；表格占位符（暂未公布等）永不采用 */
function resolveMergedDeadline(
  main: ParsedRequirements,
  table: ParsedRequirements,
): string | undefined {
  if (isTrustworthyDeadline(main.deadline)) {
    return normalizeDeadlineString(String(main.deadline)) ?? main.deadline;
  }

  // 主正文无日期时才考虑表格；占位符已在 isTrustworthyDeadline 中过滤
  if (isTrustworthyDeadline(table.deadline)) {
    return normalizeDeadlineString(String(table.deadline)) ?? table.deadline;
  }

  return undefined;
}

/** numPositions：表格各行 slots 加总优先；无表格人数时 fallback 主正文总人数 */
function resolveMergedNumPositions(
  main: ParsedRequirements,
  table: ParsedRequirements,
  tableOther: Record<string, unknown>,
): number | string | undefined {
  const tableSum = tableOther.tableHeadcountSum;
  if (typeof tableSum === "number" && tableSum > 0) {
    return tableSum;
  }

  const structuredSum = sumStructuredJobSlots(tableOther);
  if (structuredSum != null) {
    return structuredSum;
  }

  if (isTrustworthyNumPositions(table.numPositions)) {
    return normalizeNumPositions(table.numPositions);
  }

  if (isTrustworthyNumPositions(main.numPositions)) {
    return normalizeNumPositions(main.numPositions);
  }

  return undefined;
}

// ==================== MiniMax fallback ====================

async function parseWithMiniMax(
  buffer: Buffer,
  fileType: "pdf" | "xlsx" | "docx",
  fileName?: string,
): Promise<ParseResult> {
  const rawText = await extractPlainText(buffer, fileType);
  const cleanedText = cleanText(rawText);
  const llmPayload = await callStructuredExtractionLlm(
    cleanedText.slice(0, 12000),
    fileName ?? fileType,
  );

  const requirements = normalizeRequirements(llmPayload?.requirements, cleanedText);
  const title =
    cleanTitle(pickString(llmPayload?.title) ?? "") ||
    extractTitleFromText(cleanedText) ||
    "未命名公告";

  return {
    title,
    requirements,
    rawText: cleanedText,
    success: Boolean(
      cleanedText.length > 0 ||
        title !== "未命名公告" ||
        hasUsefulRequirements(requirements),
    ),
    parserUsed: "minimax",
  };
}

function normalizeRequirements(
  input: unknown,
  sourceText?: string,
): ParsedRequirements {
  if (!input || typeof input !== "object") {
    if (sourceText) {
      return cleanRequirements(extractRequirementsFromText(sourceText));
    }
    return {};
  }

  const raw = input as Record<string, unknown>;
  const llmTableReq: ParsedRequirements = {};

  const ageLimit = pickString(raw.ageLimit);
  if (ageLimit) llmTableReq.ageLimit = ageLimit;

  const politicalStatus = pickString(raw.politicalStatus);
  if (politicalStatus) llmTableReq.politicalStatus = politicalStatus;

  if (Array.isArray(raw.majorRequirements)) {
    llmTableReq.majorRequirements = raw.majorRequirements
      .map((item) => pickString(item))
      .filter((item): item is string => Boolean(item));
  } else {
    const majorText = pickString(raw.majorRequirements ?? raw.majors ?? raw.major);
    if (majorText) {
      llmTableReq.majorRequirements = extractMajorNamesFromCell(majorText);
    }
  }

  const education = pickString(raw.education);
  if (education) llmTableReq.education = education;

  const gender = pickString(raw.gender);
  if (gender) llmTableReq.gender = gender;

  const numPositions = normalizeNumPositions(raw.numPositions);
  if (numPositions != null && !isPlaceholderField(numPositions)) {
    llmTableReq.numPositions = numPositions;
  }

  const normalizedDeadline = normalizeDeadline(raw.deadline);
  if (normalizedDeadline && !isPlaceholderField(normalizedDeadline)) {
    llmTableReq.deadline = normalizedDeadline;
  }

  if (typeof raw.freshGraduateOnly === "boolean") {
    llmTableReq.freshGraduateOnly = raw.freshGraduateOnly;
  } else {
    const freshText = pickString(raw.freshGraduateOnly);
    if (freshText != null) {
      if (/^(true|是|1|yes)$/iu.test(freshText) || /限应届/u.test(freshText)) {
        llmTableReq.freshGraduateOnly = true;
      } else if (/^(false|否|0|no)$/iu.test(freshText) || /不限应届|非应届/u.test(freshText)) {
        llmTableReq.freshGraduateOnly = false;
      }
    }
  }

  const notes = pickString(raw.notes);
  if (notes) llmTableReq.notes = notes;

  if (raw.other && typeof raw.other === "object") {
    llmTableReq.other = raw.other as Prisma.InputJsonValue;
  }

  let mainReq: ParsedRequirements = {};
  let embeddedTableReq: ParsedRequirements = {};

  if (sourceText) {
    const prose = cleanText(sourceText);
    const isNonRecruitment = isNonRecruitmentAnnouncement(prose);

    const parsed = extractRequirementsFromText(sourceText);
    const { mainText } = splitHybridText(sourceText);
    mainReq = parseMainText(mainText || sourceText);

    embeddedTableReq = { ...parsed };
    delete embeddedTableReq.deadline;

    // [NEW] 非招聘公告：丢弃 LLM / 表格侧的全局人数与截止日期
    if (isNonRecruitment) {
      delete llmTableReq.deadline;
      delete llmTableReq.numPositions;
      delete embeddedTableReq.deadline;
      delete embeddedTableReq.numPositions;
    }
  }

  const tableMerged = mergeMainTextAndTable(embeddedTableReq, llmTableReq);
  const merged = mergeMainTextAndTable(mainReq, tableMerged);

  return cleanRequirements(enforceMainTextPriority(merged, mainReq, tableMerged));
}

// ==================== 二进制格式检测 ====================

function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function isExcelBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (isZipBuffer(buffer)) return true;
  return (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  );
}

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isPlainUtf8TextBuffer(buffer: Buffer): boolean {
  if (isExcelBuffer(buffer) || isPdfBuffer(buffer)) {
    const head = buffer.subarray(0, Math.min(buffer.length, 64)).toString("utf8");
    if (/[\u4e00-\u9fa5]/.test(head) && !head.includes("PK\u0003")) {
      return true;
    }
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  const utf8 = sample.toString("utf8");
  if (utf8.includes("\uFFFD")) return false;

  const readable = (utf8.match(/[\u4e00-\u9fa5A-Za-z0-9 \t\r\n，。；：、（）()【】[\]《》/\\.-]/g) || [])
    .length;
  const ratio = readable / Math.max(utf8.length, 1);

  return ratio > 0.92 && /[\u4e00-\u9fa5]/.test(utf8);
}

function looksLikeGarbledText(text: string): boolean {
  if (!text) return true;

  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const mojibake = (text.match(/[ÃÂÐÞæœåÑÒÓÔÕÖ×ØÙÚÛÜÝþÿ]{2,}/g) || []).length;
  const vietnameseLike = (text.match(/\b[nèh|kâ|nánh|môn|tuổi]\b/gi) || []).length;

  if (text.length > 40 && cjk === 0 && (mojibake > 0 || vietnameseLike > 2)) {
    return true;
  }

  if (mojibake > 0 && cjk < Math.max(3, text.length * 0.05)) {
    return true;
  }

  return false;
}

// ==================== UTF-8 与文本清洗（保持不变） ====================

function decodeBufferAsUtf8(buffer: Buffer): string {
  return toUtf8String(buffer.toString("utf8"));
}

function toUtf8String(input: string): string {
  return input
    .normalize("NFC")
    .replace(/^\uFEFF/u, "")
    .replace(/\uFEFF/gu, "")
    .replace(/\u0000/gu, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "");
}

function bufferToUtf8Preview(buffer: Buffer, maxLen = 500): string {
  return cleanText(decodeBufferAsUtf8(buffer).slice(0, maxLen));
}

function cleanCellValue(value: unknown): string {
  if (value == null) return "";
  return toUtf8String(String(value)).replace(/^"|"$/g, "").trim();
}

function cleanText(text: string): string {
  let out = toUtf8String(text);

  out = out
    .replace(/---+\s*发现附件透视文本:[^-]*---+/giu, "")
    .replace(/---+\s*工作表:\s*[^\n-]+---+/giu, "")
    .replace(/^---+\s*工作表:\s*.+$/gimu, "")
    .replace(/工作表:\s*Sheet\d+/giu, "")
    .replace(/^Sheet\d+$/gimu, "")
    .replace(/^[-—–]{2,}\s*$/gmu, "")
    .replace(/^---+\s*/gmu, "")
    .replace(/\s*---+\s*$/gmu, "");

  out = out
    .replace(/\.[\w-]+\s*\{[^}]*\}/gu, "")
    .replace(/var\s+\w+\s*=\s*document\.[^;]+;/gu, "")
    .replace(/<[^>]+>/gu, " ");

  out = out.replace(/\u3000/gu, " ");
  out = out.replace(/[ \t]+\n/gu, "\n");
  out = out.replace(/\n[ \t]+/gu, "\n");
  out = out.replace(/[ \t]{2,}/gu, " ");

  out = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[-—–]{2,}$/u.test(line))
    .join("\n");

  out = out.replace(/\n{3,}/gu, "\n\n");
  return out.trim();
}

function cleanTitle(title: string): string {
  const cleaned = cleanText(stripWebScrapJunk(title));
  if (!cleaned || isGarbledText(cleaned)) return "";

  const invalid =
    /^工作表:/iu.test(cleaned) ||
    /^Sheet\d+$/iu.test(cleaned) ||
    /^[-—–]{2,}$/u.test(cleaned) ||
    cleaned.length < 2;

  return invalid ? "" : cleaned.slice(0, 120);
}

function cleanRequirements(requirements: ParsedRequirements): ParsedRequirements {
  const cleaned: ParsedRequirements = {};

  const ageLimit = cleanText(requirements.ageLimit ?? "");
  if (ageLimit) cleaned.ageLimit = ageLimit;

  const politicalStatus = cleanText(requirements.politicalStatus ?? "");
  if (politicalStatus) cleaned.politicalStatus = politicalStatus;

  if (Array.isArray(requirements.majorRequirements)) {
    const majors = requirements.majorRequirements
      .map((item) => cleanText(String(item)))
      .filter(Boolean);
    if (majors.length > 0) cleaned.majorRequirements = [...new Set(majors)];
  }

  const education = normalizeEducationValue(requirements.education ?? "");
  if (education) cleaned.education = education;

  const gender = cleanText(requirements.gender ?? "");
  if (gender) cleaned.gender = gender;

  if (requirements.numPositions != null && requirements.numPositions !== "") {
    const normalized = normalizeNumPositions(requirements.numPositions);
    if (normalized != null) cleaned.numPositions = normalized;
  }

  const deadline = normalizeDeadlineString(requirements.deadline ?? "");
  if (deadline) cleaned.deadline = deadline;

  if (requirements.freshGraduateOnly === true || requirements.freshGraduateOnly === false) {
    cleaned.freshGraduateOnly = requirements.freshGraduateOnly;
  }

  const notes = cleanText(requirements.notes ?? "");
  if (notes) cleaned.notes = notes;

  if (requirements.other && typeof requirements.other === "object") {
    cleaned.other = requirements.other;
  }

  return cleaned;
}

// ==================== XLSX / PDF / DOCX 提取 ====================

function readXlsxWorkbook(buffer: Buffer): XLSX.WorkBook {
  const u8array = new Uint8Array(buffer);
  return XLSX.read(u8array, { type: "array" });
}

function getWorksheetExpandedRange(worksheet: XLSX.WorkSheet): string | undefined {
  if (!worksheet) return undefined;

  let maxRow = 0;
  let maxCol = 0;

  for (const key of Object.keys(worksheet)) {
    if (key.startsWith("!")) continue;
    const addr = XLSX.utils.decode_cell(key);
    maxRow = Math.max(maxRow, addr.r);
    maxCol = Math.max(maxCol, addr.c);
  }

  const merges = worksheet["!merges"];
  if (Array.isArray(merges)) {
    for (const merge of merges) {
      maxRow = Math.max(maxRow, merge.e.r);
      maxCol = Math.max(maxCol, merge.e.c);
    }
  }

  if (worksheet["!ref"]) {
    const decoded = XLSX.utils.decode_range(worksheet["!ref"]);
    maxRow = Math.max(maxRow, decoded.e.r);
    maxCol = Math.max(maxCol, decoded.e.c);
  }

  if (maxRow === 0 && maxCol === 0 && !worksheet["!ref"]) return undefined;

  return XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRow, c: maxCol },
  });
}

/** 完整读取工作表所有行/列；sheet_to_json 行数不足时逐格回退，避免丢行 */
function readAllWorksheetRows(worksheet: XLSX.WorkSheet): (string | number)[][] {
  const range = getWorksheetExpandedRange(worksheet);
  if (!range) return [];

  const decoded = XLSX.utils.decode_range(range);
  const expectedRows = decoded.e.r + 1;
  const expectedCols = decoded.e.c + 1;

  const readCellGrid = (): (string | number)[][] => {
    const rows: (string | number)[][] = [];
    for (let r = 0; r <= decoded.e.r; r += 1) {
      const row: (string | number)[] = [];
      for (let c = 0; c <= decoded.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[addr];
        row.push(cell ? cleanCellValue(XLSX.utils.format_cell(cell)) : "");
      }
      rows.push(row);
    }
    return rows;
  };

  const fromJson = XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
    range,
  });

  const grid = readCellGrid();

  if (fromJson.length >= expectedRows && fromJson.length >= grid.length) {
    return fromJson.map((row, ri) => {
      const padded = [...row];
      while (padded.length < expectedCols) padded.push("");
      return padded.map((cell) => cleanCellValue(cell));
    });
  }

  return grid;
}

function worksheetToPlainText(
  worksheet: XLSX.WorkSheet,
  stats?: WorksheetStats,
): string {
  const rows = readAllWorksheetRows(worksheet);
  if (rows.length === 0) {
    if (stats) {
      stats.totalRows = 0;
      stats.collectedRows = 0;
      stats.colCount = 0;
    }
    return "";
  }

  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const lines = rows.map((row) => {
    const padded = [...row];
    while (padded.length < colCount) padded.push("");
    return padded.map((cell) => cleanCellValue(cell)).join("\t").replace(/\t+$/u, "");
  });

  if (stats) {
    stats.totalRows = rows.length;
    stats.colCount = colCount;
    stats.collectedRows = lines.filter((line) => line.trim().length > 0).length;
  }

  return lines.join("\n");
}

async function extractPlainText(
  buffer: Buffer,
  fileType: "pdf" | "xlsx" | "docx",
): Promise<string> {
  if (fileType === "xlsx") {
    if (!isExcelBuffer(buffer) || isPlainUtf8TextBuffer(buffer)) {
      return cleanText(decodeBufferAsUtf8(buffer));
    }

    try {
      const structuredJobs = await parseTableToStructuredJobs(buffer);
      const structuredText = structuredJobsToTabText(structuredJobs);

      const workbook = readXlsxWorkbook(buffer);
      const merged = workbook.SheetNames.map((name) =>
        worksheetToPlainText(workbook.Sheets[name]),
      )
        .filter(Boolean)
        .join("\n");

      const combined = [merged, structuredText].filter(Boolean).join("\n\n");
      if (looksLikeGarbledText(combined)) {
        return cleanText(decodeBufferAsUtf8(buffer));
      }
      return cleanText(combined);
    } catch {
      return cleanText(decodeBufferAsUtf8(buffer));
    }
  }

  if (fileType === "pdf") {
    if (!isPdfBuffer(buffer)) return cleanText(decodeBufferAsUtf8(buffer));
    return cleanText(await extractPdfText(buffer));
  }

  if (fileType === "docx") {
    if (!isZipBuffer(buffer)) return cleanText(decodeBufferAsUtf8(buffer));
    const result = await mammoth.extractRawText({ buffer });
    return cleanText(decodeBufferAsUtf8(String(result?.value ?? "")));
  }

  return "";
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  let text = "";

  if (typeof pdfParse === "function") {
    const pdfData = await pdfParse(buffer);
    text = String(pdfData?.text ?? "");
  } else {
    const Parser = pdfParse.PDFParse;
    if (typeof Parser !== "function") {
      throw new Error("pdf-parse 未导出可用的解析接口");
    }

    const parser = new Parser({ data: buffer });
    try {
      const result = await parser.getText();
      text = String(result?.text ?? "");
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    }
  }

  return decodeBufferAsUtf8(text);
}

// ==================== 字段提取（全局 / 表格共用） ====================

/** [NEW] 判断是否为非招聘公告（通知、考核公示等） */
function isNonRecruitmentAnnouncement(text: string): boolean {
  if (/面向(?:全校|校内)|编制内|管理辅助岗位|任职基本(?:条件|资格)|应聘条件/u.test(text)) {
    return false;
  }

  const head = extractAnnouncementHead(text);
  if (!head) return false;

  if (RECRUITMENT_POSITIVE_PATTERNS.some((pattern) => pattern.test(head))) {
    return false;
  }

  return NON_RECRUITMENT_PATTERNS.some((pattern) => pattern.test(head));
}

/** 取标题/文首片段用于招聘/非招聘分类 */
function extractAnnouncementHead(text: string): string {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => cleanText(line))
    .filter((line) => line.length >= 4);

  const titleLike =
    lines.find(
      (line) =>
        line.length <= 120 &&
        /(?:关于|招聘|考核|公示|通知|公布|审查|合格|引进|启事|名单)/u.test(line),
    ) ?? lines[0] ?? "";

  return `${titleLike}\n${text.slice(0, 600)}`.slice(0, 800);
}

/** [NEW] normalizeRequirements 最终合并：主正文 deadline / numPositions 强制优先 */
function enforceMainTextPriority(
  merged: ParsedRequirements,
  main: ParsedRequirements,
  table: ParsedRequirements,
): ParsedRequirements {
  const mainOther = getRequirementsOther(main);
  if (mainOther.nonRecruitmentAnnouncement) {
    const out = { ...merged };
    delete out.deadline;
    delete out.numPositions;
    return out;
  }

  const out = { ...merged };
  const tableOther = getRequirementsOther(table);

  if (isTrustworthyDeadline(main.deadline)) {
    out.deadline =
      normalizeDeadlineString(String(main.deadline)) ?? String(main.deadline);
  }

  const hasTableHeadcount =
    (typeof tableOther.tableHeadcountSum === "number" && tableOther.tableHeadcountSum > 0) ||
    (Array.isArray(tableOther.structuredJobs) &&
      (tableOther.structuredJobs as StructuredJob[]).some(
        (job) => normalizeNumPositions(job.slots ?? job.numPositions) != null,
      )) ||
    isTrustworthyNumPositions(table.numPositions);

  if (!hasTableHeadcount && isTrustworthyNumPositions(main.numPositions)) {
    out.numPositions = normalizeNumPositions(main.numPositions);
  }

  return out;
}

function extractGlobalNumPositions(text: string): number | string | undefined {
  const patterns = [
    /(?:本次|此次)?招聘计划\s*(\d+)\s*名/u,
    /(?:本次|此次)?计划\s*(\d+)\s*名/u,
    /(?:本次|此次)?招聘\s*(\d+)\s*名/u,
    /名额\s*(\d+)(?:\s*名|\s*人|$)/u,
    /(?:本次|此次)?(?:拟)?(?:公开)?招聘(?:工作人员|人员|专技人员)?\s*(\d+)\s*名/u,
    /(?:本次|此次)?招聘(?:计划)?\s*(\d+)\s*名/u,
    /拟(?:公开)?招聘\s*(\d+)\s*(?:名|人)/u,
    /计划招聘\s*(\d+)\s*(?:名|人)/u,
    /共招聘\s*(\d+)\s*(?:名|人)/u,
    /招聘\s*(\d+)\s*名/u,
    /计划\s*(\d+)\s*名/u,
    /(?:拟)?招聘\s*(\d+)\s*名/u,
    /(?:共|合计|总计)\s*(\d+)\s*(?:名|人)/u,
    /(?:招聘|招录)(?:总)?人数\s*[:：]?\s*(\d+)\s*(?:名|人)?/u,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 9999) return parsed;
    }
  }

  return extractNumPositions(text);
}

function extractGlobalDeadline(text: string): string | undefined {
  // [NEW] 报名时间 … 至 …（宽松，优先取结束日）
  const signupToPatterns = [
    /(?:网上)?报名时间[\s\S]{0,1500}?[至到]\s*(\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}时(?:\d{1,2}分)?(?:\d{1,2}秒)?|\s*24时|\s*24:00)?)/u,
    /报名(?:时间|期限)\s*[:：]?\s*[\s\S]{0,1200}?[至到]\s*(\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}时(?:\d{1,2}分)?|\s*24时|\s*24:00)?)/u,
    /(?:网上)?报名时间\s*[:：]?\s*[\s\S]{0,1200}?[至到]\s*(\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}时)?)/u,
  ];

  for (const pattern of signupToPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const normalized = normalizeDeadlineString(match[1]);
      if (normalized) return normalized;
    }
  }

  // [NEW] 报名截止 + 日期
  const signupCutoffPatterns = [
    /报名截止(?:时间|日期)?[\s\S]{0,300}?(\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}时(?:\d{1,2}分)?|\s*24时|\s*24:00)?)/u,
    /(?:截止|报名)(?:时间|日期)?[\s\S]{0,200}?(\d{4}年\d{1,2}月\d{1,2}日(?:\d{1,2}时)?)/u,
  ];

  for (const pattern of signupCutoffPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const normalized = normalizeDeadlineString(match[1]);
      if (normalized) return normalized;
    }
  }

  const signupRangePatterns = [
    /(?:网上)?报名时间[\s\S]{0,600}?[至到]\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})/u,
  ];

  for (const pattern of signupRangePatterns) {
    const match = text.match(pattern);
    if (match?.[1] && match[2] && match[3]) {
      return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    }
  }

  const isoSignupRange = text.match(
    /(?:网上)?报名时间[\s\S]{0,600}?[至到]\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})/u,
  );
  if (isoSignupRange) {
    return `${isoSignupRange[1]}-${isoSignupRange[2].padStart(2, "0")}-${isoSignupRange[3].padStart(2, "0")}`;
  }

  const afterZhi = text.match(
    /[至到]\s*(\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}时(?:\d{1,2}分)?|\s*24时|\s*24:00)?)/u,
  );
  if (afterZhi?.[1]) {
    const normalized = normalizeDeadlineString(afterZhi[1]);
    if (normalized) return normalized;
  }

  return extractDeadlineText(text);
}

function extractAgeLimitText(text: string): string | undefined {
  for (const pattern of AGE_LIMIT_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) return cleanText(match[0]);
  }
  return undefined;
}

function extractPoliticalStatus(text: string): string | undefined {
  if (PARTY_REQUIRED_KEYWORDS.some((kw) => text.includes(kw))) {
    return "中共党员";
  }
  if (/不限.*党员|党员.*不限|不作党员要求/u.test(text)) {
    return "不限";
  }
  return undefined;
}

function extractNotesText(text: string): string | undefined {
  const match =
    text.match(/其他要求[:：]?\s*([^\n\r]{4,500})/u) ??
    text.match(/备注[:：]?\s*([^\n\r]{4,500})/u);
  const notes = match?.[1] ? cleanText(match[1]) : "";
  return notes || undefined;
}

function extractOverallRequirements(text: string): string | undefined {
  const chunks: string[] = [];

  const patterns = [
    /(?:应聘人员|报考者|报名人员)须(?:同时)?具备以下条件[:：]([\s\S]{20,800}?)(?:\n{2,}|$)/u,
    /(?:基本条件|总体要求|应聘条件)[:：]([\s\S]{20,600}?)(?:\n{2,}|$)/u,
    /(?:本次|此次)招聘(?:岗位|计划)[^\n。；;]{4,200}[。；;]/gu,
  ];

  for (const pattern of patterns) {
    if (pattern.global) {
      for (const m of text.matchAll(pattern)) {
        const chunk = cleanText(m[0] ?? m[1] ?? "");
        if (chunk.length >= 8) chunks.push(chunk);
      }
    } else {
      const m = text.match(pattern);
      const chunk = cleanText(m?.[1] ?? m?.[0] ?? "");
      if (chunk.length >= 8) chunks.push(chunk);
    }
  }

  const unique = [...new Set(chunks)];
  return unique.length > 0 ? unique.join("\n") : undefined;
}

function extractGenderText(text: string): string | undefined {
  const labeled = text.match(/性别要求[:：]?\s*([^\n\r]{2,20})/u)?.[1];
  if (labeled) {
    const cleaned = cleanText(labeled);
    if (cleaned) return cleaned;
  }

  if (/限男性|仅限男|男性/u.test(text)) return "限男性";
  if (/限女性|仅限女|女性/u.test(text)) return "限女性";
  if (/性别不限|不限性别/u.test(text)) return "不限";
  return undefined;
}

function extractNumPositions(text: string): number | string | undefined {
  const inlinePatterns = [
    /招聘计划\s*(\d+)\s*名/u,
    /计划\s*(\d+)\s*名/u,
    /(?:拟)?招聘\s*(\d+)\s*名/u,
    /名额\s*(\d+)/u,
    /岗位\s*(\d+)\s*个/u,
  ];

  for (const pattern of inlinePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 999) return parsed;
    }
  }

  const labeledPatterns = [
    /(?:招聘|计划(?:招录|招聘)|拟招|招录)(?:人数|计划数|名额|岗位数)?[:：]?\s*(\d+|若干)/u,
    /(?:招聘人数|计划招录|招录人数|岗位数|名额|计划数)[:：]?\s*(\d+|若干)/u,
    /(?:人数|名额|岗位数)[:：]?\s*(\d+|若干)/u,
    /(?:共|合计|总计)\s*(\d+)\s*(?:名|人|个(?:岗位|名额)?)/u,
  ];

  for (const pattern of labeledPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const normalized = normalizeNumPositions(match[1]);
      if (normalized != null) return normalized;
    }
  }

  const inline = text.match(/(?:招聘|拟招|计划招聘|计划招录)\s*(\d+)\s*(?:名|人)/u);
  if (inline?.[1]) return Number.parseInt(inline[1], 10);

  if (/(?:招聘|招录|名额|岗位).*若干|若干(?:名|人|个)/u.test(text)) {
    return "若干";
  }

  return undefined;
}

function extractDeadlineEndDate(text: string): string | undefined {
  const str = cleanText(text);
  if (!str) return undefined;

  const cnRangeFull = str.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日(?:\d{1,2}时)?\s*[至到—\-~]\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:\d{1,2}时)?/u,
  );
  if (cnRangeFull) {
    return `${cnRangeFull[4]}-${cnRangeFull[5].padStart(2, "0")}-${cnRangeFull[6].padStart(2, "0")}`;
  }

  const cnRangeSameYear = str.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日(?:\d{1,2}时)?\s*[至到—\-~]\s*(\d{1,2})月(\d{1,2})日(?:\d{1,2}时)?/u,
  );
  if (cnRangeSameYear) {
    return `${cnRangeSameYear[1]}-${cnRangeSameYear[4].padStart(2, "0")}-${cnRangeSameYear[5].padStart(2, "0")}`;
  }

  const isoRange = str.match(
    /(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s*[至到—\-~]\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})/u,
  );
  if (isoRange) {
    return `${isoRange[4]}-${isoRange[5].padStart(2, "0")}-${isoRange[6].padStart(2, "0")}`;
  }

  const afterZhi = str.match(/[至到]\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:\d{1,2}时)?/u);
  if (afterZhi) {
    return `${afterZhi[1]}-${afterZhi[2].padStart(2, "0")}-${afterZhi[3].padStart(2, "0")}`;
  }

  const afterZhiIso = str.match(/[至到]\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})/u);
  if (afterZhiIso) {
    return `${afterZhiIso[1]}-${afterZhiIso[2].padStart(2, "0")}-${afterZhiIso[3].padStart(2, "0")}`;
  }

  return undefined;
}

function extractDeadlineText(text: string): string | undefined {
  const signupToEnd = text.match(
    /(?:网上)?报名时间\s*[:：]?\s*[\s\S]{0,800}?[至到]\s*(\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}时(?:\d{1,2}分)?|\s*24时|\s*24:00)?)/u,
  );
  if (signupToEnd?.[1]) {
    const normalized = normalizeDeadlineString(signupToEnd[1]);
    if (normalized) return normalized;
  }

  const signupToEndIso = text.match(
    /(?:网上)?报名时间[\s\S]{0,600}?[至到]\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})/u,
  );
  if (signupToEndIso) {
    return `${signupToEndIso[1]}-${signupToEndIso[2].padStart(2, "0")}-${signupToEndIso[3].padStart(2, "0")}`;
  }

  const signupCutoff = text.match(
    /报名截止[\s\S]{0,200}?(\d{4}年\d{1,2}月\d{1,2}日(?:\d{1,2}时)?)/u,
  );
  if (signupCutoff?.[1]) {
    const normalized = normalizeDeadlineString(signupCutoff[1]);
    if (normalized) return normalized;
  }

  const labeledPatterns = [
    /(?:报名(?:时间|期限)|报名截止|截止时间?)[:：]?\s*([^\n\r。；;]{4,200})/u,
  ];

  for (const pattern of labeledPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const segment = cleanText(match[1]);
      const endFromSegment = extractDeadlineEndDate(segment) ?? normalizeDeadlineString(segment);
      if (endFromSegment) return endFromSegment;
    }
  }

  const afterZhi = text.match(/[至到]\s*(\d{4}年\d{1,2}月\d{1,2}日(?:\d{1,2}时)?)/u);
  if (afterZhi?.[1]) {
    const normalized = normalizeDeadlineString(afterZhi[1]);
    if (normalized) return normalized;
  }

  const rangeEnd = extractDeadlineEndDate(text);
  if (rangeEnd) return rangeEnd;

  return undefined;
}

function extractFreshGraduateOnly(text: string): boolean | undefined {
  if (/限(?:应届|当年)毕业生|仅限应届|应届(?:生|毕业生)(?:报考|优先)|须为应届/u.test(text)) {
    return true;
  }
  if (/不限应届|非应届|社会(?:人员|在职)/u.test(text)) {
    return false;
  }
  return undefined;
}

function normalizeNumPositions(value: unknown): number | string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const str = cleanText(String(value));
  if (!str || isPlaceholderField(str)) return undefined;
  if (/若干/u.test(str)) return "若干";
  if (/年|月|日/u.test(str)) return undefined;

  const digits = str.match(/^(\d{1,3})$/u) ?? str.match(/(\d{1,3})(?:\s*(?:名|人|个))?$/u);
  if (digits?.[1]) {
    const parsed = Number.parseInt(digits[1], 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 999) return parsed;
  }

  return undefined;
}

function normalizeDeadlineString(value: string): string | undefined {
  const str = cleanText(value);
  if (!str || isPlaceholderField(str)) return undefined;

  const rangeEnd = extractDeadlineEndDate(str);
  if (rangeEnd) return rangeEnd;

  const cn = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:\d{1,2}时)?/u);
  if (cn) {
    return `${cn[1]}-${cn[2].padStart(2, "0")}-${cn[3].padStart(2, "0")}`;
  }

  const iso = str.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/u);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  return undefined;
}

function extractTitleFromText(text: string): string {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => cleanText(line))
    .filter(Boolean);

  for (const line of lines.slice(0, 40)) {
    if (
      /招聘|岗位|一览表|报名|辅导员|教师/u.test(line) &&
      line.length >= 4 &&
      line.length <= 80 &&
      !/^工作表:/iu.test(line) &&
      !/^Sheet\d+$/iu.test(line)
    ) {
      return line;
    }
  }

  const firstMeaningful = lines.find(
    (line) =>
      line.length >= 4 &&
      !/^Sheet\d+$/iu.test(line) &&
      !/^工作表:/iu.test(line) &&
      !/^[-—–]{2,}$/u.test(line),
  );

  return firstMeaningful?.slice(0, 80) ?? "";
}

function hasUsefulRequirements(requirements: ParsedRequirements): boolean {
  return Boolean(
    requirements.ageLimit ||
      requirements.politicalStatus ||
      (requirements.majorRequirements?.length ?? 0) > 0 ||
      requirements.notes ||
      requirements.education ||
      requirements.gender ||
      requirements.numPositions != null ||
      requirements.deadline ||
      requirements.freshGraduateOnly != null ||
      getStructuredJobsFromRequirements(requirements).length > 0,
  );
}

function normalizeDeadline(value: unknown): string | undefined {
  const str = pickString(value);
  if (!str) return undefined;
  return normalizeDeadlineString(str);
}

// ==================== LLM fallback ====================

async function callStructuredExtractionLlm(
  rawText: string,
  label: string,
): Promise<{ title?: string; requirements?: ParsedRequirements } | null> {
  if (MINIMAX_API_KEY) return callMiniMaxApi(rawText, label);
  if (DIFY_API_KEY) return callDifyWorkflow(rawText);

  console.warn(
    "[Parse] 未配置 MINIMAX_API_KEY 或 DIFY_API_KEY，MiniMax fallback 将仅返回规则级结果",
  );
  return null;
}

async function callMiniMaxApi(
  rawText: string,
  label: string,
): Promise<{ title?: string; requirements?: ParsedRequirements } | null> {
  const response = await fetch(MINIMAX_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MINIMAX_API_KEY}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages: [
        { role: "system", content: REQUIREMENTS_EXTRACTION_PROMPT },
        { role: "user", content: `附件来源：${label}\n\n${rawText}` },
      ],
      temperature: 0.1,
      stream: false,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const baseResp = data.base_resp as Record<string, unknown> | undefined;
    throw new Error(
      pickString(data.message) ??
        pickString(baseResp?.status_msg) ??
        `MiniMax 返回错误 ${response.status}`,
    );
  }

  const content =
    pickString(
      (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]
        ?.message?.content,
    ) ??
    pickString(data.reply as string | undefined) ??
    pickString(data.output_text as string | undefined);

  return parseLlmJsonPayload(content, rawText);
}

async function callDifyWorkflow(
  rawText: string,
): Promise<{ title?: string; requirements?: ParsedRequirements } | null> {
  const response = await fetch(DIFY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DIFY_API_KEY}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      inputs: {
        raw_text: rawText,
        classification_guide: REQUIREMENTS_EXTRACTION_PROMPT,
      },
      response_mode: "blocking",
      user: "anbian-parse-attachment",
    }),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      pickString(data.message) ?? pickString(data.code) ?? `Dify 返回错误 ${response.status}`,
    );
  }

  const outputs =
    (data.data as Record<string, unknown> | undefined)?.outputs ??
    data.outputs ??
    data.data ??
    data;

  const textCandidate =
    pickString((outputs as Record<string, unknown>).text) ??
    pickString((outputs as Record<string, unknown>).result) ??
    pickString((outputs as Record<string, unknown>).output);

  const parsedFromText = parseLlmJsonPayload(textCandidate, rawText);
  if (parsedFromText) return parsedFromText;

  if (outputs && typeof outputs === "object") {
    const fields = outputs as Record<string, unknown>;
    return {
      title: pickString(fields.title),
      requirements: normalizeRequirements(fields.requirements ?? fields, rawText),
    };
  }

  return null;
}

function parseLlmJsonPayload(
  text: string | undefined,
  sourceText?: string,
): { title?: string; requirements?: ParsedRequirements } | null {
  if (!text?.trim()) return null;

  const candidates = [
    text,
    text.match(/```(?:json)?\s*([\s\S]*?)```/u)?.[1],
    text.match(/\{[\s\S]*\}/u)?.[0],
  ].filter((item): item is string => Boolean(item?.trim()));

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      return {
        title: pickString(obj.title),
        requirements: normalizeRequirements(obj.requirements ?? obj, sourceText),
      };
    }
  }

  return null;
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function pickString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const str = cleanText(String(value));
  return str.length > 0 ? str : undefined;
}
