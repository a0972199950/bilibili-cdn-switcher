// 產生擴充圖示：粉色圓角底 + 白色雙向箭頭（線路切換）。
// 純 Node 實作（原本用 Windows 專屬的 System.Drawing，Mac 沒辦法跑），畫法改成先組 SVG 字串，
// 再用 sharp（跨平台，capture-screenshots.mjs 也在用）點陣化＋縮放。
// 同時產生兩份：
//   src/icons/           開發版（多一個紅色圓點角標），Load unpacked 時讀到的就是這份，方便跟已安裝的正式版分辨
//   assets/icons-prod/    正式版（無角標），build.mjs 打包 zip 時會換成這份
// 用法：node scripts/gen-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEV_OUT_DIR = path.join(ROOT, "src", "icons");
const PROD_OUT_DIR = path.join(ROOT, "assets", "icons-prod");

const S = 512;

// 對應原本 PowerShell 版 New-Arrow：一個細長矩形（箭身）接一個比矩形寬的三角形（箭頭），
// tailX/tipX 是箭身尾端／箭頭尖端的 x，cy 是垂直中心，t 是箭身厚度，hh 是箭頭三角形的半高，hl 是箭頭長度。
function arrowPoints(tailX, tipX, cy, t, hh, hl) {
  const dir = tipX > tailX ? 1 : -1;
  const neck = tipX - dir * hl;
  return [
    [tailX, cy - t / 2],
    [neck, cy - t / 2],
    [neck, cy - hh],
    [tipX, cy],
    [neck, cy + hh],
    [neck, cy + t / 2],
    [tailX, cy + t / 2]
  ]
    .map((p) => p.join(","))
    .join(" ");
}

const TOP_ARROW = arrowPoints(92, 420, 166, 52, 84, 100);
const BOT_ARROW = arrowPoints(420, 92, 346, 52, 84, 100);

function buildIconSvg(isDev) {
  const badgeR = 92;
  const badgeCx = S - badgeR - 16;
  const badgeCy = badgeR + 16;
  const badge = isDev
    ? `<circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="rgb(220,20,20)" stroke="white" stroke-width="16" />`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${S}" y2="${S}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="rgb(255,138,176)" />
      <stop offset="100%" stop-color="rgb(235,90,140)" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${S}" height="${S}" rx="112" ry="112" fill="url(#bg)" />
  <g transform="translate(0,9)" fill="rgb(120,20,55)" fill-opacity="0.18">
    <polygon points="${TOP_ARROW}" />
    <polygon points="${BOT_ARROW}" />
  </g>
  <g fill="white">
    <polygon points="${TOP_ARROW}" />
    <polygon points="${BOT_ARROW}" />
  </g>
  ${badge}
</svg>`;
}

async function renderMaster(isDev) {
  return sharp(Buffer.from(buildIconSvg(isDev))).png().toBuffer();
}

async function saveIconSet(masterBuf, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const size of [16, 32, 48, 128]) {
    const buf = await sharp(masterBuf)
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    const name = `icon${size}.png`;
    fs.writeFileSync(path.join(outDir, name), buf);
    rows.push({ Name: name, Length: buf.length });
  }
  return rows;
}

const prodMasterBuf = await renderMaster(false);
const devMasterBuf = await renderMaster(true);

const devRows = await saveIconSet(devMasterBuf, DEV_OUT_DIR);
const prodRows = await saveIconSet(prodMasterBuf, PROD_OUT_DIR);

// 512 母檔（正式版，無角標）留在 assets/，不進 src/（不需要打包進擴充）
fs.writeFileSync(path.join(ROOT, "assets", "icon-master.png"), prodMasterBuf);

function printTable(title, rows) {
  console.log(`\n${title}`);
  for (const r of rows) console.log(`  ${r.Name.padEnd(12)} ${r.Length}`);
}
printTable("開發版（含角標，src/icons/ 平常載入未封裝用的就是這份）：", devRows);
printTable("正式版（無角標，build.mjs 打包 zip 時會換成這份）：", prodRows);
