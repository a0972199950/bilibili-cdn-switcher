// 進行中的抽獎（Neon Postgres 的 lotteries）。每個抽獎存一份 metadata（國家、獎品、名額、可參加的寬頻業者…），
// 顯示的文字由各端自己組：
//   · CDN 測速 GUI（CDNSpeedTest.exe）「測速目的」頁：tools/cdn-speedtest-app/lottery_text.py，只顯示使用者所在國家的抽獎
//   · 擴充 popup 主頁的公告欄與點開的公告視窗：src/lottery-text.js，同樣只顯示使用者所在國家的抽獎
// exe 透過 report worker 的 GET /v1/lotteries 讀取 metadata；擴充透過 GET /v1/announcements（新增抽獎時會自動建立對應的抽獎公告，
// 見 scripts/lib/announcements.mjs）。
// 邏輯在 scripts/lib/lotteries.mjs（本機後台 admin/ 也用它）；這支是命令列版本。
//
//   npm run lottery:add -- <lottery.json>          新增一個抽獎
//   npm run lottery:update -- 3 <lottery.json>     用 lottery.json 覆寫第 3 個抽獎（期間、metadata、舊版 exe 的 html 全部更新）
//   npm run lottery:preview -- <lottery.json>      只印出各語言會顯示的文字，不寫資料庫
//   npm run lottery:show                           列出全部抽獎與狀態（進行中／未開始／已結束）
//   npm run lottery:end -- 3                       提前結束第 3 個抽獎（資料保留）
//
// lottery.json（範例：scripts/lottery-example.json）：
//   { "title": "2026-10 台灣有線寬頻抽獎",        // 必填。擴充跑馬燈「NT$200 抽獎:」後面捲動的那段（使用者看得到，各語言都顯示這一份）
//     "country": "TW",                            // 舉辦國家（單一，兩碼代碼）
//     "start": "2026-10-01", "end": "2026-10-30", // 台灣時間的日期，end 當天整天都算
//     "prize": { "amount": 200, "currency": "TWD", "giftCards": ["7-11 禮物卡", "Apple 禮物卡"] },  // 每名的面額；禮物卡寫該國語言，多種＝擇一
//     "winners": 3,                               // 抽幾名
//     "isps": ["台灣大寬頻", "大大寬頻"],          // 可參加的寬頻業者（該國語言）；省略或空的＝該國所有使用者
//     "drawDays": 7 }                             // 結束後幾天內抽出（預設 7）
//
// 相容舊版 exe（1.7.0（含）以前透過 Apps Script action=lotteries 只讀 title／html／starts_at／ends_at／ended_at，
// 而且不分國家、只顯示最新開始的一個）：這幾個欄位照舊寫，html 由 lottery_text.py 依 metadata 產生（跟新版 exe 顯示的一樣）。
import fs from "node:fs";
import {
  LotteryError, validateMeta, legacyHtml, addLottery, updateLottery, endLottery, listLotteries,
} from "./lib/lotteries.mjs";

const width = (s) => [...s].reduce((n, ch) => n + (/[⺀-￯]/.test(ch) ? 2 : 1), 0);
const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// 讀 lottery.json 並檢查欄位
function readMeta(file) {
  if (!file || !fs.existsSync(file)) fail(`找不到 ${file || "lottery.json"}`);
  return validateMeta(JSON.parse(fs.readFileSync(file, "utf8")));
}

async function add(args) {
  const m = readMeta(args[0]);
  const id = await addLottery(m);
  console.log(`已新增第 ${id} 個抽獎「${m.title}」（${m.country}，${m.start} ～ ${m.end}）`);
}

async function update(args) {
  const id = Number(args[0]);
  if (!id) fail("用法：npm run lottery:update -- <id> <lottery.json>");
  const m = readMeta(args[1]);
  const ok = await updateLottery(id, m);
  console.log(ok ? `已更新第 ${id} 個抽獎「${m.title}」（${m.country}，${m.start} ～ ${m.end}）` : `找不到第 ${id} 個抽獎`);
}

// 印出新版 exe 會顯示的文字（擴充的文字範本相同）
function preview(args) {
  const m = readMeta(args[0]);
  const html = legacyHtml(m);
  for (const [lang, h] of Object.entries(html)) {
    const text = h.replace(/<\/(h3|p)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
    console.log(`── ${lang} ──\n${text}`);
  }
}

async function end(args) {
  const id = Number(args[0]);
  if (!id) fail("用法：npm run lottery:end -- <id>");
  const title = await endLottery(id);
  console.log(title ? `第 ${id} 個抽獎「${title}」已結束` : `找不到第 ${id} 個抽獎`);
}

const STATUS = { active: "進行中", upcoming: "未開始", ended: "已結束", ended_early: "提前結束" };

async function show() {
  const rows = await listLotteries();
  console.log(`${pad("id", 4)}${pad("狀態", 24)}${pad("期間", 25)}${pad("國家", 6)}${pad("獎品", 18)}${pad("業者", 8)}標題`);
  for (const l of rows) {
    const st = STATUS[l.status] + (l.legacyShown ? "（舊版 exe 顯示）" : "");
    const period = `${l.start} ～ ${l.end}`;
    const prize = l.hasMeta ? `${l.prize.amount} ${l.prize.currency} × ${l.winners}` : "（無 metadata）";
    const isps = l.hasMeta ? (l.isps.length ? `${l.isps.length} 家` : "不限") : "-";
    console.log(`${pad(String(l.id), 4)}${pad(st, 24)}${pad(period, 25)}${pad(l.country || "-", 6)}${pad(prize, 18)}${pad(isps, 8)}${l.title}`);
  }
  console.log(`共 ${rows.length} 個（沒有 metadata 的抽獎只有舊版 exe 看得到）`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "preview") preview(args);
  else if (cmd === "add") await add(args);
  else if (cmd === "update") await update(args);
  else if (cmd === "end") await end(args);
  else if (cmd === "show") await show();
  else fail("用法：lottery.mjs add|update|preview|end|show");
} catch (e) {
  if (e instanceof LotteryError) fail(e.message);
  throw e;
}
