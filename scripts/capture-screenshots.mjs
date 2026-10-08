// 用 Puppeteer 載入 unpacked 擴充功能，依五語系各截五張圖（點播主頁 / 直播主頁 / 點播測速頁 /
// 進階設定頁 / debug 疊層），等比縮放 + 黑邊填成 1280x800 png，輸出到 store/ 取代現有檔案。
// 檔名 screenshot-<語系>-<序號>-<畫面>-<寬>x<高>.png：先語系、後序號，檔案總管按檔名排序時
// 同一語系排在一起、且依 VIEWS 的順序排列。
// --locale=en|zhcn|zhtw|ja|ko：只跑指定語系。
// --safari：拍 Mac App Store 用的 Safari 版截圖（檔名前綴 screenshot-safari-），見下方 SAFARI 的說明。
//
// 用法：npm run capture-screenshots
//
// 注意事項（決定了下面流程為什麼要這樣寫）：
// - 擴充功能沒有 background service worker，抓不到現成的 extension target，
//   extension id 改用開 chrome://extensions 讀 shadow DOM 取得。
// - popup.html 這裡是當一般分頁開來模擬彈窗，不是真的擴充功能彈窗；popup.js 靠
//   chrome.tabs.query({active:true, currentWindow:true}) 找目前分頁，所以開完 popup 分頁後
//   要 bringToFront() 把 bilibili 影片分頁切回 active，debug/測速資料才抓得到。
// - debug 截圖不是 popup 畫面，是「顯示 debug 疊層」開啟後、疊在播放器左上角的浮層，
//   所以是對 bilibili 分頁的播放器 DOM 截圖，不是對 popup 分頁截圖。
//   「顯示 debug 疊層」開關已移到進階設定頁，但 #showDebug 還在 DOM 裡，照樣用 JS 觸發即可。
// - 直播主頁要有「正在播放的直播間」才看得到具體線路網址：每輪最後才把同一個分頁導去直播間，
//   房間由 get_user_recommend 動態挑（直播間會下播，寫死房號很快就失效），可用 LIVE_ROOM 指定。
import puppeteer from "puppeteer";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// --safari：Safari 打包時 scripts/safari-ext-name.py 會把 popup 標題換成 App 名稱（App Store 不准名稱含 bilibili），
// 圖示也換成 assets/icons-prod。這裡把 src 複製到暫存資料夾、做一樣的替換再載入，拍出來才跟 Safari 版一致；
// 「給 5 星」按鈕在 Safari 上不會出現，截圖時也藏起來。檔名加 safari- 前綴，不會蓋掉 Chrome 那套。
const SAFARI = process.argv.includes("--safari");
let EXT_DIR = path.join(ROOT, "src");
if (SAFARI) {
  EXT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "cdn-switcher-safari-src-"));
  await fs.cp(path.join(ROOT, "src"), EXT_DIR, { recursive: true });
  for (const f of await fs.readdir(path.join(ROOT, "assets", "icons-prod"))) {
    if (/^icon.*.png$/.test(f)) await fs.copyFile(path.join(ROOT, "assets", "icons-prod", f), path.join(EXT_DIR, "icons", f));
  }
  execFileSync(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "scripts", "safari-ext-name.py"), path.join(EXT_DIR, "_locales")], {
    stdio: "inherit",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" }
  });
}
const OUT_DIR = path.join(ROOT, "store");

const VIDEO_URL = "https://www.bilibili.com/video/BV1p1n8zdEAk/";

// 登入 cookie 是選用的：.env.local 有 BILI_COOKIE 就帶登入狀態開影片頁，拿得到高畫質；
// 沒有這個檔（或值是空的）就照舊用未登入狀態跑，畫質約 480P，流程其餘部分完全一樣。
// 用 Node 內建的 loadEnvFile，不額外裝 dotenv。範例見 .env.local.example。
try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // 檔案不存在或格式不對都當作沒設定，不要讓截圖整個中斷
}
const BILI_COOKIE = (process.env.BILI_COOKIE || "").trim();
// 直播間：.env.local 設 LIVE_ROOM=<房號> 就固定用那間；沒設就從推薦清單挑第一間能播的
const LIVE_ROOM_ENV = (process.env.LIVE_ROOM || "").trim();

