export const USER_PROFILE_STORAGE_KEY = "userProfile";

export const DEFAULT_USER_PROFILE = {
  age: 28,
  major: "辅导员",
  majors: "辅导员",
  isPartyMember: false,
  politicalStatus: "群众",
};

export function normalizeUserProfile(data) {
  const ageRaw = Number.parseInt(String(data?.age ?? DEFAULT_USER_PROFILE.age), 10);
  const age = Number.isFinite(ageRaw) ? ageRaw : DEFAULT_USER_PROFILE.age;
  const major = String(data?.major ?? "").trim() || DEFAULT_USER_PROFILE.major;
  const isPartyMember =
    data?.isPartyMember === true ||
    data?.politicalStatus === "党员" ||
    String(data?.politicalStatus ?? "").includes("党员");

  return {
    age,
    major,
    majors: major,
    isPartyMember,
    politicalStatus: isPartyMember ? "党员" : "群众",
  };
}

export function readUserProfileFromStorage() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(USER_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeUserProfile(parsed);
  } catch {
    return null;
  }
}

export function saveUserProfileToStorage(profile) {
  const normalized = normalizeUserProfile(profile);
  window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function formatProfileLabel(profile) {
  const safe = profile || DEFAULT_USER_PROFILE;
  const political = safe.isPartyMember ? "党员" : "群众";
  return `${safe.age} 岁 · ${political} · ${safe.major || "—"}`;
}
