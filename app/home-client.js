"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SiteNav from "@/components/site-nav";
import { EDUCATION_FILTER_OPTIONS } from "@/lib/mock-jobs";
import { CHINA_PROVINCE_LIST, getCitiesForProvince } from "@/lib/china-regions";
import { jobMatchesRegion } from "@/lib/location-utils";
import { TRACK_CATEGORY_LIST } from "@/lib/track-category-client";
import { calcDaysLeft } from "@/lib/job-utils";
import {
  DEFAULT_USER_PROFILE,
  readUserProfileFromStorage,
  USER_PROFILE_STORAGE_KEY,
} from "@/lib/user-profile-client";

const PAGE_SIZE = 20;

const EMPTY_FILTERS = {
  textKeyword: "",
  category: "全部",
  province: "全部",
  city: "全部",
  education: "全部",
};

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none";

const TRACK_BADGE_STYLES = {
  高校院所招聘: "border-blue-200 bg-blue-50 text-blue-700",
  "博士/申博/博后": "border-purple-200 bg-purple-50 text-purple-700",
  地方编制求职: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

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

function normalizeConflictReasons(reasons) {
  if (!Array.isArray(reasons)) return [];
  return reasons
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function hasServerMatchStatus(status) {
  const value = String(status ?? "");
  return value === "PERFECT" || value === "CONFLICT" || value === "NORMAL";
}

function buildJobsApiUrl(userProfile) {
  const profile = userProfile || DEFAULT_USER_PROFILE;
  const politicalStatus = profile.isPartyMember ? "党员" : "群众";
  const params = new URLSearchParams({
    format: "jobs",
    match: "1",
    age: String(profile.age ?? 28),
    major: String(profile.major ?? profile.majors ?? ""),
    politicalStatus,
    isPartyMember: profile.isPartyMember ? "1" : "0",
  });
  return `/api/jobs?${params.toString()}`;
}

function parseAgeLimit(jobText) {
  for (const pattern of AGE_LIMIT_PATTERNS) {
    const match = jobText.match(pattern);
    if (match && match[1] != null) {
      const limit = Number.parseInt(match[1], 10);
      if (Number.isFinite(limit) && limit > 0 && limit < 200) {
        return limit;
      }
    }
  }
  return null;
}

/** 本地 Matcher 回退（与 utils/matcher.js 一致） */
function localCalculateMatchStatus(userProfile, jobText) {
  const profile = userProfile || DEFAULT_USER_PROFILE;
  const text = String(jobText ?? "").trim();
  const conflictReasons = [];

  if (!text) {
    return { matchStatus: "NORMAL", conflictReasons };
  }

  const ageLimit = parseAgeLimit(text);
  const userAge = Number(profile.age);
  if (ageLimit != null && Number.isFinite(userAge) && userAge > ageLimit) {
    conflictReasons.push(`年龄超限（岗位限 ${ageLimit} 周岁以下）`);
  }

  const requiresParty = PARTY_REQUIRED_KEYWORDS.some((kw) => text.includes(kw));
  if (requiresParty && profile.isPartyMember === false) {
    conflictReasons.push("政治面貌不符（该岗位限中共党员）");
  }

  if (conflictReasons.length > 0) {
    return { matchStatus: "CONFLICT", conflictReasons };
  }

  const major = String(profile.major ?? profile.majors ?? "").trim();
  if (major && text.includes(major)) {
    return { matchStatus: "PERFECT", conflictReasons: [] };
  }

  return { matchStatus: "NORMAL", conflictReasons: [] };
}

function resolveJobMatch(userProfile, job) {
  if (hasServerMatchStatus(job.matchStatus)) {
    return {
      matchStatus: job.matchStatus,
      conflictReasons: normalizeConflictReasons(job.conflictReasons),
    };
  }

  const text = String(job.text || job.content || job.title || "").trim();
  return localCalculateMatchStatus(userProfile, text);
}

function parseSlotsFromJob(job) {
  if (typeof job.slots === "number" && job.slots > 0) return job.slots;
  const label = String(job.slotsLabel ?? "");
  const match = label.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function pickDisplayField(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "—") return "";
  return text;
}

function pickMajorDisplay(value) {
  const text = pickDisplayField(value);
  if (!text || text === "详见官网原文") return "无要求";
  return text;
}

function normalizeApiJobToHomeCard(apiJob, userProfile) {
  const text = String(apiJob.text || apiJob.rawText || apiJob.title || "").trim();
  const base = {
    id: apiJob.id,
    organization: apiJob.organization || apiJob.sourceName || "招聘单位",
    title: apiJob.title || "未命名岗位",
    publishDate: apiJob.publishDate || "",
    deadline: pickDisplayField(apiJob.deadline),
    category: apiJob.category || "",
    provinceCity: pickDisplayField(apiJob.provinceCity) || "待定",
    slots: parseSlotsFromJob(apiJob),
    slotsLabel: pickDisplayField(apiJob.slotsLabel),
    majors: pickMajorDisplay(apiJob.majorRequirement),
    ageRequirement: pickDisplayField(apiJob.ageRequirement),
    education: pickDisplayField(apiJob.education),
    politicalRequirement: pickDisplayField(apiJob.politicalRequirement),
    certificateRequirements: Array.isArray(apiJob.certificateRequirements)
      ? apiJob.certificateRequirements
      : [],
    specialRequirements: pickDisplayField(
      apiJob.otherRequirements || apiJob.specialRequirements,
    ),
    summary: text.slice(0, 300) || "暂无摘要",
    content: text,
    sourceUrl: apiJob.sourceUrl || "",
    text,
    matchStatus: apiJob.matchStatus,
    conflictReasons: apiJob.conflictReasons,
  };

  const match = resolveJobMatch(userProfile, base);
  return {
    ...base,
    matchStatus: match.matchStatus,
    conflictReasons: match.conflictReasons,
  };
}

function RequirementChip({ label, value, title }) {
  if (!value) return null;
  return (
    <span
      className="inline-flex max-w-full items-start gap-1 rounded border border-slate-200/60 bg-slate-50/90 px-1.5 py-0.5 text-slate-600"
      title={title || label}
    >
      <span className="shrink-0 text-slate-400">{label}</span>
      <span className="min-w-0 break-words font-medium text-slate-700">{value}</span>
    </span>
  );
}

function ThresholdRow({ job }) {
  const slotsText =
    job.slots > 0
      ? `${job.slots} 人`
      : job.slotsLabel && job.slotsLabel !== "—"
        ? job.slotsLabel
        : "";

  const otherRequirements = pickDisplayField(
    job.specialRequirements || job.otherRequirements,
  );

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap gap-1.5 text-xs leading-snug">
        <RequirementChip
          label="省市"
          value={job.provinceCity || "待定"}
          title="工作省市"
        />
        <RequirementChip
          label="招聘"
          value={
            slotsText ? `${slotsText.replace(/\s*人\s*$/, "")} 人` : ""
          }
          title="招聘人数"
        />
        <RequirementChip label="年龄" value={job.ageRequirement} title="年龄要求" />
        <RequirementChip label="学历" value={job.education} title="学历要求" />
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs leading-snug">
        <RequirementChip label="专业要求" value={job.majors} title="专业要求" />
        <RequirementChip
          label="其他要求"
          value={otherRequirements}
          title="资格证、职称、语言等级等"
        />
      </div>
    </div>
  );
}

function TrackBadge({ category }) {
  if (!category) return null;
  const style =
    TRACK_BADGE_STYLES[category] ??
    "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-px text-xs ${style}`}
    >
      {category}
    </span>
  );
}

