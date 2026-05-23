"use client";

import { useEffect, useMemo, useState } from "react";
import SiteNav from "@/components/site-nav";
import { EDUCATION_FILTER_OPTIONS } from "@/lib/mock-jobs";
import { CHINA_PROVINCE_LIST, getCitiesForProvince } from "@/lib/china-regions";
import { jobMatchesRegion } from "@/lib/location-utils";
import { TRACK_CATEGORY_LIST } from "@/lib/track-category-client";
import { calcDaysLeft } from "@/lib/job-utils";

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

/** 未来用户画像：专业、年龄上限、意向城市等 */
const DEFAULT_USER_PROFILE = null;

function thresholdChipClass(mismatch) {
  if (mismatch) {
    return "bg-red-50 px-1 py-0.5 font-medium text-red-700 rounded";
  }
  return "bg-slate-50/80 px-1 py-0.5 text-slate-600 rounded";
}

/** 专业是否与用户画像不符（无画像时恒为 false，仅占位） */
function isMajorsMismatch(job, userProfile) {
  if (!userProfile) return false;
  const pref = userProfile.majors ?? userProfile.major;
  if (pref == null || String(pref).trim() === "") return false;

  const jobText = String(job.majors ?? "").trim().toLowerCase();
  if (!jobText || jobText.includes("不限")) return false;

  const tokens = String(pref)
    .split(/[、,，/|\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 1);

  if (tokens.length === 0) return false;
  return !tokens.some((token) => jobText.includes(token));
}

/** 年龄是否与用户画像不符（解析「N周岁以下」等常见表述） */
function isAgeMismatch(job, userProfile) {
  if (!userProfile) return false;
  const userMax =
    userProfile.maxAge ?? userProfile.ageLimit ?? userProfile.age;
  if (userMax == null || userMax === "") return false;

  const req = String(job.ageRequirement ?? "");
  const capMatch = req.match(/(\d+)\s*周岁\s*以[下内]/);
  if (!capMatch) return false;

  const jobMaxAge = Number.parseInt(capMatch[1], 10);
  if (Number.isNaN(jobMaxAge)) return false;

  const userAge = Number(userMax);
  if (Number.isNaN(userAge)) return false;

  return userAge > jobMaxAge;
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

function ThresholdRow({ job, userProfile = DEFAULT_USER_PROFILE }) {
  const majorsMismatch = isMajorsMismatch(job, userProfile);
  const ageMismatch = isAgeMismatch(job, userProfile);
  const slots = job.slots ?? 0;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-snug">
      <span className="rounded border border-slate-200/40 bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
        {job.provinceCity || "地点待定"}
      </span>
      <span className="select-none text-slate-300" aria-hidden>
        ·
      </span>
      <span className="text-slate-500">
        招聘{" "}
        <span className="font-semibold tabular-nums text-slate-900">{slots}</span>{" "}
        人
      </span>
      {job.majors ? (
        <>
          <span className="select-none text-slate-300" aria-hidden>
            ·
          </span>
          <span className={thresholdChipClass(majorsMismatch)} title="专业要求">
            {job.majors}
          </span>
        </>
      ) : null}
      {job.ageRequirement ? (
        <>
          <span className="select-none text-slate-300" aria-hidden>
            ·
          </span>
          <span className={thresholdChipClass(ageMismatch)} title="年龄要求">
            {job.ageRequirement}
          </span>
        </>
      ) : null}
    </div>
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
  if (educationFilter === "硕士") return edu.includes("硕士") || edu.includes("研究生");
  if (educationFilter === "本科") return edu.includes("本科");
  if (educationFilter === "大专") return edu.includes("大专") || edu.includes("专科");
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

export default function HomeClient({
  initialJobs = [],
  userProfile = DEFAULT_USER_PROFILE,
}) {
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const draftCityOptions = useMemo(() => {
    if (draft.province === "全部") return ["全部"];
    return ["全部", ...getCitiesForProvince(draft.province)];
  }, [draft.province]);

  const filteredJobs = useMemo(
    () => filterJobs(initialJobs, applied),
    [initialJobs, applied],
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

                <ThresholdRow job={job} userProfile={userProfile} />
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
                      {job.education ? (
                        <p className="mt-2 text-xs text-slate-500">
                          学历要求：{job.education}
                        </p>
                      ) : null}
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

        {initialJobs.length === 0 ? (
          <p className="mt-10 text-center text-sm text-slate-500">
            暂无已发布岗位。请先在{" "}
            <a href="/admin" className="text-slate-700 underline underline-offset-2">
              管理后台
            </a>{" "}
            发布职位，并确认截止日期未过期。
          </p>
        ) : filteredJobs.length === 0 ? (
          <p className="mt-10 text-center text-sm text-slate-500">
            没有匹配的岗位，试试调整筛选条件
          </p>
        ) : (
          <JobPagination
            page={page}
            totalPages={totalPages}
            totalItems={filteredJobs.length}
            onPageChange={goToPage}
          />
        )}
      </main>
    </div>
  );
}
