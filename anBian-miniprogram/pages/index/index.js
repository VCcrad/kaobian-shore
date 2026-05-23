const { checkJobQualification } = require("../../utils/matcher.js");

const API_JOBS_URL = "http://127.0.0.1:3000/api/jobs?format=jobs";

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
    if (result.ageMatch && result.ageMatch.reason) return "[ ❌ 年龄超限 ]";
    return "[ ❌ 条件冲突 ]";
  }
  return "[ · 无冲突 ]";
}

function conflictReasonFromResult(result) {
  if (result.finalStatus !== "CONFLICT") return "";
  if (result.ageMatch && result.ageMatch.reason) return result.ageMatch.reason;
  if (result.partyMatch && result.partyMatch.reason) return result.partyMatch.reason;
  return "";
}

function parseJobsFromResponse(res) {
  const body = res && res.data != null ? res.data : null;
  if (!body) return null;
  if (body.success === true && Array.isArray(body.data)) return body.data;
  if (Array.isArray(body)) return body;
  return null;
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
    this.fetchJobsFromApi();
  },

  computeJobStatuses(profile, jobsInput) {
    const safeProfile = profile || this.data.currentProfile || PROFILE_A;
    const jobs = Array.isArray(jobsInput) ? jobsInput : this.data.rawJobs || [];
    const displayedJobs = [];

    for (let i = 0; i < jobs.length; i += 1) {
      const job = jobs[i];
      const text = String(job.text || job.title || "").trim();
      const result = checkJobQualification(safeProfile, text);

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
        finalStatus: result.finalStatus,
        statusClass: statusClassFromFinal(result.finalStatus),
        statusLabel: statusLabelFromResult(result),
        reason: conflictReasonFromResult(result),
      });
    }

    const isApiFeed = jobs.length > FALLBACK_JOBS.length;

    this.setData({
      rawJobs: jobs,
      displayedJobs: displayedJobs,
      jobLineCount: displayedJobs.length,
      dataSourceLabel: isApiFeed ? "湖南人社厅 · 6岗" : "Mock 兜底",
      loading: false,
    });

    console.log("[岸边] 结构化岗位", displayedJobs.length, "条");
    return displayedJobs;
  },

  fetchJobsFromApi() {
    const that = this;
    let settled = false;

    wx.request({
      url: API_JOBS_URL,
      method: "GET",
      timeout: 120000,
      success(res) {
        const status = res && res.statusCode ? res.statusCode : 0;
        const jobs = parseJobsFromResponse(res);

        if (status >= 200 && status < 300 && jobs && jobs.length > 0) {
          settled = true;
          that.computeJobStatuses(that.data.currentProfile, jobs);
          return;
        }

        console.error("[岸边] API 异常，使用 mock", status);
        settled = true;
        that.applyFallbackJobs();
      },
      fail(err) {
        console.error("[岸边] 请求失败，使用 mock", err);
        settled = true;
        that.applyFallbackJobs();
      },
      complete() {
        if (!settled && that.data.loading) {
          that.applyFallbackJobs();
        }
      },
    });
  },

  applyFallbackJobs() {
    this.computeJobStatuses(this.data.currentProfile, FALLBACK_JOBS);
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

  onShow() {},
});
