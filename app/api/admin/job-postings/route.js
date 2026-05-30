import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatMajorRequirement } from "@/lib/major-utils.js";
import {
  resolveJobCardTitle,
  sanitizeOrganizationName,
} from "@/lib/job-posting-text.js";

const { runTrashJanitor } = require("../../../../lib/trash-janitor.cjs");

export const dynamic = "force-dynamic";

function formatDateOnly(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function mapJobPosting(job) {
  const requirements =
    job.requirements && typeof job.requirements === "object"
      ? job.requirements
      : {};
  const other =
    requirements.other && typeof requirements.other === "object"
      ? requirements.other
      : {};
  const sourceName = job.source?.name ?? "";
  const organization = sanitizeOrganizationName(
    other.organization || sourceName,
    sourceName,
  );
  const title = resolveJobCardTitle(job, other, organization);
  const slots =
    typeof other.slots === "number"
      ? other.slots
      : Number(other.numPositions) ||
        Number(requirements.numPositions) ||
        0;
  const majors = formatMajorRequirement(
    other.majorRequirement ||
      (Array.isArray(requirements.majorRequirements)
        ? requirements.majorRequirements.join("、")
        : requirements.majorRequirements),
  );

  return {
    id: job.id,
    title,
    sourceName,
    organization,
    province: job.province,
    deadline: formatDateOnly(job.deadline),
    publishDate: formatDateOnly(job.publishDate),
    slots,
    majors: majors || "无要求",
    sourceUrl: job.sourceUrl,
    createdAt: job.createdAt,
  };
}

export async function GET() {
  try {
    await runTrashJanitor(prisma);

    const jobs = await prisma.jobPosting.findMany({
      where: { isDeleted: false },
      include: { source: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(jobs.map(mapJobPosting));
  } catch (err) {
    return NextResponse.json(
      { error: "读取岗位列表失败", details: err?.message },
      { status: 500 },
    );
  }
}
