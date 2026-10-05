// 打包並把新版 zip 上傳到 Chrome Web Store / Microsoft Edge Add-ons / Firefox AMO（用 API 金鑰，不需要登入網頁）。
// ⚠️ 絕不會按「發布」：Chrome／Edge 只上傳到草稿，由人工到後台按發布。
//
//   npm run publish-stores -- --browser=all            # 三家都上傳
//   npm run publish-stores -- --browser=chrome         # 只傳 Chrome（edge / firefox 同理）
//   npm run publish-stores -- --dry-run                # 只打包並列出會做什麼，不呼叫任何 API
//   npm run publish-stores -- --browser=firefox --submit-firefox
//
// 各家 API 能做的事不同（以官方文件為準，2026-10）：
//   Chrome：API 只能上傳套件到草稿（:upload）。商店文案／圖片 API 無法修改 → 後台手動貼（列出檔案路徑）
//   Edge：  API 只能上傳套件到草稿。文案／圖片 API 無法修改 → 後台手動貼
//   Firefox（AMO）：沒有「草稿」概念，建立 version 就等於送審。所以預設只上傳＋驗證套件，
//           加 --submit-firefox 才會建立 version（附各語言 release notes）並更新各語言簡介。
//           送審後仍須通過 Mozilla 審核才會公開。
//
// 金鑰放 .env.local（見 .env.local.example），缺哪家的金鑰就只跳過那家。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || fallback;
const dryRun = flag("dry-run");
const browserArg = opt("browser", "all");
const targets = browserArg === "all" ? ["chrome", "edge", "firefox"] : [browserArg];
for (const t of targets) {
  if (!["chrome", "edge", "firefox"].includes(t)) { console.error(`未知的 --browser=${t}，可用值：chrome, edge, firefox, all`); process.exit(1); }
}

// -------- .env.local --------
function loadEnvFile() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnvFile();
const env = (k) => process.env[k] || "";
function requireEnv(keys) {
  const missing = keys.filter((k) => !env(k));
  return missing;
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, "src/manifest.json"), "utf8")).version;
const changelog = JSON.parse(fs.readFileSync(path.join(ROOT, "src/changelog.json"), "utf8"));

function zipPathFor(browser) { return path.join(DIST, `bilibili-cdn-switcher-${browser}-${version}.zip`); }

