/**
 * 预热湖南人社厅穿透行缓存（在纯 Node 环境运行，避开 Next 服务端 DOMMatrix 问题）
 * 运行：node scripts/warm-hunan-cache.js
 */

const { getHunanDemoLines } = require("../lib/fetch-demo-job-lines.cjs");

getHunanDemoLines({ useCache: false })
  .then((lines) => {
    console.log("[warm-hunan-cache] 完成，行数:", lines.length);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[warm-hunan-cache] 失败:", err.message);
    process.exit(1);
  });
