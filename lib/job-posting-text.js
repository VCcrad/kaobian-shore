/** 检测岗位文本是否乱码或含 Excel 垃圾标记（API / seed 共用） */

export function isGarbledText(text) {
  const value = String(text ?? "").trim();
  if (!value) return true;

  if (/工作表:\s*Sheet/i.test(value)) return true;
  if (/^---+\s*$/u.test(value)) return true;
  if (/[ÃÂÐÞæœ]|ï¿½|â€/.test(value)) return true;
  if (/nèh\s*kâ|nánh|tuổi/i.test(value)) return true;

  const cjk = (value.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (value.length > 40 && cjk < 2) return true;

  return false;
}

export function buildJobPostingDisplayText(job, requirements = {}, other = {}) {
  const majorRequirements = Array.isArray(requirements.majorRequirements)
    ? requirements.majorRequirements
    : requirements.majorRequirements
      ? [String(requirements.majorRequirements)]
      : [];
  const majorText =
    majorRequirements.length > 0 ? majorRequirements.join("、") : "";

  const parts = [
    job.title,
    other.organization || job.source?.name,
    requirements.ageLimit ? `年龄要求：${requirements.ageLimit}` : "",
    requirements.politicalStatus ? `政治面貌：${requirements.politicalStatus}` : "",
    majorText ? `专业要求：${majorText}` : "",
    other.education ? `学历：${other.education}` : "",
    requirements.notes || "",
  ].filter(Boolean);

  const rebuilt = parts.join(" ").trim();
  const raw = String(job.rawText ?? "").trim();

  if (raw && !isGarbledText(raw)) return raw;
  return rebuilt || String(job.title ?? "").trim();
}

export function sanitizeJobPostingTitle(title, fallback = "未命名岗位") {
  const value = String(title ?? "").trim();
  if (!value || isGarbledText(value)) return fallback;
  return value;
}
