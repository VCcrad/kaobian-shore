/**
 * 中国核心专业大类 → 关联词扩展（公考 / 高校招聘高频）
 * 用户输入大类词时，自动扩展为同族细分专业关键词
 */
export const MAJOR_CATEGORIES = [
  {
    id: "computer",
    roots: ["计算机", "计算"],
    aliases: [
      "软件",
      "软件工程",
      "网络工程",
      "网络",
      "大数据",
      "数据科学",
      "数据",
      "信息安全",
      "网络安全",
      "物联网",
      "人工智能",
      "智能科学",
      "信息",
      "信息技术",
      "信息管理",
      "信息系统",
      "电子商务",
      "数字媒体",
      "技术",
    ],
  },
  {
    id: "electronics",
    roots: ["电子", "电子信息", "通信"],
    aliases: [
      "电子信息工程",
      "电子工程",
      "微电子",
      "集成电路",
      "光电",
      "光电子",
      "通信工程",
      "电信",
      "信号",
      "自动化",
      "测控",
      "仪器",
    ],
  },
  {
    id: "electrical",
    roots: ["电气", "电力"],
    aliases: [
      "电气工程",
      "电气自动化",
      "电力系统",
      "电网",
      "能源",
      "动力工程",
      "机电",
    ],
  },
  {
    id: "mechanical",
    roots: ["机械", "制造"],
    aliases: [
      "机械工程",
      "机械设计",
      "车辆",
      "汽车",
      "材料成型",
      "工业工程",
      "智能制造",
      "数控",
    ],
  },
  {
    id: "civil",
    roots: ["土木", "建筑", "城建"],
    aliases: [
      "土木工程",
      "建筑工程",
      "结构",
      "造价",
      "工程管理",
      "城市规划",
      "交通",
      "道路",
    ],
  },
  {
    id: "economics",
    roots: ["经管", "经济", "管理", "工商"],
    aliases: [
      "经济学",
      "金融学",
      "金融",
      "会计",
      "会计学",
      "财务",
      "财务管理",
      "审计",
      "市场营销",
      "国际贸易",
      "工商管理",
      "公共管理",
      "行政管理",
      "人力资源",
    ],
  },
  {
    id: "law",
    roots: ["法学", "法律"],
    aliases: ["法学理论", "民商法", "刑法", "诉讼法", "司法"],
  },
  {
    id: "education",
    roots: ["教育", "师范"],
    aliases: [
      "教育学",
      "学前教育",
      "小学教育",
      "学科教学",
      "心理健康",
      "体育教育",
    ],
  },
  {
    id: "medicine",
    roots: ["医学", "临床", "护理", "药学"],
    aliases: [
      "临床医学",
      "口腔",
      "中医",
      "公共卫生",
      "预防医学",
      "药学",
      "中药",
      "护理学",
      "康复",
    ],
  },
  {
    id: "chinese",
    roots: ["中文", "汉语", "文学"],
    aliases: [
      "汉语言",
      "汉语言文学",
      "中国语言文学",
      "新闻",
      "传播",
      "广告",
    ],
  },
  {
    id: "marxism",
    roots: ["马克思", "思政", "政治"],
    aliases: [
      "马克思主义",
      "思想政治教育",
      "政治学",
      "党史",
      "党建",
    ],
  },
  {
    id: "psychology",
    roots: ["心理"],
    aliases: ["心理学", "应用心理", "心理健康"],
  },
];

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** 双向模糊：任一方包含另一方即算命中 */
export function bidirectionalContains(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

function categoryKeywords(category) {
  return [...category.roots, ...category.aliases];
}

/** 将用户输入词扩展为同大类下的所有关联检索词 */
export function expandSearchTerms(inputToken) {
  const terms = new Set();
  const token = inputToken.trim();
  if (!token) return terms;

  const t = normalize(token);
  terms.add(t);

  for (const category of MAJOR_CATEGORIES) {
    const keywords = categoryKeywords(category);
    const matched = keywords.some((kw) => bidirectionalContains(t, kw));
    if (matched) {
      keywords.forEach((kw) => terms.add(normalize(kw)));
    }
  }

  return terms;
}

/** 把岗位要求专业文本拆成若干片段（便于逐段双向匹配） */
export function splitMajorSegments(text) {
  return String(text ?? "")
    .split(/[、,，;；/|｜\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 汇总岗位中所有可能含专业信息的文本 */
export function getJobSearchCorpus(job) {
  const parts = [
    job.major,
    job.majors,
    job.title,
    ...(Array.isArray(job.tags) ? job.tags : []),
  ];
  return parts.filter(Boolean).join(" ");
}

/**
 * 单个用户词（已扩展）是否与岗位专业文本双向匹配
 */
function tokenMatchesCorpus(expandedTerms, corpus) {
  const segments = splitMajorSegments(corpus);
  const fullCorpus = normalize(corpus);

  for (const term of expandedTerms) {
    if (!term) continue;

    if (bidirectionalContains(term, fullCorpus)) return true;

    for (const seg of segments) {
      if (bidirectionalContains(term, seg)) return true;
    }
  }

  return false;
}

/**
 * 专业智能过滤：支持空格分隔多词，任一关键词命中即保留（OR）
 */
export function matchJobByMajorSearch(job, majorKeyword) {
  const raw = majorKeyword.trim();
  if (!raw) return true;

  const tokens = raw.split(/\s+/).filter(Boolean);
  const corpus = getJobSearchCorpus(job);

  return tokens.some((token) => {
    const expanded = expandSearchTerms(token);
    return tokenMatchesCorpus(expanded, corpus);
  });
}
