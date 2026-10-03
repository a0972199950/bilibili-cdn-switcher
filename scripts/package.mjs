// 發版用的完整打包：先跑一次 npm run build（dist/ 帶版本號的商店上傳 zip），
// 再打包發版產物到 release/（不進版控；/release skill 會把整個資料夾上傳到該版本的 GitHub Release）：
//   bilibili-cdn-switcher-chrome.zip    Chrome 離線安裝（解壓縮後在 chrome://extensions 開「開發人員模式」→「載入未封裝項目」）
//   bilibili-cdn-switcher-edge.zip      Edge 離線安裝（同上，edge://extensions）
//   bilibili-cdn-switcher-firefox.zip   Firefox（未經 Mozilla 簽署：只能在 about:debugging「載入暫時附加元件」，重開瀏覽器就消失）
//   CDNSpeedTest.exe                    CDN 測速工具（Windows）
// 檔名不帶版本號，只分瀏覽器：教學文件用 releases/latest/download/<檔名> 下載，換版也不會失效。
//
// 用法：
//   npm run package                 # 全部（exe 只能在 Windows 打包）
//   npm run package -- --skip-exe   # 只打包擴充（例如在 Mac 上）
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "release");
const skipExe = process.argv.includes("--skip-exe");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\n✘ 失敗：${cmd} ${args.join(" ")}`);
    process.exit(r.status || 1);
  }
}

if (!skipExe && process.platform !== "win32") {
  console.error("CDNSpeedTest.exe 只能在 Windows 打包；在其他系統請加 --skip-exe（並到 Windows 上補打包 exe）。");
  process.exit(1);
}

// 1. 商店上傳用（dist/，檔名帶版本）
run(process.execPath, [path.join(ROOT, "scripts", "build.mjs")]);

// 2. release/：先清空，避免上一版留下的檔案被一起上傳
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
run(process.execPath, [path.join(ROOT, "scripts", "build.mjs"), "--out=release", "--plain"]);
if (!skipExe) {
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                     path.join(ROOT, "tools", "cdn-speedtest-app", "build.ps1")]);
}

console.log("\nrelease/");
for (const f of fs.readdirSync(OUT).sort()) {
  const size = fs.statSync(path.join(OUT, f)).size;
  console.log(`  ${f.padEnd(36)} ${(size / 1024).toFixed(0).padStart(7)} KB`);
}
