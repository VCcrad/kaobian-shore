"use client";

import { useMemo, useState } from "react";
import { matchJobByMajorSearch } from "@/lib/major-search";

const CATEGORIES = ["全部", "公务员", "事业编", "高校教师", "申博"];
const CITIES = ["不限", "长沙", "北京", "上海", "武汉"];

function DaysLeftBadge({ days }) {
  const urgent = days <= 5;
  return (
    <span
      className={`shrink-0 text-sm font-medium whitespace-nowrap ${
        urgent ? "text-red-600" : "text-gray-500"
      }`}
    >
      报名剩余 {days} 天
    </span>
  );
}

export default function HomeClient({ initialJobs = [] }) {
  const [activeCategory, setActiveCategory] = useState("全部");
  const [majorKeyword, setMajorKeyword] = useState("");
  const [activeCity, setActiveCity] = useState("不限");

  const hasMajorFilter = majorKeyword.trim().length > 0;

  const filteredJobs = useMemo(() => {
    return initialJobs.filter((job) => {
      const matchCategory =
        activeCategory === "全部" || job.category === activeCategory;
      const matchCity = activeCity === "不限" || job.city === activeCity;
      const matchMajor = matchJobByMajorSearch(job, majorKeyword);

      return matchCategory && matchCity && matchMajor;
    });
  }, [initialJobs, activeCategory, majorKeyword, activeCity]);

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="border-b border-[#E5E7EB] bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <span className="text-[15px] font-medium tracking-tight text-[#111827]">
            岸边 / anBian-web
          </span>
          <button
            type="button"
            className="rounded-md bg-gray-100 px-4 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-200"
          >
            登录
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <nav className="flex flex-wrap gap-2" aria-label="岗位分类">
          {CATEGORIES.map((cat) => {
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`rounded-md px-3.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-[#111827] font-medium text-white"
                    : "bg-white text-gray-600 ring-1 ring-[#E5E7EB] hover:bg-gray-50"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </nav>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <input
            type="search"
            value={majorKeyword}
            onChange={(e) => setMajorKeyword(e.target.value)}
            placeholder="输入专业大类，支持空格多词（如：计算机 电子）"
            className="w-full flex-1 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
          />
          <div
            className="flex shrink-0 flex-wrap items-center gap-1.5"
            aria-label="城市筛选"
          >
            {CITIES.map((city) => {
              const active = activeCity === city;
              return (
                <button
                  key={city}
                  type="button"
                  onClick={() => setActiveCity(city)}
                  className={`rounded px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? "bg-gray-200 font-medium text-[#111827]"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  {city}
                </button>
              );
            })}
          </div>
        </div>

        <ul className="mt-6 space-y-3">
          {filteredJobs.map((job) => (
            <li
              key={job.id}
              className={`relative rounded-lg border border-[#E5E7EB] bg-white px-5 py-4 ${
                job.sourceUrl ? "pb-11" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold leading-snug text-[#111827] sm:text-lg">
                    {job.title}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {job.tags.map((tag) => (
                      <span key={tag} className="text-xs text-gray-500">
                        [{tag}]
                      </span>
                    ))}
                  </div>
                </div>
                <DaysLeftBadge days={job.daysLeft} />
              </div>
              {job.sourceUrl ? (
                <a
                  href={job.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-3 right-4 inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-1 text-xs text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-100 hover:text-[#111827]"
                >
                  <span aria-hidden>{"\ud83d\udd17"}</span>
                  {"\u67e5\u770b\u5b98\u7f51\u539f\u6587"}
                </a>
              ) : null}
            </li>
          ))}
        </ul>

        {filteredJobs.length === 0 && (
          <p className="mt-12 text-center text-sm text-gray-500">
            {hasMajorFilter
              ? "没有找到相关专业的岗位，换个关键词试试吧～"
              : "暂无符合筛选条件的公告"}
          </p>
        )}
      </main>
    </div>
  );
}