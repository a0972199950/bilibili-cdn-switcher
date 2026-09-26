// 用 xcodebuild 打包 Safari 擴充（macOS / iOS），把產物 .app 匯出到 dist/。
// macOS-only：xcodebuild 只在裝了 Xcode 的 Mac 上能跑。
//
// Xcode 工程 (safari/Bilibili CDN Switcher/) 是 `xcrun safari-web-extension-converter`
// 產生的，裡面的擴充資源用相對路徑 ../../../src/ 直接引用倉庫的 src/，
// 所以這裡不需要同步／複製檔案，xcodebuild 會直接抓 src/ 最新內容進 .appex。
//
// 用法：
//   npm run build:safari                       # macOS，Release，ad-hoc 簽章，輸出到 dist/
//   npm run build:safari -- --platform=ios     # 改打包 iOS（產物是 .app，需真機/模擬器才能跑）
//   npm run build:safari -- --configuration=Debug
//
// 注意：這裡是 ad-hoc 簽章（CODE_SIGN_IDENTITY="-"），產物僅供本機測試。
// 要上架 App Store 仍需在 Xcode 用你的 Apple Developer 帳號 Archive → 上傳，
// 這步無法純命令列在沒有簽章憑證的情況下完成。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
const PROJECT = path.join(ROOT, "safari", "Bilibili CDN Switcher", "Bilibili CDN Switcher.xcodeproj");
// derivedData 放在 safari/Bilibili CDN Switcher/build，對應 .gitignore 的 safari/*/build/
const DERIVED = path.join(ROOT, "safari", "Bilibili CDN Switcher", "build");

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

const platform = arg("platform", "macos").toLowerCase();
const configuration = arg("configuration", "Release");

if (!["macos", "ios"].includes(platform)) {
  console.error(`未知的 --platform=${platform}，可用值：macos, ios`);
  process.exit(1);
}
if (!["Release", "Debug"].includes(configuration)) {
  console.error(`未知的 --configuration=${configuration}，可用值：Release, Debug`);
  process.exit(1);
}

const scheme = platform === "ios" ? "Bilibili CDN Switcher (iOS)" : "Bilibili CDN Switcher (macOS)";
const sdk = platform === "ios" ? "iphoneos" : "macosx";
const version = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8")).version;

if (!fs.existsSync(PROJECT)) {
  console.error(`找不到 Xcode 工程：${PROJECT}`);
  process.exit(1);
}

console.log(`\n🔨 xcodebuild  scheme="${scheme}"  configuration=${configuration}  v${version}\n`);

// ad-hoc 簽章（"-"）＋關閉需要 provisioning profile 的檢查，讓沒有開發者憑證也能build出本機可跑的 .app。
// MARKETING_VERSION 用 manifest 的版本覆蓋，讓 .app 內部版本跟擴充版本一致（Xcode 工程預設寫死 1.0）。
const buildArgs = [
  "-project", PROJECT,
  "-scheme", scheme,
  "-configuration", configuration,
  "-sdk", sdk,
  "-derivedDataPath", DERIVED,
  `MARKETING_VERSION=${version}`,
  "CODE_SIGN_IDENTITY=-",
  "CODE_SIGN_STYLE=Manual",
  "DEVELOPMENT_TEAM=",
  "PROVISIONING_PROFILE_SPECIFIER=",
  "build",
];

try {
  execFileSync("xcodebuild", buildArgs, { stdio: "inherit" });
} catch (e) {
  console.error("\n❌ xcodebuild 失敗。常見原因：未安裝 Xcode（只有 Command Line Tools 不夠），或簽章設定衝突。");
  process.exit(1);
}

// 產物：build/Build/Products/<Configuration>[-iphoneos]/Bilibili CDN Switcher.app
const productDirName = platform === "ios" ? `${configuration}-iphoneos` : configuration;
const appName = "Bilibili CDN Switcher.app";
const builtApp = path.join(DERIVED, "Build", "Products", productDirName, appName);

if (!fs.existsSync(builtApp)) {
  console.error(`\n❌ build 完成但找不到產物：${builtApp}`);
  process.exit(1);
}

fs.mkdirSync(DIST, { recursive: true });
const outApp = path.join(DIST, `Bilibili CDN Switcher (${platform}).app`);
fs.rmSync(outApp, { recursive: true, force: true });
fs.cpSync(builtApp, outApp, { recursive: true });

// 不打 zip：這個 .app 只是本機測試用（雙擊安裝），上架 App Store 走 Xcode Archive，
// 兩者都不需要 zip。要跨機器搬運再自己 `ditto -c -k --keepParent <.app> <name>.zip` 即可。

console.log(`\n✅ 完成`);
console.log(`   .app  -> ${outApp}`);
console.log(`\n本機測試：雙擊上面的 .app，再到 Safari > 設定 > 擴充功能 啟用。`);
console.log(`上架 App Store：用 Xcode 開啟工程 → Product > Archive → Distribute App（需 Apple Developer 帳號簽章）。`);
