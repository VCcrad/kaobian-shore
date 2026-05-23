import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { parseAttachment } from "../lib/parse-attachment";

const require = createRequire(import.meta.url);
const { parseStructuredJobsFromLines } = require("../lib/parse-hunan-structured-jobs.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SEED_LIMIT = 5;
/** demo 截止 2026-05-10，固定参考日避免 feed 过滤导致 0 条 */
const SEED_REFERENCE_DATE = new Date("2026-05-08T12:00:00+08:00");

function loadEnvFile(relativePath: string) {
  const envPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

type HunanDemoFile = {
  sourceUrl?: string;
  lineCount?: number;
  lines?: string[];
};

function parseOptionalDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.includes("T") ? value : `${value}T12:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

async function main() {
  console.log("🚀 开始湖南测试数据解析与入库...");

  const deleted = await prisma.jobPosting.deleteMany({
    where: {
      OR: [
        { title: { contains: "工作表" } },
        { title: { contains: "Sheet1" } },
        { rawText: { contains: "Sheet1" } },
      ],
    },
  });
  if (deleted.count > 0) {
    console.log(`🧹 已删除 ${deleted.count} 条乱码/脏数据 JobPosting`);
  }

  let source = await prisma.source.findFirst({
    where: { name: "湖南省人社厅" },
  });

  if (!source) {
    source = await prisma.source.create({
      data: {
        name: "湖南省人社厅",
        province: "湖南",
        type: "人社厅",
        url: "https://rst.hunan.gov.cn/",
        priority: 10,
        updateFrequency: "daily",
        parserConfig: {
          type: "hunan-rst",
          listSelector: ".notice-list",
        },
      },
    });
    console.log("✅ Source 已创建:", source.name);
  } else {
    console.log("ℹ️ Source 已存在:", source.name);
  }

  const demoPath = path.join(ROOT, "data/hunan-rst-lines.json");
  let demoData: HunanDemoFile;

  try {
    demoData = JSON.parse(fs.readFileSync(demoPath, "utf-8")) as HunanDemoFile;
    console.log(`📄 读取到 ${demoData.lines?.length ?? 0} 行湖南 demo 数据`);
  } catch {
    console.error("❌ 无法读取 hunan-rst-lines.json");
    return;
  }

  const lines = demoData.lines ?? [];
  if (lines.length === 0) {
    console.error("❌ demo 文件中没有 lines 数据");
    return;
  }

  const structuredJobs = parseStructuredJobsFromLines(lines, SEED_REFERENCE_DATE);
  if (structuredJobs.length === 0) {
    console.error("❌ 未能从 demo 解析出结构化岗位（可能已过期或被过滤）");
    return;
  }

  const sourceUrl =
    demoData.sourceUrl ??
    "https://rst.hunan.gov.cn/rst/xxgk/zpzl/sydwzp/202604/t20260427_33965434.html";

  for (const item of structuredJobs.slice(0, SEED_LIMIT)) {
    try {
      const rawText = String(item.text ?? "").trim();
      const seedText = [
        item.title,
        item.organization,
        `专业要求：${item.majorRequirement}`,
        `年龄要求：${item.ageRequirement}`,
        `学历：${item.education}`,
        item.otherRequirement,
        rawText,
      ]
        .filter(Boolean)
        .join("\n");

      const fakeBuffer = Buffer.from(seedText, "utf-8");
      const parseResult = await parseAttachment(
        fakeBuffer,
        "xlsx",
        item.title || "测试岗位",
      );

      const title = item.title || parseResult.title || "未命名岗位";
      const cleanRawText =
        parseResult.rawText && !/工作表:\s*Sheet|nèh|Ã/i.test(parseResult.rawText)
          ? parseResult.rawText
          : seedText;
      const requirements = {
        ...parseResult.requirements,
        ageLimit:
          parseResult.requirements.ageLimit ??
          (item.ageRequirement !== "—" ? item.ageRequirement : undefined),
        majorRequirements:
          parseResult.requirements.majorRequirements ??
          (item.majorRequirement && item.majorRequirement !== "—"
            ? [item.majorRequirement]
            : undefined),
        notes: parseResult.requirements.notes ?? item.otherRequirement,
        other: {
          jobCode: item.id,
          organization: item.organization,
          slots: item.slots,
          education: item.education,
          parserUsed: parseResult.parserUsed,
        },
      };

      const existing = await prisma.jobPosting.findFirst({
        where: {
          sourceId: source.id,
          sourceUrl,
          title,
        },
      });

      if (existing) {
        await prisma.jobPosting.update({
          where: { id: existing.id },
          data: {
            requirements,
            rawText: cleanRawText,
          },
        });
        console.log(`♻️ 已更新: ${title}`);
        continue;
      }

      await prisma.jobPosting.create({
        data: {
          sourceId: source.id,
          title,
          province: "湖南",
          sourceUrl,
          requirements,
          rawText: cleanRawText,
          publishDate: parseOptionalDate(item.publishDate),
          deadline: parseOptionalDate(item.deadline),
          matchStatus: null,
        },
      });

      console.log(`✅ 解析并入库: ${title} (${parseResult.parserUsed})`);
    } catch (err) {
      console.error("❌ 处理失败:", item.title, err);
    }
  }

  const total = await prisma.jobPosting.count({ where: { sourceId: source.id } });
  console.log(`🎉 湖南测试数据入库完成！当前 Source 下共 ${total} 条 JobPosting`);
}

main()
  .catch((error) => console.error(error))
  .finally(async () => {
    await prisma.$disconnect();
  });
