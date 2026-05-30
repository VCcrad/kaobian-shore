import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(_request, { params }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "无效的岗位 ID" }, { status: 400 });
  }

  try {
    const updated = await prisma.jobPosting.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "岗位不存在" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "移入垃圾桶失败", details: err?.message },
      { status: 500 },
    );
  }
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "无效的岗位 ID" }, { status: 400 });
  }

  try {
    await prisma.jobPosting.delete({ where: { id } });
    return NextResponse.json({ ok: true, id });
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
