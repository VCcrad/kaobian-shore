import { createRequire } from "module";
import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveDeadlineEndDate } from "@/lib/deadline-utils.js";
import {
  extractOrganizationFromTitle,
  formatTitle,
  parseSlots,
} from "@/lib/job-utils";
import { normalizeTrackCategory } from "@/lib/track-filters.js";
import {
  buildJobPostingDisplayText,
  isGarbledText,
  sanitizeJobPostingTitle,
  sanitizeOrganizationName,
  pickJobCardTitle,
  formatJobCardDisplayTitle,
} from "@/lib/job-posting-text.js";
import { buildJobCardDisplayFields } from "@/lib/job-card-fields.js";
import { matchJobPostings } from "@/lib/match-service";
import {
  isNavigationMenuText,
  hasNonRecruitmentTitleSignal,
} from "@/lib/recruitment-announcement-filters.js";

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

function formatDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function fetchJobPostings() {
  return prisma.jobPosting.findMany({
    where: { isDeleted: false },
    include: { source: true },
    orderBy: { publishDate: "desc" },
  });
}

function calcDaysLeftLabel(deadline) {
  const deadlineStr = formatDateOnly(deadline);
  if (!deadlineStr) return { daysLeft: null, daysLeftLabel: "详见公告" };

  const end = resolveDeadlineEndDate(deadlineStr);
  if (!end) return { daysLeft: null, daysLeftLabel: "详见公告" };

  const daysLeft = Math.ceil((end - new Date()) / 86400000);
  if (daysLeft < 0) return { daysLeft, daysLeftLabel: "已截止" };
  if (daysLeft === 0) return { daysLeft, daysLeftLabel: "今日截止" };
  return { daysLeft, daysLeftLabel: `剩余 ${daysLeft} 天` };
}

function asRequirementsObject(requirements) {
  if (requirements && typeof requirements === "object" && !Array.isArray(requirements)) {
    return requirements;
  }
  return {};
}

/** 从 query 解析用户画像；未传 profile 相关参数时不启用服务端匹配 */
function parseUserProfileFromSearchParams(searchParams) {
  const hasProfileQuery =
    searchParams.has("match") ||
    searchParams.has("age") ||
    searchParams.has("major") ||
    searchParams.has("politicalStatus") ||
    searchParams.has("isPartyMember");

  if (!hasProfileQuery || searchParams.get("match") === "0") {
    return null;
  }

  const ageRaw = searchParams.get("age");
  const parsedAge = ageRaw != null ? Number.parseInt(ageRaw, 10) : 28;
  const age = Number.isFinite(parsedAge) ? parsedAge : 28;

  const politicalStatus = String(searchParams.get("politicalStatus") ?? "").trim();
  const partyParam = searchParams.get("isPartyMember");

  let isPartyMember = false;
  if (partyParam != null) {
    isPartyMember = partyParam === "1" || partyParam === "true";
  } else if (politicalStatus) {
    isPartyMember =
      /党员/u.test(politicalStatus) && !/非党员|群众/u.test(politicalStatus);
  }

  return {
    age,
    major: String(searchParams.get("major") ?? "").trim(),
    isPartyMember,
    politicalStatus: politicalStatus || (isPartyMember ? "党员" : "群众"),
  };
}

function resolveMatchFields(job) {
  if (job.match) {
    return {
      matchStatus: job.match.matchStatus,
      conflictReasons: job.match.conflictReasons ?? [],
    };
  }

  return {
    matchStatus: job.matchStatus || "NORMAL",
    conflictReasons: [],
  };
}

function resolveJobCardTitle(job, other = {}, organization = "") {
  const base = pickJobCardTitle({
    title: job.title,
    announcementTitle: other.announcementTitle,
    rawText: job.rawText,
    organization,
    sourceName: job.source?.name,
  });
  return formatJobCardDisplayTitle(base, {
    announcementTitle: other.announcementTitle,
    fallbackTitle: job.title,
    rawText: job.rawText,
  });
}

function mapJobPostingToFormatted(job) {
  const requirements = asRequirementsObject(job.requirements);
  const other =
    requirements.other && typeof requirements.other === "object"
      ? requirements.other
      : {};
  const { matchStatus, conflictReasons } = resolveMatchFields(job);

  return {
    id: job.id,
    title: resolveJobCardTitle(job, other),
    province: job.province,
    sourceName: job.source?.name ?? null,
    sourceUrl: job.sourceUrl,
    publishDate: job.publishDate,
    deadline: job.deadline,
    requirements,
    rawText: isGarbledText(job.rawText)
      ? buildJobPostingDisplayText(job, requirements, other).slice(0, 800)
      : (job.rawText?.slice(0, 800) ?? ""),
    matchStatus,
    conflictReasons,
    parserUsed: other.parserUsed || "mixed",
  };
}

