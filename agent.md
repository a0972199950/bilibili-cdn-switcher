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

`.githooks/pre-push`（`npm install` 會自動設定 `core.hooksPath`）會比對「這次 push 的最新 commit」與「分支從主線分出來的基準 commit」：
若 `src/changelog.json` 沒有變動，就會擋下並詢問 `Ignore and push: No/Yes`。agent 沒有終端機可互動，所以會直接被擋。

**push 前（或 commit 時）自己判斷這次改動要不要記錄：**

- 使用者看得到、感受得到的新功能、行為改變、bug 修正 → **必須**在 `unreleased` 追加一條（五語都要寫），再 commit、push。
- 對使用者沒有影響的改動（重構、腳本／文件／測試、研究資料、`.githooks`、內部排行榜或統計之類使用者用不到的功能）→ 不用記錄，
  用 `CHANGELOG_CHECK_IGNORE=1 git push` 略過卡點。
- 拿不準時，問使用者，不要自己硬略過。
- 不要手動改 `releases`、`manifest*.json` 的版本號；那是 `/release` 的工作。
- 改完用 `npm run changelog:validate` 驗證格式。

## 發版

用 `/release` skill（`.claude/skills/release/SKILL.md`）。商店「發布」按鈕一律由使用者人工按，agent 不得代按。
