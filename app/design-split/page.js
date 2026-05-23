import DesignSplitClient from "./design-split-client";
import { mockJobs } from "@/lib/mock-jobs";

export const dynamic = "force-dynamic";

/** 实验页：双栏分屏司令部 */
export default function DesignSplitPage() {
  return <DesignSplitClient jobs={mockJobs} />;
}
