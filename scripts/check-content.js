/**
 * 全链路实弹联调：通用页面+附件穿透 + 考编资格匹配引擎
 * 运行：node scripts/check-content.js
 */

const { checkJobQualification } = require("../utils/matcher");
const {
  getHunanDemoLines,
  HUNAN_DEMO_URL,
} = require("../lib/fetch-demo-job-lines.cjs");

const testProfile = {
  age: 28,
  isPartyMember: false,
  major: "辅导员",
};

const LINE_PREVIEW_LEN = 160;

function previewLine(text) {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  if (oneLine.length <= LINE_PREVIEW_LEN) return oneLine;
  return `${oneLine.slice(0, LINE_PREVIEW_LEN)}…`;
}

function runMatcherStorm(lines, profile) {
  let perfectCount = 0;
  let conflictCount = 0;
  let normalCount = 0;

  console.log("\n══════════ 按行暴风匹配 ══════════\n");
  console.log(
    "[测试画像]",
    `年龄 ${profile.age}`,
    `党员 ${profile.isPartyMember}`,
    `专业 ${profile.major}`,
    "\n",
  );

  for (const lineText of lines) {
    const result = checkJobQualification(profile, lineText);
    const preview = previewLine(lineText);

    if (result.finalStatus === "PERFECT") {
      perfectCount += 1;
      const hl = result.majorMatch.highlight || profile.major;
      console.log(`[🔥 完美匹配专业:${hl}] -> ${preview}`);
      continue;
    }

    if (result.finalStatus === "CONFLICT") {
      conflictCount += 1;
      const reason =
        result.ageMatch.reason || result.partyMatch.reason || "条件不符";
      console.log(`[❌ 条件冲突：${reason}] -> ${preview}`);
      continue;
    }

    normalCount += 1;
  }

  return {
    totalLines: lines.length,
    perfectCount,
    conflictCount,
    normalCount,
  };
}

async function main() {
  console.log("[check-content] 湖南人社厅 · 抓取 + 匹配引擎全链路联调\n");
  console.log("目标 URL:", HUNAN_DEMO_URL);

  const lines = await getHunanDemoLines({ useCache: true });
  const text = lines.join("\n");

  console.log("\n[抓取完成] 有效文本行数:", lines.length);
  console.log(
    "[抓取完成] 含附件透视标记:",
    text.includes("--- 发现附件透视文本") ? "是 ✓" : "否 ✗",
  );

  const report = runMatcherStorm(lines, testProfile);

  console.log("\n══════════ 【战报摘要】 ══════════");
  console.log(`  有效文本行数：${report.totalLines}`);
  console.log(`  🔥 完美命中行：${report.perfectCount}`);
  console.log(`  ❌ 冲突拒绝行：${report.conflictCount}`);
  console.log(`  · 普通未命中行：${report.normalCount}`);
}

main()
  .catch((err) => {
    console.error("[check-content] 联调失败:", err.message);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
