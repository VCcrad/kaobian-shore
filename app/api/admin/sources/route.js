import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sources = await prisma.source.findMany({
      orderBy: [{ priority: "desc" }, { name: "asc" }],
    });
    return NextResponse.json(sources);
  } catch (err) {
    return NextResponse.json(
      { error: "读取来源列表失败", details: err?.message },
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

  const name = String(body?.name ?? "").trim();
  const province = String(body?.province ?? "").trim();
  const url = String(body?.url ?? "").trim();
  const type = String(body?.type ?? "其他").trim();

  if (!name || !province || !url) {
    return NextResponse.json(
      { error: "name、province、url 为必填项" },
      { status: 400 },
    );
  }

  let parserConfig = null;
  if (body?.parserConfig != null && body.parserConfig !== "") {
    if (typeof body.parserConfig === "object") {
      parserConfig = body.parserConfig;
    } else {
      try {
        parserConfig = JSON.parse(String(body.parserConfig));
      } catch {
        return NextResponse.json(
          { error: "parserConfig 必须是合法 JSON" },
          { status: 400 },
        );
      }
    }
  }

  try {
    const source = await prisma.source.create({
      data: {
        name,
        province,
        city: String(body?.city ?? "").trim() || null,
        type,
        url,
        priority: Number(body?.priority) || 5,
        updateFrequency: String(body?.updateFrequency ?? "daily").trim(),
        status: String(body?.status ?? "active").trim(),
        parserConfig,
      },
    });
    return NextResponse.json(source, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "创建来源失败", details: err?.message },
      { status: 500 },
    );
  }
}
