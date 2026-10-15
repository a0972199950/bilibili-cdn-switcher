// 私人 repo（.git-private）：跟公開 repo 共用同一個工作目錄，只追蹤 PRIVATE_PATHS 底下的檔案，推到 GitHub 的 private repo 備份。
// 公開 repo 的 .gitignore 擋掉這些路徑；私人 repo 也會讀到同一份 .gitignore，所以新檔案要用 add -f 強制加入（這支腳本代勞）。
//
//   npm run private:setup      新電腦：把私人 repo 拉下來、檔案放回原位、設定 `git priv` 指令
//   npm run private:push       備份 + push（pre-push hook、Claude Code SessionEnd hook 會自動跑）
//   npm run private:pull       備份 + pull（post-merge hook，也就是 git pull 之後會自動跑）
//   node scripts/private-repo.mjs backup   只 commit 不 push（post-commit hook 會自動跑）
//   node scripts/private-repo.mjs init     第一次建立私人 repo（建 GitHub private repo、第一個 commit、push），只需要跑一次
//   git priv <任何 git 指令>   直接操作私人 repo，例如 git priv log --stat、git priv status
//
// 注意：不要對私人 repo 跑 `git priv clean`——對它來說公開 repo 的檔案全是「未追蹤檔案」，會被整批刪掉。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GIT_DIR = path.join(ROOT, ".git-private");
const BRANCH = "main";
// 只進私人 repo 的路徑（公開 repo 的 .gitignore 要擋掉同一批）
const PRIVATE_PATHS = [
  ".claude/skills",
  ".claude/settings.local.json",
  "promotions",
  "research",
  "spec",
  "growth-report",
  "cdn-speedtest-results",
  "store",
  // 本機憑證
  ".env.local",
  "tools/report-worker/.dev.vars",
  "tools/cdn-speedtest-app/config.json",
];
// 執行期產物，就算在私人路徑底下也不備份
const JUNK_NAMES = new Set(["__pycache__", ".venv", "node_modules", ".DS_Store", "Thumbs.db", "desktop.ini"]);
const JUNK_EXTS = [".pyc"];
// setup 時本機已有、內容又跟私人 repo 不同的檔案，覆蓋前先搬到這裡
const RESTORE_BACKUP_DIR = ".private-restore-backup";

// 在 git hook 裡執行時，git 會設 GIT_DIR / GIT_INDEX_FILE 等指向公開 repo 的變數，要清掉才不會操作到公開 repo
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|PREFIX)$/.test(k),
  ),
);

