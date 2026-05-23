import { shouldArchivePublishedJob } from "./deadline-utils.js";

/** 将过期前台岗位软删除（爬虫与 API/首页共用） */
export async function archiveExpiredPublishedJobs(prisma) {
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
    console.log(`[前台清道夫] 已将 ${result.count} 个过期岗位移入垃圾桶`);
  }

  return result;
}
