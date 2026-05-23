import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await prisma.schoolStatus.findMany({
      orderBy: [{ status: "asc" }, { schoolName: "asc" }],
    });

    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json(
      { error: "读取学校监控状态失败", details: err?.message },
      { status: 500 },
    );
  }
}
