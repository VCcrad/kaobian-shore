/**
 * 招聘公告准入过滤（爬虫列表、入库、API 展示共用）
 * 目标：过滤导航栏杂质、过程通知、结果公示等非招聘条目
 */

/** 网站导航/栏目名（标题中出现多个即视为导航串） */
export const SITE_NAV_JUNK_WORDS = [
  "首页",
  "机构设置",
  "职能简介",
  "领导分工",
  "部门职责",
  "联系方式",
  "政策制度",
  "人才计划",
  "办事指南",
  "站内搜索",
  "版权所有",
  "师资队伍",
  "师资培养",
  "薪酬与福利",
  "编制与调配",
  "社会保险",
  "档案管理",
  "职称岗位",
  "新进教师",
  "常用下载",
  "网站地图",
  "English",
  "旧版回顾",
  "政策规章",
];

/** 标题须含其一，才视为招聘类条目 */
export const RECRUITMENT_CORE_KEYWORDS = [
  "招聘",
  "公开招聘",
  "岗位",
  "计划招录",
  "名额",
  "招聘计划",
  "专任教师",
  "辅导员",
  "专技岗位",
  "选聘",
  "遴选",
  "招贤",
];

/**
 * 非招聘公告标题特征（过程通知、结果公示、培训通知等）
 * 注意：不用宽泛的「公示」一刀切，避免误杀「公开招聘公告」
 */
export const NON_RECRUITMENT_TITLE_PATTERNS = [
  /拟聘用|拟录用/u,
  /拟录(?:用|取)?人选/u,
  /(?:入围|终选|初选|通过|合格).*名单/u,
  /(?:公布|发布).*人员名单/u,
  /人员名单(?:的)?通知/u,
  /考场安排/u,
  /(?:笔试|面试|试讲|体[检验]).*(?:安排|通知|公告|事项)/u,
  /(?:资格|现场).*确认/u,
  /资格初审(?:结果)?/u,
  /初选结果/u,
  /(?:体检|政审|考察)(?:和|及|、)?(?:政审|考察)?(?:安排|通知|公告)?/u,
  /体检和?(?:政审|政)/u,
  /(?:聘用|录用).*?(?:拟)?(?:聘用|录用)/u,
  /考核结果(?:公示|公布)?/u,
  /(?:培养计划|中期考核).*?(?:通知|公示)/u,
  /教师队伍建设/u,
  /学习贯彻/u,
  /结果公示/u,
  /(?:招聘)?(?:拟)?(?:聘用|录用).*公示/u,
  /拟聘.*?(?:公示|通知)/u,
  /(?:入围|通过).*?(?:公示|通知)/u,
  /** 递补 / 改报 / 放弃资格 */
  /递补(?:公告|通知|人员)?/u,
  /(?:放弃|改报|取消)(?:资格|岗位)?(?:的)?(?:公告|通知)?/u,
  /** 成绩公布（含「关于公布…招聘…成绩」类标题） */
  /(?:公布|发布|公示).*?成绩/u,
  /(?:公布|发布|公示).*?(?:笔|面|试|讲)试?(?:成绩|分数)/u,
  /(?:笔|面|试|讲)试?(?:成绩|分数).*(?:公布|公示|通知|排名)/u,
  /成绩(?:的)?(?:通知|公布|公示|排名)/u,
  /(?:合成|总)成绩/u,
  /** 资格初审 / 审查通过人员 */
  /(?:初审|资格审查|资格复核)(?:通过|合格).*?(?:人员|名单)/u,
  /(?:初审|资格审查)(?:通过|合格)/u,
  /(?:通过|合格)人员(?:名单)?(?:的)?通知/u,
  /** 资格审查 / 现场复核结果公布（非首次招聘公告） */
  /(?:公布|发布|公示).*?(?:资格)?(?:审查|复核)(?:结果|情况)/u,
  /(?:资格)?(?:审查|复核)结果(?:的)?(?:通知|公布|公示)?/u,
  /现场资格复核/u,
  /资格审查(?:结果|情况)/u,
  /资格复核(?:结果|情况)/u,
  /** 考试安排、笔面试通知（非首次招聘公告） */
  /考试工作安排/u,
  /(?:笔|面|试|讲)试?(?:的)?(?:通知|公告|安排|事项)/u,
  /公开招聘.*?笔(?:试)?(?:的)?(?:通知|公告)/u,
  /** 体检 / 心理测试 / 考察 */
  /关于做好.*?(?:体检|考察|心理测试)/u,
  /(?:体检|心理测试|考察)(?:工作)?(?:的)?通知/u,
  /及(?:体检|心理测试)/u,
];

export function normalizeAnnouncementTitle(title) {
  return String(title ?? "")
    .replace(/\u200b/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 标题是否为网站导航栏/栏目链接串 */
export function isNavigationMenuText(text) {
  const value = normalizeAnnouncementTitle(text);
  if (!value) return false;
  if (/^首页(?:\s|$)/u.test(value)) return true;

  let hits = 0;
  for (const word of SITE_NAV_JUNK_WORDS) {
    if (value.includes(word)) hits += 1;
  }
  if (hits >= 3) return true;
  if (hits >= 2 && value.length > 36) return true;
  return false;
}

export function hasRecruitmentCoreSignal(title) {
  const text = normalizeAnnouncementTitle(title);
  if (!text) return false;
  return RECRUITMENT_CORE_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function hasNonRecruitmentTitleSignal(title) {
  const text = normalizeAnnouncementTitle(title);
  if (!text) return false;
  if (isNavigationMenuText(text)) return true;
  return NON_RECRUITMENT_TITLE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 是否为应保留的招聘公告标题
 * @param {string} title
 * @param {{ requireRecruitmentKeyword?: boolean }} [options]
 */
export function passesRecruitmentAnnouncementFilter(title, options = {}) {
  const { requireRecruitmentKeyword = true } = options;
  const text = normalizeAnnouncementTitle(title);
  if (!text || text.length < 6) return false;
  if (isNavigationMenuText(text)) return false;
  if (requireRecruitmentKeyword && !hasRecruitmentCoreSignal(text)) return false;
  if (hasNonRecruitmentTitleSignal(text)) return false;
  return true;
}

/**
 * 高校人事处常见 CMS 详情页 URL（VSB / 类似结构）
 * @param {string} url
 * @param {string} [listPageUrl]
 */
export function isLikelyUniversityDetailUrl(url, listPageUrl = "") {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;

    if (listPageUrl) {
      const list = new URL(listPageUrl);
      if (u.hostname !== list.hostname) return false;
    }

    const path = u.pathname + u.search;
    if (/\/info\/\d+\/\d+\.(?:htm|html|shtml|aspx)(?:\?|#|$)/i.test(path)) {
      return true;
    }
    if (/\/content\.jsp|article_\d+|\/(\d{4})\/(\d{2})\/\d+/i.test(path)) {
      return true;
    }
    if (/\/index\.(?:htm|html|aspx|jsp)(?:\?|#|$)/i.test(path)) return false;
    if (/\.(?:htm|html)$/.test(u.pathname) && u.pathname.split("/").filter(Boolean).length <= 2) {
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

/** 详情页 URL 是否像栏目导航页（非文章） */
export function isLikelyColumnNavUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (/\/zczd\/|\/jgsz\/|\/bszn\/|\/zcfg\/|column\//i.test(path)) return true;
    if (/list\.(?:htm|html|aspx)$/i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}