// "a=1; b=2" -> Puppeteer 的 cookie 物件陣列。值本身可能含 %3D、= 之類的字元，
// 所以只切第一個 "="，後面整段都算 value。
function parseCookieHeader(header) {
  const out = [];
  for (const part of header.split(";")) {
    const s = part.trim();
    if (!s) continue;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    out.push({
      name: s.slice(0, eq).trim(),
      value: s.slice(eq + 1).trim(),
      domain: ".bilibili.com",
      path: "/"
    });
  }
  return out;
}

// Puppeteer 23 之後 cookie 設在 browser／browserContext 層，Page.setCookie 標記為 deprecated；
// 兩種都試，才不會綁死在特定版本。
async function applyLoginCookie(browser, page) {
  if (!BILI_COOKIE) return false;
  const cookies = parseCookieHeader(BILI_COOKIE);
  if (!cookies.length) return false;
  if (typeof browser.setCookie === "function") await browser.setCookie(...cookies);
  else await page.setCookie(...cookies);
  return true;
}

// --size=WxH（預設 1280x800）：Chrome 商店固定要 1280x800；Mac App Store 想要更清晰可傳
// --size=2560x1600（同為 16:10）。檔名本來就帶尺寸（...-<W>x<H>.png），跑不同尺寸會產生
// 不同檔名，不會覆蓋掉別的尺寸那一套。
const sizeArg = (process.argv.find((a) => a.startsWith("--size=")) || "").split("=")[1] || "1280x800";
const sizeMatch = /^(\d+)x(\d+)$/.exec(sizeArg);
if (!sizeMatch) {
  console.error(`--size 格式錯誤：${sizeArg}，應為 <寬>x<高>，例如 2560x1600`);
  process.exit(1);
}
const CANVAS_W = parseInt(sizeMatch[1], 10);
const CANVAS_H = parseInt(sizeMatch[2], 10);
// 以 1280 寬為基準的放大倍率，拿來同步調高 deviceScaleFactor，讓大尺寸是「原生高 DPI 直接截出來」，
// 而不是把 1280 那套放大（放大會糊）。SCALE=1 時行為與原本完全一致。
const SCALE = CANVAS_W / 1280;

// appleLang：macOS 上 Chrome 會忽略 --lang、改跟系統 UI 語言，導致所有語系全塌成系統語言。
// 用 NSUserDefaults 的「argument domain」以 -AppleLanguages "(xxx)" 覆蓋，才能真的切 Chrome UI 語言，
// 讓擴充的 chrome.i18n.getUILanguage() 回傳對應語系。（Windows 靠 --lang、Linux 靠 LANGUAGE 環境變數，這參數無害。）
const LOCALES = [
  { chromeLang: "en-US", prefix: "en", appleLang: "(en-US)" },
  { chromeLang: "zh-CN", prefix: "zhcn", appleLang: "(zh-Hans-CN)" },
  { chromeLang: "zh-TW", prefix: "zhtw", appleLang: "(zh-Hant-TW)" },
  { chromeLang: "ja", prefix: "ja", appleLang: "(ja-JP)" },
  { chromeLang: "ko", prefix: "ko", appleLang: "(ko-KR)" }
];

const POPUP_VIEWPORT = { width: 360, height: 560, deviceScaleFactor: 2 * SCALE };
const PLAYER_SELECTORS = [".bpx-player-video-area", ".bpx-player-container", "#bilibili-player", ".bpx-player-primary-area"];

