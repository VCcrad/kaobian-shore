/**
 * 岗位卡片「省市」展示（全国通用，不用单位名称充当地点）
 */

import {
  CHINA_PROVINCE_LIST,
  CHINA_PROVINCES_CITIES,
  getCitiesForProvince,
} from "./china-regions.js";

const MUNICIPALITIES = new Set(["北京", "天津", "上海", "重庆"]);

const NON_CITY_ORG =
  /(?:大学|学院|中学|小学|学校|医院|研究|公司|有限|集团|厅|局|部|委|中心|所|馆|队|站|办|处|科|室|湖南|湖北|广东|山东|江苏|浙江|四川|河南|河北|山西|陕西|甘肃|云南|贵州|福建|安徽|江西|辽宁|吉林|黑龙江|广西|内蒙古|宁夏|新疆|西藏|青海|海南)/u;

function cleanToken(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** 与 china-regions 下拉一致的省短名 */
export function normalizeProvinceName(value) {
  const raw = cleanToken(value).replace(
    /(?:特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/u,
    "",
  );
  if (!raw) return "";

  for (const p of CHINA_PROVINCE_LIST) {
    if (raw === p || raw.startsWith(p) || p.startsWith(raw)) return p;
  }
  return raw;
}

/** 与 china-regions 下拉一致的城市短名 */
export function normalizeCityName(value, province) {
  const raw = cleanToken(value).replace(/(?:市|区|县|州|盟|地区)$/u, "");
  if (!raw || NON_CITY_ORG.test(raw)) return "";

  const prov = normalizeProvinceName(province);
  const cities = getCitiesForProvince(prov);
  for (const c of cities) {
    if (raw === c || raw.startsWith(c) || c.startsWith(raw)) return c;
  }

  if (MUNICIPALITIES.has(prov) && (raw === prov || prov.startsWith(raw))) {
    return prov;
  }

  if (raw.length >= 2 && raw.length <= 8 && !NON_CITY_ORG.test(raw)) {
    return raw;
  }
  return "";
}

/**
 * 从公告正文推断省、市（通用正则 + 对照 city 列表）
 * @param {unknown} text
 * @param {string} [hintProvince]
 * @returns {{ province: string, city: string }}
 */
export function inferRegionFromText(text, hintProvince = "") {
  const blob = String(text ?? "");
  const hint = normalizeProvinceName(hintProvince);
  let province = hint;
  let city = "";

  const adminMatch = blob.match(
    /([\u4e00-\u9fa5]{2,10}(?:省|自治区|特别行政区))[\s，,]?([\u4e00-\u9fa5]{2,10}?)(?:市|地区|州|盟)/u,
  );
  if (adminMatch) {
    province = normalizeProvinceName(adminMatch[1]) || province;
    city = normalizeCityName(adminMatch[2], province);
  }

  if (!city) {
    const workMatch = blob.match(
      /(?:工作地点|工作地|单位地址|地址|位于)[:：\s]*([\u4e00-\u9fa5]{2,12}?)(?:市|区|县)/u,
    );
    if (workMatch?.[1]) {
      city = normalizeCityName(workMatch[1], province);
    }
  }

  if (!city && province) {
    const cities = CHINA_PROVINCES_CITIES[province] ?? [];
    for (const c of cities) {
      if (blob.includes(`${c}市`) || blob.includes(c)) {
        city = c;
        break;
      }
    }
  }

  if (!province) {
    for (const p of CHINA_PROVINCE_LIST) {
      if (blob.includes(p) || blob.includes(`${p}省`)) {
        province = p;
        break;
      }
    }
  }

  return { province: province || "", city: city || "" };
}

/**
 * @param {{
 *   province?: string,
 *   city?: string,
 *   sourceProvince?: string,
 *   sourceCity?: string,
 *   text?: string,
 * }} input
 * @returns {string}
 */
export function buildJobProvinceCity(input = {}) {
  const hintProvince = normalizeProvinceName(
    input.province || input.sourceProvince || "",
  );
  const inferred = inferRegionFromText(input.text || "", hintProvince);

  const province =
    hintProvince ||
    normalizeProvinceName(inferred.province) ||
    normalizeProvinceName(input.sourceProvince);

  const city =
    normalizeCityName(input.city, province) ||
    normalizeCityName(input.sourceCity, province) ||
    normalizeCityName(inferred.city, province);

  if (province && city && city !== province) {
    return `${province} · ${city}`;
  }
  if (province) return province;
  if (city) return city;
  return "";
}
