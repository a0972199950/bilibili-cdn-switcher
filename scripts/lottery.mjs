// CDN 測速 GUI（CDNSpeedTest.exe）「測速目的」頁顯示的進行中抽獎（Neon Postgres 的 lotteries）。
//   npm run lottery:add -- <資料夾> --start 2026-10-01 --end 2026-10-31 [--title 十月抽獎]
//        資料夾裡放各語言的 HTML：zh-TW.html、zh-CN.html、en.html、ja.html、ko.html（至少一個；缺的語言依序退回 en、zh-TW）
//   npm run lottery:show              列出全部抽獎與狀態（進行中／未開始／已結束）
//   npm run lottery:end -- 3          提前結束第 3 個抽獎（資料保留）
//
// exe 透過 Apps Script（action=lotteries）讀取「現在介於 start 與 end、且沒有提前結束」的抽獎；
// 期間重疊時只顯示最新開始的那一個（開始時間相同取後新增的），show 會標出目前顯示的是哪個。
// exe 用內嵌的 HTML 元件顯示（tkinterweb：支援常見的 HTML／CSS，不跑 JavaScript；連結會用瀏覽器開）。
// --start／--end 是台灣時間的日期，end 當天整天都算。範例：scripts/lottery-example/。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // 沒有 .env.local 就看環境變數
}
const DB_URL = (process.env.DATABASE_URL || "").trim();
const LANGS = ["zh-TW", "zh-CN", "en", "ja", "ko"];

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

async function ensureTable() {
  await sql(`create table if not exists lotteries (
    id serial primary key,
    title text not null,
    html jsonb not null,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    ended_at timestamptz,
    created_at timestamptz not null default now())`);
}

const width = (s) => [...s].reduce((n, ch) => n + (/[⺀-￯]/.test(ch) ? 2 : 1), 0);
const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));
const day = (t) => new Date(t).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 10);

function opt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function add(args) {
  const dir = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  const start = opt(args, "--start"), end = opt(args, "--end");
  if (!dir || !start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    console.error("用法：npm run lottery:add -- <資料夾> --start 2026-10-01 --end 2026-10-31 [--title 標題]");
    process.exit(1);
  }
  const html = {};
  for (const l of LANGS) {
    const f = path.resolve(dir, `${l}.html`);
    if (fs.existsSync(f)) html[l] = fs.readFileSync(f, "utf8");
  }
  if (!Object.keys(html).length) {
    console.error(`${dir} 裡找不到 ${LANGS.map((l) => l + ".html").join("、")}`);
    process.exit(1);
  }
  const title = opt(args, "--title") || path.basename(path.resolve(dir));
  const rows = await sql(
    `insert into lotteries (title, html, starts_at, ends_at)
     values ($1, $2::jsonb, ($3::date)::timestamp at time zone 'Asia/Taipei',
             ($4::date + 1)::timestamp at time zone 'Asia/Taipei') returning id`,
    [title, JSON.stringify(html), start, end],
  );
  console.log(`已新增第 ${rows[0].id} 個抽獎「${title}」（${start} ～ ${end}，語言：${Object.keys(html).join("、")}）`);
}

async function end(args) {
  const id = Number(args[0]);
  if (!id) {
    console.error("用法：npm run lottery:end -- <id>");
    process.exit(1);
  }
  const rows = await sql("update lotteries set ended_at = coalesce(ended_at, now()) where id = $1 returning title", [id]);
  console.log(rows.length ? `第 ${id} 個抽獎「${rows[0].title}」已結束` : `找不到第 ${id} 個抽獎`);
}

async function show() {
  const rows = await sql("select *, now() as now from lotteries order by starts_at desc, id desc");
  console.log(`${pad("id", 4)}${pad("狀態", 24)}${pad("期間", 25)}${pad("語言", 26)}標題`);
  let shown = false;   // 已照「最新開始」排序：第一個進行中的就是 exe 顯示的那個
  for (const r of rows) {
    const now = new Date(r.now);
    let st = r.ended_at ? "提前結束" : now < new Date(r.starts_at) ? "未開始" : now >= new Date(r.ends_at) ? "已結束" : "進行中";
    if (st === "進行中") {
      st = shown ? "進行中（被較新的蓋過）" : "進行中（顯示中）";
      shown = true;
    }
    const period = `${day(r.starts_at)} ～ ${day(new Date(new Date(r.ends_at) - 1))}`;
    console.log(`${pad(String(r.id), 4)}${pad(st, 24)}${pad(period, 25)}${pad(Object.keys(r.html).join(","), 26)}${r.title}`);
  }
  console.log(`共 ${rows.length} 個`);
}

const [cmd, ...args] = process.argv.slice(2);
if (!DB_URL) {
  console.error("找不到 DATABASE_URL（.env.local 或環境變數）");
  process.exit(1);
}
await ensureTable();
if (cmd === "add") await add(args);
else if (cmd === "end") await end(args);
else if (cmd === "show") await show();
else {
  console.error("用法：lottery.mjs add|end|show");
  process.exit(1);
}
