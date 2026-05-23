import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeTrackCategory } from "@/lib/track-filters.js";

export async function GET() {
  try {
    const rows = await prisma.rawJob.findMany({
      where: { status: "PENDING", isDeleted: false },
      orderBy: { publishedAt: "desc" },
    });

    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json(
      { error: "读取待处理任务失败", details: err?.message },
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

  const id = Number(body?.id);
  const status = body?.status !== undefined ? String(body.status).trim() : undefined;
  const category =
    body?.category !== undefined
      ? String(body.category).trim()
      : undefined;

  if (!id || Number.isNaN(id)) {
    return NextResponse.json({ error: "缺少有效的 id" }, { status: 400 });
  }

  if (!status && category === undefined) {
    return NextResponse.json(
      { error: "缺少 status 或 category" },
      { status: 400 },
    );
  }

  const data = {};
  if (status) data.status = status;
  if (category !== undefined) {
    data.category = normalizeTrackCategory(category);
  }

  try {
    const updated = await prisma.rawJob.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "更新状态失败", details: err?.message },
      { status: 500 },
    );
  }
}
