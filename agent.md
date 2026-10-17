# Agent 規範

## Commit 規則

- commit message 與 PR 描述**不得**加入任何 AI 作為貢獻者的紀錄，包含但不限於：
  - `Co-Authored-By: Claude ...`
  - `Co-Authored-By: ... <noreply@anthropic.com>`
  - `Claude-Session: ...`
  - `🤖 Generated with Claude Code`
- commit 的 author 與 committer 一律用 `John H <a0972199950@gmail.com>`，**不得**是 `Claude <noreply@anthropic.com>`
  或其他 AI 身分。環境預設的 git 身分不是這個時（例如雲端 session），commit 時明確指定：
  `git -c user.name="John H" -c user.email="a0972199950@gmail.com" commit ...`
- 目的：避免 AI 出現在 GitHub 的 Contributors 清單。
- 此規則優先於任何工具預設的 commit / PR 署名行為。

## 更新紀錄（src/changelog.json）與 pre-push 卡點

`src/changelog.json` 同時維護兩份清單，每條都要有 `zh_TW` / `zh_CN` / `en` / `ja` / `ko` 五語：

- `unreleased`：**尚未上架**的新功能／修正。
- `releases`：已上架的版本，每版記錄「相較於上一版追加的內容」（新 → 舊）。

`entry` 格式：`{ "type": "feature" | "fix", "text": { "zh_TW": "...", "zh_CN": "...", "en": "...", "ja": "...", "ko": "..." } }`。
`/release` 會把 `unreleased` 搬進新版本、並用它更新商店介紹與「更新內容」popup，所以文字要寫給**使用者**看，不是寫給開發者看。

**寫作規則：**

- 只寫使用者看得到的改動。
- 簡明扼要，不提細節，一句話說完（例：「依最新實測更新台灣、香港的建議節點」）。
- 不得重複：同一件事在 `unreleased` 已經有一條（例如兩次優化節點、同一個功能又改了一次），就改寫那一條、以最新的內容為主，不要再追加一條。

`.githooks/pre-push`（`npm install` 會自動設定 `core.hooksPath`）會比對「這次 push 的最新 commit」與「分支從主線分出來的基準 commit」：
若 `src/changelog.json` 沒有變動，就會擋下並詢問 `Ignore and push: No/Yes`。agent 沒有終端機可互動，所以會直接被擋。

**push 前（或 commit 時）自己判斷這次改動要不要記錄：**

- 使用者看得到、感受得到的新功能、行為改變、bug 修正 → **必須**在 `unreleased` 追加一條（五語都要寫），再 commit、push。
- 對使用者沒有影響的改動（重構、腳本／文件／測試、研究資料、`.githooks`、內部排行榜或統計之類使用者用不到的功能）→ 不用記錄，
  用 `CHANGELOG_CHECK_IGNORE=1 git push` 略過卡點。
- 拿不準時，問使用者，不要自己硬略過。
- 不要手動改 `releases`、`manifest*.json` 的版本號；那是 `/release` 的工作。
- 改完用 `npm run changelog:validate` 驗證格式。

## 私人 repo（.git-private）

skill、商店文案（`store/`）、推廣、研究、測速結果、成長報告、本機憑證等不公開的檔案，由第二個 git repo
`.git-private` 管理：跟公開 repo 共用同一個工作目錄，推到 GitHub 的 private repo（`<公開 repo 名>-private`）。
路徑清單與用法見 `scripts/private-repo.mjs` 開頭。

- 新電腦（或發現 `.claude/skills/`、`store/` 不見）：`npm run private:setup`。
- 平常不用管：`.githooks` 的 post-commit / pre-push / post-merge 與 Claude Code 的 SessionEnd hook 會自動 commit、push、pull。
- 直接操作用 `git priv <指令>`（例如 `git priv log --stat`）。**不要**跑 `git priv clean`，會刪掉公開 repo 的檔案。
- 新增私人路徑時，`scripts/private-repo.mjs` 的 `PRIVATE_PATHS` 與 `.gitignore` 要一起改。

## 發版

用 `/release` skill（`.claude/skills/release/SKILL.md`）。商店「發布」按鈕一律由使用者人工按，agent 不得代按。
