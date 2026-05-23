import type { Prisma } from "@prisma/client";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

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

export type ParsedRequirements = {
  ageLimit?: string;
  politicalStatus?: string;
  majorRequirements?: string[];
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

const MIN_RAW_TEXT_LENGTH = 200;
const MIN_RULE_TEXT_LENGTH = 80;

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

const REQUIREMENTS_EXTRACTION_PROMPT = `你是高校与编制类招聘公告附件的结构化提取助手。
请阅读用户提供的附件全文（可能来自 PDF、Excel 或 Word），只输出一个合法 JSON 对象，禁止 markdown 代码块与多余说明。

输出格式：
{
  "title": "公告或岗位表标题",
  "requirements": {
    "ageLimit": "如 35周岁以下，无法识别则省略该字段",
    "politicalStatus": "中共党员 | 群众 | 不限 三选一",
    "majorRequirements": ["专业要求1", "专业要求2"],
    "notes": "其他要求、备注中的隐性条件",
    "other": {}
  }
}

要求：
- majorRequirements 尽量拆成数组，保留原文关键表述
- politicalStatus 仅当文中明确党员要求时填「中共党员」，明确不限则「不限」，否则省略
- 无法确定的字段请省略，不要编造`;

/**
 * 混合解析主函数：规则优先，不理想时 fallback MiniMax / Dify
 */
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

// ==================== 规则解析入口 ====================

async function parseWithRules(
  buffer: Buffer,
  fileType: "pdf" | "xlsx" | "docx",
): Promise<ParseResult> {
  if (fileType === "xlsx") {
    return parseXLSX(buffer);
  }
  if (fileType === "pdf") {
    return parsePDF(buffer);
  }
  if (fileType === "docx") {
    return parseDOCX(buffer);
  }

  return {
    title: "未知格式",
    requirements: {},
    rawText: "",
    success: false,
    parserUsed: "rule",
  };
}

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

  const requirements = normalizeRequirements(llmPayload?.requirements);
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

// ==================== 格式解析 ====================

async function parseXLSX(buffer: Buffer): Promise<ParseResult> {
  // 关键修复：UTF-8 纯文本被误标为 xlsx 时，禁止交给 XLSX.read（会产生 nèh kâ 类乱码）
  if (!isExcelBuffer(buffer) || isPlainUtf8TextBuffer(buffer)) {
    const text = decodeBufferAsUtf8(buffer);
    return buildRuleResult(text, extractRequirementsFromText(text), "岗位表");
  }

  try {
    const workbook = readXlsxWorkbook(buffer);
    const parts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const sheetText = worksheetToPlainText(sheet);
      if (sheetText) parts.push(sheetText);
    }

    const rawText = parts.join("\n");
    const tableRequirements = extractRequirementsFromXlsxWorkbook(workbook);

    if (looksLikeGarbledText(rawText)) {
      console.warn("[Parse] XLSX 解析结果疑似乱码，回退 UTF-8 纯文本");
      const fallbackText = decodeBufferAsUtf8(buffer);
      return buildRuleResult(
        fallbackText,
        extractRequirementsFromText(fallbackText),
        "岗位表",
      );
    }

    return buildRuleResult(rawText, tableRequirements, "岗位表");
  } catch (error) {
    console.warn("[Parse] XLSX.read 失败，回退 UTF-8 纯文本", error);
    const text = decodeBufferAsUtf8(buffer);
    return buildRuleResult(text, extractRequirementsFromText(text), "岗位表");
  }
}

async function parsePDF(buffer: Buffer): Promise<ParseResult> {
  if (!isPdfBuffer(buffer)) {
    const text = decodeBufferAsUtf8(buffer);
    return buildRuleResult(text, extractRequirementsFromText(text), "PDF 岗位");
  }

  const text = await extractPdfText(buffer);
  return buildRuleResult(text, {}, "PDF 岗位");
}

