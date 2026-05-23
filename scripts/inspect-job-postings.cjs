const { prisma } = require("../lib/prisma.cjs");

async function main() {
  const rows = await prisma.jobPosting.findMany({ orderBy: { createdAt: "desc" } });
  for (const row of rows) {
    const sample = String(row.rawText ?? "").slice(0, 80);
    const bad = /工作表:\s*Sheet|nèh|Ã|nánh/i.test(`${row.title}\n${sample}`);
    console.log(bad ? "BAD" : "OK ", row.title);
    if (bad) console.log("  ", sample.replace(/\n/g, " "));
  }
  console.log("total", rows.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
