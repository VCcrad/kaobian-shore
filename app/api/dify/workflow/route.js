import { NextResponse } from "next/server";

// ★ 配置入口：优先读项目根目录 .env.local（推荐）
//   第 5 行 DIFY_API_URL  → Dify「访问 API」里的工作流运行地址
//   第 8 行 DIFY_API_KEY  → Dify「访问 API」里生成的 API 密钥
// 未配置 .env.local 时，才会使用下面两行默认值：
const DIFY_API_URL =
  process.env.DIFY_API_URL || "http://localhost/v1/workflows/run";
const DIFY_API_KEY = process.env.DIFY_API_KEY || "";

export async function POST(request) {
  if (!DIFY_API_KEY) {
    return NextResponse.json(
      {
        error:
          "未配置 DIFY_API_KEY。请在项目根目录 .env.local 中填入 Dify API 密钥后重启开发服务。",
      },
      { status: 500 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const rawText = body?.raw_text?.trim();
  if (!rawText) {
    return NextResponse.json(
      { error: "缺少 raw_text：请粘贴招聘公告原文" },
      { status: 400 },
    );
  }

  try {
    const difyRes = await fetch(DIFY_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DIFY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: { raw_text: rawText },
        response_mode: "blocking",
        user: "anbian-admin",
      }),
    });

    const data = await difyRes.json().catch(() => ({}));

    if (!difyRes.ok) {
      return NextResponse.json(
        {
          error: data?.message || data?.code || `Dify 返回错误 ${difyRes.status}`,
          details: data,
        },
        { status: difyRes.status },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "无法连接 Dify。请确认 Dify 已启动，且 DIFY_API_URL 地址正确（常见为 http://localhost/v1/workflows/run）。",
        details: err?.message,
      },
      { status: 502 },
    );
  }
}
