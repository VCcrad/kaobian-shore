import { calcDaysLeft, isPublishedJobVisible } from "@/lib/job-utils";

export const ADMIN_INPUT_CLASS =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none";

export function TrackBadge({ category }) {
  const label = String(category ?? "").trim();
  if (!label) return null;
  return (
    <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-px text-xs text-slate-600">
      {label}
    </span>
  );
}

export function AdminDeadlineLine({ deadline }) {
  const daysLeft = calcDaysLeft(deadline);
  const urgent = daysLeft != null && daysLeft <= 5;

  if (!deadline) {
    return <p className="mt-1 text-xs text-slate-400">报名截止：暂未填写</p>;
  }

  return (
    <p className="mt-1 text-xs text-slate-500">
      报名截止 {deadline}
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

/** 与前台卡片结构对齐的已发布岗位预览 */
export function PublishedJobCard({ job, onTrash, deleting }) {
  const hiddenFromPublic = !isPublishedJobVisible(job);

  return (
    <li
      className={`relative rounded-lg border bg-white px-5 pb-8 pt-3 ${
        hiddenFromPublic ? "border-amber-200 bg-amber-50/30" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3 pr-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug text-slate-900">{job.title}</p>
          <p className="mt-1.5 text-xs leading-snug text-slate-500">
            {job.slots > 0 ? `招聘 ${job.slots} 人` : "人数未填"}
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="line-clamp-1">{job.majors || "专业未填"}</span>
          </p>
          <AdminDeadlineLine deadline={job.deadline} />
          {hiddenFromPublic ? (
            <p className="mt-1 text-xs text-amber-700">已过期（前台 API 默认不展示）</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <TrackBadge category={job.category} />
          {job.createdAt ? (
            <span className="text-[11px] tabular-nums text-slate-400">
              {new Date(job.createdAt).toLocaleDateString("zh-CN")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="absolute bottom-2.5 right-5 flex items-center gap-2">
        {job.sourceUrl ? (
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
          >
            原文
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => onTrash(job.id)}
          disabled={deleting}
          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {deleting ? "…" : "移入垃圾桶"}
        </button>
      </div>
    </li>
  );
}

/** 发布前前台卡片预览（当前库字段） */
export function FrontPublishPreview({ form, sourceUrl }) {
  const hasAny =
    form.title || form.deadline || form.major || form.headcount || form.category;

  if (!hasAny) {
    return (
      <p className="text-xs text-slate-400">
        填写右侧字段后，此处预览与前台卡片相近的展示效果。
      </p>
    );
  }

  const slots = parseInt(String(form.headcount).replace(/\D/g, ""), 10) || 0;

  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        前台预览
      </p>
      <div className="rounded-lg border border-slate-200 bg-white px-4 pb-6 pt-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug text-slate-900">
            {form.title || "（标题）"}
          </p>
          <TrackBadge category={form.category} />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          <span className="text-slate-400">单位/城市待扩展</span>
          {slots > 0 ? (
            <>
              <span className="mx-1.5 text-slate-300">·</span>
              招聘 {slots} 人
            </>
          ) : null}
          {form.major ? (
            <>
              <span className="mx-1.5 text-slate-300">·</span>
              {form.major}
            </>
          ) : null}
        </p>
        <AdminDeadlineLine deadline={form.deadline} />
        {sourceUrl ? (
          <p className="mt-2 truncate text-[11px] text-slate-400">{sourceUrl}</p>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        学历、摘要、正文检索等字段前台已预留，数据库扩展后将自动打通。
      </p>
    </div>
  );
}
