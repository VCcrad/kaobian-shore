const PLACEHOLDER_DEADLINE =
  /未明确|另行通知|长期|常年|面议|不限|待定|招满即止|详见|以公告为准/i;

function isPlaceholderDeadline(value) {
  const str = String(value ?? "").trim();
  return !str || PLACEHOLDER_DEADLINE.test(str);
}

function parseDeadlineDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (isPlaceholderDeadline(str)) return null;

  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const cn = str.match(/(\d{4})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5/);
  if (cn) {
    const [, y, m, d] = cn;
    const date = new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function resolveDeadlineEndDate(value) {
  const str = String(value ?? "").trim();
  if (!str || isPlaceholderDeadline(str)) return null;

  const parsed = parseDeadlineDate(str);
  if (parsed) return parsed;

  const fallback = new Date(`${str}T23:59:59`);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function isDeadlineExpiredByDays(deadline, graceDays = 7, now = new Date()) {
  const end = parseDeadlineDate(deadline);
  if (!end) return false;
  const threshold = new Date(end);
  threshold.setDate(threshold.getDate() + graceDays);
  return threshold < now;
}

/** 是否应移入垃圾桶：已过期，或无有效截止日期（如「未明确」） */
function shouldArchivePublishedJob(job, now = new Date()) {
  const end = resolveDeadlineEndDate(job?.deadline);
  if (end) return end < now;
  return true;
}

/** 前台列表是否展示：有效截止日期且未过期（与 lib/job-utils isPublishedJobVisible 一致） */
function isPublishedJobVisible(job, now = new Date()) {
  const end = resolveDeadlineEndDate(job?.deadline);
  if (!end) return false;
  return end >= now;
}

/**
 * 前台/小程序 feed：未过期可展示；截止已过满 graceDays 天则不再返回（视同蒸发删除）
 */
function isJobOnPublicFeed(job, now = new Date(), graceDays = 7) {
  const deadline = job?.deadline;
  if (isDeadlineExpiredByDays(deadline, graceDays, now)) return false;
  return isPublishedJobVisible(job, now);
}

module.exports = {
  parseDeadlineDate,
  resolveDeadlineEndDate,
  isPlaceholderDeadline,
  isDeadlineExpiredByDays,
  shouldArchivePublishedJob,
  isPublishedJobVisible,
  isJobOnPublicFeed,
};
