// 公告 API 的下載次數（report worker 寫進 Workers Analytics Engine 的 bcs_announce_opens，見 src/index.js 的 countOpen）。
//   npm run worker:opens            最近 14 天：每天各國次數、各國 × 瀏覽器合計
//   npm run worker:opens -- 7       改看最近 7 天
// 每次打開 popup 且擴充的 15 分鐘快取過期才算一次，是「有人真的在用」的次數，不是使用者數；拿各國比例對照商店後台的區域分佈。
// 日期是 UTC。需要 .env.local 的 BCS_CF_ACCOUNT_ID、BCS_CF_ANALYTICS_TOKEN（權限 Account Analytics: Read）。
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // 沒有 .env.local 就看環境變數
}
const ACCOUNT = (process.env.BCS_CF_ACCOUNT_ID || "").trim();
const TOKEN = (process.env.BCS_CF_ANALYTICS_TOKEN || "").trim();
const DATASET = "bcs_announce_opens";
const DAYS = Math.max(1, Math.min(90, Number(process.argv[2]) || 14)); // Analytics Engine 只留 3 個月

async function sql(query) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: query + " FORMAT JSON",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Analytics Engine ${res.status}：${text.slice(0, 300)}`);
  return JSON.parse(text).data || [];
}

const pct = (n, total) => (total ? ((100 * n) / total).toFixed(1) + "%" : "—");

async function main() {
  if (!ACCOUNT || !TOKEN) {
    console.error("找不到 BCS_CF_ACCOUNT_ID／BCS_CF_ANALYTICS_TOKEN（.env.local 或環境變數）");
    process.exit(1);
  }
  const where = `timestamp > NOW() - INTERVAL '${DAYS}' DAY`;
  const byDay = await sql(
    `SELECT intDiv(toUInt32(timestamp), 86400) * 86400 AS d, blob1 AS country, SUM(_sample_interval) AS n
     FROM ${DATASET} WHERE ${where} GROUP BY d, country ORDER BY d, n DESC`
  );
  const byBrowser = await sql(
    `SELECT blob1 AS country, blob2 AS browser, SUM(_sample_interval) AS n
     FROM ${DATASET} WHERE ${where} GROUP BY country, browser ORDER BY n DESC`
  );
  if (!byDay.length) {
    console.log(`最近 ${DAYS} 天沒有資料（worker 部署了嗎？）`);
    return;
  }

  // 每天：總數與前 6 國
  console.log(`最近 ${DAYS} 天每天的公告下載次數（UTC）`);
  const days = new Map();
  for (const r of byDay) {
    const day = new Date(Number(r.d) * 1000).toISOString().slice(0, 10);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push([r.country, Number(r.n)]);
  }
  for (const [day, rows] of days) {
    const total = rows.reduce((s, [, n]) => s + n, 0);
    console.log(`  ${day}  ${String(total).padStart(6)}  ` + rows.slice(0, 6).map(([c, n]) => `${c} ${n}（${pct(n, total)}）`).join("、"));
  }

  // 整段期間：各國合計與瀏覽器拆分
  const countries = new Map();
  for (const r of byBrowser) {
    const c = countries.get(r.country) || { n: 0, browsers: [] };
    c.n += Number(r.n);
    c.browsers.push(`${r.browser} ${Number(r.n)}`);
    countries.set(r.country, c);
  }
  const total = [...countries.values()].reduce((s, c) => s + c.n, 0);
  console.log(`\n各國合計（共 ${total}）`);
  for (const [country, c] of [...countries].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) {
    console.log(`  ${country.padEnd(3)} ${String(c.n).padStart(6)}（${pct(c.n, total)}）  ${c.browsers.join("、")}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
