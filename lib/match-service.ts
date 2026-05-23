import type { Prisma } from "@prisma/client";
import type { ParsedRequirements } from "./parse-attachment";

/** 与 Prisma UserProfile / 小程序画像对齐 */
export type UserProfileInput = {
  age?: number | null;
  major?: string | null;
  isPartyMember?: boolean | null;
  degree?: string | null;
  originPlace?: string | null;
};

/** 匹配服务所需的 JobPosting 字段（可来自 Prisma 查询结果） */
export type JobPostingInput = {
  id?: string;
  title?: string | null;
  rawText?: string | null;
  requirements?: ParsedRequirements | Prisma.JsonValue | null;
};

export type MatchStatus = "PERFECT" | "CONFLICT" | "NORMAL";

export type MatchResult = {
  matchStatus: MatchStatus;
  conflictReasons: string[];
  /** 细分结果，便于 API / 调试 */
  details: {
    age: { pass: boolean; limit?: number; reason?: string };
    party: { pass: boolean; reason?: string };
    major: { pass: boolean; matched?: string; reason?: string };
  };
};

const AGE_LIMIT_PATTERNS = [
  /(\d{1,3})\s*周岁\s*及?\s*以[下内]/u,
  /(\d{1,3})\s*周岁以下/u,
  /不超过\s*(\d{1,3})\s*周岁/u,
  /(\d{1,3})\s*岁\s*及?\s*以下/u,
  /年龄\s*(?:在\s*)?(\d{1,3})\s*周岁/u,
];

const PARTY_REQUIRED_KEYWORDS = [
  "中共党员",
  "中共预备党员",
  "预备党员",
  "限党员",
  "面向党员",
  "须为中共党员",
  "须中共党员",
  "限中共党员",
];

const MAJOR_UNLIMITED_KEYWORDS = [
  "专业不限",
  "不限专业",
  "专业要求不限",
  "不作限制",
];

/**
 * 后端智能匹配：UserProfile × JobPosting（结构化 requirements 优先，文本 fallback）
 */
export function matchJobPosting(
  userProfile: UserProfileInput | null | undefined,
  job: JobPostingInput | null | undefined,
): MatchResult {
  try {
    const profile = normalizeUserProfile(userProfile);
    const requirements = normalizeRequirements(job?.requirements);
    const jobText = buildJobMatchText(job, requirements);

    const ageCheck = checkAge(profile, requirements, jobText);
    const partyCheck = checkParty(profile, requirements, jobText);
    const majorCheck = checkMajor(profile, requirements, jobText);

    const conflictReasons: string[] = [];
    if (!ageCheck.pass && ageCheck.reason) conflictReasons.push(ageCheck.reason);
    if (!partyCheck.pass && partyCheck.reason) conflictReasons.push(partyCheck.reason);

  // 专业不匹配采用宽松策略：仅记录为 NORMAL，不写入 conflictReasons
    const matchStatus = resolveMatchStatus(ageCheck, partyCheck, majorCheck);

    return {
      matchStatus,
      conflictReasons,
      details: {
        age: ageCheck,
        party: partyCheck,
        major: majorCheck,
      },
    };
  } catch {
    return {
      matchStatus: "NORMAL",
      conflictReasons: [],
      details: {
        age: { pass: true },
        party: { pass: true },
        major: { pass: false, reason: "匹配异常，按无冲突处理" },
      },
    };
  }
}

/** 批量匹配并按 CONFLICT → PERFECT → NORMAL 排序 */
export function matchJobPostings(
  userProfile: UserProfileInput | null | undefined,
  jobs: JobPostingInput[],
): Array<JobPostingInput & { match: MatchResult }> {
  const ranked = jobs.map((job) => ({
    ...job,
    match: matchJobPosting(userProfile, job),
  }));

  const order: Record<MatchStatus, number> = {
    PERFECT: 0,
    NORMAL: 1,
    CONFLICT: 2,
  };

  return ranked.sort(
    (a, b) => order[a.match.matchStatus] - order[b.match.matchStatus],
  );
}

// ==================== 规则实现 ====================