async function parseDOCX(buffer: Buffer): Promise<ParseResult> {
  if (!isZipBuffer(buffer)) {
    const text = decodeBufferAsUtf8(buffer);
    return buildRuleResult(text, extractRequirementsFromText(text), "Word 岗位");
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
  const requirements = extractRequirementsFromText(cleanedText);
  mergeRequirements(requirements, tableRequirements);

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
    success: qualityOk || (result.success && rawText.length > 0 && !looksLikeGarbledText(rawText)),
  };
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

/** 判断 buffer 是否实为 UTF-8 纯文本（seed 脚本误标 xlsx 的常见情况） */
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

// ==================== UTF-8 与文本清洗 ====================

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
  const cleaned = cleanText(title);
  if (!cleaned) return "";

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

  const notes = cleanText(requirements.notes ?? "");
  if (notes) cleaned.notes = notes;

  if (Array.isArray(requirements.majorRequirements)) {
    const majors = requirements.majorRequirements
      .map((item) => cleanText(String(item)))
      .filter(Boolean);
    if (majors.length > 0) cleaned.majorRequirements = [...new Set(majors)];
  }

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

function worksheetToPlainText(worksheet: XLSX.WorkSheet): string {
  if (!worksheet?.["!ref"]) return "";

  try {
    return XLSX.utils.sheet_to_csv(worksheet, {
      FS: "\t",
      RS: "\n",
      raw: false,
      blankrows: false,
    });
  } catch {
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, {
      header: 1,
      defval: "",
      raw: false,
    });

    return rows
      .map((row) =>
        row
          .map((cell) => cleanCellValue(cell))
          .filter(Boolean)
          .join("\t"),
      )
      .filter((line) => line.length > 0)
      .join("\n");
  }
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
      const workbook = readXlsxWorkbook(buffer);
      const merged = workbook.SheetNames.map((name) =>
        worksheetToPlainText(workbook.Sheets[name]),
      )
        .filter(Boolean)
        .join("\n");

      if (looksLikeGarbledText(merged)) {
        return cleanText(decodeBufferAsUtf8(buffer));
      }
      return cleanText(merged);
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

// ==================== 规则字段提取 ====================

function extractRequirementsFromText(text: string): ParsedRequirements {
  const requirements: ParsedRequirements = {};

  const ageLimit = extractAgeLimitText(text);
  if (ageLimit) requirements.ageLimit = ageLimit;

  const politicalStatus = extractPoliticalStatus(text);
  if (politicalStatus) requirements.politicalStatus = politicalStatus;

  const majorRequirements = extractMajorRequirements(text);
  if (majorRequirements.length > 0) {
    requirements.majorRequirements = majorRequirements;
  }

  const notes = extractNotesText(text);
  if (notes) requirements.notes = notes;

  return requirements;
}

function extractRequirementsFromXlsxWorkbook(
  workbook: XLSX.WorkBook,
): ParsedRequirements {
  const merged: ParsedRequirements = { majorRequirements: [] };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: "",
      raw: false,
    });

    for (const row of rows.slice(0, 30)) {
      for (const [rawKey, rawValue] of Object.entries(row)) {
        const key = cleanCellValue(rawKey);
        const value = cleanCellValue(rawValue);
        if (!value) continue;

        if (/年龄/u.test(key) && !merged.ageLimit) {
          merged.ageLimit = extractAgeLimitText(value) ?? value;
        }

        if (/专业/u.test(key)) {
          splitMajorTokens(value).forEach((item) => merged.majorRequirements?.push(item));
        }

        if (/政治|党员/u.test(key) && !merged.politicalStatus) {
          merged.politicalStatus = extractPoliticalStatus(value) ?? value;
        }

        if (/其他要求|备注/u.test(key) && !merged.notes) {
          merged.notes = value;
        }
      }
    }
  }

  merged.majorRequirements = [...new Set(merged.majorRequirements ?? [])];
  if (merged.majorRequirements.length === 0) delete merged.majorRequirements;

  return merged;
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

