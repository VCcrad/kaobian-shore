/**
 * 考编资格高亮匹配器（小程序前端 · 与后端 utils/matcher.js 同源）
 * 防御性设计，不抛未捕获异常
 */

const AGE_LIMIT_PATTERNS = [
  /(\d{1,3})\s*周岁以下/u,
  /不超过\s*(\d{1,3})\s*周岁/u,
  /(\d{1,3})\s*周岁\s*及\s*以下/u,
  /(\d{1,3})\s*岁\s*及\s*以下/u,
  /年龄\s*(?:在\s*)?(\d{1,3})\s*周岁/u,
];

const PARTY_REQUIRED_KEYWORDS = [
  "中共党员",
  "限党员",
  "面向党员",
  "须为中共党员",
  "须中共党员",
  "限中共党员",
];

function safeString(value) {
  if (value == null) return "";
  return String(value);
}

function safeProfile(userProfile) {
  if (userProfile == null || typeof userProfile !== "object") {
    return { age: undefined, isPartyMember: undefined, major: "" };
  }
  return {
    age: userProfile.age,
    isPartyMember: userProfile.isPartyMember,
    major: safeString(userProfile.major).trim(),
  };
}

function parseAgeLimit(jobText) {
  for (let i = 0; i < AGE_LIMIT_PATTERNS.length; i += 1) {
    const pattern = AGE_LIMIT_PATTERNS[i];
    const match = jobText.match(pattern);
    if (match && match[1] != null) {
      const limit = parseInt(match[1], 10);
      if (isFinite(limit) && limit > 0 && limit < 200) {
        return limit;
      }
    }
  }
  return null;
}

function checkAgeMatch(userProfile, jobText) {
  const limit = parseAgeLimit(jobText);
  if (limit == null) {
    return { pass: true };
  }

  const userAge = Number(userProfile.age);
  if (!isFinite(userAge)) {
    return { pass: true };
  }

  if (userAge > limit) {
    return {
      pass: false,
      reason: "年龄超限（岗位限 " + limit + " 周岁以下）",
    };
  }

  return { pass: true };
}

function checkPartyMatch(userProfile, jobText) {
  let requiresParty = false;
  for (let i = 0; i < PARTY_REQUIRED_KEYWORDS.length; i += 1) {
    if (jobText.indexOf(PARTY_REQUIRED_KEYWORDS[i]) !== -1) {
      requiresParty = true;
      break;
    }
  }

  if (!requiresParty) {
    return { pass: true };
  }

  if (userProfile.isPartyMember === false) {
    return {
      pass: false,
      reason: "政治面貌不符（该岗位限中共党员）",
    };
  }

  return { pass: true };
}

function checkMajorMatch(userProfile, jobText) {
  const major = userProfile.major;
  if (!major) {
    return { pass: false };
  }

  if (jobText.indexOf(major) !== -1) {
    return { pass: true, highlight: major };
  }

  return { pass: false };
}

function resolveFinalStatus(ageMatch, partyMatch, majorMatch) {
  if (ageMatch.pass === false || partyMatch.pass === false) {
    return "CONFLICT";
  }
  if (majorMatch.pass === true) {
    return "PERFECT";
  }
  return "NORMAL";
}

/**
 * @param {object|null|undefined} userProfile - { age, isPartyMember, major }
 * @param {string|null|undefined} jobText
 */
function checkJobQualification(userProfile, jobText) {
  try {
    const profile = safeProfile(userProfile);
    const text = safeString(jobText).trim();

    if (!text) {
      return {
        ageMatch: { pass: true },
        partyMatch: { pass: true },
        majorMatch: { pass: false },
        finalStatus: "NORMAL",
      };
    }

    const ageMatch = checkAgeMatch(profile, text);
    const partyMatch = checkPartyMatch(profile, text);
    const majorMatch = checkMajorMatch(profile, text);
    const finalStatus = resolveFinalStatus(ageMatch, partyMatch, majorMatch);

    return {
      ageMatch: ageMatch,
      partyMatch: partyMatch,
      majorMatch: majorMatch,
      finalStatus: finalStatus,
    };
  } catch (err) {
    return {
      ageMatch: { pass: true },
      partyMatch: { pass: true },
      majorMatch: { pass: false },
      finalStatus: "NORMAL",
    };
  }
}

module.exports = {
  checkJobQualification: checkJobQualification,
};