function build(browser) {
  const r = spawnSync(process.execPath, [path.join(__dirname, "build.mjs"), `--browser=${browser}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) throw new Error(`打包 ${browser} 失敗`);
  if (!fs.existsSync(zipPathFor(browser))) throw new Error(`找不到 ${zipPathFor(browser)}`);
}

async function http(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 不是 JSON */ }
  return { res, text, json };
}
function fail(what, r) { throw new Error(`${what}：HTTP ${r.res.status} ${r.text.slice(0, 500)}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -------- Chrome Web Store（API v2）--------
async function publishChrome() {
  const keys = ["CWS_PUBLISHER_ID", "CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN"];
  const missing = requireEnv(keys);
  const base = `publishers/${env("CWS_PUBLISHER_ID") || "<CWS_PUBLISHER_ID>"}/items/${env("CWS_EXTENSION_ID") || "dfaddcffoondcendifiljhdbdagebgch"}`;
  console.log(`  上傳 ${path.basename(zipPathFor("chrome"))} → https://chromewebstore.googleapis.com/upload/v2/${base}:upload（只到草稿，不發布）`);
  if (dryRun) return;
  if (missing.length) throw new Error(`缺少金鑰：${missing.join(", ")}`);

  const tok = await http("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("CWS_CLIENT_ID"), client_secret: env("CWS_CLIENT_SECRET"), refresh_token: env("CWS_REFRESH_TOKEN"), grant_type: "refresh_token" })
  });
  if (!tok.json?.access_token) fail("取得 Chrome access token 失敗", tok);
  const auth = { Authorization: `Bearer ${tok.json.access_token}` };

  const up = await http(`https://chromewebstore.googleapis.com/upload/v2/${base}:upload`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/zip" }, body: fs.readFileSync(zipPathFor("chrome"))
  });
  if (!up.res.ok) fail("Chrome 上傳失敗", up);
  // v2 的 UploadState：SUCCEEDED / IN_PROGRESS / FAILED / NOT_FOUND（v1.1 舊值是 SUCCESS，一併接受）；
  // 處理中時改用 fetchStatus 的 lastAsyncUploadState 輪詢
  const inProgress = (s) => s === "IN_PROGRESS" || s === "UPLOAD_IN_PROGRESS";
  let state = up.json?.uploadState;
  for (let i = 0; inProgress(state) && i < 30; i++) {
    await sleep(5000);
    const st = await http(`https://chromewebstore.googleapis.com/v2/${base}:fetchStatus`, { headers: auth });
    state = st.json?.lastAsyncUploadState || state;
  }
  if (state !== "SUCCEEDED" && state !== "SUCCESS") throw new Error(`Chrome 上傳狀態：${state}（${up.text.slice(0, 300)}）`);
  console.log("  ✔ 已上傳到草稿。");
}

// -------- Microsoft Edge Add-ons（API v1.1，ApiKey）--------
const EDGE_KEY_PAGE = "https://partner.microsoft.com/dashboard/microsoftedge/publishapi";
async function publishEdge() {
  const missing = requireEnv(["EDGE_PRODUCT_ID", "EDGE_CLIENT_ID", "EDGE_API_KEY"]);
  const root = `https://api.addons.microsoftedge.microsoft.com/v1/products/${env("EDGE_PRODUCT_ID") || "<EDGE_PRODUCT_ID>"}/submissions/draft/package`;
  console.log(`  上傳 ${path.basename(zipPathFor("edge"))} → ${root}（只到草稿，不發布）`);
  // Partner Center 的 API key 有到期日（約兩個月），到期就只能回後台重新產生；在 .env.local 記下到期日就能提前提醒
  const expires = env("EDGE_API_KEY_EXPIRES");
  if (expires) {
    const days = Math.floor((Date.parse(expires) - Date.now()) / 86400000);
    if (days < 0) throw new Error(`EDGE_API_KEY 已於 ${expires} 過期：到 ${EDGE_KEY_PAGE} 重新產生，並更新 .env.local 的 EDGE_API_KEY 與 EDGE_API_KEY_EXPIRES`);
    if (days <= 14) console.warn(`  ⚠ EDGE_API_KEY 將於 ${expires} 到期（剩 ${days} 天），記得到 ${EDGE_KEY_PAGE} 換新`);
  }
  if (dryRun) return;
  if (missing.length) throw new Error(`缺少金鑰：${missing.join(", ")}`);

  const headers = { Authorization: `ApiKey ${env("EDGE_API_KEY")}`, "X-ClientID": env("EDGE_CLIENT_ID") };
  const up = await http(root, { method: "POST", headers: { ...headers, "Content-Type": "application/zip" }, body: fs.readFileSync(zipPathFor("edge")) });
  if (up.res.status === 401) throw new Error(`Edge 金鑰被拒（401），多半是 API key 過期了：到 ${EDGE_KEY_PAGE} 重新產生，並更新 .env.local`);
  if (up.res.status !== 202) fail("Edge 上傳失敗", up);
  const opId = (up.res.headers.get("location") || "").split("/").filter(Boolean).pop();
  if (!opId) throw new Error("Edge 上傳回應沒有 Location（operationID）");
  for (let i = 0; i < 30; i++) {
    const st = await http(`${root}/operations/${opId}`, { headers });
    const status = st.json?.status;
    if (status === "Succeeded") { console.log("  ✔ 已上傳到草稿。"); return; }
    if (status === "Failed") throw new Error(`Edge 套件處理失敗：${st.text.slice(0, 500)}`);
    await sleep(5000);
  }
  throw new Error("Edge 套件處理逾時（150 秒），請到 Partner Center 查看。");
}

// -------- Firefox AMO（API v5，JWT）--------
const AMO = "https://addons.mozilla.org/api/v5";
function b64url(buf) { return Buffer.from(buf).toString("base64url"); }
function amoJwt() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: env("AMO_JWT_ISSUER"), jti: crypto.randomUUID(), iat: now, exp: now + 120 }));
  const sig = crypto.createHmac("sha256", env("AMO_JWT_SECRET")).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
const AMO_LOCALES = { "en-US": ["en", "en"], "zh-TW": ["zhtw", "zh_TW"], "zh-CN": ["zhcn", "zh_CN"], ja: ["ja", "ja"], ko: ["ko", "ko"] }; // AMO locale → [store 檔名後綴, changelog 語系鍵]

