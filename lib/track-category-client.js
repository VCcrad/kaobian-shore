/**
 * Client Component 安全导出（无 createRequire）
 * 常量与 normalize 逻辑须与 lib/track-filters.cjs 保持同步
 */

export const TRACK_CATEGORIES = {
  HIGH_SCHOOL: "高校院所招聘",
  PHD: "博士/申博/博后",
  LOCAL_GOV: "地方编制求职",
};

export const TRACK_CATEGORY_LIST = Object.values(TRACK_CATEGORIES);

export function normalizeTrackCategory(value) {
  const str = String(value ?? "").trim();
  if (TRACK_CATEGORY_LIST.includes(str)) return str;

  if (/博士|申博|博后|招生简章|考核制|博士后/.test(str)) {
    return TRACK_CATEGORIES.PHD;
  }
  if (/事业编|事业单位|人才引进|编制|选调/.test(str)) {
    return TRACK_CATEGORIES.LOCAL_GOV;
  }
  if (/高校|大学|学院|辅导员|科研助理|研究所|院所/.test(str)) {
    return TRACK_CATEGORIES.HIGH_SCHOOL;
  }

  return "";
}
