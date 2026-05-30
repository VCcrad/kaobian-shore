import {
  shouldArchivePublishedJob,
  shouldArchiveJobPosting,
} from "./deadline-utils.js";
import { getArchiveGraceDays } from "./site-settings.cjs";

async function archiveExpiredLegacyJobs(prisma) {
  const now = new Date();

  const activeJobs = await prisma.job.findMany({
    where: { isDeleted: false },
    select: { id: true, deadline: true, createdAt: true },
  });

  const idsToArchive = activeJobs
    .filter((job) => shouldArchivePublishedJob(job, now))
    .map((job) => job.id);

  if (idsToArchive.length === 0) {
    return { count: 0 };
  }

  const result = await prisma.job.updateMany({
    where: { id: { in: idsToArchive }, isDeleted: false },
    data: { isDeleted: true, deletedAt: now },
  });

  if (result.count > 0) {
    console.log(`[前台清道夫] 已将 ${result.count} 个 legacy 过期岗位移入垃圾桶`);
  }

  return result;
}

async function archiveExpiredJobPostings(prisma, graceDays) {
  const days =
    graceDays != null ? graceDays : await getArchiveGraceDays(prisma);
  const now = new Date();

  const activeJobs = await prisma.jobPosting.findMany({
    where: { isDeleted: false, deadline: { not: null } },
    select: { id: true, deadline: true },
  });

  const idsToArchive = activeJobs
    .filter((job) => shouldArchiveJobPosting(job, now, days))
    .map((job) => job.id);

  if (idsToArchive.length === 0) {
    return { count: 0 };
  }

  const result = await prisma.jobPosting.updateMany({
    where: { id: { in: idsToArchive }, isDeleted: false },
    data: { isDeleted: true, deletedAt: now },
  });

  if (result.count > 0) {
    console.log(
      `[前台清道夫] 已将 ${result.count} 个截止超过 ${days} 天的岗位移入垃圾桶`,
    );
  }

  return result;
}

/** 将过期岗位软删除（legacy Job + JobPosting） */
export async function archiveExpiredPublishedJobs(prisma) {
  const graceDays = await getArchiveGraceDays(prisma);
  const [legacy, postings] = await Promise.all([
    archiveExpiredLegacyJobs(prisma),
    archiveExpiredJobPostings(prisma, graceDays),
  ]);

  return {
    count: legacy.count + postings.count,
    legacyJobs: legacy.count,
    jobPostings: postings.count,
  };
}
