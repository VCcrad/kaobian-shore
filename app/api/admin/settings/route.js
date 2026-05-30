import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const {
  getSiteSettings,
  updateSiteSettings,
  MIN_ARCHIVE_GRACE_DAYS,
  MAX_ARCHIVE_GRACE_DAYS,
} = require("../../../../lib/site-settings.cjs");

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSiteSettings(prisma);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: "读取设置失败", details: err?.message },
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

  if (body?.archiveGraceDays === undefined) {
    return NextResponse.json(
      { error: "缺少 archiveGraceDays" },
      { status: 400 },
    );
  }

  const days = Number(body.archiveGraceDays);
  if (
    !Number.isFinite(days) ||
    days < MIN_ARCHIVE_GRACE_DAYS ||
    days > MAX_ARCHIVE_GRACE_DAYS
  ) {
    return NextResponse.json(
      {
        error: `archiveGraceDays 须在 ${MIN_ARCHIVE_GRACE_DAYS}–${MAX_ARCHIVE_GRACE_DAYS} 之间`,
      },
      { status: 400 },
    );
  }

  try {
    const settings = await updateSiteSettings(prisma, {
      archiveGraceDays: days,
    });
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: "保存设置失败", details: err?.message },
      { status: 500 },
    );
  }
}
