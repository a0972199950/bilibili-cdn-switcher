// 公開網站 https://biboost.app 的檔案：把擴充的贊助頁（src/donate.html 與它用到的 js、語系、圖示）複製到 tools/site/public/，
// 前面加上 tools/site/web-shim.js（用 localStorage 模擬擴充 API）。贊助頁只維護 src/ 那一份。
//   npm run site:build    只產生檔案
//   npm run site:deploy   產生後部署（tools/site/wrangler.toml，網域 biboost.app）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "tools/site/public");
const FILES = ["donate.js", "common.js", "i18n.js", "logo128.png"];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
fs.copyFileSync(path.join(ROOT, "tools/site/web-shim.js"), path.join(OUT, "web-shim.js"));
for (const lang of fs.readdirSync(path.join(SRC, "_locales"))) {
  fs.mkdirSync(path.join(OUT, "_locales", lang), { recursive: true });
  fs.copyFileSync(path.join(SRC, "_locales", lang, "messages.json"), path.join(OUT, "_locales", lang, "messages.json"));
}

let html = fs.readFileSync(path.join(SRC, "donate.html"), "utf8");
// web-shim.js 要在 i18n.js 之前（i18n.js 一載入就要用 chrome.runtime）
const i18nTag = '<script src="i18n.js"></script>';
if (!html.includes(i18nTag)) throw new Error("donate.html 找不到 i18n.js 的 <script>");
html = html.replace(i18nTag, '<script src="/web-shim.js"></script>\n  ' + i18nTag).replace("</title>", '</title>\n  <link rel="icon" href="/logo128.png" />');
// 網址是 /donate（沒有結尾斜線），相對路徑照樣指到根目錄；保險起見加 <base>
html = html.replace("<head>", '<head>\n  <base href="/" />');
fs.writeFileSync(path.join(OUT, "donate.html"), html);

// 首頁先導到贊助頁（之後有官網再換掉）
fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>BiBoost</title>
<meta http-equiv="refresh" content="0; url=/donate"><link rel="canonical" href="https://biboost.app/donate"></head>
<body><a href="/donate">BiBoost</a></body></html>
`);
console.log("site → " + path.relative(ROOT, OUT));
