/**
 * add-source.ts · 快速添加 / 更新湖南省招聘来源（高校、事业单位等）
 *
 * 用法：
 *   npx tsx scripts/add-source.ts --name="湖南大学" --province="湖南" --type="高校" --url="https://rsc.hnu.edu.cn/zpxx.htm" --parserConfig='{"type":"hunan-university"}'
 *
 * 可选参数：
 *   --city="长沙"
 *   --priority=8
 *   --updateFrequency=daily|weekly
 *   --status=active|inactive|error
 *   --dry-run          只打印将要写入的数据，不写库
 *   --help
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const SOURCE_TYPES = ["人社厅", "高校", "组织部", "事业单位", "其他"] as const;
const UPDATE_FREQUENCIES = ["daily", "weekly"] as const;
const STATUSES = ["active", "inactive", "error"] as const;

type SourceType = (typeof SOURCE_TYPES)[number];
type UpdateFrequency = (typeof UPDATE_FREQUENCIES)[number];
type SourceStatus = (typeof STATUSES)[number];

type CliArgs = {
  name?: string;
  province?: string;
  city?: string;
  type?: string;
  url?: string;
  parserConfig?: Prisma.InputJsonValue;
  parserConfigFile?: string;
  priority?: number;
  updateFrequency?: UpdateFrequency;
  status?: SourceStatus;
  dryRun: boolean;
  help: boolean;
};

// ─── 环境 & Prisma ───────────────────────────────────────────────

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

// ─── CLI ─────────────────────────────────────────────────────────

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function parseFlagValue(arg: string, prefix: string): string | undefined {
  if (!arg.startsWith(prefix)) return undefined;
  return stripQuotes(arg.slice(prefix.length));
}

function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = { dryRun: false, help: false };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }

    const name = parseFlagValue(arg, "--name=");
    if (name != null) {
      result.name = name;
      continue;
    }

    const province = parseFlagValue(arg, "--province=");
    if (province != null) {
      result.province = province;
      continue;
    }

    const city = parseFlagValue(arg, "--city=");
    if (city != null) {
      result.city = city;
      continue;
    }

    const type = parseFlagValue(arg, "--type=");
    if (type != null) {
      result.type = type;
      continue;
    }

    const url = parseFlagValue(arg, "--url=");
    if (url != null) {
      result.url = url;
      continue;
    }

    const parserConfigRaw = parseFlagValue(arg, "--parserConfig=");
    if (parserConfigRaw != null) {
      result.parserConfig = parseParserConfig(parserConfigRaw);
      continue;
    }

    const parserConfigFile = parseFlagValue(arg, "--parserConfigFile=");
    if (parserConfigFile != null) {
      result.parserConfigFile = parserConfigFile;
      continue;
    }

    const priorityRaw = parseFlagValue(arg, "--priority=");
    if (priorityRaw != null) {
      const priority = Number.parseInt(priorityRaw, 10);
      if (!Number.isFinite(priority) || priority < 1 || priority > 10) {
        throw new Error("--priority 必须是 1–10 之间的整数");
      }
      result.priority = priority;
      continue;
    }

    const updateFrequency = parseFlagValue(arg, "--updateFrequency=");
    if (updateFrequency != null) {
      if (!UPDATE_FREQUENCIES.includes(updateFrequency as UpdateFrequency)) {
        throw new Error(`--updateFrequency 必须是 ${UPDATE_FREQUENCIES.join(" | ")}`);
      }
      result.updateFrequency = updateFrequency as UpdateFrequency;
      continue;
    }

    const status = parseFlagValue(arg, "--status=");
    if (status != null) {
      if (!STATUSES.includes(status as SourceStatus)) {
        throw new Error(`--status 必须是 ${STATUSES.join(" | ")}`);
      }
      result.status = status as SourceStatus;
      continue;
    }

    throw new Error(`未知参数: ${arg}（使用 --help 查看用法）`);
  }

  return result;
}

function parseParserConfig(raw: string): Prisma.InputJsonValue {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("--parserConfig 不能为空 JSON");
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("parserConfig 必须是 JSON 对象");
    }
    return parsed as Prisma.InputJsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`--parserConfig JSON 解析失败: ${message}`);
  }
}

function printHelp() {
  console.log(`
add-source.ts · 快速添加 / 更新招聘来源

必填：
  --name          来源名称，如 "湖南大学"
  --province      省份，如 "湖南"
  --type          类型：${SOURCE_TYPES.join(" | ")}
  --url           列表页或首页 URL

可选：
  --parserConfig  解析配置 JSON，如 '{"type":"hunan-university","listUrl":"..."}'
  --parserConfigFile  从 JSON 文件读取 parserConfig（Windows 推荐）
  --city          城市
  --priority      优先级 1–10（默认 5）
  --updateFrequency  daily | weekly（默认 daily）
  --status        active | inactive | error（默认 active）
  --dry-run       预览，不写数据库
  --help          显示帮助

示例：
  npx tsx scripts/add-source.ts \\
    --name="湖南大学" \\
    --province="湖南" \\
    --type="高校" \\
    --url="https://rsc.hnu.edu.cn/zpxx.htm" \\
    --parserConfig='{"type":"hunan-university","listUrl":"https://rsc.hnu.edu.cn/zpxx.htm"}'
`);
}

// ─── 校验 & 写入 ─────────────────────────────────────────────────

function validateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error("URL 必须是 http 或 https");
    }
    return parsed.href;
  } catch {
    throw new Error(`无效的 URL: ${url}`);
  }
}

function validateRequiredArgs(args: CliArgs): {
  name: string;
  province: string;
  type: string;
  url: string;
} {
  const missing: string[] = [];
  if (!args.name?.trim()) missing.push("--name");
  if (!args.province?.trim()) missing.push("--province");
  if (!args.type?.trim()) missing.push("--type");
  if (!args.url?.trim()) missing.push("--url");

  if (missing.length > 0) {
    throw new Error(`缺少必填参数: ${missing.join(", ")}`);
  }

  return {
    name: args.name!.trim(),
    province: args.province!.trim(),
    type: args.type!.trim(),
    url: validateUrl(args.url!.trim()),
  };
}

function mergeParserConfig(
  existing: Prisma.JsonValue | null | undefined,
  incoming: Prisma.InputJsonValue | undefined,
): Prisma.InputJsonValue | undefined {
  if (incoming == null) {
    return existing != null && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Prisma.InputJsonValue)
      : undefined;
  }

  const base =
    existing != null && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  return {
    ...base,
    ...(incoming as Record<string, unknown>),
  } as Prisma.InputJsonValue;
}

function buildSourceData(
  args: CliArgs,
  required: ReturnType<typeof validateRequiredArgs>,
  existingParserConfig?: Prisma.JsonValue | null,
): Prisma.SourceCreateInput {
  const parserConfig = mergeParserConfig(existingParserConfig, args.parserConfig);

  const data: Prisma.SourceCreateInput = {
    name: required.name,
    province: required.province,
    type: required.type,
    url: required.url,
    city: args.city?.trim() || null,
    priority: args.priority ?? 5,
    updateFrequency: args.updateFrequency ?? "daily",
    status: args.status ?? "active",
  };

  if (parserConfig != null) {
    data.parserConfig = parserConfig;
  }

  return data;
}

function summarizeSource(source: {
  id: string;
  name: string;
  province: string;
  city: string | null;
  type: string;
  url: string;
  priority: number;
  updateFrequency: string;
  status: string;
  parserConfig: Prisma.JsonValue | null;
}) {
  console.log("────────────────────────────────────────");
  console.log(`ID:              ${source.id}`);
  console.log(`名称:            ${source.name}`);
  console.log(`省份:            ${source.province}`);
  console.log(`城市:            ${source.city ?? "—"}`);
  console.log(`类型:            ${source.type}`);
  console.log(`URL:             ${source.url}`);
  console.log(`优先级:          ${source.priority}`);
  console.log(`更新频率:        ${source.updateFrequency}`);
  console.log(`状态:            ${source.status}`);
  console.log(
    `parserConfig:    ${JSON.stringify(source.parserConfig ?? {}, null, 2)}`,
  );
  console.log("────────────────────────────────────────");
}

function loadParserConfigFromFile(filePath: string): Prisma.InputJsonValue {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`parserConfig 文件不存在: ${resolved}`);
  }
  return parseParserConfig(fs.readFileSync(resolved, "utf8"));
}

async function upsertSource(args: CliArgs) {
  const required = validateRequiredArgs(args);

  if (args.parserConfigFile) {
    args.parserConfig = loadParserConfigFromFile(args.parserConfigFile);
  }

  const existing = await prisma.source.findFirst({
    where: { name: required.name },
  });

  const data = buildSourceData(args, required, existing?.parserConfig);

  if (args.dryRun) {
    console.log(existing ? "🔍 [dry-run] 将更新已有 Source:" : "🔍 [dry-run] 将创建新 Source:");
    summarizeSource({
      id: existing?.id ?? "(new)",
      name: data.name as string,
      province: data.province as string,
      city: (data.city as string | null) ?? null,
      type: data.type as string,
      url: data.url as string,
      priority: data.priority as number,
      updateFrequency: data.updateFrequency as string,
      status: data.status as string,
      parserConfig: (data.parserConfig as Prisma.JsonValue) ?? null,
    });
    return;
  }

  if (existing) {
    console.log(`♻️  已存在同名 Source，正在更新: ${existing.name}`);
    const updated = await prisma.source.update({
      where: { id: existing.id },
      data: {
        province: data.province as string,
        city: data.city as string | null,
        type: data.type as string,
        url: data.url as string,
        priority: data.priority as number,
        updateFrequency: data.updateFrequency as string,
        status: data.status as string,
        ...(data.parserConfig != null ? { parserConfig: data.parserConfig } : {}),
      },
    });
    console.log("✅ Source 已更新");
    summarizeSource(updated);
    return;
  }

  console.log(`➕ 未找到同名 Source，正在创建: ${required.name}`);
  const created = await prisma.source.create({ data });
  console.log("✅ Source 已创建");
  summarizeSource(created);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  await upsertSource(args);
}

main()
  .catch((error) => {
    console.error("❌ add-source 失败:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