function run(cmd, args, { input, allowFail = false, inherit = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: ENV,
    input,
    encoding: "utf8",
    stdio: inherit ? "inherit" : [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.join(" ")} 失敗${inherit ? "" : `：\n${(r.stderr || r.stdout || "").trim()}`}`);
  }
  return r;
}

// 操作私人 repo
const git = (args, opts) => run("git", [`--git-dir=${GIT_DIR}`, `--work-tree=${ROOT}`, ...args], opts);
// 操作公開 repo
const publicGit = (args, opts) => run("git", ["-C", ROOT, ...args], opts);

function defaultUrl() {
  const origin = publicGit(["remote", "get-url", "origin"]).stdout.trim();
  return origin.replace(/(\.git)?$/, "-private.git");
}

function listPrivateFiles() {
  const files = [];
  const walk = (rel) => {
    let st;
    try {
      st = fs.lstatSync(path.join(ROOT, rel));
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(path.join(ROOT, rel))) {
        if (JUNK_NAMES.has(name) || JUNK_EXTS.some((ext) => name.endsWith(ext))) continue;
        walk(`${rel}/${name}`);
      }
    } else if (st.isFile()) {
      files.push(rel);
    }
  };
  PRIVATE_PATHS.forEach(walk);
  return files;
}

function initGitDir(url) {
  run("git", ["init", "--bare", "--quiet", `--initial-branch=${BRANCH}`, GIT_DIR]);
  git(["config", "core.bare", "false"]);
  // 不然 git priv status 會把公開 repo 的幾千個檔案都列成未追蹤
  git(["config", "status.showUntrackedFiles", "no"]);
  git(["remote", "add", "origin", url]);
  configureAlias();
}

function configureAlias() {
  // shell alias 一律在公開 repo 的根目錄執行，所以相對路徑就好
  publicGit(["config", "alias.priv", "!git --git-dir=.git-private --work-tree=."]);
}

// 回傳這次 commit 了幾個檔案的變動（0 = 沒有變動）
function backup() {
  // 已追蹤檔案的修改與刪除（私人 repo 只追蹤私人檔案，所以不用限定路徑）
  git(["add", "--update"]);
  // 新檔案：.gitignore 擋著，要 -f
  const files = listPrivateFiles();
  if (files.length) {
    git(["add", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"], {
      input: files.map((f) => `:(literal)${f}`).join("\0"),
    });
  }
  const changed = git(["diff", "--cached", "--name-only"]).stdout.split("\n").filter(Boolean);
  if (!changed.length) return 0;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  git(["commit", "--quiet", "-m", `backup ${stamp} (${os.hostname()})`]);
  return changed.length;
}

function hasCommits() {
  return git(["rev-parse", "--verify", "--quiet", BRANCH], { allowFail: true }).status === 0;
}

function push() {
  const n = backup();
  if (n) console.log(`私人 repo：已備份 ${n} 個檔案的變動`);
  if (!hasCommits()) return;
  const ahead = git(["rev-list", "--count", `origin/${BRANCH}..${BRANCH}`], { allowFail: true });
  if (ahead.status === 0 && ahead.stdout.trim() === "0") return;
  const r = git(["push", "--quiet", "origin", BRANCH], { allowFail: true });
  if (r.status !== 0) {
    console.warn(`私人 repo：push 失敗，下次會再試。\n${r.stderr.trim()}`);
  }
}

function pull() {
  // 先把本機的變動 commit 起來，merge 才不會蓋掉還沒備份的檔案
  const n = backup();
  if (n) console.log(`私人 repo：已備份 ${n} 個檔案的變動`);
  const r = git(["pull", "--no-rebase", "--no-edit", "--quiet", "origin", BRANCH], { allowFail: true });
  if (r.status !== 0) {
    console.warn(`私人 repo：pull 失敗（可能有衝突），請用 git priv status 檢查後手動處理。\n${r.stderr.trim()}`);
  }
}

// 本機已有、內容跟私人 repo 不同的檔案，先複製到 RESTORE_BACKUP_DIR，回傳搬了幾個
function backupConflictingFiles() {
  const entries = git(["ls-tree", "-r", "-z", BRANCH])
    .stdout.split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split("\t");
      return { sha: meta.split(" ")[2], file };
    })
    .filter(({ file }) => fs.existsSync(path.join(ROOT, file)));
  if (!entries.length) return 0;
  const local = git(["hash-object", "--stdin-paths"], { input: entries.map((e) => e.file).join("\n") + "\n" })
    .stdout.trim()
    .split("\n");
  const conflicts = entries.filter((e, i) => local[i] !== e.sha);
  if (!conflicts.length) return 0;
  const dir = path.join(ROOT, RESTORE_BACKUP_DIR, new Date().toISOString().replace(/[:.]/g, "-"));
  for (const { file } of conflicts) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  console.log(`本機有 ${conflicts.length} 個檔案跟私人 repo 不同，覆蓋前已備份到 ${path.relative(ROOT, dir)}`);
  return conflicts.length;
}

function setup(url = defaultUrl()) {
  if (fs.existsSync(GIT_DIR)) {
    configureAlias();
    console.log("這台電腦已經設定過私人 repo（.git-private），已確認 git priv 指令。要更新請用 npm run private:pull。");
    return;
  }
  console.log(`下載私人 repo：${url}`);
  initGitDir(url);
  try {
    git(["fetch", "origin"], { inherit: true });
  } catch (e) {
    fs.rmSync(GIT_DIR, { recursive: true, force: true });
    throw new Error(`${e.message}\n下載失敗，已還原。請確認有權限讀取這個 repo（gh auth login），或指定網址：node scripts/private-repo.mjs setup <url>`);
  }
  git(["update-ref", `refs/heads/${BRANCH}`, `refs/remotes/origin/${BRANCH}`]);
  git(["branch", "--quiet", `--set-upstream-to=origin/${BRANCH}`, BRANCH]);
  backupConflictingFiles();
  git(["reset", "--hard", "--quiet", BRANCH]);
  const count = git(["ls-files"]).stdout.split("\n").filter(Boolean).length;
  console.log(`完成：已放回 ${count} 個私人檔案。之後 git commit / push / pull 會自動同步私人 repo，也可以用 git priv <指令> 直接操作。`);
}

function init() {
  if (fs.existsSync(GIT_DIR)) throw new Error("已經有 .git-private，不用再 init。");
  const url = defaultUrl();
  const name = url.match(/github\.com[/:](.+?)(\.git)?$/)?.[1];
  if (!name) throw new Error(`看不出 GitHub repo 名稱：${url}`);
  if (run("gh", ["repo", "view", name], { allowFail: true }).status !== 0) {
    run("gh", ["repo", "create", name, "--private", "--description", "bilibili-cdn-switcher 的私人檔案備份"], { inherit: true });
  }
  initGitDir(url);
  const n = backup();
  git(["push", "--quiet", "-u", "origin", BRANCH], { inherit: true });
  console.log(`完成：已建立 ${name}（private）並推上 ${n} 個檔案。`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "setup") setup(args[0]);
  else if (cmd === "init") init();
  else if (["backup", "push", "pull"].includes(cmd)) {
    // 這三個會被 hook 自動呼叫：沒設定私人 repo 的電腦（別人 clone、雲端 session）直接略過
    if (!fs.existsSync(GIT_DIR)) process.exit(0);
    // 從 hook 跑時沒有人能回答帳密提示，與其卡住不如直接失敗
    ENV.GIT_TERMINAL_PROMPT = "0";
    if (cmd === "backup") {
      const n = backup();
      if (n) console.log(`私人 repo：已備份 ${n} 個檔案的變動`);
    } else if (cmd === "push") push();
    else pull();
  } else {
    console.log("用法：node scripts/private-repo.mjs <setup [url] | init | backup | push | pull>");
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`私人 repo：${e.message}`);
  process.exit(1);
}
