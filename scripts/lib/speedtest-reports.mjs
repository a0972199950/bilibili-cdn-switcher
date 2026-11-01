// 測速報告的資料來源與寄信，抽獎 v2（lotteries-v2.mjs）與必中獎參加人（invites.mjs）共用：
//   · 試算表「CDN SpeedTest Log」（Apps Script 的 handleReport 每份報告寫一列：收到時間、報告編號、email、國家、ISP、參加方式、邀請碼…）
//   · 本機歸檔 cdn-speedtest-results/<國家>/（/collect-speedtest-mail 排除了 VPN、無效、重複送出）
//   · 業者名稱對照（.claude/skills/analyze-cdn/isp-share.json，加上這裡的 ISP_ALIASES）
//   · 用使用者自己的 Gmail 寄純文字信
// Google 的 OAuth 憑證換 access token：
//   · 本機：google-workspace MCP 登入時存的（~/.google_workspace_mcp/credentials/<email>.json，含 spreadsheets、drive、gmail.send 權限），不另外設定
//   · 雲端（biboost-site）：secret GOOGLE_OAUTH（npm run admin:google 產生：只有 gmail.send、試算表唯讀、雲端硬碟中繼資料唯讀）
// 雲端讀不到本機檔案：業者對照表、歸檔的報告編號、排除紀錄另外存一份在 Neon（settings 的 speedtest_snapshot），
// 本機後台啟動時與 npm run invite:review 後更新（syncSnapshot），雲端用 loadSnapshot 讀。
// 錯誤一律丟 LotteryError（訊息給人看的中文）。
// 注意：本機後台（admin/server.mjs）載入後不會重新讀這支，改了要重開 npm run admin
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LotteryError, ROOT, textTables } from "./lotteries.mjs";
import { getSetting, setSetting } from "./settings.mjs";
// 擴充名稱（寫信用）：打包進來，雲端也讀得到
import enMsg from "../../src/_locales/en/messages.json" with { type: "json" };
import jaMsg from "../../src/_locales/ja/messages.json" with { type: "json" };
import koMsg from "../../src/_locales/ko/messages.json" with { type: "json" };
import zhCNMsg from "../../src/_locales/zh_CN/messages.json" with { type: "json" };
import zhTWMsg from "../../src/_locales/zh_TW/messages.json" with { type: "json" };

const SHEET_NAME = "CDN SpeedTest Log";
const CRED_DIR = path.join(os.homedir(), ".google_workspace_mcp", "credentials");
const ISP_SHARE = path.join(ROOT, ".claude", "skills", "analyze-cdn", "isp-share.json");
const RESULTS = path.join(ROOT, "cdn-speedtest-results");
const REJECTED = path.join(RESULTS, "_rejected.json");
const COL = { time: "收到時間", rid: "報告編號", test: "測試模式", email: "Email", country: "國家", isp: "ISP", join: "參加方式", invite: "邀請碼" };

// { client_id, client_secret, refresh_token, token_uri?, email? }（email：GOOGLE_OAUTH 才有，測試信寄給自己用）
function googleCred() {
  if (process.env.GOOGLE_OAUTH) {
    try { return { ...JSON.parse(process.env.GOOGLE_OAUTH), cloud: true }; } catch { throw new LotteryError("GOOGLE_OAUTH 不是合法的 JSON：重跑 npm run admin:google"); }
  }
  let files = [];
  try { files = fs.readdirSync(CRED_DIR).filter((f) => f.includes("@") && f.endsWith(".json")); } catch { /* 沒有資料夾 */ }
  if (!files.length) throw new LotteryError(`找不到 Google 憑證（${CRED_DIR}）：先用 google-workspace MCP 登入一次`);
  return JSON.parse(fs.readFileSync(path.join(CRED_DIR, files[0]), "utf8"));
}

