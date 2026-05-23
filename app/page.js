import HomeClient from "./home-client";
import { fetchHomeJobs } from "@/lib/fetch-home-jobs";

export const dynamic = "force-dynamic";

/** 首页：展示后台已发布且未过期的 Job 表数据 */
export default async function Home() {
  let jobs = [];

  try {
    jobs = await fetchHomeJobs();
  } catch (err) {
    console.error("[首页] 加载岗位失败:", err);
  }

  return <HomeClient initialJobs={jobs} />;
}
