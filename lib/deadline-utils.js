const PLACEHOLDER_DEADLINE =
  /未明确|另行通知|长期|常年|面议|不限|待定|招满即止|详见|以公告为准/i;

/** 非真实日期的 deadline 占位文案 */
export function isPlaceholderDeadline(value) {
  const str = String(value ?? "").trim();
  return !str || PLACEHOLDER_DEADLINE.test(str);
}

/** 截止日后超过该天数则移入垃圾桶 */
export const ARCHIVE_GRACE_DAYS = 5;

/** 解析 deadline 字符串为 Date（支持 YYYY-MM-DD 与中文日期） */
export function parseDeadlineDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
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

/** 与前台「剩余天数」一致的截止时刻 */
export function resolveDeadlineEndDate(value) {
  const str = String(value ?? "").trim();
  if (!str || isPlaceholderDeadline(str)) return null;

  const parsed = parseDeadlineDate(str);
  if (parsed) return parsed;

  const fallback = new Date(`${str}T23:59:59`);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** 截止日后经过 graceDays 天即视为应进垃圾桶 */
export function isDeadlineExpiredByDays(deadline, graceDays = 7, now = new Date()) {
  const end = parseDeadlineDate(deadline);
  if (!end) return false;
  const threshold = new Date(end);
  threshold.setDate(threshold.getDate() + graceDays);
  return threshold < now;
}

/** JobPosting：截止后满 graceDays 天移入垃圾桶；无 deadline 不自动归档 */
export function shouldArchiveJobPosting(
  job,
  now = new Date(),
  graceDays = ARCHIVE_GRACE_DAYS,
) {
  if (!job?.deadline) return false;
  return isDeadlineExpiredByDays(job.deadline, graceDays, now);
}

/** 是否应移入垃圾桶：已过期，或无有效截止日期（如「未明确」） */
export function shouldArchivePublishedJob(job, now = new Date()) {
  const end = resolveDeadlineEndDate(job?.deadline);
  if (end) return end < now;
  return true;
}

/** 前台列表是否展示：有效截止日期且未过期 */
export function isPublishedJobVisible(job, now = new Date()) {
  const end = resolveDeadlineEndDate(job?.deadline);
  if (!end) return false;
  return end >= now;
}

/** 前台/小程序 feed：未过期可展示；截止已过满 graceDays 天则不再返回 */
export function isJobOnPublicFeed(job, now = new Date(), graceDays = 7) {
  const deadline = job?.deadline;
  if (isDeadlineExpiredByDays(deadline, graceDays, now)) return false;
  return isPublishedJobVisible(job, now);
}
