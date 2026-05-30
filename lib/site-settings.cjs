const DEFAULT_ARCHIVE_GRACE_DAYS = 5;
const MIN_ARCHIVE_GRACE_DAYS = 0;
const MAX_ARCHIVE_GRACE_DAYS = 365;

function normalizeArchiveGraceDays(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_ARCHIVE_GRACE_DAYS;
  return Math.min(MAX_ARCHIVE_GRACE_DAYS, Math.max(MIN_ARCHIVE_GRACE_DAYS, n));
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getArchiveGraceDays(prisma) {
  try {
    const row = await prisma.siteSettings.findUnique({
      where: { id: "default" },
      select: { archiveGraceDays: true },
    });
    if (row) return normalizeArchiveGraceDays(row.archiveGraceDays);
  } catch {
    /* 表未迁移等场景回退默认值 */
  }
  return DEFAULT_ARCHIVE_GRACE_DAYS;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getSiteSettings(prisma) {
  const archiveGraceDays = await getArchiveGraceDays(prisma);
  return { archiveGraceDays };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ archiveGraceDays?: number }} patch
 */
async function updateSiteSettings(prisma, patch) {
  const archiveGraceDays = normalizeArchiveGraceDays(
    patch?.archiveGraceDays ?? DEFAULT_ARCHIVE_GRACE_DAYS,
  );

  const row = await prisma.siteSettings.upsert({
    where: { id: "default" },
    create: { id: "default", archiveGraceDays },
    update: { archiveGraceDays },
  });

  return { archiveGraceDays: row.archiveGraceDays };
}

module.exports = {
  DEFAULT_ARCHIVE_GRACE_DAYS,
  MIN_ARCHIVE_GRACE_DAYS,
  MAX_ARCHIVE_GRACE_DAYS,
  normalizeArchiveGraceDays,
  getArchiveGraceDays,
  getSiteSettings,
  updateSiteSettings,
};
