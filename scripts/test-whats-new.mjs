// 用真的 Chrome（puppeteer 內建的 Chrome for Testing）載入 src/，測「版本更新提示」popup。
//
//   npm run test:whats-new
//
// 情境：新使用者不跳／老使用者跳且關閉後才寫入版本／同版本不跳／關掉後重開不再跳／
//       用 X 關閉也算／版本紀錄壞掉時不跳並重設。
// 截圖存到 os.tmpdir()/whats-new-popup.png 方便目視檢查。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const current = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8")).version;
const changelog = JSON.parse(fs.readFileSync(path.join(SRC, "changelog.json"), "utf8"));
// 版本 1.0.0 → 目前版本之間會顯示的條目數（popup 只看 releases，不看 unreleased）
const expectedEntries = changelog.releases
  .reduce((n, r) => n + r.entries.length, 0);

const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  enableExtensions: true,
  args: ["--no-sandbox", "--lang=zh-TW"]
});

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✔" : "✘"} ${name}${ok ? "" : `  ← ${detail}`}`);
  if (!ok) failed++;
}

try {
  const extId = await browser.installExtension(SRC);
  const url = `chrome-extension://${extId}/popup.html`;
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 640 });

  const storageGet = () => page.evaluate(() => new Promise((r) => chrome.storage.local.get("installedVersion", (x) => r(x.installedVersion))));
  const storageSet = (v) => page.evaluate((val) => new Promise((r) => (val === undefined ? chrome.storage.local.clear(r) : chrome.storage.local.set({ installedVersion: val }, r))), v);
  const overlayShown = () => page.$eval("#whatsNew", (el) => el.classList.contains("show"));
  // popup 內的 storage 讀寫都是非同步，給它一點時間跑完
  const settle = () => new Promise((r) => setTimeout(r, 500));

  // 先開一次 popup 取得 chrome.* 環境來預先設定 storage，再 reload 才是「真的開啟」那一次
  async function openWith(stored) {
    await page.goto(url);
    await storageSet(stored);
    await page.reload();
    await settle();
  }

  // 1. 新使用者
  await openWith(undefined);
  check("新使用者：不跳 popup", !(await overlayShown()));
  check("新使用者：版本號直接寫入 storage", (await storageGet()) === current, `storage=${await storageGet()}`);

  // 2. 同版本
  await openWith(current);
  check("同版本：不跳 popup", !(await overlayShown()));

  // 3. 老使用者，按「知道了」關閉
  await openWith("1.0.0");
  check("老使用者：跳 popup", await overlayShown());
  const title = await page.$eval("#wnTitle", (el) => el.textContent);
  check("popup 標題含最新版本號", title.includes(current), title);
  const count = await page.$$eval("#wnList li", (els) => els.length);
  check(`popup 列出 ${expectedEntries} 條更新內容`, count === expectedEntries, `實際 ${count}`);
  check("關閉前 storage 版本號沒變", (await storageGet()) === "1.0.0", `storage=${await storageGet()}`);
  await page.screenshot({ path: path.join(os.tmpdir(), "whats-new-popup.png") });
  await page.click("#wnClose");
  await settle();
  check("按關閉後 popup 消失", !(await overlayShown()));
  check("按關閉後才寫入新版本號", (await storageGet()) === current, `storage=${await storageGet()}`);
  await page.reload();
  await settle();
  check("關閉後重開：不再跳", !(await overlayShown()));

  // 4. 老使用者，按 X 關閉；只跨一個版本時只列該版本之後的內容
  const prevOfLatest = changelog.releases[1]?.version;
  if (prevOfLatest) {
    await openWith(prevOfLatest);
    const n = await page.$$eval("#wnList li", (els) => els.length);
    check(`只跨一版（${prevOfLatest} → ${current}）：只列最新版的 ${changelog.releases[0].entries.length} 條`, n === changelog.releases[0].entries.length, `實際 ${n}`);
    await page.click("#wnX");
    await settle();
    check("按 X 關閉也會寫入新版本號", (await storageGet()) === current, `storage=${await storageGet()}`);
  }

  // 5. 版本紀錄壞掉
  await openWith("not-a-version");
  check("版本紀錄壞掉：不跳 popup 並重設成目前版本", !(await overlayShown()) && (await storageGet()) === current, `storage=${await storageGet()}`);

  // 6. console 預覽函數：能顯示、不動 storage、可重複呼叫、關閉後不寫入
  await openWith(current);
  await page.evaluate(() => previewWhatsNew());
  check("previewWhatsNew()：顯示 popup", await overlayShown());
  await page.evaluate(() => previewWhatsNew("1.0.0"));
  const pn = await page.$$eval("#wnList li", (els) => els.length);
  check("previewWhatsNew('1.0.0')：重複呼叫可用，列出所有已上架內容", pn === expectedEntries, `實際 ${pn}`);
  await page.click("#wnClose");
  await settle();
  check("預覽關閉後 storage 版本號不變", (await storageGet()) === current, `storage=${await storageGet()}`);

  // 7. 網址參數 ?whatsNew 預覽
  await openWith(current);
  await page.goto(`${url}?whatsNew=1.0.0`);
  await settle();
  check("popup.html?whatsNew=1.0.0：顯示預覽且不動 storage", (await overlayShown()) && (await storageGet()) === current, `storage=${await storageGet()}`);
} finally {
  await browser.close();
}

console.log(failed ? `\n${failed} 項失敗` : "\n全部通過");
process.exit(failed ? 1 : 0);
