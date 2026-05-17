import HomeClient from "./home-client";
import { mapJobToCard } from "@/lib/job-utils";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const rows = await prisma.job.findMany({
    orderBy: { createdAt: "desc" },
  });

  const jobs = rows.map(mapJobToCard);

  return <HomeClient initialJobs={jobs} />;
}
