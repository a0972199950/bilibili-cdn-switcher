// 用 Puppeteer 載入 unpacked 擴充功能，依三語系各截 main / debug / speedtest 三張圖，
// 等比縮放 + 黑邊填成 1200x800 jpg，輸出到 store/ 取代現有檔案。
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
import puppeteer from "puppeteer";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXT_DIR = path.join(ROOT, "src");
const OUT_DIR = path.join(ROOT, "store");

const VIDEO_URL = "https://www.bilibili.com/video/BV1p1n8zdEAk/";

const CANVAS_W = 1200;
const CANVAS_H = 800;

const LOCALES = [
  { chromeLang: "en-US", prefix: "en" },
  { chromeLang: "zh-CN", prefix: "zhcn" },
  { chromeLang: "zh-TW", prefix: "zhtw" }
];

const POPUP_VIEWPORT = { width: 360, height: 560, deviceScaleFactor: 2 };
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

function outFileName(view, prefix) {
  return `screenshot-${view}-${prefix}-${CANVAS_W}x${CANVAS_H}.jpg`;
}

async function saveLetterboxedJpeg(rawBuffer, outPath) {
  await sharp(rawBuffer)
    .resize({ width: CANVAS_W, height: CANVAS_H, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .jpeg({ quality: 90 })
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
async function waitForStableSpeed(tabB, downloadStartedAt) {
  const timeout = 25000;
  const pollMs = 1000;
  const start = Date.now();
  let prevBps = null;
  while (Date.now() - start < timeout) {
    const text = await tabB.$eval("#debug", (el) => el.textContent).catch(() => "");
    const bps = parseSpdBps(text);
    if (bps && Date.now() - downloadStartedAt >= 10000 && prevBps && bps <= prevBps * 1.15) {
      return;
    }
    prevBps = bps;
    await sleep(pollMs);
  }
  log("  （等了 25 秒速度還沒穩定下來，直接用目前讀數截圖）");
}

async function waitForSpeedtestMidway(tabB) {
  // 節點清單長、每個節點慢的話可能真的要等（有的節點會等到 timeout 才失敗），
  // 所以在「剛好完成第 1 個、還在跑第 2 個」就馬上截圖：畫面才會同時看得到
  // 已完成的節點跟「Testing…」那行，慢了的話「Testing…」會被捲出可視範圍外。
  // polling 預設用 requestAnimationFrame，但 tabB 這時是背景分頁，瀏覽器會暫停 rAF，
  // 導致條件幾乎沒被檢查、一路空等到 timeout 才發現整個測速早就跑完了。改用固定間隔 polling。
  await tabB.waitForFunction(() => {
    var st = window.lastSpeedtestState;
    return !!(st && st.running && st.results && st.results.length >= 1);
  }, { timeout: 60000, polling: 100 }).catch(() => log("  （測速沒等到「完成 1 個節點且仍在測試中」，直接用目前畫面截圖）"));
}

async function captureLocale({ chromeLang, prefix }) {
  log(`\n== ${prefix} (${chromeLang}) ==`);
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), `roger-cdn-shot-${prefix}-`));
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      `--lang=${chromeLang}`,
      "--window-size=1400,1000",
      "--no-first-run"
    ]
  });

  try {
    const extensionId = await getExtensionId(browser);
    log("extension id:", extensionId);

    // tabA：真實 bilibili 影片頁，content script 掛在這裡，debug/測速都靠它
    const tabA = await browser.newPage();
    await tabA.setViewport({ width: 1280, height: 900 });
    await tabA.goto(VIDEO_URL, { waitUntil: "networkidle2", timeout: 60000 });
    const playerHandle = await waitForPlayer(tabA);
    const downloadStartedAt = Date.now();
    await sleep(3000); // 等 main-hook 完成第一次改寫/取樣，debug 資料才有東西可顯示

    // tabB：popup.html 當一般分頁開，模擬擴充功能彈窗
    const tabB = await browser.newPage();
    await tabB.setViewport(POPUP_VIEWPORT);
    await tabB.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
    await sleep(300);

    // 開「在頁面上顯示 debug 疊層」，main / debug 兩張都要
    // #showDebug 是 opacity:0/寬高 0 的隱藏 checkbox（外觀靠 .slider 畫出來），
    // Puppeteer 的 click() 需要有實際可點的座標，抓不到寬高 0 的元素，改用 JS 直接觸發
    await tabB.$eval("#showDebug", (el) => el.click());

    await tabA.bringToFront();
    await sleep(1500); // 等 popup.js 的 setInterval(1000ms) 至少 poll 一次，#debug 才有字可讀
    await waitForStableSpeed(tabB, downloadStartedAt); // main 的 spd 數字等它衝上去、穩定了再截圖

    await fs.mkdir(OUT_DIR, { recursive: true });

    const mainPng = await tabB.screenshot({ type: "png" });
    await saveLetterboxedJpeg(mainPng, path.join(OUT_DIR, outFileName("main", prefix)));
    log("saved main");

    const debugPng = await playerHandle.screenshot({ type: "png" });
    await saveLetterboxedJpeg(debugPng, path.join(OUT_DIR, outFileName("debug", prefix)));
    log("saved debug");

    // tabB 這時是背景分頁（tabA 才是 active），page.click() 的 hit-test 邏輯在背景分頁裡
    // 會一直等不到而卡住逾時，跟 #showDebug 一樣改用 JS 直接觸發 click
    await tabB.$eval("#speedtestBtn", (el) => el.click());
    await tabB.waitForSelector("#speedtestView", { visible: true });
    await waitForSpeedtestMidway(tabB);
    await sleep(100);
    const speedPng = await tabB.screenshot({ type: "png" });
    await saveLetterboxedJpeg(speedPng, path.join(OUT_DIR, outFileName("speedtest", prefix)));
    log("saved speedtest");
  } finally {
    await browser.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

for (const locale of LOCALES) {
  try {
    await captureLocale(locale);
  } catch (err) {
    console.error(`\n!! ${locale.prefix} 截圖失敗：`, err);
  }
}
log("\n全部完成，輸出在", OUT_DIR);
