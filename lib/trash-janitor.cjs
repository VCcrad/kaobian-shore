/**
 * 智能垃圾桶：过期软删 + 满 7 天物理蒸发（与 scripts/spider-safe.js / 网页前台一致）
 */

const { archiveExpiredPublishedJobs } = require("./archive-expired-jobs.cjs");

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function runTrashJanitor(prisma) {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const archiveResult = await archiveExpiredPublishedJobs(prisma);

  const evaporatedJobs = await prisma.job.deleteMany({
    where: {
      isDeleted: true,
      deletedAt: { lt: sevenDaysAgo },
    },
  });

  const evaporatedRawJobs = await prisma.rawJob.deleteMany({
    where: {
      isDeleted: true,
      deletedAt: { lt: sevenDaysAgo },
    },
  });

  return {
    softDeleted: archiveResult.count,
    evaporatedJobs: evaporatedJobs.count,
    evaporatedRawJobs: evaporatedRawJobs.count,
  };
}

module.exports = { runTrashJanitor };
