import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const rows = await prisma.rawJob.findMany({
      where: { status: "PENDING" },
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
  const status = String(body?.status ?? "").trim();

  if (!id || Number.isNaN(id)) {
    return NextResponse.json({ error: "缺少有效的 id" }, { status: 400 });
  }

  if (!status) {
    return NextResponse.json({ error: "缺少 status" }, { status: 400 });
  }

  try {
    const updated = await prisma.rawJob.update({
      where: { id },
      data: { status },
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
