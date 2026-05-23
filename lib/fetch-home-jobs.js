import { prisma } from "@/lib/prisma";
import { runTrashJanitor } from "@/lib/trash-janitor.js";
import { isPublishedJobVisible, mapJobToHomeCard } from "@/lib/job-utils";

/** 前台首页：已发布且未过期的岗位（与 /api/jobs GET 规则一致） */
export async function fetchHomeJobs() {
  await runTrashJanitor();

  const rows = await prisma.job.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: "desc" },
  });

  return rows.filter(isPublishedJobVisible).map(mapJobToHomeCard);
}
