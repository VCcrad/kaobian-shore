const { checkJobQualification } = require("../../utils/matcher.js");

const API_JOBS_URL = "http://127.0.0.1:3000/api/jobs?format=jobs";
// 上线后改为真实域名，例如：
// const API_JOBS_URL = "https://your-domain.com/api/jobs?format=jobs";

const PROFILE_A = {
  key: "A",
  age: 28,
  isPartyMember: false,
  major: "辅导员",
  label: "群众 · 辅导员",
};

const PROFILE_B = {
  key: "B",
  age: 28,
  isPartyMember: true,
  major: "辅导员",
  label: "党员 · 辅导员",
};

const FALLBACK_JOBS = [
  {
    id: "mock-1",
    publishDate: "2026-03-17",
    organization: "南华大学 · 党委学生工作部",
    title: "辅导员 A1",
    provinceCity: "湖南 · 衡阳",
    slots: 4,
    slotsLabel: "4 人",
    education: "硕士研究生及以上",
    majorRequirement: "专业不限",
    ageRequirement: "38周岁及以下",
    deadline: "2026-05-10",
    daysLeft: 12,
    daysLeftLabel: "剩余 12 天",
    text: "南华大学招聘专职辅导员，限中共党员，35周岁以下。专业不限",
  },
  {
    id: "mock-2",
    publishDate: "2026-03-17",
    organization: "湖南XX学院",
    title: "专职辅导员",
    provinceCity: "湖南 · 长沙",
    slots: 2,
    slotsLabel: "2 人",
    education: "本科及以上",
    majorRequirement: "教育学相关",
    ageRequirement: "30周岁及以下",
    deadline: "2026-05-10",
    daysLeft: 12,
    daysLeftLabel: "剩余 12 天",
    text: "湖南XX学院招聘专职辅导员，不限政治面貌，不超过30周岁。",
  },
  {
    id: "mock-3",
    publishDate: "2026-03-16",
    organization: "长沙某高校",
    title: "行政人员",
    provinceCity: "湖南 · 长沙",
    slots: 1,
    slotsLabel: "1 人",
    education: "硕士研究生及以上",
    majorRequirement: "专业不限",
    ageRequirement: "38周岁及以下",
    deadline: "2026-05-10",
    daysLeft: 12,
    daysLeftLabel: "剩余 12 天",
    text: "长沙某高校招聘行政人员，限中共党员，38周岁以下。",
  },
];

function statusClassFromFinal(finalStatus) {
  if (finalStatus === "PERFECT") return "perfect";
  if (finalStatus === "CONFLICT") return "conflict";
  return "normal";
}

function statusLabelFromResult(result) {
  if (result.finalStatus === "PERFECT") return "[ 🔥 完美匹配 ]";
  if (result.finalStatus === "CONFLICT") {
    const reasons = collectConflictReasonsFromResult(result);
    return statusLabelFromConflictReason(reasons[0] || "");
  }
  return "[ · 无冲突 ]";
}

function collectConflictReasonsFromResult(result) {
  const reasons = [];
  if (!result || result.finalStatus !== "CONFLICT") return reasons;
  if (result.ageMatch && result.ageMatch.reason) reasons.push(result.ageMatch.reason);
  if (result.partyMatch && result.partyMatch.reason) reasons.push(result.partyMatch.reason);
  return normalizeConflictReasons(reasons);
}

function normalizeConflictReasons(reasons) {
  if (!Array.isArray(reasons)) return [];
  return reasons
    .map(function (item) {
      return String(item ?? "").trim();
    })
    .filter(Boolean);
}

/** 根据冲突文案生成更精确的 statusLabel */
function statusLabelFromConflictReason(reason) {
  const text = String(reason || "");
  if (/年龄/i.test(text)) return "[ ❌ 年龄超限 ]";
  if (/政治|党员|面貌/i.test(text)) return "[ ❌ 政治面貌不符 ]";
  if (/专业/i.test(text)) return "[ ❌ 专业不符 ]";
  if (text) return "[ ❌ 条件冲突 ]";
  return "[ ❌ 条件冲突 ]";
}

function conflictReasonFromResult(result) {
  const reasons = collectConflictReasonsFromResult(result);
  return reasons[0] || "";
}

function statusLabelFromFinalStatus(finalStatus, conflictReasons) {
  if (finalStatus === "PERFECT") return "[ 🔥 完美匹配 ]";
  if (finalStatus === "CONFLICT") {
    const reasons = normalizeConflictReasons(conflictReasons);
    return statusLabelFromConflictReason(reasons[0] || "");
  }
  return "[ · 无冲突 ]";
}

