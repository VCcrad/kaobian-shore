import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [jobs, rawJobs] = await Promise.all([
      prisma.job.findMany({
        where: { isDeleted: true },
        orderBy: { deletedAt: "desc" },
      }),
      prisma.rawJob.findMany({
        where: { isDeleted: true },
        orderBy: { deletedAt: "desc" },
      }),
    ]);

    return NextResponse.json({ jobs, rawJobs });
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

  const entity = String(body?.entity ?? "").trim();
  const id = Number(body?.id);
  const action = String(body?.action ?? "").trim();

  if (!entity || !["job", "rawJob"].includes(entity)) {
    return NextResponse.json(
      { error: "entity 须为 job 或 rawJob" },
      { status: 400 },
    );
  }

  if (!id || Number.isNaN(id)) {
    return NextResponse.json({ error: "缺少有效的 id" }, { status: 400 });
  }

  if (action !== "restore") {
    return NextResponse.json(
      { error: "PATCH 仅支持 action: restore" },
      { status: 400 },
    );
  }

  try {
    if (entity === "job") {
      const updated = await prisma.job.update({
        where: { id },
        data: { isDeleted: false, deletedAt: null },
      });
      return NextResponse.json(updated);
    }

    const updated = await prisma.rawJob.update({
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
