import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const jobId = Number(id);

  if (!id || Number.isNaN(jobId)) {
    return NextResponse.json({ error: "无效的岗位 ID" }, { status: 400 });
  }

  try {
    await prisma.job.delete({
      where: { id: jobId },
    });

    return NextResponse.json({ ok: true, id: jobId });
  } catch (err) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "岗位不存在或已删除" }, { status: 404 });
    }

    return NextResponse.json(
      { error: "删除失败", details: err?.message },
      { status: 500 },
    );
  }
}
