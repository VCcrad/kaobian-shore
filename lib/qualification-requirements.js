/**
 * 资格要求提取（全国事业单位招聘通用）
 * 仅输出完整、可读的硬性条件短语（资格证、职称、语言等级、从业年限等）。
 */

const CERT_CATALOG = [
  "法律职业资格证书",
  "国家统一法律职业资格证书",
  "医师资格证",
  "医师执业证",
  "护士执业证",
  "教师资格证",
  "会计专业技术资格证",
  "会计从业资格证",
  "注册会计师",
  "注册建造师",
  "一级建造师",
  "二级建造师",
  "监理工程师",
  "造价工程师",
  "注册消防工程师",
  "电工证",
  "焊工证",
  "特种设备作业证",
  "驾驶证",
  "C1驾驶证",
  "计算机等级证书",
  "全国计算机等级考试",
  "出版专业技术人员职业资格",
  "新闻记者职业资格",
  "翻译专业资格",
  "社会工作者职业水平证书",
];

/** 证书类（须含「证书」或目录内资格证，避免误匹配「经历证」「…证明」） */
const CERT_EXTRACT_PATTERNS = [
  /[\u4e00-\u9fa5]{2,14}(?:执业)?(?:资格)?证书(?:\([^)]{1,10}\))?/gu,
  /(?:国家统一)?法律职业资格(?:证书)?/gu,
];

/** 以「证」结尾但非证件（多为「…证明」被截断或报名材料说明） */
const FALSE_CERT_SUFFIX =
  /(?:经历|荣誉|工作|身份|学历|学位|在职|组织|户口|婚姻|无犯罪|廉洁|健康|业绩|成果|关系|党员|政治|材料|情况|业绩|获奖|任职)证$/u;

/** 职称须带层级，禁止匹配孤立的「以上职称」 */
const TITLE_EXTRACT_PATTERNS = [
  /(?:正|副)?(?:高|中|初)级(?:及以上|以上)(?:专业)?(?:技术)?职称/gu,
  /(?:正高|副高|助理)级(?:及以上|以上)?(?:专业)?(?:技术)?职称/gu,
  /(?:会计|审计|经济|统计|工程|教师|医师|护师|药师)系列(?:中|高|初)级(?:及以上|以上)职称/gu,
  /(?:住院|主治|副主任|主任)医师(?:职称|资格)/gu,
  /(?:高校|高等学校)?(?:讲师|副教授|教授)(?:职称|职务)?/gu,
  /(?:讲师|副教授|教授|研究员|副研究员|助理研究员)(?:及以上|以上)(?:职称)?/gu,
];

const OTHER_QUAL_PATTERNS = [
  /(?:大学英语|英语)(?:四|五|六|八)级(?:及以上|以上)?/gu,
  /(?:CET|cet)[-\s]?[468](?:级)?(?:及以上|以上)?/giu,
  /普通话(?:水平)?(?:测试)?(?:等级)?(?:证书)?二级[\u4e00-\u9fa5]*等(?:及以上|以上)?/gu,
  /普通话(?:水平)?(?:测试)?(?:等级)?(?:证书)?三级[\u4e00-\u9fa5]*等(?:及以上|以上)?/gu,
  /\d+\s*年(?:以上)?(?:相关)?(?:工作|从教|从业|基层)?经验/gu,
];

/** 高校校内招聘用人范围（编制内、校内教职工等） */
const UNIVERSITY_EMPLOYMENT_PATTERNS = [
  /学校编制内(?:在)?(?:岗)?(?:职工|教职工)/gu,
  /面向(?:全校|校内)(?:教职工|职工)/gu,
  /须符合学校跨部门流动条件/gu,
  /本校(?:编制内|在编)(?:人员|职工|教职工)?/gu,
];

/** 残缺片段（拆分或正则误伤产生） */
const INCOMPLETE_ITEM =
  /^(?:及|或|等|的|和|与|须|应|需|具有|具备|以上|以下|及以上|及以下|中级|高级|初级|职称|专业|技术|系列|资格|学历|学位)$/u;

const CERT_BLOCKLIST =
  /(?:毕业|学位|学历|身份|居住|保证|承诺|授权|协议|诚信|体检|考察|公示|品行|政治|拥护|热爱|遵纪|守法|健康|无犯罪|征信|档案|户籍|生源|面试|笔试|复审|调剂|递补|附件|表格|一览|招聘|岗位|计划|序号|单位名称|咨询电话|报名|缴费)/u;

const CERT_SUFFIX_BLOCK =
  /(?:保证书|承诺书|授权书|协议书|介绍信|证明信|推荐表|证明材料|证明$)$/u;

function normalizeFragment(raw) {
  let s = String(raw ?? "").trim();
  for (let i = 0; i < 4; i += 1) {
    const next = s
      .replace(
        /^(?:须|应|需|必须|应当|须具备|需具备|应具有|具有|持有|取得|持|具备)/u,
        "",
      )
      .trim();
    if (next === s) break;
    s = next;
  }
  s = s.replace(/[，,；;。].*$/u, "").trim();
  return s;
}

