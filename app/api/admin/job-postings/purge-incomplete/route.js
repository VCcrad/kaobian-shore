import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isIncompleteJobPosting } from "@/lib/incomplete-job-posting.js";

const { runTrashJanitor } = require("../../../../../lib/trash-janitor.cjs");

export const dynamic = "force-dynamic";

/** 一键将「三无」岗位移入垃圾桶：无截止日、无发布日、无招聘人数 */
export async function POST() {
  try {
    await runTrashJanitor(prisma);

    const jobs = await prisma.jobPosting.findMany({
      where: { isDeleted: false },
    });

    const targets = jobs.filter(isIncompleteJobPosting);
    if (targets.length === 0) {
      return NextResponse.json({ count: 0, ids: [] });
    }

    const now = new Date();
    const ids = targets.map((job) => job.id);

    await prisma.jobPosting.updateMany({
      where: { id: { in: ids }, isDeleted: false },
      data: { isDeleted: true, deletedAt: now },
    });

    return NextResponse.json({
      count: ids.length,
      ids,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "批量删除三无岗位失败", details: err?.message },
      { status: 500 },
    );
  }
}
