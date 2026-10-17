// 測速報告的資料來源與寄信，抽獎 v2（lotteries-v2.mjs）與必中獎參加人（invites.mjs）共用：
//   · 試算表「CDN SpeedTest Log」（Apps Script 的 handleReport 每份報告寫一列：收到時間、報告編號、email、國家、ISP、參加方式、邀請碼…）
//   · 本機歸檔 cdn-speedtest-results/<國家>/（/collect-speedtest-mail 排除了 VPN、無效、重複送出）
//   · 業者名稱對照（.claude/skills/analyze-cdn/isp-share.json，加上這裡的 ISP_ALIASES）
//   · 用使用者自己的 Gmail 寄純文字信
// Google 用 google-workspace MCP 登入時存的 OAuth 憑證（~/.google_workspace_mcp/credentials/<email>.json，
// 含 spreadsheets、drive、gmail.send 權限）換 access token，不另外設定。錯誤一律丟 LotteryError（訊息給人看的中文）。
// 注意：本機後台用相對路徑 import 這支，改了這支要重開 admin 的 dev server（見 admin/lib/repo.js）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LotteryError, ROOT, textTables } from "./lotteries.mjs";

const SHEET_NAME = "CDN SpeedTest Log";
const CRED_DIR = path.join(os.homedir(), ".google_workspace_mcp", "credentials");
const ISP_SHARE = path.join(ROOT, ".claude", "skills", "analyze-cdn", "isp-share.json");
const RESULTS = path.join(ROOT, "cdn-speedtest-results");
const COL = { time: "收到時間", rid: "報告編號", test: "測試模式", email: "Email", country: "國家", isp: "ISP", join: "參加方式", invite: "邀請碼" };

export async function googleToken() {
  let files = [];
  try { files = fs.readdirSync(CRED_DIR).filter((f) => f.includes("@") && f.endsWith(".json")); } catch { /* 沒有資料夾 */ }
  if (!files.length) throw new LotteryError(`找不到 Google 憑證（${CRED_DIR}）：先用 google-workspace MCP 登入一次`);
  const c = JSON.parse(fs.readFileSync(path.join(CRED_DIR, files[0]), "utf8"));
  const res = await fetch(c.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new LotteryError(`Google 憑證換不到 token（${j.error || res.status}）：用 google-workspace MCP 重新登入`);
  return j.access_token;
}

async function gget(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new LotteryError(`讀取 Google 資料失敗（${res.status}）：${j.error?.message || ""}`);
  return j;
}

// 某時區的「牆上時間」（當成 UTC 的毫秒）→ 真正的 UTC 毫秒
function zonedToUtc(wallMs, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(wallMs)).map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallMs - (asIfUtc - wallMs);
}

// 邀請碼欄是「碼」或「碼（驗證失敗）」之類：取出碼（同 Apps Script 的 normCode）
const normCode = (c) => String(c || "").replace(/[\s-]/g, "").toUpperCase();

