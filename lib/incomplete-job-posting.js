/** 解析 JobPosting 招聘人数（与后台列表展示一致） */
export function resolveJobPostingSlots(job) {
  const requirements =
    job?.requirements && typeof job.requirements === "object"
      ? job.requirements
      : {};
  const other =
    requirements.other && typeof requirements.other === "object"
      ? requirements.other
      : {};

  if (typeof other.slots === "number" && other.slots > 0) return other.slots;
  if (
    typeof other.announcementHeadcount === "number" &&
    other.announcementHeadcount > 0
  ) {
    return other.announcementHeadcount;
  }

  const fromFields =
    Number(other.numPositions) || Number(requirements.numPositions) || 0;
  if (fromFields > 0) return fromFields;

  return 0;
}

function hasValidDate(value) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
}

/** 无截止日期、无发布日期、无招聘人数 */
export function isIncompleteJobPosting(job) {
  const hasDeadline = hasValidDate(job?.deadline);
  const hasPublishDate = hasValidDate(job?.publishDate);
  const hasSlots = resolveJobPostingSlots(job) > 0;
  return !hasDeadline && !hasPublishDate && !hasSlots;
}

/** 后台列表项（已格式化字段） */
export function isIncompleteJobListItem(job) {
  const hasDeadline = Boolean(String(job?.deadline ?? "").trim());
  const hasPublishDate = Boolean(String(job?.publishDate ?? "").trim());
  const hasSlots = Number(job?.slots) > 0;
  return !hasDeadline && !hasPublishDate && !hasSlots;
}