// store/description-firefox-*.md：「簡短描述」＝ summary、「詳細描述」＝ description
function parseStoreDescription(suffix) {
  const md = fs.readFileSync(path.join(ROOT, "store", `description-firefox-${suffix}.md`), "utf8").replace(/\r\n/g, "\n");
  const sections = md.split(/^## /m).slice(1);
  const pick = (re) => (sections.find((s) => re.test(s.split("\n")[0])) || "").split("\n").slice(1).join("\n").trim();
  return { summary: pick(/簡短描述|简短描述|Short description|簡単な説明|간단한 설명/i), description: pick(/詳細描述|详细描述|Detailed description|詳細な説明|자세한 설명/i) };
}
function releaseNotesFor(langKey) {
  const rel = changelog.releases.find((r) => r.version === version);
  if (!rel) return "";
  return rel.entries.map((e) => `• ${e.text[langKey]}`).join("\n");
}

async function publishFirefox() {
  const missing = requireEnv(["AMO_JWT_ISSUER", "AMO_JWT_SECRET"]);
  const slug = env("AMO_ADDON_SLUG") || "bilibili-cdn-switcher";
  const submit = flag("submit-firefox");
  console.log(`  上傳並驗證 ${path.basename(zipPathFor("firefox"))}（channel=listed）`);
  if (submit) console.log(`  --submit-firefox：建立 version ${version}（＝送審）＋ 更新各語言簡介（${Object.keys(AMO_LOCALES).join(", ")}）`);
  else console.log("  （未加 --submit-firefox：只驗證，不建立 version，不會送審）");
  if (dryRun) return;
  if (missing.length) throw new Error(`缺少金鑰：${missing.join(", ")}`);
  const auth = () => ({ Authorization: `JWT ${amoJwt()}` });

  const form = new FormData();
  form.set("channel", "listed");
  form.set("upload", new Blob([fs.readFileSync(zipPathFor("firefox"))], { type: "application/zip" }), path.basename(zipPathFor("firefox")));
  const up = await http(`${AMO}/addons/upload/`, { method: "POST", headers: auth(), body: form });
  if (!up.json?.uuid) fail("Firefox 上傳失敗", up);
  const uuid = up.json.uuid;

  let status = up.json;
  for (let i = 0; !status.processed && i < 60; i++) {
    await sleep(5000);
    status = (await http(`${AMO}/addons/upload/${uuid}/`, { headers: auth() })).json || status;
  }
  if (!status.processed) throw new Error("Firefox 套件驗證逾時");
  if (!status.valid) throw new Error(`Firefox 套件驗證失敗：${JSON.stringify(status.validation || status).slice(0, 1500)}`);
  console.log(`  ✔ 套件驗證通過（upload ${uuid}）。`);
  if (!submit) return;

  const releaseNotes = {}, summary = {}, description = {};
  for (const [amoLocale, [suffix, langKey]] of Object.entries(AMO_LOCALES)) {
    const d = parseStoreDescription(suffix);
    if (d.summary) summary[amoLocale] = d.summary;
    if (d.description) description[amoLocale] = d.description;
    const notes = releaseNotesFor(langKey);
    if (notes) releaseNotes[amoLocale] = notes;
  }
  const ver = await http(`${AMO}/addons/addon/${slug}/versions/`, {
    method: "POST", headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ upload: uuid, ...(Object.keys(releaseNotes).length ? { release_notes: releaseNotes } : {}) })
  });
  if (!ver.res.ok) fail("Firefox 建立 version 失敗", ver);
  console.log(`  ✔ 已建立 version ${ver.json?.version || version}，等待 Mozilla 審核。`);

  const meta = await http(`${AMO}/addons/addon/${slug}/`, {
    method: "PATCH", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ summary, description })
  });
  if (!meta.res.ok) fail("Firefox 更新簡介失敗（version 已建立）", meta);
  console.log("  ✔ 已更新各語言簡介。");
}

// -------- 流程 --------
const manualListing = {
  chrome: ["https://chrome.google.com/webstore/devconsole", "chrome"],
  edge: ["https://partner.microsoft.com/dashboard/microsoftedge/overview", "edge"]
};
const runners = { chrome: publishChrome, edge: publishEdge, firefox: publishFirefox };

console.log(`版本 v${version}${dryRun ? "（dry-run）" : ""}`);
let failed = 0;
for (const b of targets) {
  console.log(`\n[${b}]`);
  try {
    build(b);
    console.log(`  已打包 ${path.relative(ROOT, zipPathFor(b))}`);
    await runners[b]();
  } catch (e) {
    failed++;
    console.error(`  ✘ ${e.message}`);
  }
}

console.log("\n—— 還需要你手動做的事 ——");
for (const b of targets) {
  if (manualListing[b]) {
    const [dash, key] = manualListing[b];
    console.log(`• ${b}：到 ${dash} 確認草稿 → 貼上 store/description-${key}-{zhtw,zhcn,en,ja,ko}.md 的各語言簡介（API 不能改文案／圖片，圖片在 store/*.png）→ 自己按「發布」`);
  } else if (!flag("submit-firefox")) {
    console.log("• firefox：套件已驗證；確認後執行 `npm run publish-stores -- --browser=firefox --submit-firefox` 送審（AMO 沒有草稿，這步等同發布按鈕）");
  } else {
    console.log("• firefox：已送審；Firefox 商店圖片需到 AMO 後台自行確認");
  }
}
process.exit(failed ? 1 : 0);
