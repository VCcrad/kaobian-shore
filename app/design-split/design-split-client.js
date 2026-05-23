"use client";

import { useMemo, useState } from "react";

function CompactThreshold({ job }) {
  return (
    <p className="mt-1 text-[11px] leading-snug text-slate-500">
      {job.provinceCity} | {job.slots}人 | {job.majors} | {job.ageRequirement}
    </p>
  );
}

function QualificationPanel({ job }) {
  if (!job) {
    return (
      <p className="text-sm text-slate-500">← 选择左侧条目查看准入资格对照</p>
    );
  }

  const items = [
    { icon: "📍", label: "省份城市", value: job.provinceCity },
    { icon: "👥", label: "招聘人数", value: `${job.slots} 人` },
    { icon: "🎓", label: "专业要求", value: job.majors, accent: true },
    { icon: "⏳", label: "年龄要求", value: job.ageRequirement, accent: true },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{job.title}</h2>
        <p className="mt-1 text-sm text-slate-500">{job.organization}</p>
      </div>

      <section className="rounded-lg border-2 border-amber-200 bg-amber-50/60 p-4">
        <h3 className="text-base font-bold text-amber-900">🎯 准入资格对照</h3>
        <p className="mt-1 text-xs text-amber-800/80">
          对照您的毕业院校、专业、学历与年龄，快速判断是否符合硬门槛
        </p>
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li
              key={item.label}
              className="rounded-md border border-amber-100 bg-white px-3 py-2.5"
            >
              <p className="text-xs text-slate-500">
                {item.icon} {item.label}
              </p>
              <p
                className={`mt-1 text-lg font-semibold leading-snug ${
                  item.accent ? "text-amber-900" : "text-slate-800"
                }`}
              >
                {item.value}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700">AI 提炼摘要</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{job.summary}</p>
      </section>
    </div>
  );
}

export default function DesignSplitClient({ jobs = [] }) {
  const [selectedId, setSelectedId] = useState(jobs[0]?.id ?? null);

  const selected = useMemo(
    () => jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null,
    [jobs, selectedId],
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-base font-semibold text-slate-900">双栏分屏司令部</h1>
        <p className="text-xs text-slate-500">design-split · mockJobs</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 左 40% 列表 */}
        <aside className="w-full shrink-0 border-b border-slate-200 bg-white lg:w-[40%] lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-500">
            情报简表 · {jobs.length} 条
          </div>
          <ul className="max-h-[calc(100vh-8rem)] overflow-y-auto">
            {jobs.map((job) => {
              const active = job.id === selected?.id;
              return (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(job.id)}
                    className={`w-full border-b border-slate-100 px-3 py-2.5 text-left transition-colors ${
                      active ? "bg-slate-100" : "hover:bg-slate-50"
                    }`}
                  >
                    <p
                      className={`text-sm leading-snug ${
                        active ? "font-medium text-slate-900" : "text-slate-700"
                      }`}
                    >
                      {job.organization} · {job.title}
                    </p>
                    <CompactThreshold job={job} />
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* 右 60% AI 看板 */}
        <section className="min-h-[320px] flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6">
          <QualificationPanel job={selected} />
        </section>
      </div>
    </div>
  );
}