function checkAge(
  profile: NormalizedUserProfile,
  requirements: ParsedRequirements,
  jobText: string,
): { pass: boolean; limit?: number; reason?: string } {
  const limit =
    parseAgeLimitFromString(requirements.ageLimit) ?? parseAgeLimitFromText(jobText);

  if (limit == null) return { pass: true };

  const userAge = profile.age;
  if (userAge == null || !Number.isFinite(userAge)) return { pass: true, limit };

  if (userAge > limit) {
    const over = userAge - limit;
    return {
      pass: false,
      limit,
      reason: `年龄超限 ${over} 岁`,
    };
  }

  return { pass: true, limit };
}

function checkParty(
  profile: NormalizedUserProfile,
  requirements: ParsedRequirements,
  jobText: string,
): { pass: boolean; reason?: string } {
  const requiresParty =
    requirements.politicalStatus === "中共党员" ||
    PARTY_REQUIRED_KEYWORDS.some((kw) => jobText.includes(kw));

  if (!requiresParty) return { pass: true };

  if (profile.isPartyMember === false) {
    return { pass: false, reason: "政治面貌不符" };
  }

  return { pass: true };
}

function checkMajor(
  profile: NormalizedUserProfile,
  requirements: ParsedRequirements,
  jobText: string,
): { pass: boolean; matched?: string; reason?: string } {
  const userMajor = profile.major;
  if (!userMajor) {
    return { pass: false, reason: "用户未填写专业" };
  }

  const majors = requirements.majorRequirements ?? [];
  const blob = [jobText, ...majors].join("\n");

  if (MAJOR_UNLIMITED_KEYWORDS.some((kw) => blob.includes(kw))) {
    return { pass: true, matched: userMajor };
  }

  if (majors.length > 0) {
    const hit = majors.find(
      (item) => majorMatches(userMajor, item) || blob.includes(userMajor),
    );
    if (hit) return { pass: true, matched: hit };
  }

  if (jobText.includes(userMajor)) {
    return { pass: true, matched: userMajor };
  }

  return { pass: false, reason: "专业未命中岗位要求（宽松模式，标记 NORMAL）" };
}

function resolveMatchStatus(
  age: { pass: boolean },
  party: { pass: boolean },
  major: { pass: boolean },
): MatchStatus {
  if (!age.pass || !party.pass) return "CONFLICT";
  if (major.pass) return "PERFECT";
  return "NORMAL";
}

// ==================== 工具函数 ====================

type NormalizedUserProfile = {
  age?: number;
  major: string;
  isPartyMember?: boolean;
};

function normalizeUserProfile(
  userProfile: UserProfileInput | null | undefined,
): NormalizedUserProfile {
  if (!userProfile || typeof userProfile !== "object") {
    return { major: "" };
  }

  const ageRaw = userProfile.age;
  const age =
    ageRaw == null || ageRaw === ""
      ? undefined
      : Number.parseInt(String(ageRaw), 10);

  return {
    age: Number.isFinite(age) ? age : undefined,
    major: String(userProfile.major ?? "").trim(),
    isPartyMember:
      userProfile.isPartyMember == null
        ? undefined
        : Boolean(userProfile.isPartyMember),
  };
}

function normalizeRequirements(
  input: ParsedRequirements | Prisma.JsonValue | null | undefined,
): ParsedRequirements {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as ParsedRequirements;
}

function buildJobMatchText(
  job: JobPostingInput | null | undefined,
  requirements: ParsedRequirements,
): string {
  const majors = Array.isArray(requirements.majorRequirements)
    ? requirements.majorRequirements.join("、")
    : "";

  return [
    job?.title,
    job?.rawText,
    requirements.ageLimit && `年龄要求：${requirements.ageLimit}`,
    requirements.politicalStatus && `政治面貌：${requirements.politicalStatus}`,
    majors && `专业要求：${majors}`,
    requirements.notes,
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseAgeLimitFromString(value?: string | null): number | null {
  if (!value) return null;
  return parseAgeLimitFromText(String(value));
}

function parseAgeLimitFromText(text: string): number | null {
  for (const pattern of AGE_LIMIT_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1] != null) {
      const limit = Number.parseInt(match[1], 10);
      if (Number.isFinite(limit) && limit > 0 && limit < 200) {
        return limit;
      }
    }
  }
  return null;
}

function majorMatches(userMajor: string, requirement: string): boolean {
  const req = String(requirement ?? "").trim();
  if (!req) return false;
  if (req.includes(userMajor)) return true;
  if (userMajor.includes(req)) return true;
  return false;
}