function extractMajorRequirements(text: string): string[] {
  const majors = new Set<string>();

  const labeled =
    text.match(/专业要求[:：]?\s*([^\n\r]{2,300})/u)?.[1] ??
    text.match(/专业[:：]?\s*([^\n\r]{2,300})/u)?.[1];

  if (labeled) {
    splitMajorTokens(labeled).forEach((item) => majors.add(item));
  }

  const codeMatches = text.matchAll(
    /(?:\(\d+\)|\d{2,4})\s*[\u4e00-\u9fa5A-Za-z0-9、，,\/\s-]{2,40}/gu,
  );
  for (const match of codeMatches) {
    const token = cleanText(match[0].replace(/^\(\d+\)\s*/, ""));
    if (token.length >= 2 && token.length <= 40) majors.add(token);
    if (majors.size >= 24) break;
  }

  return [...majors];
}

function splitMajorTokens(value: string): string[] {
  return value
    .split(/[;；、,\/\n\r|]+/u)
    .map((part) => cleanText(part.replace(/^[\d.()\s]+/, "")))
    .filter((part) => part.length >= 2 && part.length <= 80);
}

function extractNotesText(text: string): string | undefined {
  const match =
    text.match(/其他要求[:：]?\s*([^\n\r]{4,500})/u) ??
    text.match(/备注[:：]?\s*([^\n\r]{4,500})/u);
  const notes = match?.[1] ? cleanText(match[1]) : "";
  return notes || undefined;
}

function mergeRequirements(
  target: ParsedRequirements,
  source: ParsedRequirements,
): void {
  if (!target.ageLimit && source.ageLimit) target.ageLimit = source.ageLimit;
  if (!target.politicalStatus && source.politicalStatus) {
    target.politicalStatus = source.politicalStatus;
  }
  if (!target.notes && source.notes) target.notes = source.notes;

  if (source.majorRequirements?.length) {
    target.majorRequirements = [
      ...new Set([...(target.majorRequirements ?? []), ...source.majorRequirements]),
    ];
  }
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
      requirements.notes,
  );
}

// ==================== LLM fallback ====================

function normalizeRequirements(input: unknown): ParsedRequirements {
  if (!input || typeof input !== "object") return {};

  const raw = input as Record<string, unknown>;
  const requirements: ParsedRequirements = {};

  const ageLimit = pickString(raw.ageLimit);
  if (ageLimit) requirements.ageLimit = ageLimit;

  const politicalStatus = pickString(raw.politicalStatus);
  if (politicalStatus) requirements.politicalStatus = politicalStatus;

  const notes = pickString(raw.notes);
  if (notes) requirements.notes = notes;

  if (Array.isArray(raw.majorRequirements)) {
    requirements.majorRequirements = raw.majorRequirements
      .map((item) => pickString(item))
      .filter((item): item is string => Boolean(item));
  } else {
    const majorText = pickString(raw.majorRequirements ?? raw.majors ?? raw.major);
    if (majorText) requirements.majorRequirements = splitMajorTokens(majorText);
  }

  if (raw.other && typeof raw.other === "object") {
    requirements.other = raw.other as Prisma.InputJsonValue;
  }

  return cleanRequirements(requirements);
}

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

  return parseLlmJsonPayload(content);
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

  const parsedFromText = parseLlmJsonPayload(textCandidate);
  if (parsedFromText) return parsedFromText;

  if (outputs && typeof outputs === "object") {
    const fields = outputs as Record<string, unknown>;
    return {
      title: pickString(fields.title),
      requirements: normalizeRequirements(fields.requirements ?? fields),
    };
  }

  return null;
}

function parseLlmJsonPayload(
  text: string | undefined,
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
        requirements: normalizeRequirements(obj.requirements ?? obj),
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
