// 打包 src/ 成 Chrome / Edge / Firefox 可上傳的 zip，輸出到 dist/。
// 純 Node 實作（原本是 PowerShell，Mac 沒有 pwsh 就用不了），Windows / Mac / Linux 都能跑。
//
// 用法：
//   npm run build                          # Chrome + Edge + Firefox 都打包
//   npm run build -- --browser=chrome      # 只打包 Chrome
//   npm run build -- --browser=edge        # 只打包 Edge
//   npm run build -- --browser=firefox
//
// Edge 是 Chromium 內核，Manifest V3 與 Chrome 完全相容，直接沿用 src/manifest.json，
// 不需要另外一份 manifest.edge.json。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
const ICONS_PROD = path.join(ROOT, "assets", "icons-prod");

// zip 內每個 entry 的時間戳都固定成這個，內容沒變的話每次包出來的 zip bytes 才會完全一樣
// （reproducible build），不然每個 entry 會帶「打包當下」的時間，光時間不同就會讓 bytes 每次都不同。
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1));

const VALID_BROWSERS = ["chrome", "edge", "firefox", "all"];
const browserArg = (process.argv.find((a) => a.startsWith("--browser=")) || "").split("=")[1] || "all";
if (!VALID_BROWSERS.includes(browserArg)) {
  console.error(`未知的 --browser=${browserArg}，可用值：${VALID_BROWSERS.join(", ")}`);
  process.exit(1);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// manifest 的 name 是 __MSG_x__ 這種 i18n 佔位字串（真正文字在 _locales/<default_locale>/messages.json），
// 只是拿來在打包時的終端機輸出顯示好看一點，不影響實際打包內容。
function resolveDisplayName(manifest) {
  const m = /^__MSG_(.+)__$/.exec(manifest.name || "");
  if (!m || !manifest.default_locale) return manifest.name;
  const msgPath = path.join(SRC, "_locales", manifest.default_locale, "messages.json");
  if (!fs.existsSync(msgPath)) return manifest.name;
  const messages = readJson(msgPath);
  return messages[m[1]]?.message || manifest.name;
}

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

async function buildTarget(name, manifestFile) {
  const manifestPath = path.join(SRC, manifestFile);
  const manifest = readJson(manifestPath);
  const version = manifest.version;

  fs.mkdirSync(DIST, { recursive: true });
  const zipPath = path.join(DIST, `bilibili-cdn-switcher-${name}-${version}.zip`);

  const iconsProdFiles = fs.existsSync(ICONS_PROD)
    ? fs.readdirSync(ICONS_PROD).filter((f) => f.endsWith(".png"))
    : [];
  if (!iconsProdFiles.length) {
    console.warn(`找不到 ${ICONS_PROD}，zip 內会是 src/icons/ 目前的图示（可能是开发版）。请先执行 npm run gen-icons。`);
  }

  // 收集要打包的檔案：src/ 底下除了兩份 manifest 以外的全部（manifest 換成 manifest.json 放最上層）；
  // icons/ 有正式版（assets/icons-prod/）的話整批換成正式版
  const entries = new Map(); // zip 內的 posix 相對路徑 -> 來源絕對路徑
  for (const abs of listFilesRecursive(SRC)) {
    const rel = path.relative(SRC, abs).split(path.sep).join("/");
    if (rel === "manifest.json" || rel === "manifest.firefox.json") continue;
    if (rel.startsWith("icons/") && iconsProdFiles.length) continue;
    entries.set(rel, abs);
  }
  entries.set("manifest.json", manifestPath);
  for (const f of iconsProdFiles) entries.set(`icons/${f}`, path.join(ICONS_PROD, f));

  const sortedNames = [...entries.keys()].sort();
  const zip = new JSZip();
  for (const relName of sortedNames) {
    // createFolders:false —— 不然 JSZip 會自動幫 "_locales/en/x.json" 這種路徑補上
    // "_locales/"、"_locales/en/" 這些資料夾 entry，而且時間戳是產生當下的現在時間，
    // 每次包出來的 zip bytes 就會不一樣，reproducible build 就破功了。原本 PowerShell 版本
    // （.NET 的 ZipArchive.CreateEntry）本來就只會建檔案 entry，這裡維持同樣行為。
    zip.file(relName, fs.readFileSync(entries.get(relName)), { date: FIXED_DATE, createFolders: false });
  }
  // platform 明確指定 UNIX：不指定的話 zip 內部的檔案屬性欄位會依執行平台（Windows/Mac）不同，
  // 同樣內容在不同系統打包出來的 bytes 會不一樣，指定死了才能讓 Windows／Mac 包出來的結果一致。
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    platform: "UNIX",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });
  fs.writeFileSync(zipPath, buf);

  console.log(`\n${resolveDisplayName(manifest)} [${name}]  v${version}`);
  for (const relName of sortedNames) {
    const size = fs.statSync(entries.get(relName)).size;
    console.log(`  ${relName.padEnd(24)} ${String(size).padStart(7)} B`);
  }
  console.log(`-> ${zipPath}  (${buf.length} B)\n`);
}

if (browserArg === "all") {
  const chromeVersion = readJson(path.join(SRC, "manifest.json")).version;
  const firefoxVersion = readJson(path.join(SRC, "manifest.firefox.json")).version;
  if (chromeVersion !== firefoxVersion) {
    console.warn(`manifest.json (${chromeVersion}) 与 manifest.firefox.json (${firefoxVersion}) 版本号不一致，请先同步。`);
  }
}

if (browserArg === "chrome" || browserArg === "all") await buildTarget("chrome", "manifest.json");
if (browserArg === "edge" || browserArg === "all") await buildTarget("edge", "manifest.json");
if (browserArg === "firefox" || browserArg === "all") await buildTarget("firefox", "manifest.firefox.json");
