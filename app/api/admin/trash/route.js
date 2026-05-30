import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

  return {
    id: job.id,
    title: resolveJobCardTitle(job, other, organization),
    sourceName,
    deadline: formatDateOnly(job.deadline),
    sourceUrl: job.sourceUrl,
    deletedAt: job.deletedAt,
  };
}

export async function GET() {
  try {
    await runTrashJanitor(prisma);

    const jobs = await prisma.jobPosting.findMany({
      where: { isDeleted: true },
      include: { source: true },
      orderBy: { deletedAt: "desc" },
    });

    return NextResponse.json({ jobs: jobs.map(mapJobPosting) });
  } catch (err) {
    return NextResponse.json(
      { error: "读取垃圾桶失败", details: err?.message },
      { status: 500 },
    );
  }
}

export async function PATCH(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const id = String(body?.id ?? "").trim();
  const action = String(body?.action ?? "").trim();

  if (!id) {
    return NextResponse.json({ error: "缺少有效的 id" }, { status: 400 });
  }

  if (action !== "restore") {
    return NextResponse.json(
      { error: "PATCH 仅支持 action: restore" },
      { status: 400 },
    );
  }

  try {
    const updated = await prisma.jobPosting.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "恢复失败", details: err?.message },
      { status: 500 },
    );
  }
}
