// 更新紀錄（src/changelog.json）的驗證與 pre-push 檢查。
//
// changelog.json 結構：
//   unreleased: [entry]                       ← 尚未上架的新功能清單
//   releases:   [{version, date, entries}]    ← 已上架：該版本相較於上一版新增的清單（新 → 舊）
//   entry:      {type: "feature" | "fix", text: {zh_TW, zh_CN, en}}
//
// 用法：
//   node scripts/changelog.mjs validate                          # 驗證格式
//   node scripts/changelog.mjs check-push <ref> <sha> <remote_ref> <remote_sha>
//       ↑ 給 .githooks/pre-push 呼叫。exit code：0 通過／10 清單沒有變動（hook 會互動詢問）／1 清單格式錯誤
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const CHANGELOG_REL = "src/changelog.json";
export const CHANGELOG_PATH = path.join(ROOT, CHANGELOG_REL);
export const LANGS = ["zh_TW", "zh_CN", "en"];
export const ENTRY_TYPES = ["feature", "fix"];

const EXIT_UNCHANGED = 10;
const ZERO_SHA = /^0+$/;

export function readChangelog(file = CHANGELOG_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeChangelog(data, file = CHANGELOG_PATH) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function validateEntry(entry, where, errors) {
  if (!entry || typeof entry !== "object") { errors.push(`${where}: 不是物件`); return; }
  if (!ENTRY_TYPES.includes(entry.type)) errors.push(`${where}: type 必須是 ${ENTRY_TYPES.join(" / ")}`);
  for (const lang of LANGS) {
    const s = entry.text && entry.text[lang];
    if (typeof s !== "string" || !s.trim()) errors.push(`${where}: 缺少 text.${lang}`);
  }
}

// 回傳錯誤訊息陣列，空陣列代表格式正確
export function validateChangelog(data) {
  const errors = [];
  if (!data || typeof data !== "object") return ["最外層必須是物件"];
  if (!Array.isArray(data.unreleased)) errors.push("unreleased 必須是陣列");
  else data.unreleased.forEach((e, i) => validateEntry(e, `unreleased[${i}]`, errors));
  if (!Array.isArray(data.releases)) { errors.push("releases 必須是陣列"); return errors; }
  let prev = null;
  data.releases.forEach((r, i) => {
    const where = `releases[${i}]`;
    if (!r || !parseVersion(r.version)) { errors.push(`${where}: version 必須是 x.y.z`); return; }
    if (prev && compareVersions(prev, r.version) <= 0) errors.push(`${where}: 版本必須由新到舊排列且不重複（${prev} → ${r.version}）`);
    prev = r.version;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) errors.push(`${where}: date 必須是 YYYY-MM-DD`);
    if (!Array.isArray(r.entries)) errors.push(`${where}: entries 必須是陣列`);
    else r.entries.forEach((e, j) => validateEntry(e, `${where}.entries[${j}]`, errors));
  });
  return errors;
}

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts }).trim();
}
function gitOrNull(args) {
  try { return git(args); } catch { return null; }
}

// 找出「分支從哪裡分出來」的基準 commit：與主線（origin/HEAD → origin/master → origin/main → master → main）的 merge-base。
// 回傳 null 代表這次 push 沒有相對主線的新 commit（例如只是把已合併的分支再推一次），不需要檢查。
function findBaseCommit(localSha, remoteSha) {
  const candidates = [];
  const originHead = gitOrNull(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (originHead) candidates.push(originHead);
  candidates.push("origin/master", "origin/main", "master", "main");
  for (const ref of candidates) {
    if (!gitOrNull(["rev-parse", "--verify", "--quiet", ref])) continue;
    const mb = gitOrNull(["merge-base", localSha, ref]);
    if (!mb) continue;
    return mb === localSha ? null : mb;
  }
  // 找不到主線（例如全新的 repo）：退回遠端目前的 commit；遠端也沒有就沒有基準可比
  if (remoteSha && !ZERO_SHA.test(remoteSha) && gitOrNull(["cat-file", "-e", remoteSha])) return remoteSha;
  return null;
}

function checkPush([localRef, localSha, , remoteSha]) {
  if (!localRef || !localRef.startsWith("refs/heads/")) return 0; // tag 等其他 ref 不檢查
  if (!localSha || ZERO_SHA.test(localSha)) return 0; // 刪除遠端分支
  const base = findBaseCommit(localSha, remoteSha);
  if (!base) return 0;

  const changedFiles = git(["diff", "--name-only", base, localSha]).split("\n").filter(Boolean);
  if (!changedFiles.length) return 0;

  if (changedFiles.includes(CHANGELOG_REL)) {
    const errors = validateChangelog(readChangelogAt(localSha));
    if (errors.length) {
      console.error(`✖ ${CHANGELOG_REL} 格式有誤：\n` + errors.map((e) => `  - ${e}`).join("\n"));
      return 1;
    }
    return 0;
  }
  console.error(`相較於 ${base.slice(0, 8)}（分支出來的基準），這次 push 改了 ${changedFiles.length} 個檔案，但 ${CHANGELOG_REL} 沒有任何變動。`);
  return EXIT_UNCHANGED;
}

// 驗證「要被 push 的那個 commit」裡的 changelog，而不是工作目錄裡可能還沒 commit 的版本
function readChangelogAt(sha) {
  return JSON.parse(git(["show", `${sha}:${CHANGELOG_REL}`], { maxBuffer: 16 * 1024 * 1024 }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "validate") {
    const errors = validateChangelog(readChangelog());
    if (errors.length) { console.error(errors.map((e) => `- ${e}`).join("\n")); process.exit(1); }
    console.log(`${CHANGELOG_REL} OK`);
  } else if (cmd === "check-push") {
    process.exit(checkPush(rest));
  } else {
    console.error("用法：node scripts/changelog.mjs validate | check-push <ref> <sha> <remote_ref> <remote_sha>");
    process.exit(1);
  }
}
