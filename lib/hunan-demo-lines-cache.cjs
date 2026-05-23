/**
 * 湖南人社厅 demo 行缓存（纯 fs，供 Next API 读取，不加载 pdf-parse / spider）
 */

const fs = require("fs");
const path = require("path");

/** Next 打包后 __dirname 会偏移，优先用 process.cwd() 定位项目根 */
function resolveCacheFile() {
  const candidates = [
    path.join(process.cwd(), "data", "hunan-rst-lines.json"),
    path.join(__dirname, "..", "data", "hunan-rst-lines.json"),
  ];

  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) {
      return candidates[i];
    }
  }

  return candidates[0];
}

function readCachedLines() {
  const cacheFile = resolveCacheFile();
  if (!fs.existsSync(cacheFile)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (Array.isArray(raw.lines) && raw.lines.length > 0) {
      return raw.lines;
    }
  } catch {
    /* 缓存损坏 */
  }
  return null;
}

module.exports = {
  resolveCacheFile,
  readCachedLines,
};
