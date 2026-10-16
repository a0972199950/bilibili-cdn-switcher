// 抽獎（Neon Postgres 的 lotteries）的共用邏輯：欄位檢查、寫入、列出、產生舊版 exe 用的 html、各端文字預覽。
// scripts/lottery.mjs（CLI）與 admin/（本機後台，gitignored）都用這一份，規則只有一個地方。
//
// metadata（lottery.json／後台表單）：
//   { title, country: "TW", start: "2026-10-01", end: "2026-10-30",
//     prize: { amount: 200, currency: "TWD", giftCards: ["7-11 禮物卡", ...] }, winners: 3, isps: [...], drawDays: 7 }
// 欄位說明見 scripts/lottery.mjs 開頭。錯誤一律丟 LotteryError（訊息給人看的中文）。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOTTERY_TEXT_PY = path.join(ROOT, "tools", "cdn-speedtest-app", "lottery_text.py");
const LOTTERY_TEXT_JS = path.join(ROOT, "src", "lottery-text.js");
export const LANGS = ["zh-TW", "zh-CN", "en", "ja", "ko"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class LotteryError extends Error {}

let dbUrl = null;
function getDbUrl() {
  if (dbUrl == null) {
    try {
      process.loadEnvFile(path.join(ROOT, ".env.local"));
    } catch {
      // 沒有 .env.local 就看環境變數
    }
    dbUrl = (process.env.DATABASE_URL || "").trim();
  }
  if (!dbUrl) throw new LotteryError("找不到 DATABASE_URL（.env.local 或環境變數）");
  return dbUrl;
}

export async function sql(query, params = []) {
  const url = getDbUrl();
  const host = new URL(url).hostname;
  const res = await fetch(`https://${host.replace(/^[^.]+\./, "api.")}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Neon-Connection-String": url },
    body: JSON.stringify({ query, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neon ${res.status}：${text.slice(0, 300)}`);
  return JSON.parse(text).rows || [];
}

let tableReady = null;
export function ensureTable() {
  tableReady ||= (async () => {
    await sql(`create table if not exists lotteries (
      id serial primary key,
      title text not null,
      html jsonb not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      ended_at timestamptz,
      created_at timestamptz not null default now())`);
    // metadata（2026-10 起）；之前的抽獎這些是 null，新版 exe 與擴充不會顯示
    await sql(`alter table lotteries
      add column if not exists country text,
      add column if not exists prize_amount numeric,
      add column if not exists currency text,
      add column if not exists gift_cards text[],
      add column if not exists isps text[],
      add column if not exists winners int,
      add column if not exists draw_days int`);
    // 擴充的公告（跑馬燈）：type = 'lottery'（由抽獎自動建立，內容由擴充依抽獎資料自己組）或 'html'（後台寫的一般公告）。
    // 一般公告的 prefix／title／html 是 { 語言: 文字 }，countries 空＝所有國家；沒有期間，刪掉才消失（見 scripts/lib/announcements.mjs）
    await sql(`create table if not exists announcements (
      id serial primary key,
      type text not null check (type in ('lottery', 'html')),
      lottery_id int unique references lotteries(id) on delete cascade,
      prefix jsonb,
      title jsonb,
      html jsonb,
      countries text[],
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now())`);
    // 有 metadata 但還沒有公告的抽獎（建公告表之前就有的）補建
    await sql(`insert into announcements (type, lottery_id, created_at)
      select 'lottery', l.id, l.created_at from lotteries l
      where l.country is not null and not exists (select 1 from announcements a where a.lottery_id = l.id)`);
  })().catch((e) => { tableReady = null; throw e; });
  return tableReady;
}

// 檢查並整理 metadata；不合格丟 LotteryError
export function validateMeta(m) {
  const fail = (msg) => { throw new LotteryError(msg); };
  if (!m || typeof m !== "object") fail("格式錯誤");
  const strList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim());
  if (typeof m.title !== "string" || !m.title.trim()) fail("標題（title）必填：會顯示在擴充的跑馬燈");
  if (!/^[A-Z]{2}$/.test(m.country || "")) fail("國家（country）要是兩碼大寫國家代碼，例如 TW");
  if (!DATE_RE.test(m.start || "") || !DATE_RE.test(m.end || "") || m.end < m.start) fail("活動期間（start／end）要是 YYYY-MM-DD，且結束日不早於開始日");
  const p = m.prize || {};
  if (!(Number(p.amount) > 0)) fail("每名獎品面額（prize.amount）要是正數");
  if (!/^[A-Z]{3}$/.test(p.currency || "")) fail("幣別（prize.currency）要是三碼幣別，例如 TWD、USD");
  if (!strList(p.giftCards) || !p.giftCards.length) fail("禮物卡（prize.giftCards）至少要有一種");
  if (!(Number.isInteger(m.winners) && m.winners > 0)) fail("名額（winners）要是正整數");
  if (m.isps != null && !strList(m.isps)) fail("寬頻業者（isps）要是字串陣列（省略＝該國所有使用者）");
  const drawDays = m.drawDays == null ? 7 : m.drawDays;
  if (!(Number.isInteger(drawDays) && drawDays >= 0)) fail("結束後幾天內抽出（drawDays）要是 0 以上的整數");
  return {
    title: m.title.trim(),
    country: m.country, start: m.start, end: m.end,
    prize: { amount: Number(p.amount), currency: p.currency, giftCards: p.giftCards.map((x) => x.trim()) },
    winners: m.winners, isps: (m.isps || []).map((x) => x.trim()), drawDays,
  };
}

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// 跟 worker 回傳的格式一樣（lottery_text.py / src/lottery-text.js 吃這個）
export function apiMeta(m) {
  return { title: m.title, country: m.country, prize: m.prize, winners: m.winners, isps: m.isps, drawDays: m.drawDays,
           startDate: m.start, endDate: m.end, drawBy: addDays(m.end, m.drawDays) };
}