/** 小程序 / 旧 format=jobs 卡片字段兼容 */
function mapJobPostingToMiniProgramCard(job) {
  const requirements = asRequirementsObject(job.requirements);
  const other =
    requirements.other && typeof requirements.other === "object"
      ? requirements.other
      : {};
  const sourceName = job.source?.name ?? "";
  const organization = sanitizeOrganizationName(
    other.organization || sourceName,
    sourceName,
  );
  const text = buildJobPostingDisplayText(job, requirements, {
    ...other,
    organization,
  });
  const cardFields = buildJobCardDisplayFields({
    job: { ...job, source: job.source },
    requirements,
    other: {
      ...other,
      organization,
    },
    text,
  });
  const deadlineStr = formatDateOnly(job.deadline) ?? "—";
  const { daysLeft, daysLeftLabel } = calcDaysLeftLabel(job.deadline);
  const { matchStatus, conflictReasons } = resolveMatchFields(job);

  return {
    id: job.id,
    publishDate: formatDateOnly(job.publishDate) ?? "",
    organization,
    title: resolveJobCardTitle(job, other, organization),
    provinceCity: cardFields.provinceCity,
    slots: cardFields.slots,
    slotsLabel: cardFields.slotsLabel || "—",
    education: cardFields.education || "—",
    majorRequirement: cardFields.majorRequirement || "—",
    ageRequirement: cardFields.ageRequirement || "—",
    politicalRequirement: cardFields.politicalRequirement || "—",
    certificateRequirements: cardFields.certificateRequirements,
    specialRequirements: cardFields.specialRequirements || "—",
    otherRequirements: cardFields.otherRequirements || "—",
    deadline: deadlineStr,
    daysLeft,
    daysLeftLabel,
    text,
    sourceName: job.source?.name ?? null,
    sourceUrl: job.sourceUrl,
    requirements,
    matchStatus,
    conflictReasons,
    parserUsed: other.parserUsed || "mixed",
  };
}

/** GET /api/jobs — JobPosting 结构化列表（新数据源） */
async function getJobPostingsResponse(format, searchParams) {
  await runTrashJanitor(prisma);

  const profile = parseUserProfileFromSearchParams(searchParams);
  const allJobs = await fetchJobPostings();
  let jobs = allJobs.filter((job) => {
    const req = asRequirementsObject(job.requirements);
    const other =
      req.other && typeof req.other === "object" ? req.other : {};
    const org = sanitizeOrganizationName(
      other.organization || job.source?.name || "",
      job.source?.name || "",
    );
    const title = resolveJobCardTitle(job, other, org);
    if (!title) return false;
    const listTitle = other.announcementTitle || job.title || "";
    if (isNavigationMenuText(title) || isNavigationMenuText(listTitle)) return false;
    if (hasNonRecruitmentTitleSignal(listTitle) || hasNonRecruitmentTitleSignal(title)) {
      return false;
    }
    if (isGarbledText(title) || isGarbledText(listTitle)) return false;
    return Boolean(org || title);
  });

  if (profile) {
    jobs = matchJobPostings(profile, jobs);
  }

  const profileUsed = profile
    ? {
        age: profile.age,
        major: profile.major,
        politicalStatus: profile.politicalStatus,
        isPartyMember: profile.isPartyMember,
      }
    : null;

  if (format === "lines") {
    const linesData = jobs.map((job) => {
      const { matchStatus, conflictReasons } = resolveMatchFields(job);
      return {
        title: job.title,
        sourceUrl: job.sourceUrl,
        rawText: job.rawText || "",
        requirements: job.requirements,
        matchStatus,
        conflictReasons,
      };
    });

    return NextResponse.json({
      success: true,
      data: linesData,
      total: linesData.length,
      source: "job_postings",
      profileUsed,
    });
  }

  if (format === "jobs") {
    const data = jobs.map(mapJobPostingToMiniProgramCard);

    if (data.length === 0) {
      return getStructuredJobsResponse();
    }

    return NextResponse.json({
      success: true,
      data,
      meta: {
        count: data.length,
        signupDeadline: data[0]?.deadline ?? null,
      },
      total: data.length,
      source: "job_postings",
      profileUsed,
    });
  }

  const formattedJobs = jobs.map(mapJobPostingToFormatted);

  return NextResponse.json({
    success: true,
    data: formattedJobs,
    total: jobs.length,
    source: "job_postings",
    profileUsed,
  });
}

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
  const format = searchParams.get("format");

  if (searchParams.get("all") === "1") {
    try {
      await runTrashJanitor(prisma);
      const jobs = await prisma.job.findMany({
        where: { isDeleted: false },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json(jobs);
    } catch (err) {
      return NextResponse.json(
        { error: "读取岗位列表失败", details: err?.message },
        { status: 500 },
      );
    }
  }

  if (format === "cache-lines") {
    return getDemoLinesResponse(request);
  }

  try {
    return await getJobPostingsResponse(format, searchParams);
  } catch (error) {
    console.error("API /jobs error:", error);
    return NextResponse.json(
      { success: false, error: "服务器错误", details: error?.message },
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