function profileToQuery(profile) {
  const safeProfile = profile || PROFILE_A;
  const politicalStatus = safeProfile.isPartyMember ? "党员" : "群众";

  return [
    "format=jobs",
    "match=1",
    "age=" + encodeURIComponent(String(safeProfile.age ?? 28)),
    "major=" + encodeURIComponent(String(safeProfile.major ?? "")),
    "politicalStatus=" + encodeURIComponent(politicalStatus),
    "isPartyMember=" + (safeProfile.isPartyMember ? "1" : "0"),
  ].join("&");
}

function buildJobsApiUrls(profile) {
  const query = profileToQuery(profile);
  return [
    "http://127.0.0.1:3000/api/jobs?" + query,
    "http://localhost:3000/api/jobs?" + query,
  ];
}

function hasServerMatchStatus(job) {
  const status = job && job.serverMatchStatus ? String(job.serverMatchStatus) : "";
  return status === "PERFECT" || status === "CONFLICT" || status === "NORMAL";
}

/** 本地 Matcher 回退（与 utils/matcher.js 一致） */
function calculateMatchStatus(profile, job) {
  const text = String(job.text || job.title || "").trim();
  return checkJobQualification(profile, text);
}

function resolveDisplayStatus(profile, job, meta) {
  const useServer =
    meta &&
    meta.useServerMatch &&
    job.profileKeyAtFetch === profile.key &&
    hasServerMatchStatus(job);

  if (useServer) {
    const finalStatus = job.serverMatchStatus;
    const conflictReasons = normalizeConflictReasons(job.serverConflictReasons);

    return {
      finalStatus: finalStatus,
      statusClass: statusClassFromFinal(finalStatus),
      statusLabel: statusLabelFromFinalStatus(finalStatus, conflictReasons),
      reason: conflictReasons[0] || "",
      conflictReasons: conflictReasons,
    };
  }

  const result = calculateMatchStatus(profile, job);
  const conflictReasons = collectConflictReasonsFromResult(result);

  return {
    finalStatus: result.finalStatus,
    statusClass: statusClassFromFinal(result.finalStatus),
    statusLabel: statusLabelFromResult(result),
    reason: conflictReasons[0] || "",
    conflictReasons: conflictReasons,
  };
}

function parseJobsFromResponse(res) {
  const body = res && res.data != null ? res.data : null;
  if (!body) return null;
  if (body.success === true && Array.isArray(body.data)) return body.data;
  if (Array.isArray(body)) return body;
  return null;
}

function asRequirements(requirements) {
  if (requirements && typeof requirements === "object" && !Array.isArray(requirements)) {
    return requirements;
  }
  return {};
}

/** 新 JobPosting API → 小程序卡片字段（保留 Matcher 所需的 text） */
function normalizeApiJob(job, profile) {
  const requirements = asRequirements(job.requirements);
  const majorList = Array.isArray(requirements.majorRequirements)
    ? requirements.majorRequirements
    : requirements.majorRequirements
      ? [String(requirements.majorRequirements)]
      : [];
  const majorRequirement =
    job.majorRequirement ||
    (majorList.length > 0 ? majorList.join("、") : "—");
  const safeProfile = profile || PROFILE_A;

  return {
    ...job,
    organization: job.organization || job.sourceName || "湖南省人社厅",
    provinceCity: job.provinceCity || job.province || "—",
    majorRequirement,
    ageRequirement: job.ageRequirement || requirements.ageLimit || "—",
    text: String(job.text || job.rawText || job.title || "").trim(),
    matchStatus: job.matchStatus || "NORMAL",
    serverMatchStatus: job.matchStatus || "",
    serverConflictReasons: Array.isArray(job.conflictReasons)
      ? job.conflictReasons
      : [],
    profileKeyAtFetch: safeProfile.key,
    requirements,
  };
}

function buildDataSourceLabel(jobs, meta) {
  if (meta && meta.dataSourceLabel) return meta.dataSourceLabel;

  const count = jobs.length;
  const source = meta && meta.source ? meta.source : "";

  if (source === "job_postings") {
    return "JobPosting · " + count + "岗";
  }
  if (count > FALLBACK_JOBS.length) {
    return "湖南人社厅 · " + count + "岗";
  }
  return "Mock 兜底";
}

