// 發版的本機機械步驟（給 /release skill 呼叫）：
//
//   node scripts/release.mjs next <major|minor|patch>   # 印出升版後的版本號（不改任何檔案）
//   node scripts/release.mjs prepare <x.y.z>            # 把 unreleased 搬到新版本底下 + 同步所有版本號
//
// prepare 會做的事：
//   1. src/changelog.json：unreleased 整批搬到 releases 最前面（日期＝今天），unreleased 清空
//   2. src/manifest.json、src/manifest.firefox.json 的 version
//   3. Safari Xcode 工程的 MARKETING_VERSION
// 要先在 release 分支上跑；不會 commit。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT, readChangelog, writeChangelog, validateChangelog, parseVersion, compareVersions
} from "./changelog.mjs";

const MANIFESTS = ["src/manifest.json", "src/manifest.firefox.json"];
const PBXPROJ = "safari/Bilibili CDN Switcher/Bilibili CDN Switcher.xcodeproj/project.pbxproj";

function currentVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "src/manifest.json"), "utf8")).version;
}

export function nextVersion(current, bump) {
  const p = parseVersion(current);
  if (!p) throw new Error(`目前版本號格式不對：${current}`);
  if (bump === "major") return `${p[0] + 1}.0.0`;
  if (bump === "minor") return `${p[0]}.${p[1] + 1}.0`;
  if (bump === "patch") return `${p[0]}.${p[1]}.${p[2] + 1}`;
  throw new Error(`升版類型必須是 major / minor / patch，收到：${bump}`);
}

// 只換掉字串裡的版本號，不重新序列化 JSON，免得動到原本的縮排／換行
function replaceInFile(rel, re, replacement) {
  const file = path.join(ROOT, rel);
  const before = fs.readFileSync(file, "utf8");
  const after = before.replace(re, replacement);
  if (after === before) throw new Error(`${rel}：找不到可以換掉的版本號（或已經是新版本）`);
  fs.writeFileSync(file, after);
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function prepare(version) {
  if (!parseVersion(version)) throw new Error(`版本號必須是 x.y.z：${version}`);
  const current = currentVersion();
  if (compareVersions(version, current) <= 0) throw new Error(`新版本 ${version} 必須大於目前版本 ${current}`);

  const log = readChangelog();
  const errors = validateChangelog(log);
  if (errors.length) throw new Error("changelog.json 格式有誤：\n" + errors.map((e) => `  - ${e}`).join("\n"));
  if (!log.unreleased.length) throw new Error("unreleased 是空的，沒有東西可以發版。先把新功能／修正記到 src/changelog.json。");

  log.releases.unshift({ version, date: today(), entries: log.unreleased });
  log.unreleased = [];
  writeChangelog(log);

  for (const rel of MANIFESTS) replaceInFile(rel, /("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
  if (fs.existsSync(path.join(ROOT, PBXPROJ))) replaceInFile(PBXPROJ, /MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);

  console.log(`✔ ${current} → ${version}：changelog 已整理、manifest 與 Safari 工程版本號已同步`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === "next") console.log(nextVersion(currentVersion(), arg));
    else if (cmd === "prepare") prepare(arg);
    else throw new Error("用法：node scripts/release.mjs next <major|minor|patch> | prepare <x.y.z>");
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
