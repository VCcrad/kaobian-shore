const axios = require("axios");
const cheerio = require("cheerio");

const listUrl = process.argv[2] || "https://rsc.hnu.edu.cn/zpxx.htm";

axios
  .get(listUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    timeout: 20000,
  })
  .then(async (r) => {
    const $ = cheerio.load(r.data);
    const detailUrls = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href && /\/info\//i.test(href)) {
        try {
          const abs = new URL(href, listUrl).href;
          if (!detailUrls.includes(abs)) detailUrls.push(abs);
        } catch {}
      }
    });
    console.log("details found:", detailUrls.length);
    for (const url of detailUrls.slice(0, 8)) {
      const dr = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 20000,
        validateStatus: () => true,
      });
      if (dr.status !== 200) {
        console.log(url, "status", dr.status);
        continue;
      }
      const d$ = cheerio.load(dr.data);
      const att = [];
      d$("a[href]").each((_, el) => {
        const href = d$(el).attr("href");
        if (/\.(xls|xlsx|pdf|docx)/i.test(href)) {
          att.push(new URL(href, url).href);
        }
      });
      if (att.length) {
        console.log("\nOK", url);
        att.forEach((a) => console.log(" ", a));
      }
    }
  })
  .catch((e) => console.error(e.message));
