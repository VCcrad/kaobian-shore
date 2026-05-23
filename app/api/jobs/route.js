import { createRequire } from "module";
import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractOrganizationFromTitle,
  formatTitle,
  isPublishedJobVisible,
  parseSlots,
} from "@/lib/job-utils";
import { normalizeTrackCategory } from "@/lib/track-filters.js";

const require = createRequire(import.meta.url);
const {
  readCachedLines,
  resolveCacheFile,
} = require("../../../lib/hunan-demo-lines-cache.cjs");
const {
  parseStructuredJobsFromLines,
} = require("../../../lib/parse-hunan-structured-jobs.cjs");
const { runTrashJanitor } = require("../../../lib/trash-janitor.cjs");
const execFileAsync = promisify(execFile);

/** GET /api/jobs?format=jobs — 结构化岗位卡片（小程序首页） */
async function getStructuredJobsResponse() {
  try {
    const janitor = await runTrashJanitor(prisma);

    let lines = readCachedLines();

    if (!lines || lines.length === 0) {
      const scriptPath = path.join(process.cwd(), "scripts/warm-hunan-cache.js");
      await execFileAsync(process.execPath, [scriptPath], {
        cwd: process.cwd(),
        timeout: 120000,
      });
      lines = readCachedLines();
    }

    const data = parseStructuredJobsFromLines(lines || []);

    return NextResponse.json({
      success: true,
      data,
      meta: {
        count: data.length,
        signupDeadline: data[0]?.deadline ?? null,
        janitor,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        data: [],
        error: "结构化岗位解析失败",
        details: err?.message ?? String(err),
      },
      { status: 500 },
    );
  }
}

/** GET /api/jobs?format=lines — 读本地缓存（避免 Next 服务端加载 pdf-parse） */
async function getDemoLinesResponse(request) {
  try {
    const refresh =
      new URL(request.url).searchParams.get("refresh") === "1";

    if (!refresh) {
      const cached = readCachedLines();
      if (cached) {
        return NextResponse.json({
          success: true,
          data: cached,
          meta: { lineCount: cached.length, cached: true },
        });
      }
    }

    const scriptPath = path.join(process.cwd(), "scripts/warm-hunan-cache.js");
    await execFileAsync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      timeout: 120000,
    });

    const lines = readCachedLines();
    if (lines && lines.length > 0) {
      return NextResponse.json({
        success: true,
        data: lines,
        meta: { lineCount: lines.length, cached: false, refreshed: refresh },
      });
    }

    return NextResponse.json(
      {
        success: false,
        data: [],
        error: "缓存为空，请先运行 node scripts/warm-hunan-cache.js",
        cachePath: resolveCacheFile(),
        cwd: process.cwd(),
      },
      { status: 503 },
    );
  } catch (err) {
    const cached = readCachedLines();
    if (cached && cached.length > 0) {
      return NextResponse.json({
        success: true,
        data: cached,
        meta: {
          lineCount: cached.length,
          cached: true,
          warn: "刷新失败，已返回旧缓存",
          details: err?.message ?? String(err),
        },
      });
    }

    return NextResponse.json(
      {
        success: false,
        data: [],
        error: "穿透文本读取失败",
        details: err?.message ?? String(err),
      },
      { status: 500 },
    );
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("format") === "jobs") {
    return getStructuredJobsResponse();
  }
  if (searchParams.get("format") === "lines") {
    return getDemoLinesResponse(request);
  }

  try {
    await runTrashJanitor(prisma);
    const includeAll = searchParams.get("all") === "1";
    const jobs = await prisma.job.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: "desc" },
    });
    const list = includeAll ? jobs : jobs.filter(isPublishedJobVisible);
    return NextResponse.json(list);
  } catch (err) {
    return NextResponse.json(
      { error: "读取岗位列表失败", details: err?.message },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const {
    title: rawTitle,
    deadline: rawDeadline,
    majors: rawMajors,
    major: rawMajor,
    slots: rawSlots,
    headcount,
    sourceUrl: rawSourceUrl,
    link: rawLink,
    category: rawCategory,
    organization: rawOrganization,
    provinceCity: rawProvinceCity,
    education: rawEducation,
    ageRequirement: rawAgeRequirement,
    summary: rawSummary,
    content: rawContent,
    publishDate: rawPublishDate,
  } = body ?? {};

  const parsedOrg = extractOrganizationFromTitle(rawTitle ?? "");
  const title = formatTitle(parsedOrg.title || (rawTitle ?? ""));
  const deadline = String(rawDeadline ?? "").trim();
  const majors = String(rawMajors ?? rawMajor ?? "").trim();
  const slots = parseSlots(rawSlots ?? headcount);
  const category = normalizeTrackCategory(rawCategory ?? "");
  const sourceUrl =
    String(rawSourceUrl ?? rawLink ?? "")
      .trim() || null;
  const organization =
    String(rawOrganization ?? "").trim() || parsedOrg.organization;
  const provinceCity = String(rawProvinceCity ?? "").trim();
  const education = String(rawEducation ?? "").trim();
  const ageRequirement = String(rawAgeRequirement ?? "").trim();
  const content = String(rawContent ?? "").trim();
  const summary =
    String(rawSummary ?? "").trim() ||
    (content.length > 400 ? `${content.slice(0, 400)}…` : content);
  const publishDate = String(rawPublishDate ?? "").trim();

  if (!title) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }

  if (!category) {
    return NextResponse.json(
      { error: "请选择赛道分类（category）" },
      { status: 400 },
    );
  }

  try {
    const job = await prisma.job.create({
      data: {
        title,
        deadline,
        majors,
        slots,
        category,
        sourceUrl,
        organization,
        provinceCity,
        education,
        ageRequirement,
        summary,
        content,
        publishDate:
          publishDate || new Date().toISOString().slice(0, 10),
      },
    });

    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "写入数据库失败", details: err?.message },
      { status: 500 },
    );
  }
}