// access token 留到過期前 1 分鐘（雲端一次列表＋草稿＋寄信不用每次都換）
let cached = null;
export async function googleToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const c = googleCred();
  const res = await fetch(c.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new LotteryError(`Google 憑證換不到 token（${j.error || res.status}）：${c.cloud ? "重跑 npm run admin:google" : "用 google-workspace MCP 重新登入"}`);
  }
  cached = { token: j.access_token, email: c.email || "", until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
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

// ── 本機檔案與雲端的快照 ───────────────────────────────────────────────────────────────────────────
const SNAPSHOT_KEY = "speedtest_snapshot";
const SNAPSHOT_TTL_MS = 5 * 60_000;
let snapshot = null, snapshotAt = 0;

function hasLocalFiles() {
  try { return fs.existsSync(RESULTS); } catch { return false; }
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

// 雲端：讀本機同步上來的快照（快取 5 分鐘）；本機什麼都不做（直接讀檔案）。讀不到就當作沒有
export async function loadSnapshot() {
  if (hasLocalFiles() || Date.now() - snapshotAt < SNAPSHOT_TTL_MS) return;
  try { snapshot = await getSetting(SNAPSHOT_KEY, null); } catch (e) { console.error("speedtest snapshot:", e); }
  snapshotAt = Date.now();
}

// 歸檔狀態從哪裡來：{ local: true } 本機檔案／{ local: false, at } 雲端的快照（at：同步時間）／null 都沒有
export function archiveSource() {
  if (hasLocalFiles()) return { local: true };
  return snapshot ? { local: false, at: snapshot.at } : null;
}

// key 排序後的 JSON（jsonb 存回來的 key 順序跟原本不同，比對內容用）
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

// 本機 → Neon：業者對照表、各國歸檔的報告編號、排除紀錄。內容沒變就不寫；回傳有沒有更新
export async function syncSnapshot() {
  if (!hasLocalFiles()) return false;
  const archived = {};
  for (const d of fs.readdirSync(RESULTS, { withFileTypes: true })) {
    if (d.isDirectory() && /^[A-Z]{2}$/.test(d.name)) archived[d.name] = [...archivedRids(d.name)].sort();
  }
  const data = { ispShare: readJson(ISP_SHARE) || {}, archived, rejected: readJson(REJECTED) || {} };
  const old = await getSetting(SNAPSHOT_KEY, null);
  if (old && stable({ ispShare: old.ispShare, archived: old.archived, rejected: old.rejected }) === stable(data)) return false;
  await setSetting(SNAPSHOT_KEY, { ...data, at: Date.now() });
  return true;
}

// 有歸檔的報告編號（資料夾名稱 <國家>-<yyyyMMdd-HHmm>-<rid>）；雲端用快照
export function archivedRids(country) {
  if (!hasLocalFiles()) return new Set(snapshot?.archived?.[country] || []);
  try {
    return new Set(fs.readdirSync(path.join(RESULTS, country), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name.split("-").pop()));
  } catch {
    return new Set();
  }
}

// /collect-speedtest-mail 排除的報告（cdn-speedtest-results/_rejected.json）：rid → { base, kind（vpn／invalid／dup）, why, at }；雲端用快照
export function rejectedReports() {
  return (hasLocalFiles() ? readJson(REJECTED) : snapshot?.rejected) || {};
}

// isp-share.json 沒有的業者（市占小、不在分析裡）：抽獎設定的名稱 → 比對字串
const ISP_ALIASES = {
  TW: [{ name: "亞太寬頻", match: ["AS7482", "Asia Pacific On-line", "AS17709", "Asia Pacific Telecom"] }],   // 亞太線上 APOL／亞太電信
};

// 抽獎設定的業者名稱 → isp-share.json（或 ISP_ALIASES）的比對字串（AS 編號、英文公司名）。對不到的就拿名稱本身比對，並列在 ispMap 給人看
const norm = (s) => String(s).toLowerCase().replace(/[\s()（）]/g, "");
function knownIsps(country) {
  const share = (hasLocalFiles() ? readJson(ISP_SHARE) : snapshot?.ispShare) || {};
  return [...(share[country]?.isps || []), ...(ISP_ALIASES[country] || [])];
}

// 報告裡的 ISP（「AS38841 kbro CO. Ltd.」）→ 給人看的名稱：有給業者名單（抽獎限定的業者）時用名單裡的名稱（「凱擘」），
// 否則用 isp-share.json 的名稱（去掉市占是估的「（估計）」標註，會寫進信裡），都對不到就拿原字串去掉 AS 編號
export function ispLabel(country, raw, names = []) {
  const s = norm(raw);
  const hitIn = (patterns) => patterns.some((p) => p && s.includes(norm(p)));
  const set = names.length ? ispMatcher(country, names).map.find((m) => hitIn(m.patterns)) : null;
  if (set) return set.name;
  const known = knownIsps(country).find((i) => hitIn(i.match));
  return known ? known.name.replace(/\s*[（(]估計[)）]\s*$/, "") : String(raw).replace(/^AS\d+\s+/i, "").trim();
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
// 信的語言依國家（香港廣東話、台澳繁中、中新馬簡中、日、韓，其他英文）
const COUNTRY_LANG = { TW: "zh-TW", HK: "zh-HK", MO: "zh-TW", CN: "zh-CN", SG: "zh-CN", MY: "zh-CN", JP: "ja", KR: "ko" };
export const mailLang = (country) => COUNTRY_LANG[country] || "en";
// zh-HK：廣東話（書面粵語），只用在寄信，擴充名稱與抽獎標題沿用繁中
export const MAIL_LANGS = ["zh-TW", "zh-HK", "zh-CN", "en", "ja", "ko"];
const LOCALE_MSG = { "zh-TW": zhTWMsg, "zh-HK": zhTWMsg, "zh-CN": zhCNMsg, en: enMsg, ja: jaMsg, ko: koMsg };
export const fillText = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));

// 擴充在這個語言的名稱（_locales 的 extName）
export function extName(lang) {
  return (LOCALE_MSG[lang] || enMsg).extName.message;
}

// { 語言: 文字 } 依 語言 → en → zh-TW → 任一種 取一種（zh-HK 先退到 zh-TW）
export function pickText(map, lang) {
  for (const k of [lang, ...(lang === "zh-HK" ? ["zh-TW"] : []), "en", "zh-TW", ...Object.keys(map || {})]) if (map?.[k]) return map[k];
  return "";
}

// 幣別 → 金額符號：本機用 exe 的 lottery_text.py（textTables）；雲端跑不了 Python，由 biboost-site 給擴充 lottery-text.js 的同一張表
let currencyTable = null;
export function useCurrencyTable(t) { currencyTable = t; }

// 金額：NT$200、HK$100；沒有金額符號的幣別寫成「200 XXX」
export function money(amount, currency) {
  const sym = (currencyTable || textTables().currencies)[currency];
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
    // 雲端的憑證只有 gmail.send，讀不了 profile：用憑證裡記的 email
    to = cached.email || (await gget(token, "https://gmail.googleapis.com/gmail/v1/users/me/profile")).emailAddress;
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
