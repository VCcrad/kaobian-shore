import { NextResponse } from "next/server";
import { exec } from "child_process";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少来源 ID" }, { status: 400 });
  }

  try {
    const source = await prisma.source.findUnique({ where: { id } });
    if (!source) {
      return NextResponse.json({ error: "来源不存在" }, { status: 404 });
    }

    const root = process.cwd();
    const safeName = source.name.replace(/"/g, '\\"');
    const cmd = `npx tsx scripts/crawler.ts --source="${safeName}"`;

    exec(cmd, { cwd: root, windowsHide: true }, (err) => {
      if (err) {
        console.error(`[admin recrawl] ${source.name} failed:`, err.message);
      }
    });

    return NextResponse.json({
      ok: true,
      message: `已在后台触发「${source.name}」抓取`,
      sourceId: id,
      sourceName: source.name,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "触发抓取失败", details: err?.message },
      { status: 500 },
    );
  }
}