// 舊版 exe 用的 html（也是新版 exe 顯示的樣子）：交給 exe 自己的 lottery_text.py 產生
export function legacyHtml(m) {
  const r = spawnSync(process.platform === "win32" ? "python" : "python3", [LOTTERY_TEXT_PY], {
    input: JSON.stringify(apiMeta(m)), encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.status !== 0) throw new LotteryError(`lottery_text.py 失敗：${r.stderr || r.error}`);
  return JSON.parse(r.stdout);
}

// exe 的 lottery_text.py 認得哪些國家（有中文名稱，沒有的顯示代碼）與幣別（有金額符號，沒有的寫「200 XXX」）：
// { countries: ["TW", ...], currencies: { TWD: "NT$", ... } }；後台下拉選單用來分組
let tables = null;
export function textTables() {
  if (!tables) {
    const r = spawnSync(process.platform === "win32" ? "python" : "python3",
      ["-c", "import json, lottery_text as L; print(json.dumps({'countries': list(L.COUNTRY), 'currencies': L.CURRENCY}))"],
      { cwd: path.dirname(LOTTERY_TEXT_PY), encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    if (r.status !== 0) throw new LotteryError(`讀取 lottery_text.py 失敗：${r.stderr || r.error}`);
    tables = JSON.parse(r.stdout);
  }
  return tables;
}

// 擴充的文字（跑馬燈 label＋line、說明視窗）：直接跑 src/lottery-text.js，跟擴充一模一樣
// （檔案改了就重新載入：後台 dev server 開著時改 lottery-text.js 也會反映到預覽）
let extComposer = null, extMtime = 0;
function extCompose(meta, lang) {
  const mtime = fs.statSync(LOTTERY_TEXT_JS).mtimeMs;
  if (!extComposer || mtime !== extMtime) {
    const ctx = { window: {}, Intl };
    vm.runInNewContext(fs.readFileSync(LOTTERY_TEXT_JS, "utf8"), ctx);
    extComposer = ctx.window.LotteryText.compose;
    extMtime = mtime;
  }
  return extComposer(meta, lang);
}

// 各端會顯示什麼：{ exe: { 語言: html }, ext: { 語言: { label, line, title, eligible, ispList, period, prize, draw } } }
export function previewTexts(m) {
  const api = apiMeta(m);
  const ext = {};
  for (const lang of LANGS) ext[lang] = extCompose(api, lang);
  return { exe: legacyHtml(m), ext };
}

function metaParams(m) {
  return [m.title, JSON.stringify(legacyHtml(m)), m.start, m.end, m.country, m.prize.amount, m.prize.currency,
          m.prize.giftCards, m.isps.length ? m.isps : null, m.winners, m.drawDays];
}
const START_SQL = "($3::date)::timestamp at time zone 'Asia/Taipei'";
const END_SQL = "($4::date + 1)::timestamp at time zone 'Asia/Taipei'";

// 新增，回傳 id；同時建立對應的公告（type = 'lottery'，跟抽獎同一句 SQL，不會只建一半）
export async function addLottery(meta) {
  const m = validateMeta(meta);
  await ensureTable();
  const rows = await sql(
    `with l as (
       insert into lotteries (title, html, starts_at, ends_at, country, prize_amount, currency, gift_cards, isps, winners, draw_days)
       values ($1, $2::jsonb, ${START_SQL}, ${END_SQL}, $5, $6, $7, $8::text[], $9::text[], $10, $11) returning id),
     a as (insert into announcements (type, lottery_id) select 'lottery', id from l)
     select id from l`,
    metaParams(m),
  );
  return rows[0].id;
}

// 覆寫（期間、metadata、舊版 html 全部更新）；找不到回 false
export async function updateLottery(id, meta) {
  const m = validateMeta(meta);
  await ensureTable();
  const rows = await sql(
    `update lotteries set title = $1, html = $2::jsonb, starts_at = ${START_SQL}, ends_at = ${END_SQL}, country = $5,
       prize_amount = $6, currency = $7, gift_cards = $8::text[], isps = $9::text[], winners = $10, draw_days = $11
     where id = $12 returning id`,
    [...metaParams(m), id],
  );
  return rows.length > 0;
}

// 提前結束（資料保留）；回傳標題，找不到回 null
export async function endLottery(id) {
  await ensureTable();
  const rows = await sql("update lotteries set ended_at = coalesce(ended_at, now()) where id = $1 returning title", [id]);
  return rows.length ? rows[0].title : null;
}

const ROW_SQL = `select id, title, country, prize_amount::float8 as amount, currency, gift_cards, isps, winners, draw_days, ended_at,
    to_char(starts_at at time zone 'Asia/Taipei', 'YYYY-MM-DD') as start_date,
    to_char(ends_at at time zone 'Asia/Taipei' - interval '1 day', 'YYYY-MM-DD') as end_date,
    case when ended_at is not null then 'ended_early' when now() < starts_at then 'upcoming'
         when now() >= ends_at then 'ended' else 'active' end as status
  from lotteries`;

function rowToLottery(r) {
  return {
    id: r.id, title: r.title, status: r.status, hasMeta: !!r.country,
    country: r.country, start: r.start_date, end: r.end_date,
    prize: { amount: r.amount, currency: r.currency, giftCards: r.gift_cards || [] },
    winners: r.winners, isps: r.isps || [], drawDays: r.draw_days == null ? 7 : r.draw_days,
  };
}

// 全部抽獎，新的在前；legacyShown＝舊版 exe 目前顯示的那一個（進行中裡最新開始的）
export async function listLotteries() {
  await ensureTable();
  const rows = await sql(`${ROW_SQL} order by starts_at desc, id desc`);
  let legacy = false;
  return rows.map((r) => {
    const l = rowToLottery(r);
    l.legacyShown = !legacy && l.status === "active";
    if (l.legacyShown) legacy = true;
    return l;
  });
}

export async function getLottery(id) {
  await ensureTable();
  const rows = await sql(`${ROW_SQL} where id = $1`, [id]);
  return rows.length ? rowToLottery(rows[0]) : null;
}
