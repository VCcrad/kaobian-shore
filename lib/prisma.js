import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis;

/** 模型变更后递增，避免 dev 热更新仍复用旧的 PrismaClient 实例 */
const PRISMA_CLIENT_REVISION = "job-sourceUrl-v1";

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  return new PrismaClient({ adapter });
}

function getPrisma() {
  if (
    process.env.NODE_ENV !== "production" &&
    globalForPrisma.prismaRevision !== PRISMA_CLIENT_REVISION
  ) {
    void globalForPrisma.prisma?.$disconnect?.();
    globalForPrisma.prisma = undefined;
    globalForPrisma.prismaRevision = PRISMA_CLIENT_REVISION;
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prismaRevision = PRISMA_CLIENT_REVISION;
    }
  }

  return globalForPrisma.prisma;
}

export const prisma = getPrisma();
