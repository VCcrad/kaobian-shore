"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ADMIN_INPUT_CLASS } from "@/components/admin/admin-ui";
import { isIncompleteJobListItem } from "@/lib/incomplete-job-posting.js";

const ADMIN_PASSWORD = "123456";
const JOBS_PAGE_SIZE = 50;

const SOURCE_TYPES = ["高校", "人社厅", "组织部", "其他"];
const SOURCE_STATUSES = ["active", "inactive", "error"];
const UPDATE_FREQUENCIES = ["daily", "weekly"];

const EMPTY_SOURCE_FORM = {
  name: "",
  province: "",
  city: "",
  type: "高校",
  url: "",
  priority: "5",
  updateFrequency: "daily",
  status: "active",
  parserConfig: "",
};

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatParserConfig(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function statusLabel(status) {
  if (status === "active") return "正常";
  if (status === "inactive") return "停用";
  if (status === "error") return "异常";
  return status || "—";
}

function statusClass(status) {
  if (status === "active") return "border-green-200 bg-green-50 text-green-800";
  if (status === "error") return "border-red-200 bg-red-50 text-red-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function filterJobs(jobs, keyword) {
  const q = keyword.trim().toLowerCase();
  if (!q) return jobs;
  return jobs.filter((job) => {
    const hay = [
      job.title,
      job.sourceName,
      job.organization,
      job.majors,
      job.deadline,
      job.province,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [authError, setAuthError] = useState(false);

  const [adminTab, setAdminTab] = useState("settings");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [settings, setSettings] = useState({ archiveGraceDays: "5" });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const [sources, setSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourceForm, setSourceForm] = useState(EMPTY_SOURCE_FORM);
  const [editingSourceId, setEditingSourceId] = useState(null);
  const [savingSource, setSavingSource] = useState(false);
  const [recrawlingId, setRecrawlingId] = useState(null);

  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobKeyword, setJobKeyword] = useState("");
  const [jobPage, setJobPage] = useState(1);
  const [deletingJobId, setDeletingJobId] = useState(null);
  const [purgingIncomplete, setPurgingIncomplete] = useState(false);

  const [trashJobs, setTrashJobs] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashActionId, setTrashActionId] = useState(null);

  const filteredJobs = useMemo(
    () => filterJobs(jobs, jobKeyword),
    [jobs, jobKeyword],
  );

  const incompleteJobs = useMemo(
    () => jobs.filter(isIncompleteJobListItem),
    [jobs],
  );

  const jobTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredJobs.length / JOBS_PAGE_SIZE)),
    [filteredJobs.length],
  );

  const paginatedJobs = useMemo(() => {
    const start = (jobPage - 1) * JOBS_PAGE_SIZE;
    return filteredJobs.slice(start, start + JOBS_PAGE_SIZE);
  }, [filteredJobs, jobPage]);

  useEffect(() => {
    setJobPage(1);
  }, [jobKeyword]);

  useEffect(() => {
    if (jobPage > jobTotalPages) {
      setJobPage(jobTotalPages);
    }
  }, [jobPage, jobTotalPages]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "加载设置失败");
      setSettings({
        archiveGraceDays: String(data.archiveGraceDays ?? 5),
      });
    } catch (err) {
      setError(err?.message || "加载设置失败");
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const res = await fetch("/api/admin/sources");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "加载来源失败");
      setSources(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "加载来源失败");
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const res = await fetch("/api/admin/job-postings");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "加载岗位失败");
      setJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "加载岗位失败");
    } finally {
      setJobsLoading(false);
    }
  }, []);

  const loadTrash = useCallback(async () => {
    setTrashLoading(true);
    try {
      const res = await fetch("/api/admin/trash");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "加载垃圾桶失败");
      setTrashJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (err) {
      setError(err?.message || "加载垃圾桶失败");
    } finally {
      setTrashLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    loadSettings();
    loadSources();
    loadJobs();
    loadTrash();
  }, [unlocked, loadSettings, loadSources, loadJobs, loadTrash]);

  useEffect(() => {
    if (unlocked && adminTab === "trash") {
      loadTrash();
    }
  }, [unlocked, adminTab, loadTrash]);

  function handleUnlock(e) {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      setUnlocked(true);
      setAuthError(false);
    } else {
      setUnlocked(false);
      setAuthError(true);
    }
  }

  function resetSourceForm() {
    setSourceForm(EMPTY_SOURCE_FORM);
    setEditingSourceId(null);
  }

  function startEditSource(source) {
    setEditingSourceId(source.id);
    setSourceForm({
      name: source.name || "",
      province: source.province || "",
      city: source.city || "",
      type: source.type || "其他",
      url: source.url || "",
      priority: String(source.priority ?? 5),
      updateFrequency: source.updateFrequency || "daily",
      status: source.status || "active",
      parserConfig: formatParserConfig(source.parserConfig),
    });
    setError("");
    setMessage("");
  }

  function updateSourceField(key, value) {
    setSourceForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    setError("");
    setMessage("");

    const days = Number(settings.archiveGraceDays);
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      setError("天数须在 0–365 之间");
      setSavingSettings(false);
      return;
    }

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archiveGraceDays: days }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存设置失败");

      setSettings({ archiveGraceDays: String(data.archiveGraceDays) });
      setMessage("设置已保存");
    } catch (err) {
      setError(err?.message || "保存设置失败");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveSource(e) {
    e.preventDefault();
    setSavingSource(true);
    setError("");
    setMessage("");

    const payload = {
      name: sourceForm.name.trim(),
      province: sourceForm.province.trim(),
      city: sourceForm.city.trim(),
      type: sourceForm.type,
      url: sourceForm.url.trim(),
      priority: Number(sourceForm.priority) || 5,
      updateFrequency: sourceForm.updateFrequency,
      status: sourceForm.status,
      parserConfig: sourceForm.parserConfig.trim() || null,
    };

    try {
      const res = await fetch(
        editingSourceId
          ? `/api/admin/sources/${editingSourceId}`
          : "/api/admin/sources",
        {
          method: editingSourceId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存来源失败");

      setMessage(editingSourceId ? "来源已更新" : "来源已创建");
      resetSourceForm();
      await loadSources();
    } catch (err) {
      setError(err?.message || "保存来源失败");
    } finally {
      setSavingSource(false);
    }
  }

  async function handleRecrawl(sourceId) {
    setRecrawlingId(sourceId);
    setError("");
    setMessage("");

    try {
      const res = await fetch(`/api/admin/sources/${sourceId}/recrawl`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "触发抓取失败");
      setMessage(data?.message || "已触发抓取，请稍后刷新列表");
    } catch (err) {
      setError(err?.message || "触发抓取失败");
    } finally {
      setRecrawlingId(null);
    }
  }

  async function handleDeleteJob(id) {
    if (!window.confirm("确定移入垃圾桶？")) return;

    setDeletingJobId(id);
    setError("");
    setMessage("");

    try {
      const res = await fetch(`/api/admin/job-postings/${id}`, {
        method: "PATCH",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "删除失败");

      setMessage("已移入垃圾桶");
      await loadJobs();
      await loadTrash();
    } catch (err) {
      setError(err?.message || "删除失败");
    } finally {
      setDeletingJobId(null);
    }
  }

  async function handlePurgeIncompleteJobs() {
    if (incompleteJobs.length === 0) return;

    const ok = window.confirm(
      `将删除 ${incompleteJobs.length} 个三无岗位（无截止日期、无发布日期、无招聘人数），移入垃圾桶。确定继续？`,
    );
    if (!ok) return;

    setPurgingIncomplete(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/job-postings/purge-incomplete", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "批量删除失败");

      setMessage(`已移入垃圾桶 ${data.count ?? 0} 个三无岗位`);
      await loadJobs();
      await loadTrash();
    } catch (err) {
      setError(err?.message || "批量删除失败");
    } finally {
      setPurgingIncomplete(false);
    }
  }

  async function handleTrashAction(id, action) {
    const key = `${id}-${action}`;
    setTrashActionId(key);
    setError("");
    setMessage("");

    try {
      if (action === "restore") {
        const res = await fetch("/api/admin/trash", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: "restore" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "恢复失败");
        setMessage("已恢复岗位");
      } else if (action === "purge") {
        if (!window.confirm("彻底删除后无法恢复，确定继续？")) return;
        const res = await fetch(`/api/admin/job-postings/${id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "彻底删除失败");
        setMessage("已彻底删除");
      }

      await loadTrash();
      await loadJobs();
    } catch (err) {
      setError(err?.message || "操作失败");
    } finally {
      setTrashActionId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-2.5 shrink-0">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white"
              aria-hidden
            >
              岸
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-slate-900">
                岸边<span className="text-slate-400">/</span>
                <span className="font-medium text-slate-700">管理后台</span>
              </span>
              <span className="block text-[11px] text-slate-500">
                设置 · 来源 · 岗位 · 垃圾桶
              </span>
            </span>
          </a>
          <a
            href="/"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            查看前台
          </a>
        </div>
      </header>

      {unlocked && (
        <section className="border-b border-slate-200 bg-white px-4 py-2 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            {[
              { id: "settings", label: "基本设置" },
              { id: "sources", label: "来源管理" },
              { id: "jobs", label: "已发布岗位" },
              { id: "trash", label: "垃圾桶" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setAdminTab(tab.id)}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  adminTab === tab.id
                    ? "bg-slate-900 font-medium text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab.label}
                {tab.id === "trash" && trashJobs.length > 0 ? (
                  <span className="ml-1 tabular-nums opacity-80">
                    ({trashJobs.length})
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      )}

      {(message || error) && unlocked && (
        <section className="border-b border-slate-200 bg-white px-4 py-2 sm:px-6">
          <div className="mx-auto max-w-6xl text-sm">
            {message ? (
              <p className="text-green-700">{message}</p>
            ) : null}
            {error ? <p className="text-red-600">{error}</p> : null}
          </div>
        </section>
      )}

      {!unlocked ? (
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <form
            onSubmit={handleUnlock}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
                岸
              </span>
              <span className="text-sm font-semibold text-slate-900">
                岸边管理后台
              </span>
            </div>
            <label
              htmlFor="admin-password"
              className="block text-sm font-medium text-slate-800"
            >
              请输入管理员密码
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setAuthError(false);
              }}
              placeholder="管理员密码"
              className={ADMIN_INPUT_CLASS}
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              进入后台
            </button>
            {authError ? (
              <p className="text-sm text-red-600">密码错误</p>
            ) : null}
          </form>
        </div>
      ) : (
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          {adminTab === "settings" && (
            <section className="max-w-lg rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">基本设置</h2>
              <p className="mt-1 text-xs text-slate-500">
                岗位截止后超过设定天数，将自动移入垃圾桶。
              </p>

              {settingsLoading ? (
                <p className="mt-6 text-sm text-slate-500">加载中…</p>
              ) : (
                <form onSubmit={handleSaveSettings} className="mt-5 space-y-4">
                  <label className="block">
                    <span className="mb-1 block text-xs text-slate-600">
                      过期进垃圾桶（天）
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={settings.archiveGraceDays}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          archiveGraceDays: e.target.value,
                        }))
                      }
                      className={`${ADMIN_INPUT_CLASS} max-w-[120px]`}
                      required
                    />
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                      例如设为 5：截止日为 5 月 15 日的岗位，5 月 21
                      日起自动进入垃圾桶。设为 0 表示截止日当天结束后即移入。
                    </p>
                  </label>
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {savingSettings ? "保存中…" : "保存设置"}
                  </button>
                </form>
              )}
            </section>
          )}

          {adminTab === "sources" && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <section className="rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-slate-900">
                    来源列表
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {sourcesLoading ? "…" : sources.length}
                    </span>
                  </h2>
                  <button
                    type="button"
                    onClick={loadSources}
                    disabled={sourcesLoading}
                    className="text-xs text-slate-500 hover:text-slate-900 disabled:opacity-50"
                  >
                    刷新
                  </button>
                </div>

                {sourcesLoading && sources.length === 0 ? (
                  <p className="px-4 py-8 text-sm text-slate-500">加载中…</p>
                ) : sources.length === 0 ? (
                  <p className="px-4 py-8 text-sm text-slate-500">暂无来源</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {sources.map((source) => (
                      <li key={source.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-slate-900">
                                {source.name}
                              </p>
                              <span
                                className={`rounded-full border px-2 py-px text-[11px] ${statusClass(source.status)}`}
                              >
                                {statusLabel(source.status)}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {source.type}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-xs text-slate-500">
                              {source.province}
                              {source.city ? ` · ${source.city}` : ""}
                              <span className="mx-1.5 text-slate-300">·</span>
                              {source.url}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-400">
                              上次抓取 {formatDateTime(source.lastCrawled)}
                              <span className="mx-1.5 text-slate-300">·</span>
                              优先级 {source.priority}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => startEditSource(source)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRecrawl(source.id)}
                              disabled={recrawlingId === source.id}
                              className="rounded-lg border border-slate-900 bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                            >
                              {recrawlingId === source.id ? "触发中…" : "Re-crawl"}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {editingSourceId ? "编辑来源" : "新增来源"}
                  </h2>
                  {editingSourceId ? (
                    <button
                      type="button"
                      onClick={resetSourceForm}
                      className="text-xs text-slate-500 hover:text-slate-900"
                    >
                      取消编辑
                    </button>
                  ) : null}
                </div>

                <form onSubmit={handleSaveSource} className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-slate-600">
                      名称 *
                    </span>
                    <input
                      value={sourceForm.name}
                      onChange={(e) => updateSourceField("name", e.target.value)}
                      className={ADMIN_INPUT_CLASS}
                      required
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-600">
                        省份 *
                      </span>
                      <input
                        value={sourceForm.province}
                        onChange={(e) =>
                          updateSourceField("province", e.target.value)
                        }
                        className={ADMIN_INPUT_CLASS}
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-600">
                        城市
                      </span>
                      <input
                        value={sourceForm.city}
                        onChange={(e) => updateSourceField("city", e.target.value)}
                        className={ADMIN_INPUT_CLASS}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs text-slate-600">
                      列表 URL *
                    </span>
                    <input
                      value={sourceForm.url}
                      onChange={(e) => updateSourceField("url", e.target.value)}
                      className={ADMIN_INPUT_CLASS}
                      required
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-600">
                        类型
                      </span>
                      <select
                        value={sourceForm.type}
                        onChange={(e) => updateSourceField("type", e.target.value)}
                        className={ADMIN_INPUT_CLASS}
                      >
                        {SOURCE_TYPES.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-600">
                        状态
                      </span>
                      <select
                        value={sourceForm.status}
                        onChange={(e) =>
                          updateSourceField("status", e.target.value)
                        }
                        className={ADMIN_INPUT_CLASS}
                      >
                        {SOURCE_STATUSES.map((item) => (
                          <option key={item} value={item}>
                            {statusLabel(item)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-600">
                        优先级 (1-10)
                      </span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={sourceForm.priority}
                        onChange={(e) =>
                          updateSourceField("priority", e.target.value)
                        }
                        className={ADMIN_INPUT_CLASS}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-600">
                        抓取频率
                      </span>
                      <select
                        value={sourceForm.updateFrequency}
                        onChange={(e) =>
                          updateSourceField("updateFrequency", e.target.value)
                        }
                        className={ADMIN_INPUT_CLASS}
                      >
                        {UPDATE_FREQUENCIES.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs text-slate-600">
                      parserConfig (JSON)
                    </span>
                    <textarea
                      value={sourceForm.parserConfig}
                      onChange={(e) =>
                        updateSourceField("parserConfig", e.target.value)
                      }
                      rows={8}
                      placeholder='{"type":"hunan-university","listUrl":"..."}'
                      className={`${ADMIN_INPUT_CLASS} font-mono text-xs`}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={savingSource}
                    className="w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {savingSource
                      ? "保存中…"
                      : editingSourceId
                        ? "保存修改"
                        : "创建来源"}
                  </button>
                </form>
              </section>
            </div>
          )}

          {adminTab === "jobs" && (
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  已发布岗位
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {jobsLoading ? "…" : `${filteredJobs.length} / ${jobs.length}`}
                  </span>
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={jobKeyword}
                    onChange={(e) => setJobKeyword(e.target.value)}
                    placeholder="搜索标题、来源、专业…"
                    className={`${ADMIN_INPUT_CLASS} w-56`}
                  />
                  <button
                    type="button"
                    onClick={handlePurgeIncompleteJobs}
                    disabled={
                      purgingIncomplete || jobsLoading || incompleteJobs.length === 0
                    }
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                    title="无截止日期、无发布日期、无招聘人数的岗位"
                  >
                    {purgingIncomplete
                      ? "删除中…"
                      : `一键删除三无岗位${incompleteJobs.length > 0 ? ` (${incompleteJobs.length})` : ""}`}
                  </button>
                  <button
                    type="button"
                    onClick={loadJobs}
                    disabled={jobsLoading}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    刷新
                  </button>
                </div>
              </div>

              {jobsLoading && jobs.length === 0 ? (
                <p className="px-4 py-8 text-sm text-slate-500">加载中…</p>
              ) : filteredJobs.length === 0 ? (
                <p className="px-4 py-8 text-sm text-slate-500">暂无岗位</p>
              ) : (
                <>
                  <ul className="divide-y divide-slate-100">
                    {paginatedJobs.map((job) => (
                      <li key={job.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                          <p className="font-medium leading-snug text-slate-900">
                            {job.title}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {job.sourceName || job.organization}
                            {job.slots > 0 ? (
                              <>
                                <span className="mx-1.5 text-slate-300">·</span>
                                招聘 {job.slots} 人
                              </>
                            ) : null}
                            <span className="mx-1.5 text-slate-300">·</span>
                            {job.majors}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            截止 {job.deadline || "—"}
                            <span className="mx-1.5 text-slate-300">·</span>
                            发布 {job.publishDate || "—"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
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
                            onClick={() => handleDeleteJob(job.id)}
                            disabled={deletingJobId === job.id}
                            className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            {deletingJobId === job.id ? "…" : "删除"}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                  {jobTotalPages > 1 ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                      <p className="text-xs text-slate-500">
                        第 {jobPage} / {jobTotalPages} 页，本页{" "}
                        {paginatedJobs.length} 条，共 {filteredJobs.length} 条
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setJobPage((p) => Math.max(1, p - 1))}
                          disabled={jobPage <= 1}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          上一页
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setJobPage((p) => Math.min(jobTotalPages, p + 1))
                          }
                          disabled={jobPage >= jobTotalPages}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          )}

          {adminTab === "trash" && (
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  垃圾桶
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {trashLoading ? "…" : trashJobs.length}
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={loadTrash}
                  disabled={trashLoading}
                  className="text-xs text-slate-500 hover:text-slate-900 disabled:opacity-50"
                >
                  刷新
                </button>
              </div>

              {trashLoading && trashJobs.length === 0 ? (
                <p className="px-4 py-8 text-sm text-slate-500">加载中…</p>
              ) : trashJobs.length === 0 ? (
                <p className="px-4 py-8 text-sm text-slate-500">垃圾桶为空</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {trashJobs.map((job) => {
                    const busy = trashActionId?.startsWith(`${job.id}-`);
                    return (
                      <li key={job.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-900">
                              {job.title}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {job.sourceName}
                              <span className="mx-1.5 text-slate-300">·</span>
                              删除于 {formatDateTime(job.deletedAt)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleTrashAction(job.id, "restore")}
                              disabled={busy}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            >
                              恢复
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTrashAction(job.id, "purge")}
                              disabled={busy}
                              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                            >
                              彻底删除
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </main>
      )}
    </div>
  );
}