function toCatalogName(text) {
  const s = normalizeFragment(text);
  if (!s) return "";
  const sorted = [...CERT_CATALOG].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    if (s.includes(kw)) return kw;
  }
  return s;
}

function hasCompleteTitleLevel(text) {
  const s = String(text ?? "");
  if (!/职称/u.test(s)) return false;
  return /(?:初级|中级|高级|正高|副高|助理|员级|住院|主治|副主任|主任|讲师|副教授|教授|研究员|副研究员|会计师|工程师|经济师|系列|正高级|副高级)/u.test(
    s,
  );
}

function isCompleteQualificationPhrase(text) {
  const s = normalizeFragment(text);
  if (!s || s.length < 3 || s.length > 32) return false;
  if (INCOMPLETE_ITEM.test(s)) return false;
  if (/^(?:及|或)?以上(?:职称|学历|学位)?$/u.test(s)) return false;
  if (/^及以上(?:职称)?$/u.test(s)) return false;
  if (/职称/u.test(s) && !hasCompleteTitleLevel(s)) return false;
  return true;
}

function isValidQualificationItem(text) {
  const s = normalizeFragment(text);
  if (!isCompleteQualificationPhrase(s)) return false;
  if (CERT_BLOCKLIST.test(s)) return false;
  if (CERT_SUFFIX_BLOCK.test(s)) return false;
  if (FALSE_CERT_SUFFIX.test(s)) return false;
  if (/证明$/u.test(s) && !/证书$/u.test(s)) return false;
  if (/^证/u.test(s)) return false;
  if (/证$/u.test(s) && !/证书$/u.test(s) && !/资格证$/u.test(s) && !/执业证$/u.test(s)) {
    if (!CERT_CATALOG.some((kw) => s.includes(kw))) return false;
  }

  if (CERT_CATALOG.some((kw) => s.includes(kw) || kw.includes(s))) return true;
  if (/普通话/u.test(s) && /级/u.test(s)) return true;
  if (/(?:大学英语|英语|CET)/iu.test(s) && /[四五六八]/u.test(s)) return true;
  if (/\d+\s*年(?:以上)?(?:相关)?(?:工作|从教|从业|基层)?经验/u.test(s)) return true;
  if (hasCompleteTitleLevel(s)) return true;
  if (/[\u4e00-\u9fa5]{2,12}(?:执业)?(?:资格)?证书$/u.test(s)) return true;
  if (/[\u4e00-\u9fa5]{2,8}(?:资格|执业)证$/u.test(s)) return true;

  return false;
}

function trimQualDisplay(text) {
  const s = String(text ?? "").trim();
  if (/普通话|英语|CET/iu.test(s)) {
    return s.replace(/(?:及)?以上$/u, "");
  }
  return s;
}

function dedupeItems(items) {
  const unique = [...new Set(items)];
  return unique.filter(
    (item) =>
      !unique.some(
        (other) =>
          other !== item && other.includes(item) && other.length > item.length,
      ),
  );
}

/**
 * 按分句拆分；不把「及以上」里的「及」拆开
 */
function splitRequirementClauses(text) {
  return String(text ?? "")
    .split(/[；;\n\r|｜/]+/u)
    .flatMap((part) => part.split(/[、,，]+/u))
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function addIfValid(found, raw) {
  const normalized = toCatalogName(raw);
  const candidate = normalized || normalizeFragment(raw);
  if (isValidQualificationItem(candidate)) {
    found.add(trimQualDisplay(candidate));
  }
}

/**
 * @param {...unknown} sources
 * @returns {string[]}
 */
export function extractQualificationRequirements(...sources) {
  const combined = sources.filter(Boolean).join("\n");
  if (!combined.trim()) return [];

  const found = new Set();

  for (const keyword of CERT_CATALOG) {
    if (combined.includes(keyword)) found.add(keyword);
  }

  const allPatterns = [
    ...TITLE_EXTRACT_PATTERNS,
    ...CERT_EXTRACT_PATTERNS,
    ...OTHER_QUAL_PATTERNS,
  ];

  for (const pattern of allPatterns) {
    for (const match of combined.matchAll(pattern)) {
      addIfValid(found, match[0]);
    }
  }

  for (const pattern of UNIVERSITY_EMPLOYMENT_PATTERNS) {
    for (const match of combined.matchAll(pattern)) {
      const phrase = String(match[0] ?? "").trim();
      if (phrase.length >= 4 && phrase.length <= 32) {
        found.add(phrase);
      }
    }
  }

  for (const clause of splitRequirementClauses(combined)) {
    for (const keyword of CERT_CATALOG) {
      if (clause.includes(keyword)) found.add(keyword);
    }
    for (const pattern of allPatterns) {
      for (const match of clause.matchAll(pattern)) {
        addIfValid(found, match[0]);
      }
    }
  }

  return dedupeItems([...found]).slice(0, 8);
}

/**
 * @param {...unknown} sources
 * @returns {string}
 */
export function formatQualificationRequirements(...sources) {
  return extractQualificationRequirements(...sources).join("、");
}