function DeadlineLine({ job }) {
  const daysLeft = calcDaysLeft(job.deadline);
  const urgent = daysLeft != null && daysLeft <= 5;

  if (!job.deadline) {
    return <p className="mt-1 text-xs text-slate-400">报名截止：暂未公布</p>;
  }

  return (
    <p className="mt-1 text-xs text-slate-500">
      报名截止 {job.deadline}
      {daysLeft != null ? (
        <>
          <span className="mx-1.5 text-slate-300">·</span>
          <span>剩余 </span>
          <span
            className={`tabular-nums font-medium ${
              urgent ? "text-red-600" : "text-slate-600"
            }`}
          >
            {daysLeft}
          </span>
          <span className={urgent ? "text-red-600" : "text-slate-500"}> 天</span>
        </>
      ) : null}
    </p>
  );
}

function jobMatchesEducation(job, educationFilter) {
  if (educationFilter === "全部") return true;
  const edu = String(job.education ?? "");
  if (educationFilter === "博士") return edu.includes("博士");
  if (educationFilter === "硕士") return edu.includes("硕士");
  if (educationFilter === "本科") return edu.includes("本科");
  if (educationFilter === "大专") return edu.includes("大专");
  return true;
}

function filterJobs(jobs, filters) {
  const q = filters.textKeyword.trim().toLowerCase();

  return jobs.filter((job) => {
    if (filters.category !== "全部" && job.category !== filters.category) {
      return false;
    }
    if (
      !jobMatchesRegion(job, filters.province, filters.city)
    ) {
      return false;
    }
    if (!jobMatchesEducation(job, filters.education)) {
      return false;
    }
    if (!q) return true;

    const hay = [
      job.organization,
      job.title,
      job.provinceCity,
      job.majors,
      job.category,
      job.summary,
      job.content,
      job.education,
      job.politicalRequirement,
      job.specialRequirements,
      job.certificateRequirements?.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    return hay.includes(q);
  });
}

function buildPageNumbers(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const list = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i] - list[i - 1] > 1) out.push("ellipsis");
    out.push(list[i]);
  }
  return out;
}

