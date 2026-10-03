// CDN 測速 GUI（CDNSpeedTest.exe）的使用紀錄（Neon Postgres 的 app_events，由 Apps Script 的 action=log 寫入）。
//   npm run events:show            最近 30 天各類事件的次數（依國家）＋最近 30 筆
//   npm run events:show -- 7       改看最近 7 天
//
// 事件類型：install 安裝（這台電腦第一次執行）、run 執行、free 純測速、lottery 抽獎、guaranteed 必中抽獎
// （三者在開始測速時記一次）、test_done 測速完成、send 發送、custom_list 更新自訂節點列表。
// 開發者測試模式送出的事件 test = true，統計時排除。連線字串同 invite.mjs（.env.local 的 DATABASE_URL）。
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // 沒有 .env.local 就看環境變數
}
const DB_URL = (process.env.DATABASE_URL || "").trim();

async function sql(query, params = []) {
  const host = new URL(DB_URL).hostname;
  const res = await fetch(`https://${host.replace(/^[^.]+\./, "api.")}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Neon-Connection-String": DB_URL },
    body: JSON.stringify({ query, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neon ${res.status}：${text.slice(0, 300)}`);
  return JSON.parse(text).rows || [];
}

export async function ensureTable() {
  await sql(`create table if not exists app_events (
    id bigserial primary key,
    at timestamptz not null default now(),
    type text not null,
    country text,
    email text,
    install_id text,
    app_version text,
    lang text,
    test boolean not null default false)`);
  await sql("create index if not exists app_events_at_idx on app_events (at)");
}

const TYPES = ["install", "run", "free", "lottery", "guaranteed", "test_done", "send", "custom_list"];
const LABEL = { install: "安裝", run: "執行", free: "純測速", lottery: "抽獎", guaranteed: "必中抽獎",
                test_done: "測速完成", send: "發送", custom_list: "自訂節點" };
const width = (s) => [...s].reduce((n, ch) => n + (/[⺀-￯]/.test(ch) ? 2 : 1), 0);
const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));
const time = (t) => new Date(t).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 16);

async function show(days) {
  const counts = await sql(
    `select coalesce(country, '??') as country, type, count(*)::int as n from app_events
     where not test and at > now() - make_interval(days => $1) group by 1, 2`, [days]);
  const byCountry = {};
  for (const r of counts) (byCountry[r.country] ||= {})[r.type] = r.n;
  const total = (c) => TYPES.reduce((n, t) => n + (byCountry[c][t] || 0), 0);
  console.log(`最近 ${days} 天（不含測試模式）`);
  console.log(pad("國家", 6) + TYPES.map((t) => pad(LABEL[t], 10)).join(""));
  const countries = Object.keys(byCountry).sort((a, b) => total(b) - total(a));
  for (const c of countries) console.log(pad(c, 6) + TYPES.map((t) => pad(String(byCountry[c][t] || 0), 10)).join(""));
  console.log(pad("合計", 6) + TYPES.map((t) => pad(String(countries.reduce((n, c) => n + (byCountry[c][t] || 0), 0)), 10)).join(""));

  const recent = await sql("select * from app_events order by at desc limit 30");
  console.log("\n最近 30 筆");
  for (const r of recent) {
    console.log(`${time(r.at)}  ${pad(LABEL[r.type] || r.type, 10)}${pad(r.country || "??", 4)}` +
      `${pad(r.app_version || "-", 8)}${pad((r.install_id || "-").slice(0, 8), 10)}${r.email || ""}${r.test ? "  [TEST]" : ""}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!DB_URL) {
    console.error("找不到 DATABASE_URL（.env.local 或環境變數）");
    process.exit(1);
  }
  await ensureTable();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "show") await show(Math.max(1, Number(arg) || 30));
  else {
    console.error("用法：events.mjs show [天數]");
    process.exit(1);
  }
}