// 試算表的每一列 → { receivedAt（UTC 毫秒）, rid, test, email, country, isp, join（純測速／抽獎／必中獎）, invite（邀請碼，沒有是空字串） }
export async function sheetEntries() {
  const token = await googleToken();
  const q = encodeURIComponent(`name = '${SHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`);
  const files = (await gget(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`)).files || [];
  if (!files.length) throw new LotteryError(`雲端硬碟裡找不到試算表「${SHEET_NAME}」`);
  const id = files[0].id;
  const meta = await gget(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.timeZone,sheets.properties.title`);
  const tz = meta.properties.timeZone || "Asia/Taipei";
  const tab = encodeURIComponent(meta.sheets[0].properties.title);
  const rows = (await gget(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${tab}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`)).values || [];
  const head = rows[0] || [];
  const idx = Object.fromEntries(Object.entries(COL).map(([k, name]) => [k, head.indexOf(name)]));
  const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => COL[k]);
  if (missing.length) throw new LotteryError(`試算表少了欄位：${missing.join("、")}`);
  return rows.slice(1).filter((r) => r[idx.rid]).map((r) => {
    const serial = Number(r[idx.time]);   // 試算表的日期序號（1899-12-30 起的天數，試算表時區的牆上時間）
    return {
      receivedAt: Number.isFinite(serial) ? zonedToUtc(Math.round((serial - 25569) * 864e5), tz) : NaN,
      rid: String(r[idx.rid]).trim(), test: !!String(r[idx.test] ?? "").trim(), email: String(r[idx.email] ?? "").trim(),
      country: String(r[idx.country] ?? "").trim().toUpperCase(), isp: String(r[idx.isp] ?? "").trim(), join: String(r[idx.join] ?? "").trim(),
      invite: normCode(String(r[idx.invite] ?? "").split(/[（(]/)[0]),
    };
  });
}

// 本機有歸檔的報告編號（資料夾名稱 <國家>-<yyyyMMdd-HHmm>-<rid>）
export function archivedRids(country) {
  try {
    return new Set(fs.readdirSync(path.join(RESULTS, country), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name.split("-").pop()));
  } catch {
    return new Set();
  }
}

// isp-share.json 沒有的業者（市占小、不在分析裡）：抽獎設定的名稱 → 比對字串
const ISP_ALIASES = {
  TW: [{ name: "亞太寬頻", match: ["AS7482", "Asia Pacific On-line", "AS17709", "Asia Pacific Telecom"] }],   // 亞太線上 APOL／亞太電信
};

// 抽獎設定的業者名稱 → isp-share.json（或 ISP_ALIASES）的比對字串（AS 編號、英文公司名）。對不到的就拿名稱本身比對，並列在 ispMap 給人看
const norm = (s) => String(s).toLowerCase().replace(/[\s()（）]/g, "");
function knownIsps(country) {
  let isps = [];
  try { isps = JSON.parse(fs.readFileSync(ISP_SHARE, "utf8"))[country]?.isps || []; } catch { /* 沒有對照表 */ }
  return [...isps, ...(ISP_ALIASES[country] || [])];
}

// 報告裡的 ISP（「AS38841 kbro CO. Ltd.」）→ 給人看的名稱：有給業者名單（抽獎限定的業者）時用名單裡的名稱（「凱擘」），
// 否則用 isp-share.json 的名稱，都對不到就拿原字串去掉 AS 編號
export function ispLabel(country, raw, names = []) {
  const s = norm(raw);
  const hitIn = (patterns) => patterns.some((p) => p && s.includes(norm(p)));
  const set = names.length ? ispMatcher(country, names).map.find((m) => hitIn(m.patterns)) : null;
  if (set) return set.name;
  const known = knownIsps(country).find((i) => hitIn(i.match));
  return known ? known.name : String(raw).replace(/^AS\d+\s+/i, "").trim();
}

export function ispMatcher(country, names) {
  const isps = knownIsps(country);
  const map = names.map((name) => {
    const n = norm(name);
    const hit = isps.find((i) => norm(i.name).includes(n) || n.includes(norm(i.name).split(/[a-z]/)[0] || "\u0000"));
    return { name, via: hit ? hit.name : null, patterns: [...(hit ? hit.match : []), name] };
  });
  const test = (isp) => {
    const s = norm(isp);
    return map.some((m) => m.patterns.some((p) => p && s.includes(norm(p))));
  };
  return { map, test };
}

// ── 寫信 ─────────────────────────────────────────────────────────────────────────────────────
// 信的語言依國家（台港澳繁中、中新馬簡中、日、韓，其他英文）
const COUNTRY_LANG = { TW: "zh-TW", HK: "zh-TW", MO: "zh-TW", CN: "zh-CN", SG: "zh-CN", MY: "zh-CN", JP: "ja", KR: "ko" };
export const mailLang = (country) => COUNTRY_LANG[country] || "en";
export const MAIL_LANGS = ["zh-TW", "zh-CN", "en", "ja", "ko"];
const LOCALE_DIR = { "zh-TW": "zh_TW", "zh-CN": "zh_CN", en: "en", ja: "ja", ko: "ko" };
export const fillText = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));

// 擴充在這個語言的名稱（_locales 的 extName）
export function extName(lang) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "src", "_locales", LOCALE_DIR[lang], "messages.json"), "utf8")).extName.message;
  } catch {
    return "Overseas Video Speedup for bilibili";
  }
}

// { 語言: 文字 } 依 語言 → en → zh-TW → 任一種 取一種
export function pickText(map, lang) {
  for (const k of [lang, "en", "zh-TW", ...Object.keys(map || {})]) if (map?.[k]) return map[k];
  return "";
}

// 金額：NT$200、HK$100；沒有金額符號的幣別寫成「200 XXX」
export function money(amount, currency) {
  const sym = textTables().currencies[currency];
  const num = Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return sym ? sym + num : `${num} ${currency}`;
}

// 中日文句子裡的名稱不加空格，開頭／結尾是英數字時才補（「你對 kbro 的」「你對台灣大寬頻的」）
export const cjkPad = (s) => (/^[\x21-\x7e]/.test(s) ? " " : "") + s + (/[\x21-\x7e]$/.test(s) ? " " : "");

// RFC 2047：非 ASCII 的標頭（主旨）
const mimeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

// 用使用者自己的 Gmail 寄純文字信；toSelf：測試用，改寄給使用者自己、主旨加「[測試]」。回傳 { to, threadId }
export async function sendGmail({ to, subject, body, toSelf = false }) {
  if (!String(subject || "").trim() || !String(body || "").trim()) throw new LotteryError("主旨和內文都要填");
  const token = await googleToken();
  subject = subject.trim();
  if (toSelf) {
    to = (await gget(token, "https://gmail.googleapis.com/gmail/v1/users/me/profile")).emailAddress;
    subject = `[測試] ${subject}`;
  }
  const raw = [
    `To: ${to}`, `Subject: ${mimeWord(subject)}`, "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new LotteryError(`Gmail 寄信失敗（${res.status}）：${j.error?.message || ""}`);
  return { to, threadId: j.threadId };
}