function JobPagination({ page, totalPages, totalItems, onPageChange }) {
  const pageItems = buildPageNumbers(page, totalPages);

  return (
    <nav
      className="mt-6 flex flex-col items-center gap-3 border-t border-slate-200 pt-5"
      aria-label="分页"
    >
      <p className="text-xs text-slate-500">
        共 {totalItems} 条 · 每页 {PAGE_SIZE} 条 · 第 {page} / {totalPages} 页
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          上一页
        </button>
        {pageItems.map((item, index) =>
          item === "ellipsis" ? (
            <span
              key={`ellipsis-${index}`}
              className="px-1 text-sm text-slate-400"
              aria-hidden
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-current={item === page ? "page" : undefined}
              className={`min-w-[2.25rem] rounded-lg px-2.5 py-1.5 text-sm tabular-nums transition-colors ${
                item === page
                  ? "bg-slate-900 font-medium text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一页
        </button>
        </div>
    </nav>
  );
}

export default function HomeClient() {
  const [userProfile, setUserProfile] = useState(DEFAULT_USER_PROFILE);
  const [profileReady, setProfileReady] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const saved = readUserProfileFromStorage();
    if (saved) {
      setUserProfile(saved);
    }
    setProfileReady(true);
  }, []);

  useEffect(() => {
    if (!profileReady) return undefined;

    function syncProfileFromStorage() {
      const saved = readUserProfileFromStorage();
      setUserProfile(saved || DEFAULT_USER_PROFILE);
    }

    function handleStorage(event) {
      if (event.key === USER_PROFILE_STORAGE_KEY || event.key === null) {
        syncProfileFromStorage();
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", syncProfileFromStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", syncProfileFromStorage);
    };
  }, [profileReady]);

  const loadJobs = useCallback(async () => {
    if (!profileReady) return;

    setLoading(true);
    try {
      const res = await fetch(buildJobsApiUrl(userProfile), { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await res.json();
      const list = Array.isArray(payload?.data) ? payload.data : [];
      setJobs(list.map((job) => normalizeApiJobToHomeCard(job, userProfile)));
    } catch (err) {
      console.error("[首页] 拉取岗位失败:", err);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [profileReady, userProfile]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const draftCityOptions = useMemo(() => {
    if (draft.province === "全部") return ["全部"];
    return ["全部", ...getCitiesForProvince(draft.province)];
  }, [draft.province]);

  const filteredJobs = useMemo(
    () => filterJobs(jobs, applied),
    [jobs, applied],
  );

  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);

  const paginatedJobs = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredJobs.slice(start, start + PAGE_SIZE);
  }, [filteredJobs, page]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function handleQuery() {
    setApplied({ ...draft });
    setExpandedId(null);
    setCurrentPage(1);
  }

  function handleReset() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setExpandedId(null);
    setCurrentPage(1);
  }

  function goToPage(next) {
    const target = Math.min(Math.max(1, next), totalPages);
    setCurrentPage(target);
    setExpandedId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleExpand(id) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <SiteNav activePath="/" />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <section
          className="rounded-lg border border-slate-200 bg-white p-4"
          aria-label="筛选条件"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block min-w-0">
              <span className="mb-1 block text-xs text-slate-500">正文关键字</span>
              <input
                type="search"
                value={draft.textKeyword}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, textKeyword: e.target.value }))
                }
                placeholder="搜索标题、摘要、正文…"
                className={inputClass}
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-xs text-slate-500">职位分类</span>
              <select
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value }))
                }
                className={inputClass}
              >
                <option value="全部">全部</option>
                {TRACK_CATEGORY_LIST.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <label className="block min-w-0">
                <span className="mb-1 block text-xs text-slate-500">省份</span>
                <select
                  value={draft.province}
                  onChange={(e) => {
                    const province = e.target.value;
                    setDraft((d) => ({
                      ...d,
                      province,
                      city: "全部",
                    }));
                  }}
                  className={inputClass}
                >
                  <option value="全部">全部</option>
                  {CHINA_PROVINCE_LIST.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-xs text-slate-500">城市</span>
                <select
                  value={draft.city}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, city: e.target.value }))
                  }
                  disabled={draft.province === "全部"}
                  className={`${inputClass} disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400`}
                >
                  {draftCityOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block min-w-0">
              <span className="mb-1 block text-xs text-slate-500">学历</span>
              <select
                value={draft.education}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, education: e.target.value }))
                }
                className={inputClass}
              >
                {EDUCATION_FILTER_OPTIONS.map((edu) => (
                  <option key={edu} value={edu}>
                    {edu}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              重置
            </button>
            <button
              type="button"
              onClick={handleQuery}
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              查询
            </button>
          </div>
        </section>

        <p className="mt-4 text-xs text-slate-500">
          共 {filteredJobs.length} 条结果
          {filteredJobs.length > 0 ? (
            <>
              <span className="mx-1.5 text-slate-300">·</span>
              当前第 {page} / {totalPages} 页
            </>
          ) : null}
        </p>

        <ul className="mt-3 space-y-2">
          {paginatedJobs.map((job) => {
            const open = expandedId === job.id;
            return (
              <li
                key={job.id}
                className="group relative rounded-lg border border-slate-200 bg-white px-5 pb-8 pt-3 transition-all duration-150 hover:border-slate-300 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-4 pr-2">
                  <button
                    type="button"
                    onClick={() => toggleExpand(job.id)}
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={open}
                  >
                    <p className="font-medium leading-snug text-slate-900 transition-colors group-hover:text-blue-600">
                      <span className="text-slate-600 transition-colors group-hover:text-blue-600">
                        {job.organization}
                      </span>
                      <span className="mx-1 text-slate-300 group-hover:text-slate-300">
                        ·
                      </span>
                      <span className="transition-colors group-hover:text-blue-600">
                        {job.title}
                      </span>
                    </p>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className="text-xs tabular-nums text-slate-400"
                      title="公告发布时间"
                    >
                      {job.publishDate}
                    </span>
                    <TrackBadge category={job.category} />
                  </div>
                </div>

                <ThresholdRow job={job} />
                <DeadlineLine job={job} />

                {open ? (
                  <div className="mt-2 border-t border-slate-100 pt-2 pr-24">
                    <div className="rounded border border-slate-100 bg-slate-50/70 p-2.5">
                      <p className="mb-1 text-xs font-medium text-slate-500">
                        AI 提炼摘要
                      </p>
                      <p className="text-sm leading-relaxed text-slate-600">
                        {job.summary}
                      </p>
                    </div>
                  </div>
                ) : null}

                {job.sourceUrl ? (
                  <a
                    href={job.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-2.5 right-5 inline-flex items-center rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-slate-600 underline decoration-dotted underline-offset-2 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                  >
                    [查看原文]
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>

        {!loading && jobs.length === 0 ? (
          <p className="mt-10 text-center text-sm text-slate-500">
            暂无已发布岗位。请先在{" "}
            <a href="/admin" className="text-slate-700 underline underline-offset-2">
              管理后台
            </a>{" "}
            发布职位，并确认截止日期未过期。
          </p>
        ) : !loading && filteredJobs.length === 0 ? (
          <p className="mt-10 text-center text-sm text-slate-500">
            没有匹配的岗位，试试调整筛选条件
          </p>
        ) : filteredJobs.length > 0 ? (
          <JobPagination
            page={page}
            totalPages={totalPages}
            totalItems={filteredJobs.length}
            onPageChange={goToPage}
          />
        ) : null}

        <p className="mt-10 border-t border-slate-200 pt-6 text-center text-xs leading-relaxed text-slate-400">
          请以各单位官方公告为准 · 数据来源于公开政府及高校网站
        </p>
      </main>
    </div>
  );
}
