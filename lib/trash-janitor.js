import { prisma } from "@/lib/prisma";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { runTrashJanitor: runTrashJanitorCjs } = require("./trash-janitor.cjs");

/** 过期软删 + 垃圾桶满 7 天物理蒸发（与爬虫、API 共用） */
export async function runTrashJanitor() {
  return runTrashJanitorCjs(prisma);
}
