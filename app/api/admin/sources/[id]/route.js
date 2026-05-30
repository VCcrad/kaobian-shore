import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function parseParserConfig(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  return JSON.parse(String(value));
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少来源 ID" }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const data = {};
  const stringFields = [
    "name",
    "province",
    "city",
    "type",
    "url",
    "updateFrequency",
    "status",
  ];
  for (const key of stringFields) {
    if (body?.[key] !== undefined) {
      const val = String(body[key] ?? "").trim();
      data[key] = key === "city" ? val || null : val;
    }
  }
  if (body?.priority !== undefined) {
    data.priority = Number(body.priority) || 5;
  }
  if (body?.parserConfig !== undefined) {
    try {
      data.parserConfig = parseParserConfig(body.parserConfig);
    } catch {
      return NextResponse.json(
        { error: "parserConfig 必须是合法 JSON" },
        { status: 400 },
      );
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新字段" }, { status: 400 });
  }

  try {
    const source = await prisma.source.update({ where: { id }, data });
    return NextResponse.json(source);
  } catch (err) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "来源不存在" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "更新来源失败", details: err?.message },
      { status: 500 },
    );
  }
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少来源 ID" }, { status: 400 });
  }

  try {
    const count = await prisma.jobPosting.count({ where: { sourceId: id } });
    if (count > 0) {
      return NextResponse.json(
        { error: `该来源下仍有 ${count} 条岗位，请先删除岗位再删来源` },
        { status: 409 },
      );
    }
    await prisma.source.delete({ where: { id } });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "来源不存在" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "删除来源失败", details: err?.message },
      { status: 500 },
    );
  }
}