Page({
  data: {
    profileA: PROFILE_A,
    profileB: PROFILE_B,
    currentProfile: PROFILE_A,
    activeProfileKey: "A",
    rawJobs: [],
    displayedJobs: [],
    jobLineCount: 0,
    dataSourceLabel: "加载中",
    loading: true,
  },

  onLoad() {
    this.loadJobs();
  },

  computeJobStatuses(profile, jobsInput, meta) {
    const safeProfile = profile || this.data.currentProfile || PROFILE_A;
    const jobs = Array.isArray(jobsInput) ? jobsInput : this.data.rawJobs || [];
    const displayedJobs = [];

    for (let i = 0; i < jobs.length; i += 1) {
      const job = jobs[i];
      const text = String(job.text || job.title || "").trim();
      const display = resolveDisplayStatus(safeProfile, job, meta);

      displayedJobs.push({
        id: job.id || "job-" + i,
        publishDate: job.publishDate || "",
        organization: job.organization || "",
        title: job.title || "",
        provinceCity: job.provinceCity || "—",
        slotsLabel: job.slotsLabel || "—",
        education: job.education || "—",
        majorRequirement: job.majorRequirement || "—",
        ageRequirement: job.ageRequirement || "—",
        deadline: job.deadline || "—",
        daysLeftLabel: job.daysLeftLabel || "—",
        text: text,
        finalStatus: display.finalStatus,
        statusClass: display.statusClass,
        statusLabel: display.statusLabel,
        reason: display.reason,
        conflictReasons: display.conflictReasons || [],
      });
    }

    this.setData({
      rawJobs: jobs,
      displayedJobs: displayedJobs,
      jobLineCount: displayedJobs.length,
      dataSourceLabel: buildDataSourceLabel(jobs, meta),
      loading: false,
    });

    console.log("[岸边] 结构化岗位", displayedJobs.length, "条");
    return displayedJobs;
  },

  async loadJobs() {
    this.setData({ loading: true });

    const profile = this.data.currentProfile || PROFILE_A;
    const apiUrls = buildJobsApiUrls(profile);
    const that = this;
    let lastErrMsg = "";

    function requestOnce(url) {
      return new Promise(function (resolve) {
        wx.request({
          url: url,
          method: "GET",
          timeout: 20000,
          success: function (res) {
            resolve({ ok: true, res: res });
          },
          fail: function (err) {
            resolve({ ok: false, err: err || {} });
          },
          complete: function () {
            // complete 始终执行，避免 fail/timeout 冒泡成未捕获错误弹窗
          },
        });
      });
    }

    for (let i = 0; i < apiUrls.length; i += 1) {
      const url = apiUrls[i];
      const result = await requestOnce(url);

      if (!result.ok) {
        lastErrMsg =
          result.err && result.err.errMsg
            ? String(result.err.errMsg)
            : "request failed";

        if (/timeout/i.test(lastErrMsg)) {
          console.warn("[岸边] 请求超时(20s):", url);
        } else {
          console.warn("[岸边] 请求失败:", url, lastErrMsg);
        }
        continue;
      }

      const res = result.res;
      const status = res && res.statusCode ? res.statusCode : 0;
      const jobs = parseJobsFromResponse(res);

      if (status >= 200 && status < 300 && jobs && jobs.length > 0) {
        const source = res.data && res.data.source ? res.data.source : "";
        const profileUsed =
          res.data && res.data.profileUsed ? res.data.profileUsed : null;

        console.log(
          "✅ 从新 JobPosting 表加载数据",
          jobs.length,
          "条",
          source ? "(" + source + ")" : "",
          profileUsed ? "· 服务端匹配" : "",
          "via",
          url,
        );

        that.computeJobStatuses(
          profile,
          jobs.map(function (job) {
            return normalizeApiJob(job, profile);
          }),
          { source: source, useServerMatch: true },
        );
        return;
      }

      lastErrMsg = "empty or invalid response";
      console.warn("[岸边] 接口无有效数据:", url, "status=", status);
    }

    const fallbackLabel = /timeout/i.test(lastErrMsg)
      ? "网络超时 · Mock 兜底"
      : lastErrMsg
        ? "离线模式 · Mock 兜底"
        : "Mock 兜底";

    console.warn("[岸边] 新 API 不可用，回退 mock ·", fallbackLabel);
    that.loadOldCache(fallbackLabel);
  },

  loadOldCache(fallbackLabel) {
    this.applyFallbackJobs(
      typeof fallbackLabel === "string" ? fallbackLabel : "Mock 兜底",
    );
  },

  applyFallbackJobs(label) {
    this.computeJobStatuses(this.data.currentProfile, FALLBACK_JOBS, {
      dataSourceLabel: label || "Mock 兜底",
    });
  },

  switchProfile(e) {
    const key = e.currentTarget.dataset.profile;
    const nextProfile = key === "B" ? PROFILE_B : PROFILE_A;

    this.setData({
      currentProfile: nextProfile,
      activeProfileKey: nextProfile.key,
    });

    this.computeJobStatuses(nextProfile, this.data.rawJobs);
  },

  onAiTutorTap(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    console.log("[AI导师] 占位点击", {
      jobId: dataset.id || "",
      title: dataset.title || "",
      status: dataset.status || "",
    });
  },

  onShow() {},
});