function log(...args) { console.log(...args); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getExtensionId(browser) {
  const page = await browser.newPage();
  await page.goto("chrome://extensions");
  const handle = await page.waitForFunction(() => {
    const manager = document.querySelector("extensions-manager");
    const itemList = manager && manager.shadowRoot && manager.shadowRoot.querySelector("extensions-item-list");
    const item = itemList && itemList.shadowRoot && itemList.shadowRoot.querySelector("extensions-item");
    return item ? item.id : false;
  }, { timeout: 10000 });
  const id = await handle.jsonValue();
  await page.close();
  return id;
}

async function waitForPlayer(page) {
  await page.waitForFunction(
    (sels) => sels.some((s) => document.querySelector(s)),
    { timeout: 30000 },
    PLAYER_SELECTORS
  );
  for (const sel of PLAYER_SELECTORS) {
    const el = await page.$(sel);
    if (el) return el;
  }
  throw new Error("找不到播放器元素");
}

// 順序即檔名序號，也是商店截圖想呈現的順序
const VIEWS = {
  videoMain: "01-video-main",
  liveMain: "02-live-main",
  videoSpeedtest: "03-video-speedtest",
  advanced: "04-advanced",
  debug: "05-debug"
};

function outFileName(view, prefix) {
  return `screenshot-${SAFARI ? "safari-" : ""}${prefix}-${view}-${CANVAS_W}x${CANVAS_H}.png`;
}

// popup 實際高度由內容決定：主頁 / 進階設定頁比預設視窗高就把視窗撐高再截，才不會被切掉。
// 測速頁不能這樣做：它的版面是鎖死 popup 可見高度（html.stMode），改視窗高度會觸發重排。
async function popupShot(tabB, { fit }) {
  if (!fit) return tabB.screenshot({ type: "png" });
  const height = await tabB.evaluate(() => document.documentElement.scrollHeight);
  const full = Math.min(Math.max(height, POPUP_VIEWPORT.height), 1100);
  await tabB.setViewport({ ...POPUP_VIEWPORT, height: full });
  try {
    return await tabB.screenshot({ type: "png" });
  } finally {
    await tabB.setViewport(POPUP_VIEWPORT);
  }
}

// 直播推薦清單 -> 房號候選（依序試到有一間真的在播為止）
async function liveRoomCandidates() {
  if (LIVE_ROOM_ENV) return [LIVE_ROOM_ENV];
  const res = await fetch("https://api.live.bilibili.com/room/v1/room/get_user_recommend?page=1&page_size=15", {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://live.bilibili.com/", ...(BILI_COOKIE ? { Cookie: BILI_COOKIE } : {}) }
  });
  const json = await res.json();
  return ((json && json.data) || []).map((r) => r.roomid).filter(Boolean).slice(0, 8);
}

// 輸出 png 而非 jpg：截圖以文字和 UI 線條為主，jpeg 的區塊壓縮會讓小字邊緣糊掉，
// png 無損、檔案雖大（單張約 0.3～1 MB）但三個商店都吃得下。
async function saveLetterboxedPng(rawBuffer, outPath) {
  await sharp(rawBuffer)
    .resize({ width: CANVAS_W, height: CANVAS_H, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

function parseSpdBps(text) {
  const m = /spd=([\d.]+)\s*(kB|MB)\/s/i.exec(text || "");
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2].toLowerCase() === "mb" ? n * 1048576 : n * 1024;
}

// main-hook.js 的 spd 是 10 秒捲動視窗（SPEED_WINDOW_MS）算出來的，剛開始播放時視窗還沒填滿、
// 數字會偏低且一直往上衝；等視窗被實際下載撐滿、連續兩次讀數不再明顯往上衝，才算穩定。
// minBps：切 4K 後要等速度真的比切換前高（4K 分段大、下載量才撐得起來）才算數。
async function waitForStableSpeed(tabB, downloadStartedAt, { minBps = 0, timeout = 25000 } = {}) {
  const pollMs = 1000;
  const start = Date.now();
  let prevBps = null;
  let bps = null;
  while (Date.now() - start < timeout) {
    const text = await tabB.$eval("#debug", (el) => el.textContent).catch(() => "");
    bps = parseSpdBps(text);
    if (bps && bps > minBps && Date.now() - downloadStartedAt >= 10000 && prevBps && bps <= prevBps * 1.15) {
      return bps;
    }
    prevBps = bps;
    await sleep(pollMs);
  }
  log(`  （等了 ${timeout / 1000} 秒速度還沒穩定下來，直接用目前讀數截圖）`);
  return bps;
}

async function readOverlayText(tabA) {
  return tabA.$eval("#bcs-debug-overlay", (el) => el.textContent).catch(() => "");
}

// 把播放器畫質切到 4K（qn=120）：優先用 bpx 播放器的 window.player.requestQuality，
// 沒有這個 API 就退回直接觸發畫質選單項目的 click。要登入大會員帳號、影片也要有 4K 才切得到。
// 切換是否成功以 debug 疊層的 qn=4K 為準（main-hook 依實際下載中的分段判斷畫質，比播放器 UI 準）。
const QN_4K = 120;
async function switchTo4K(tabA) {
  if (/qn=4K/.test(await readOverlayText(tabA))) return true;
  const how = await tabA.evaluate((qn) => {
    try {
      if (window.player && typeof window.player.requestQuality === "function") {
        window.player.requestQuality(qn);
        return "requestQuality";
      }
    } catch (e) { /* 改用選單 */ }
    const item = document.querySelector(`.bpx-player-ctrl-quality-menu-item[data-value="${qn}"]`);
    if (item) { item.click(); return "menu"; }
    return null;
  }, QN_4K);
  if (!how) { log("  （找不到切畫質的方法，維持目前畫質）"); return false; }
  const ok = await tabA.waitForFunction(
    () => { const el = document.getElementById("bcs-debug-overlay"); return !!(el && /qn=4K/.test(el.textContent)); },
    { timeout: 30000, polling: 500 }
  ).then(() => true, () => false);
  log(ok ? `  已切到 4K（${how}）` : "  （30 秒內 debug 疊層沒出現 qn=4K，可能帳號不是大會員或影片沒有 4K）");
  return ok;
}

async function waitForSpeedtestMidway(tabB, minDone) {
  // 在「完成 minDone 個、仍在測試中」就馬上截圖：畫面才會同時看得到已完成的節點（開了
  // 按速度排序，會依快→慢排在最上面）跟緊接著的「Testing…」那行。節點慢的話單一節點
  // 可能等到門檻秒數才結束，所以 timeout 抓寬一點。
  // polling 預設用 requestAnimationFrame，但 tabB 這時是背景分頁，瀏覽器會暫停 rAF，
  // 導致條件幾乎沒被檢查、一路空等到 timeout 才發現整個測速早就跑完了。改用固定間隔 polling。
  await tabB.waitForFunction((n) => {
    var st = window.lastSpeedtestState;
    return !!(st && st.running && st.results && st.results.length >= n);
  }, { timeout: 120000, polling: 100 }, minDone).catch(() => log(`  （測速沒等到「完成 ${minDone} 個節點且仍在測試中」，直接用目前畫面截圖）`));
}

async function captureLiveMain({ tabA, tabB, save }) {
  const rooms = await liveRoomCandidates();
  if (!rooms.length) throw new Error("取不到直播間房號（可在 .env.local 設 LIVE_ROOM=<房號>）");
  for (const room of rooms) {
    log(`  直播間 ${room}…`);
    await tabA.goto(`https://live.bilibili.com/${room}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await tabA.bringToFront();
    // 切到直播 tab；popup 是在影片頁開的所以預設停在「影片」tab
    await tabB.$eval("#tabLive", (el) => el.click());
    // popup 每秒輪詢 debug；有 hosts 才代表正在播放。tabB 是背景分頁，rAF 會被暫停，改固定間隔 polling
    const ok = await tabB.waitForFunction(
      () => { const el = document.getElementById("liveSelectHost"); return !!(el && el.textContent.trim()); },
      { timeout: 25000, polling: 500 }
    ).then(() => true, () => false);
    if (!ok) { log("  （這間沒播起來，換下一間）"); continue; }
    await sleep(500);
    await save(await popupShot(tabB, { fit: true }), "liveMain");
    return;
  }
  throw new Error("試過的直播間都沒播起來，無法截直播主頁");
}

async function captureLocale({ chromeLang, prefix, appleLang }) {
  log(`\n== ${prefix} (${chromeLang}) ==`);
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), `cdn-switcher-shot-${prefix}-`));
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir,
    // Linux 版 Chromium 的介面語言看 LANGUAGE 環境變數（--lang 只對 Windows 有效、Mac 靠下面的 AppleLanguages）
    env: { ...process.env, LANGUAGE: chromeLang.replace("-", "_") },
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      `--lang=${chromeLang}`,
      // macOS：用 argument-domain 覆蓋 UI 語言（--lang 在 Mac 上無效）
      "-AppleLanguages", appleLang,
      "--window-size=1400,1000",
      "--no-first-run",
      // 以 root 執行（CI、雲端容器）時 Chromium 不給開 sandbox，一般使用者帳號執行不會加這條
      ...(process.getuid && process.getuid() === 0 ? ["--no-sandbox"] : [])
    ]
  });

  try {
    const extensionId = await getExtensionId(browser);
    log("extension id:", extensionId);

    // tabA：真實 bilibili 影片頁，content script 掛在這裡，debug/測速都靠它
    const tabA = await browser.newPage();
    await tabA.setViewport({ width: 1280, height: 900, deviceScaleFactor: SCALE });
    // cookie 要在 goto 之前設，不然第一次請求還是未登入、拿到的仍是低畫質 playurl
    log(await applyLoginCookie(browser, tabA) ? "已帶入登入 cookie（高畫質）" : "未設定 BILI_COOKIE，用未登入狀態（約 480P）");
    await tabA.goto(VIDEO_URL, { waitUntil: "networkidle2", timeout: 60000 });
    const playerHandle = await waitForPlayer(tabA);
    const downloadStartedAt = Date.now();
    await sleep(3000); // 等 main-hook 完成第一次改寫/取樣，debug 資料才有東西可顯示

    // tabB：popup.html 當一般分頁開，模擬擴充功能彈窗
    const tabB = await browser.newPage();
    await tabB.setViewport(POPUP_VIEWPORT);
    await tabB.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    if (SAFARI) await tabB.addStyleTag({ content: "#rateBtn { display: none !important; }" });
    await sleep(300);
    log("UI language:", await tabB.evaluate(() => chrome.i18n.getUILanguage()), "(期望對應", prefix, ")");

    // 開「在頁面上顯示 debug 疊層」，main / debug 兩張都要
    // #showDebug 是 opacity:0/寬高 0 的隱藏 checkbox（外觀靠 .slider 畫出來），
    // Puppeteer 的 click() 需要有實際可點的座標，抓不到寬高 0 的元素，改用 JS 直接觸發
    await tabB.$eval("#showDebug", (el) => el.click());
    // 開「節點按測速排序」：測速頁的結果會依速度快→慢重排，進階設定頁截圖裡這個開關也是開著的。
    // 這設定存在 storage，同一輪後面的畫面都吃得到；每個語系是全新 userDataDir，要各自打開一次
    await tabB.$eval("#sortBySpeed", (el) => { if (!el.checked) el.click(); });

    await tabA.bringToFront();
    await sleep(1500); // 等 popup.js 的 setInterval(1000ms) 至少 poll 一次，#debug 才有字可讀
    const baseBps = await waitForStableSpeed(tabB, downloadStartedAt);

    // 主頁 / debug 疊層都要顯示 4K：切畫質後重新等 10 秒視窗被 4K 分段填滿、速度衝上去並穩定再截
    if (await switchTo4K(tabA)) {
      await waitForStableSpeed(tabB, Date.now(), { minBps: baseBps || 0, timeout: 45000 });
    }

    await fs.mkdir(OUT_DIR, { recursive: true });

    const save = async (buf, key) => {
      await saveLetterboxedPng(buf, path.join(OUT_DIR, outFileName(VIEWS[key], prefix)));
      log("saved", VIEWS[key]);
    };

    await save(await popupShot(tabB, { fit: true }), "videoMain");

    await save(await playerHandle.screenshot({ type: "png" }), "debug");

    // tabB 這時是背景分頁（tabA 才是 active），page.click() 的 hit-test 邏輯在背景分頁裡
    // 會一直等不到而卡住逾時，跟 #showDebug 一樣改用 JS 直接觸發 click
    await tabB.$eval("#speedtestBtn", (el) => el.click());
    await tabB.waitForSelector("#speedtestView", { visible: true });
    // 開了「按速度排序」時，每測完一個節點 popup 會用 inline transform 做 .45s 的排名位移動畫（flipRender），
    // 截圖剛好撞上就會拍到動畫中間。tabB 是背景分頁，動畫時鐘不可靠（等 getAnimations() 清空可能永遠等不到），
    // 所以直接把清單的過渡效果關掉：排名一變就直接是最終位置，任何時間點截圖都是穩定的畫面
    await tabB.addStyleTag({ content: "#stList, #stList * { transition: none !important; animation: none !important; }" });
    await waitForSpeedtestMidway(tabB, 3);
    await sleep(300);
    await save(await popupShot(tabB, { fit: false }), "videoSpeedtest");
    await tabB.$eval("#stBackBtn", (el) => el.click()); // 返回主頁（同時中止測速）
    await sleep(300);

    await tabB.$eval("#gearBtn", (el) => el.click());
    await tabB.waitForSelector("#advancedView", { visible: true });
    await sleep(300);
    await save(await popupShot(tabB, { fit: true }), "advanced");
    await tabB.$eval("#advBackBtn", (el) => el.click());
    await sleep(300);

    // 直播主頁：同一個分頁導去直播間，等 popup 輪詢到「確定得到 CDN 網址」才截圖
    await captureLiveMain({ tabA, tabB, save });

  } finally {
    await browser.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

const onlyLocale = (process.argv.find((a) => a.startsWith("--locale=")) || "").split("=")[1];
for (const locale of LOCALES.filter((l) => !onlyLocale || l.prefix === onlyLocale)) {
  try {
    await captureLocale(locale);
  } catch (err) {
    console.error(`\n!! ${locale.prefix} 截圖失敗：`, err);
  }
}
log("\n全部完成，輸出在", OUT_DIR);
