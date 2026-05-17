import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatTitle, parseSlots } from "@/lib/job-utils";

export async function GET() {
  try {
    const jobs = await prisma.job.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(jobs);
  } catch (err) {
    return NextResponse.json(
      { error: "读取岗位列表失败", details: err?.message },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const {
    title: rawTitle,
    deadline: rawDeadline,
    majors: rawMajors,
    major: rawMajor,
    slots: rawSlots,
    headcount,
    sourceUrl: rawSourceUrl,
    link: rawLink,
  } = body ?? {};

  const title = formatTitle(rawTitle ?? "");
  const deadline = String(rawDeadline ?? "").trim();
  const majors = String(rawMajors ?? rawMajor ?? "").trim();
  const slots = parseSlots(rawSlots ?? headcount);
  const sourceUrl =
    String(rawSourceUrl ?? rawLink ?? "")
      .trim() || null;

  if (!title) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }

  try {
    const job = await prisma.job.create({
      data: {
        title,
        deadline,
        majors,
        slots,
        sourceUrl,
      },
    });

    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "写入数据库失败", details: err?.message },
      { status: 500 },
    );
  }
}
