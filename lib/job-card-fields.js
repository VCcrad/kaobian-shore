import { normalizeEducationValue } from "./education-utils.js";
import { formatMajorRequirement } from "./major-utils.js";
import { buildJobProvinceCity } from "./region-display.js";
import { sanitizeOrganizationName } from "./job-posting-text.js";
import {
  extractQualificationRequirements,
  formatQualificationRequirements,
} from "./qualification-requirements.js";

function cleanDisplayValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "—" || text === "不限" || text === "无") return "";
  return text;
}

/** 收集可能含其他要求的原始字段（不做展示，只供抽取） */
function collectQualificationSources(requirements = {}, other = {}, text = "") {
  const sources = [];

  const scope = Array.isArray(other.employmentScope)
    ? other.employmentScope.join("；")
    : cleanDisplayValue(other.employmentScope);
  if (scope) sources.unshift(scope);

  const rowOther = cleanDisplayValue(other.otherRequirement);
  if (rowOther) sources.push(rowOther);

  const jobSlots = Array.isArray(other.jobSlots) ? other.jobSlots : [];
  for (const slot of jobSlots) {
    const cell = cleanDisplayValue(slot?.otherRequirement);
    if (cell) sources.push(cell);
  }

  const notes = cleanDisplayValue(requirements.notes);
  if (notes) sources.push(notes);

  const overall = cleanDisplayValue(other.overallRequirements);
  if (overall && overall !== notes) sources.push(overall);

  const rawSnippet = String(text ?? "").trim();
  if (rawSnippet && !rowOther) sources.push(rawSnippet.slice(0, 2000));

  return sources;
}

function formatSlotsLabel(numPositions, slotsValue) {
  if (typeof slotsValue === "number" && slotsValue > 0) {
    return `${slotsValue} 人`;
  }
  const raw = cleanDisplayValue(numPositions);
  if (raw) return /^\d+$/.test(raw) ? `${raw} 人` : raw;
  return "";
}

/**
 * @param {{ job: object, requirements?: object, other?: object, text?: string }} input
 */
export function buildJobCardDisplayFields(input) {
  const job = input.job || {};
  const requirements =
    input.requirements && typeof input.requirements === "object"
      ? input.requirements
      : {};
  const other =
    requirements.other && typeof requirements.other === "object"
      ? { ...requirements.other, ...(input.other || {}) }
      : input.other || {};

  const text = String(input.text ?? job.rawText ?? "").trim();
  const source = job.source || {};

  const majorRequirements = Array.isArray(requirements.majorRequirements)
    ? requirements.majorRequirements
    : requirements.majorRequirements
      ? [String(requirements.majorRequirements)]
      : [];

  const rowMajor = cleanDisplayValue(other.majorRequirement);
  const hasMultiJobTable =
    Array.isArray(other.structuredJobs) && other.structuredJobs.length > 1;
  const majorRequirement = formatMajorRequirement(
    rowMajor && rowMajor !== "—"
      ? rowMajor
      : !hasMultiJobTable && majorRequirements.length > 0
        ? majorRequirements
        : "",
  );

  const rowSlots =
    typeof other.slots === "number" && other.slots > 0
      ? other.slots
      : typeof other.slots === "string" && /^\d+$/.test(other.slots)
        ? Number.parseInt(other.slots, 10)
        : null;

  const numPositions = requirements.numPositions;
  const slotsValue =
    rowSlots != null
      ? rowSlots
      : typeof numPositions === "number"
        ? numPositions
        : typeof numPositions === "string" && /^\d+$/.test(numPositions)
          ? Number.parseInt(numPositions, 10)
          : typeof other.jobSlots?.length === "number" && other.jobSlots.length > 0
            ? other.jobSlots.reduce(
                (sum, row) => sum + (Number(row?.slots) || 0),
                0,
              ) || null
            : null;

  const qualSources = collectQualificationSources(requirements, other, text);
  const otherRequirements = extractQualificationRequirements(...qualSources);

  const provinceCity =
    buildJobProvinceCity({
      province: job.province,
      city: other.city,
      sourceProvince: source.province,
      sourceCity: source.city,
      text,
    }) || "待定";

  return {
    provinceCity,
    slots: typeof slotsValue === "number" ? slotsValue : 0,
    slotsLabel: formatSlotsLabel(numPositions, slotsValue),
    majorRequirement,
    ageRequirement: cleanDisplayValue(requirements.ageLimit),
    education: cleanDisplayValue(
      normalizeEducationValue(requirements.education || other.education),
    ),
    politicalRequirement: cleanDisplayValue(requirements.politicalStatus),
    qualificationRequirements: otherRequirements,
    certificateRequirements: otherRequirements,
    specialRequirements: otherRequirements.join("、"),
    otherRequirements: otherRequirements.join("、"),
  };
}

export { extractQualificationRequirements, formatQualificationRequirements };
