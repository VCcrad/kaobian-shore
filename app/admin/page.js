"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ADMIN_PASSWORD = "123456";

const SAMPLE_RAW_TEXT = `????2026??????????

????????????????12??
??????????????????????????
?????2026?5?20?17:00?`;

const EMPTY_FORM = {
  title: "",
  deadline: "",
  major: "",
  headcount: "",
};

function previewContent(text, maxLen = 100) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

function pickString(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const key of keys) {
    const val = obj[key];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      return String(val).trim();
    }
  }
  return "";
}

function formatMajors(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(String).join("\u3001");
  return String(value).trim();
}

function normalizeDeadline(value) {
  if (!value) return "";
  const str = String(value).trim();
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const cn = str.match(/(\d{4})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5/);
  if (cn) {
    const [, y, m, d] = cn;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return str;
}

function tryParseJson(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseDifyWorkflowResponse(payload) {
  const outputs =
    payload?.data?.outputs ?? payload?.outputs ?? payload?.data ?? payload;

  let fields = { ...outputs };

  if (typeof outputs?.text === "string") {
    const nested = tryParseJson(outputs.text);
    if (nested && typeof nested === "object") {
      fields = { ...fields, ...nested };
    }
  }

  if (typeof outputs?.result === "string") {
    const nested = tryParseJson(outputs.result);
    if (nested && typeof nested === "object") {
      fields = { ...fields, ...nested };
    }
  }

  return {
    title: pickString(fields, ["title", "Title", "\u516c\u544a\u6807\u9898"]),
    deadline: normalizeDeadline(
      pickString(fields, [
        "deadline",
        "deadline_date",
        "\u622a\u6b62\u65e5\u671f",
        "\u62a5\u540d\u622a\u6b62",
      ]),
    ),
    major: formatMajors(
      fields.majors ?? fields.major ?? fields["\u4e13\u4e1a\u8981\u6c42"],
    ),
    headcount: pickString(fields, [
      "slots",
      "headcount",
      "\u62db\u8058\u4eba\u6570",
      "recruit_count",
    ]),
  };
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [authError, setAuthError] = useState(false);

  const [rawText, setRawText] = useState(SAMPLE_RAW_TEXT);
  const [form, setForm] = useState(EMPTY_FORM);
  const [currentSourceUrl, setCurrentSourceUrl] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  const [pendingRawJobs, setPendingRawJobs] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [ignoringId, setIgnoringId] = useState(null);
  const [extractingRawId, setExtractingRawId] = useState(null);
  const [selectedRawJobIds, setSelectedRawJobIds] = useState(() => new Set());
  const [isBatchExtracting, setIsBatchExtracting] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  const [batchResults, setBatchResults] = useState([]);
  const [isBatchAborting, setIsBatchAborting] = useState(false);

  const batchAbortRef = useRef(false);
  const batchPublishedIdsRef = useRef([]);

  const [publishedJobs, setPublishedJobs] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadPendingRawJobs = useCallback(async () => {
    setPendingLoading(true);
    try {
      const res = await fetch("/api/raw-jobs");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "\u52a0\u8f7d\u5f85\u5904\u7406\u6c60\u5931\u8d25");
      }
      setPendingRawJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      setExtractError(err?.message || "\u52a0\u8f7d\u5f85\u5904\u7406\u6c60\u5931\u8d25");
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const loadPublishedJobs = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "\u52a0\u8f7d\u5c97\u4f4d\u5217\u8868\u5931\u8d25");
      }
      setPublishedJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      setExtractError(err?.message || "\u52a0\u8f7d\u5c97\u4f4d\u5217\u8868\u5931\u8d25");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (unlocked) {
      loadPendingRawJobs();
      loadPublishedJobs();
    }
  }, [unlocked, loadPendingRawJobs, loadPublishedJobs]);

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

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const selectedCount = selectedRawJobIds.size;
  const selectablePendingJobs = useMemo(
    () => pendingRawJobs.filter((job) => Boolean(job.content?.trim())),
    [pendingRawJobs],
  );

  function isRawJobSelected(id) {
    return selectedRawJobIds.has(id);
  }

  function toggleRawJobSelection(id) {
    setSelectedRawJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllPending() {
    setSelectedRawJobIds(new Set(selectablePendingJobs.map((job) => job.id)));
  }

  function clearPendingSelection() {
    setSelectedRawJobIds(new Set());
  }

  function applyExtractToForm(job, parsed) {
    setForm({
      title: parsed.title,
      deadline: parsed.deadline,
      major: parsed.major,
      headcount: parsed.headcount,
    });
    setCurrentSourceUrl(String(job?.link ?? "").trim());
    if (job?.content) setRawText(job.content);
  }

  function clearBatchUiState() {
    setBatchResults([]);
    setBatchProgress(null);
  }

  async function rollbackBatchPublishedJobs() {
    const ids = [...batchPublishedIdsRef.current];
    batchPublishedIdsRef.current = [];
    let deleted = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
        if (res.ok) deleted += 1;
      } catch {
        /* 单条删除失败继续 */
      }
    }
    return deleted;
  }

  async function publishExtractedJob(rawJob, parsed) {
    const title = parsed.title?.trim();
    if (!title) {
      throw new Error("\u6807\u9898\u4e3a\u7a7a\uff0c\u65e0\u6cd5\u53d1\u5e03");
    }

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        deadline: parsed.deadline,
        majors: parsed.major,
        slots: parsed.headcount,
        sourceUrl: String(rawJob?.link ?? "").trim(),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const detail = data?.details ? `\uff1a${data.details}` : "";
      throw new Error((data?.error || "\u53d1\u5e03\u5931\u8d25") + detail);
    }

    return data;
  }

  async function markRawJobIgnored(id) {
    const res = await fetch("/api/raw-jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "IGNORED" }),
    });
    if (!res.ok) return;

    setPendingRawJobs((prev) => prev.filter((item) => item.id !== id));
    setSelectedRawJobIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function handleTerminateBatch() {
    if (!isBatchExtracting) return;
    batchAbortRef.current = true;
    setIsBatchAborting(true);
    setExtractError("");
    setActionMsg(
      "\u6b63\u5728\u7ec8\u6b62\u6279\u91cf\uff0c\u5b8c\u6210\u540e\u5c06\u4f5c\u5e9f\u5e76\u5220\u9664\u672c\u6b21\u5df2\u53d1\u5e03\u5185\u5bb9\u2026",
    );
  }

  async function fetchDifyParsed(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("\u6b63\u6587\u4e3a\u7a7a\uff0c\u65e0\u6cd5\u63d0\u70bc\u3002");
    }

    const res = await fetch("/api/dify/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_text: trimmed }),
    });

    const payload = await res.json();

    if (!res.ok) {
      throw new Error(
        payload?.error || `\u8bf7\u6c42\u5931\u8d25\uff08${res.status}\uff09`,
      );
    }

    const parsed = parseDifyWorkflowResponse(payload);

    if (
      !parsed.title &&
      !parsed.deadline &&
      !parsed.major &&
      !parsed.headcount
    ) {
      throw new Error(
        "Dify \u5df2\u8fd4\u56de\uff0c\u4f46\u672a\u8bc6\u522b\u5230\u7ed3\u6784\u5316\u5b57\u6bb5\u3002",
      );
    }

    return parsed;
  }

  async function runDifyExtract(text) {
    setIsExtracting(true);
    setExtractError("");
    setActionMsg("");
    setBatchResults([]);
    setBatchProgress(null);

    try {
      const parsed = await fetchDifyParsed(text);
      setForm({
        title: parsed.title,
        deadline: parsed.deadline,
        major: parsed.major,
        headcount: parsed.headcount,
      });
      setActionMsg(
        "AI \u63d0\u70bc\u5b8c\u6210\uff0c\u8bf7\u5728\u4e2d\u680f\u6838\u5bf9\u540e\u53d1\u5e03\u3002",
      );
    } catch (err) {
      setExtractError(
        err?.message || "\u63d0\u70bc\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
      );
    } finally {
      setIsExtracting(false);
    }
  }

  async function handleExtract() {
    await runDifyExtract(rawText);
  }

  async function handleAiExtractFromPool(job) {
    const content = job.content || "";
    setRawText(content);
    setCurrentSourceUrl(String(job.link ?? "").trim());
    setExtractError("");
    setBatchResults([]);
    setActionMsg(
      `\u5df2\u8f7d\u5165\u5f85\u5904\u7406\u516c\u544a\uff1a${job.title}`,
    );
    setExtractingRawId(job.id);
    try {
      await runDifyExtract(content);
    } finally {
      setExtractingRawId(null);
    }
  }

  async function handleBatchAiExtract() {
    const jobs = pendingRawJobs.filter(
      (job) => selectedRawJobIds.has(job.id) && job.content?.trim(),
    );

    if (jobs.length === 0) {
      setExtractError(
        "\u8bf7\u5148\u52fe\u9009\u81f3\u5c11\u4e00\u6761\u5e26\u6b63\u6587\u7684\u516c\u544a\u3002",
      );
      return;
    }

    batchAbortRef.current = false;
    batchPublishedIdsRef.current = [];
    setIsBatchAborting(false);
    setIsBatchExtracting(true);
    setIsExtracting(true);
    setExtractError("");
    setActionMsg("");
    clearBatchUiState();
    setBatchProgress({ current: 0, total: jobs.length });

    const results = [];
    let aborted = false;

    try {
      for (let i = 0; i < jobs.length; i++) {
        if (batchAbortRef.current) {
          aborted = true;
          break;
        }

        const job = jobs[i];
        setBatchProgress({
          current: i + 1,
          total: jobs.length,
          title: job.title,
        });
        setExtractingRawId(job.id);

        try {
          const parsed = await fetchDifyParsed(job.content);

          if (batchAbortRef.current) {
            aborted = true;
            break;
          }

          const published = await publishExtractedJob(job, parsed);

          if (batchAbortRef.current) {
            batchPublishedIdsRef.current.push(published.id);
            aborted = true;
            break;
          }

          batchPublishedIdsRef.current.push(published.id);
          await markRawJobIgnored(job.id);
          results.push({
            job,
            parsed,
            ok: true,
            publishedId: published.id,
          });
        } catch (err) {
          if (batchAbortRef.current) {
            aborted = true;
            break;
          }
          results.push({
            job,
            ok: false,
            error: err?.message || "\u5904\u7406\u5931\u8d25",
          });
        }
      }

      if (aborted || batchAbortRef.current) {
        const deleted = await rollbackBatchPublishedJobs();
        clearBatchUiState();
        setForm(EMPTY_FORM);
        setCurrentSourceUrl("");
        setRawText("");
        setActionMsg(
          `\u5df2\u7ec8\u6b62\u6279\u91cf\u3002\u672c\u6b21\u5df2\u4f5c\u5e9f\u5e76\u5220\u9664 ${deleted} \u6761\u524d\u53f0\u5c97\u4f4d\u3002`,
        );
        await loadPublishedJobs();
        return;
      }

      setBatchResults(results);
      const okCount = results.filter((item) => item.ok).length;
      const failCount = results.length - okCount;

      setForm(EMPTY_FORM);
      setCurrentSourceUrl("");
      setRawText("");
      clearPendingSelection();

      if (okCount === 0) {
        throw new Error(
          `\u6279\u91cf\u63d0\u70bc\u5e76\u53d1\u5e03\u5168\u90e8\u5931\u8d25\uff08\u5171 ${results.length} \u6761\uff09\u3002`,
        );
      }

      setActionMsg(
        `\u6279\u91cf\u63d0\u70bc\u5e76\u53d1\u5e03\u5b8c\u6210\uff1a\u6210\u529f ${okCount} \u6761${
          failCount > 0 ? `\uff0c\u5931\u8d25 ${failCount} \u6761` : ""
        }\u3002`,
      );
      await loadPublishedJobs();
    } catch (err) {
      const deleted = await rollbackBatchPublishedJobs();
      clearBatchUiState();
      setForm(EMPTY_FORM);
      setCurrentSourceUrl("");
      setRawText("");
      if (deleted > 0) {
        await loadPublishedJobs();
      }
      setExtractError(err?.message || "\u6279\u91cf\u63d0\u70bc\u5e76\u53d1\u5e03\u5931\u8d25\u3002");
    } finally {
      batchAbortRef.current = false;
      setIsBatchAborting(false);
      setExtractingRawId(null);
      setBatchProgress(null);
      setIsBatchExtracting(false);
      setIsExtracting(false);
    }
  }

  async function handleIgnoreRawJob(id) {
    setIgnoringId(id);
    setExtractError("");

    try {
      const res = await fetch("/api/raw-jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "IGNORED" }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "\u5ffd\u7565\u5931\u8d25");
      }

      setPendingRawJobs((prev) => prev.filter((item) => item.id !== id));
      setSelectedRawJobIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setActionMsg("\u5df2\u5ffd\u7565\u8be5\u6761\u722c\u866b\u4efb\u52a1\u3002");
    } catch (err) {
      setExtractError(
        err?.message || "\u5ffd\u7565\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002",
      );
    } finally {
      setIgnoringId(null);
    }
  }

  async function handlePublish() {
    const title = form.title.trim();
    const deadline = form.deadline.trim();
    const majors = form.major.trim();
    const slots = form.headcount.trim();
    const sourceUrl = currentSourceUrl.trim();

    if (!title) {
      setActionMsg("");
      setExtractError(
        "\u8bf7\u5148\u586b\u5199\u6807\u9898\u540e\u518d\u53d1\u5e03\u3002",
      );
      return;
    }

    setExtractError("");
    setActionMsg("");

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, deadline, majors, slots, sourceUrl }),
      });

      const data = await res.json();

      if (!res.ok) {
        const detail = data?.details ? `：${data.details}` : "";
        throw new Error(
          (data?.error || `\u53d1\u5e03\u5931\u8d25\uff08${res.status}\uff09`) +
            detail,
        );
      }

      setForm(EMPTY_FORM);
      setCurrentSourceUrl("");
      setRawText("");
      setActionMsg("\u53d1\u5e03\u6210\u529f\uff01");
      await loadPublishedJobs();
    } catch (err) {
      setExtractError(
        err?.message || "\u53d1\u5e03\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002",
      );
    }
  }

  async function handleDeleteJob(id) {
    setDeletingId(id);
    setExtractError("");

    try {
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data?.error || `\u4e0b\u67b6\u5931\u8d25\uff08${res.status}\uff09`,
        );
      }

      setActionMsg("\u4e0b\u67b6\u6210\u529f\uff01");
      await loadPublishedJobs();
    } catch (err) {
      setExtractError(
        err?.message || "\u4e0b\u67b6\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002",
      );
    } finally {
      setDeletingId(null);
    }
  }

  function handleDiscard() {
    setForm(EMPTY_FORM);
    setCurrentSourceUrl("");
    setRawText("");
    clearBatchUiState();
    setExtractError("");
    setActionMsg("\u5df2\u6e05\u7a7a\u5f53\u524d\u63d0\u70bc\u5185\u5bb9\u3002");
  }

  const batchOkCount = batchResults.filter((item) => item.ok).length;
  const batchFailCount = batchResults.filter((item) => !item.ok).length;

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="border-b border-[#E5E7EB] bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between">
          <h1 className="text-sm font-medium text-[#111827]">
            {"\u5cb8\u8fb9 \u00b7 \u7ba1\u7406\u5458\u6536\u4ef6\u7bb1"}
          </h1>
          <a href="/" className="text-xs text-gray-500 hover:text-[#111827]">
            {"\u8fd4\u56de\u524d\u53f0"}
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-md px-4 py-8 sm:px-6">
        {!unlocked && (
          <form onSubmit={handleUnlock} className="space-y-3">
            <label
              htmlFor="admin-password"
              className="block text-sm font-medium text-[#111827]"
            >
              {"\u8bf7\u8f93\u5165\u7ba1\u7406\u5458\u5bc6\u7801"}
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setAuthError(false);
              }}
              placeholder={"\u7ba1\u7406\u5458\u5bc6\u7801"}
              className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:border-gray-400 focus:outline-none"
            />
            <button
              type="submit"
              className="w-full rounded-md bg-[#111827] py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              {"\u8fdb\u5165\u540e\u53f0"}
            </button>
            {authError && (
              <p className="text-center text-sm text-red-600">
                {"\u6743\u9650\u4e0d\u8db3"}
              </p>
            )}
          </form>
        )}
      </div>

      {unlocked && (
        <>
          <div className="mx-auto flex h-[calc(100vh-52px)] max-w-[1800px] gap-0 border-t border-[#E5E7EB]">
            <section className="flex w-[34%] shrink-0 flex-col border-r border-[#E5E7EB] bg-white p-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {"\u516c\u544a\u539f\u6587 / AI \u8f93\u5165"}
              </h2>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={"\u7c98\u8d34\u539f\u6587\uff0c\u6216\u4ece\u53f3\u4fa7\u5f85\u5904\u7406\u6c60\u4e00\u952e\u8f7d\u5165..."}
                className="min-h-0 flex-1 resize-none rounded-md border border-[#E5E7EB] p-3 font-sans text-xs leading-relaxed text-gray-700 focus:border-gray-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleExtract}
                disabled={isExtracting}
                className="mt-3 w-full rounded-md bg-[#111827] py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isExtracting
                  ? "AI \u6b63\u5728\u63d0\u70bc\u4e2d..."
                  : "\u5f00\u59cb AI \u63d0\u70bc"}
              </button>
              {extractError && (
                <p className="mt-2 text-xs text-red-600">{extractError}</p>
              )}
              {actionMsg && (
                <p className="mt-2 text-xs leading-relaxed text-green-700">
                  {actionMsg}
                </p>
              )}
            </section>

            <section className="flex w-[33%] shrink-0 flex-col overflow-y-auto border-r border-[#E5E7EB] bg-white p-4">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {"AI \u63d0\u70bc\u7ed3\u679c\uff08\u53ef\u7f16\u8f91\uff09"}
              </h2>
              {batchResults.length > 0 && !isBatchExtracting && (
                <div className="mb-4 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-2">
                  <p className="mb-2 text-xs text-gray-500">
                    {`\u672c\u6b21\u6279\u91cf\u7ed3\u679c\uff1a\u6210\u529f ${batchOkCount} \u6761${
                      batchFailCount > 0 ? `\uff0c\u5931\u8d25 ${batchFailCount} \u6761` : ""
                    }`}
                  </p>
                  <ul className="max-h-28 space-y-1 overflow-y-auto text-xs">
                    {batchResults.map((item, index) => (
                      <li
                        key={item.job.id}
                        className={
                          item.ok ? "text-green-700" : "text-red-600"
                        }
                        title={item.error}
                      >
                        {index + 1}. {item.job.title.slice(0, 20)}
                        {item.job.title.length > 20 ? "…" : ""}
                        {item.ok
                          ? " \u00b7 \u5df2\u53d1\u5e03"
                          : ` \u00b7 ${item.error || "\u5931\u8d25"}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    {"\u6807\u9898"}
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => updateField("title", e.target.value)}
                    className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    {"\u622a\u6b62\u65e5\u671f"}
                  </label>
                  <input
                    type="date"
                    value={form.deadline}
                    onChange={(e) => updateField("deadline", e.target.value)}
                    className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    {"\u4e13\u4e1a\u8981\u6c42"}
                  </label>
                  <input
                    type="text"
                    value={form.major}
                    onChange={(e) => updateField("major", e.target.value)}
                    className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    {"\u62db\u8058\u4eba\u6570"}
                  </label>
                  <input
                    type="text"
                    value={form.headcount}
                    onChange={(e) => updateField("headcount", e.target.value)}
                    className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    {"\u5b98\u7f51\u539f\u6587\u94fe\u63a5"}
                  </label>
                  <input
                    type="url"
                    readOnly
                    value={currentSourceUrl}
                    placeholder={"\u4ece\u5f85\u5904\u7406\u6c60\u4e00\u952e\u63d0\u70bc\u540e\u81ea\u52a8\u586b\u5165"}
                    className="w-full rounded-md border border-[#E5E7EB] bg-gray-50 px-3 py-2 text-xs text-gray-600 focus:outline-none"
                  />
                </div>
              </div>
              <div className="mt-6 flex flex-col gap-2 border-t border-[#E5E7EB] pt-4">
                <button
                  type="button"
                  onClick={handlePublish}
                  className="w-full rounded-md bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  {"\u4e00\u952e\u53d1\u5e03\u5230\u524d\u53f0"}
                </button>
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="w-full rounded-md border border-[#E5E7EB] bg-white py-2.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  {"\u6e05\u7a7a\u5f53\u524d\u63d0\u70bc"}
                </button>
              </div>
            </section>

            <aside className="flex w-[33%] shrink-0 flex-col bg-[#F9FAFB] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {"\u6700\u65b0\u722c\u53d6 \u00b7 \u5f85\u5904\u7406\u6c60"}
                </h2>
                <button
                  type="button"
                  onClick={loadPendingRawJobs}
                  disabled={isBatchExtracting}
                  className="text-xs text-gray-500 hover:text-[#111827] disabled:opacity-50"
                >
                  {"\u5237\u65b0"}
                </button>
              </div>
              {pendingRawJobs.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllPending}
                    disabled={isBatchExtracting || selectablePendingJobs.length === 0}
                    className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {"\u5168\u9009"}
                  </button>
                  <button
                    type="button"
                    onClick={clearPendingSelection}
                    disabled={isBatchExtracting || selectedCount === 0}
                    className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {"\u6e05\u7a7a"}
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchAiExtract}
                    disabled={
                      isBatchExtracting ||
                      isExtracting ||
                      selectedCount === 0
                    }
                    className="ml-auto rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBatchExtracting
                      ? batchProgress
                        ? `\u6279\u91cf\u4e2d ${batchProgress.current}/${batchProgress.total}`
                        : "\u6279\u91cf\u4e2d..."
                      : `\u6279\u91cf\u63d0\u70bc\u540e\u81ea\u52a8\u53d1\u5e03${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
                  </button>
                  {isBatchExtracting && (
                    <button
                      type="button"
                      onClick={handleTerminateBatch}
                      className="w-full rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      {"\u7ec8\u6b62\u6279\u91cf\uff08\u4f5c\u5e9f\u5e76\u5220\u9664\u672c\u6b21\u5df2\u53d1\u5e03\uff09"}
                    </button>
                  )}
                </div>
              )}
              {isBatchExtracting && batchProgress?.title && (
                <p className="mb-2 truncate text-xs text-gray-500">
                  {isBatchAborting
                    ? "\u7ec8\u6b62\u4e2d\uff0c\u6b63\u5728\u56de\u6eda\u672c\u6b21\u5df2\u53d1\u5e03\u2026"
                    : `\u6b63\u5728\u5904\u7406\uff1a${batchProgress.title}`}
                </p>
              )}
              {pendingLoading ? (
                <p className="text-sm text-gray-500">{"\u52a0\u8f7d\u4e2d..."}</p>
              ) : pendingRawJobs.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {"\u6682\u65e0 PENDING \u4efb\u52a1"}
                </p>
              ) : (
                <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                  {pendingRawJobs.map((job) => {
                    const selected = isRawJobSelected(job.id);
                    const hasContent = Boolean(job.content?.trim());
                    const isProcessing =
                      extractingRawId === job.id && isBatchExtracting;

                    return (
                      <li
                        key={job.id}
                        className={`rounded-lg border bg-white p-3 shadow-sm transition-colors ${
                          selected
                            ? "border-[#111827] ring-1 ring-[#111827]"
                            : "border-[#E5E7EB]"
                        } ${isProcessing ? "opacity-80" : ""}`}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (!isBatchExtracting) toggleRawJobSelection(job.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (!isBatchExtracting) toggleRawJobSelection(job.id);
                            }
                          }}
                          className={`flex cursor-pointer gap-2 text-left ${
                            isBatchExtracting ? "cursor-default" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={isBatchExtracting}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-[#111827]"
                            aria-label={`\u9009\u4e2d ${job.title}`}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleRawJobSelection(job.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[#111827]">
                              {job.title}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              {"\u53d1\u5e03 "}
                              {job.publishedAt || "-"}
                              {!hasContent && (
                                <span className="ml-1 text-amber-600">
                                  {"\u00b7 \u65e0\u6b63\u6587"}
                                </span>
                              )}
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-gray-600">
                              {previewContent(job.content, 100) ||
                                "(\u65e0\u6b63\u6587\u9884\u89c8)"}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleIgnoreRawJob(job.id);
                            }}
                            disabled={
                              ignoringId === job.id ||
                              isExtracting ||
                              isBatchExtracting
                            }
                            className="flex-1 rounded-md bg-gray-100 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                          >
                            {ignoringId === job.id
                              ? "..."
                              : "\u5ffd\u7565"}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAiExtractFromPool(job);
                            }}
                            disabled={
                              extractingRawId === job.id ||
                              isExtracting ||
                              isBatchExtracting ||
                              !hasContent
                            }
                            className="flex-1 rounded-md bg-green-600 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {extractingRawId === job.id &&
                            (isExtracting || isBatchExtracting)
                              ? "\u63d0\u70bc\u4e2d..."
                              : "AI \u4e00\u952e\u63d0\u70bc"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>
          </div>

          <section className="mx-auto max-w-[1800px] border-t border-[#E5E7EB] bg-[#F9FAFB] px-4 py-5 sm:px-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {"\u5df2\u53d1\u5e03\u5c97\u4f4d\uff08\u524d\u53f0 Job \u8868\uff09"}
            </h2>
            {listLoading ? (
              <p className="text-sm text-gray-500">{"\u52a0\u8f7d\u4e2d..."}</p>
            ) : publishedJobs.length === 0 ? (
              <p className="text-sm text-gray-500">
                {"\u6682\u65e0\u5df2\u53d1\u5e03\u5c97\u4f4d"}
              </p>
            ) : (
              <ul className="space-y-2">
                {publishedJobs.map((job) => (
                  <li
                    key={job.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-[#E5E7EB] bg-white px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#111827]">
                        {job.title}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {job.deadline || "-"} / {job.slots} / {job.majors}
                      </p>
                    </div>
                    {job.sourceUrl ? (
                      <a
                        href={job.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50"
                      >
                        {"\ud83d\udd17 \u67e5\u770b\u539f\u6587"}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleDeleteJob(job.id)}
                      disabled={deletingId === job.id}
                      className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {deletingId === job.id ? "..." : "\u4e0b\u67b6"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}