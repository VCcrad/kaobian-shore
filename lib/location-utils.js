/** 去掉常见行政区划后缀，便于模糊匹配 */
export function normalizeRegionToken(value) {
  return String(value ?? "")
    .trim()
    .replace(
      /(特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|地区|盟|省|市|区|县)/g,
      "",
    )
    .replace(/\s+/g, "");
}

/** 解析岗位中的 provinceCity，如「山东·济南」「上海」 */
export function parseJobProvinceCity(provinceCity) {
  const raw = String(provinceCity ?? "").trim();
  if (!raw) return { province: "", city: "", raw: "" };

  if (raw.includes("·")) {
    const [p, c] = raw.split("·").map((s) => s.trim());
    return { province: p, city: c || "", raw };
  }

  return { province: raw, city: "", raw };
}

/** 按省份、城市筛选（与 CHINA 下拉选项短名一致） */
export function jobMatchesRegion(job, provinceFilter, cityFilter) {
  if (provinceFilter === "全部" && cityFilter === "全部") return true;

  const { province, city, raw } = parseJobProvinceCity(job.provinceCity);
  const nProvince = normalizeRegionToken(province);
  const nCity = normalizeRegionToken(city);
  const nRaw = normalizeRegionToken(raw);

  if (provinceFilter !== "全部") {
    const nPF = normalizeRegionToken(provinceFilter);
    const provinceOk =
      nProvince === nPF ||
      nProvince.startsWith(nPF) ||
      nPF.startsWith(nProvince) ||
      nRaw.includes(nPF);
    if (!provinceOk) return false;
  }

  if (cityFilter !== "全部") {
    const nCF = normalizeRegionToken(cityFilter);
    const cityOk =
      nCity === nCF ||
      nCity.startsWith(nCF) ||
      nCF.startsWith(nCity) ||
      nRaw.includes(nCF);
    if (!cityOk) return false;
  }

  return true;
}
