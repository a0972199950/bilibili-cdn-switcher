---
name: release
description: 發版流程：選 major/minor/patch、建立 release/x.y.z 分支、把 src/changelog.json 的 unreleased 搬進新版本、更新各商店介紹、打包並用 API 金鑰上傳 Chrome/Edge/Firefox（發布鈕由使用者人工按）、push 分支並合併回 master。使用者說「發版」「release」「上架新版本」或輸入 /release 時使用。
disable-model-invocation: true
---

# /release

把 `unreleased` 的功能發成新版本。**每一步失敗就停下來回報，不要硬往下走**；最後的商店「發布」按鈕**永遠由使用者人工按**，不得代按。

commit message 不得加 AI 共同作者（見 `agent.md`，優先於工具預設署名）。

## 0. 前置檢查

1. `git branch --show-current` 必須是 `master`，`git status --short` 必須乾淨（`research/`、`spec/`、`.playwright-mcp/` 這類與發版無關的未追蹤檔可忽略，但要告訴使用者）。不乾淨就停下來問。
2. `git pull --ff-only`。
3. `npm run changelog:validate`。
4. 讀 `src/changelog.json` 的 `unreleased`。**是空的就停止**：沒有東西可以發版。

## 1. 決定版本號

把 `unreleased` 條目列給使用者看，用 AskUserQuestion 問升 **major / minor / patch**。
依內容給建議並標 (Recommended)：有 `feature` → minor；只有 `fix` → patch；major 只在不相容的大改動時。
`node scripts/release.mjs next <major|minor|patch>` 會印出升版後的版本號，選項說明裡直接寫出 `1.5.1 → 1.6.0` 這種結果。

## 2. 建 release 分支並整理版本

```sh
git switch -c release/<x.y.z>
node scripts/release.mjs prepare <x.y.z>
```

`prepare` 會：把 `unreleased` 整批搬到 `releases` 最前面（日期＝今天）、清空 `unreleased`、同步 `manifest.json`／`manifest.firefox.json`／Safari 工程的版本號。

## 3. 更新各商店的擴充介紹

只改**會影響使用者是否想裝／怎麼用**的內容，依照本版 `entries` 調整 `store/description-<chrome|edge|firefox|safari>-<zhtw|zhcn|en>.md`（共 12 份，四個平台、三語系）裡「■ 主要功能／Key features」那一節：

- **要納入**：主要的新功能（使用者會覺得「哦這個有用」的）。寫成跟既有條目一樣的口吻與格式（`・名稱 — 說明`），三語都要。
- **不要納入**：bug 修正、效能微調、對使用者沒用的功能（例如做了捐款功能並附上排行榜，排行榜對使用者無用，介紹就不講）。
- 如果本版只有修正／不值得宣傳的東西，**介紹不用動**，並告訴使用者「這版不需要改介紹」。
- 既有功能被改名、移除、行為改變時，同步修掉介紹裡過時的描述。
- 各平台差異（系統需求、平台專屬段落）保持原樣，只動功能清單。Safari 的介紹也一併改，保持四個平台的功能清單一致。
- 如果功能清單相同的內容也出現在 `README.md`、`docs/README.en.md`、`docs/README.zh-CN.md`，一起同步。
- 動到簡短描述（Short description）時，注意不要比原本更長（各商店有字數上限）。

改完把介紹的變動摘要給使用者看（不用貼整份檔案）。

## 4. 打包、驗證、commit

```sh
npm run build
npm run test:whats-new
```

- `dist/` 有追蹤 zip，慣例是只保留最新兩個版本：刪掉比「上一版」更舊的 `dist/bilibili-cdn-switcher-*-<舊版>.zip`。
- `test:whats-new` 會用真的 Chrome 測更新提示 popup，必須全過。
- `git add -A` 只加與發版有關的檔案（changelog、manifest、Safari 工程、store/、README、dist/），然後 commit：`release: v<x.y.z>`（本文可簡述這版的功能，不要加 AI 共同作者）。

## 5. 上傳各瀏覽器商店（用金鑰，只到草稿）

先 `npm run publish-stores -- --dry-run` 確認會做什麼；缺 `.env.local` 金鑰（見 `.env.local.example`）就告訴使用者缺哪些，並問要不要略過那一家。然後：

```sh
npm run publish-stores -- --browser=all
```

- Chrome、Edge：只會把 zip 上傳到**草稿**。
- Firefox（AMO）沒有草稿：預設只上傳＋驗證；**建立 version 就等於送審**，所以必須先問使用者，同意後才跑 `npm run publish-stores -- --browser=firefox --submit-firefox`（會一併帶各語言 release notes 與簡介）。
- 任何一家上傳失敗：停在這裡回報，**不要** push／merge（修好後可以重跑這一步）。

商店 API **不能**修改 Chrome／Edge 的上架文案與圖片（Edge 官方文件明列「無法更新 metadata」，Chrome API 也沒有此能力）。如實告訴使用者：這兩家要到後台貼上 `store/description-<browser>-*.md` 的各語言介紹、確認 `store/*.png` 圖片，再自己按發布。

## 6. push 分支並合併回 master

```sh
git push -u origin release/<x.y.z>
git switch master
git merge --no-ff release/<x.y.z> -m "Merge release/<x.y.z>"
git push origin master
```

pre-push hook 會檢查 `src/changelog.json`，這個 release 分支有改它，會直接通過。

## 7. 收尾提醒（列給使用者）

- 到 Chrome Web Store／Edge Partner Center 確認草稿與各語言介紹，**自己按發布**；Firefox 等 Mozilla 審核。
- Safari 不在自動化範圍：版本號已同步，要上 App Store 仍需在 Xcode 調 build number 後 Archive（見 README「打包 Safari」）。
- 一句話總結這次發了什麼版本、哪些步驟有跳過。
