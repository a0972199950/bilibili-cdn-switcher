<div align="center">

# 🎬 B 站 CDN 線路重排

**語言 / Language：** 繁體中文（本頁）｜[简体中文](docs/README.zh-CN.md)｜[English](docs/README.en.md)

### 讓 🇹🇼 台灣 / 🇸🇬 新加坡 用戶看網頁版 B 站更順的 Chrome / Firefox / Edge / Safari 擴充

### 📥 [Chrome Web Store](https://chromewebstore.google.com/detail/dfaddcffoondcendifiljhdbdagebgch?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=zhtw) ｜ [Firefox Add-ons](https://addons.mozilla.org/addon/bilibili-cdn-switcher?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=zhtw) ｜ [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/dllallgilijcacpdemjafegibdafcbdp?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=zhtw) ｜ Safari（App Store，即將上架）

</div>

---

![Extension popup settings](./docs/main.png)
---

Before
![alt text](./docs/before.png)

After
![Player debug overlay](./docs/after.png)

## ✨ 這個擴充在做什麼

**🎯 主要是為了讓 🇹🇼 台灣／🇸🇬 新加坡 的使用者看網頁版 B 站（www.bilibili.com）更順。**

B 站預設分配的取流節點對台灣、新加坡使用者常常繞路、不夠快。這個擴充會**把影片的取流 CDN 重排、換成一個對 TW/SG 較快的最優節點**，讓緩衝與載入更順。

| 功能 | 說明 |
|:--|:--|
| 🚀 **TW/SG 最優節點** | 預設換成對台/星最快的 CDN，開箱即用 |
| 🌐 **其他 CDN 節點** | 阿里雲／騰訊雲／華為雲／Akamai／各海外節點…，依所在地區自由比較切換 |
| ✏️ **自行輸入** | 跟「清單選擇」互斥的另一個模式，可填任意 CDN host |
| 🛑 **關閉** | 影片／直播各有獨立的「關閉」選項：不介入 CDN 選線、完全維持 B 站官方原始邏輯 |
| 📺 **直播支援** | 「直播」分頁可在 國際線路(ov)／國際備用線路(ov-b)／中國線路(cn)／中國備用線路(cn-b) 之間切換，不整頁重載；進入直播間播放後才會顯示各線路的實際網址，當前直播沒有的線路會標註並變淡（仍可選）。直播線路不佳時，「失敗自動切換」會自動退回國際線路(ov)（只針對該直播間，不改變你長期的選擇） |
| 🔁 **失敗自動切換** | 偵測到目前 CDN 分段請求失敗、或播放持續卡住（非單純緩衝已滿），先靜默切換到 B 站原生給的備援節點（顯示提示、不整頁刷新）；備援也不行時彈出提示，讓你自行決定是否切到「備用URL」。可在彈出視窗的「失敗自動切換」開關關閉（預設開啟）；網路本身不穩時建議關閉 |
| 📶 **各節點測速** | 獨立頁面（影片、直播各一個），顯示影片標題／畫質，實測當前影片、當前畫質下各節點的下載速度並逐一列出，測速中也能重新測；不影響你手動選擇的 CDN，離開該頁即中止 |
| 🌏 **多語系介面** | 依瀏覽器語言自動顯示繁體中文／简体中文／English，涵蓋 popup、頁面提示與 debug 疊層 |
| 🐛 **debug 疊層** | 查看當前 CDN 節點（預設關閉，可在右上角齒輪的進階設定中打開） |
| 🦊 **Chrome / Firefox / Edge / Safari 四平台** | 同一份 `src/`，打包時依瀏覽器各自產生 zip（Edge 是 Chromium 內核，直接沿用 Chrome 的 manifest）；Safari 另用 Xcode 包成 `.app`（見下方「打包 Safari」） |

---

## 🗂️ 專案結構

```text
bilibili-cdn-switcher/
├── src/                  ← 擴充本體（載入未封裝 / 打包的就是這層）
│   ├── manifest.json          ← Chrome / Edge 用
│   ├── manifest.firefox.json  ← Firefox 用（含 browser_specific_settings）
│   ├── popup.html / popup.js
│   ├── main-hook.js      ← MAIN world：改寫取流 URL
│   ├── bridge.js         ← ISOLATED world：storage / i18n ↔ 頁面 橋接
│   ├── cdn-list.json     ← 節點清單
│   ├── _locales/{zh_TW,zh_CN,en}/  ← 三語系文案（manifest 用 __MSG_x__ 引用；popup.js／main-hook.js 執行期查表）
│   └── icons/            ← 16 / 32 / 48 / 128
├── dist/                 ← 打包產物（Chrome/Firefox/Edge 是 .zip；Safari 是 .app）
├── docs/                 ← README 用的截圖 + 简体中文／English README
├── assets/               ← 圖示母檔 512px（icons-prod 由 gen-icons.mjs 產生）
├── store/                ← 各商店上架用截圖 / 宣傳圖 + 各平台三語系介紹文字
├── safari/               ← Safari 擴充的 Xcode 工程（safari-web-extension-converter 產生，內含擴充資源用相對路徑直接引用 ../../../src/）
├── scripts/              ← 所有開發／打包腳本，純 Node，Windows／Mac／Linux 都能跑
│   ├── build.mjs                 ← 打包成上架用 zip（Chrome + Firefox + Edge）
│   ├── build-safari.mjs          ← 用 Xcode 打包 Safari 擴充成 .app（macOS-only）
│   ├── changelog.mjs             ← 驗證 src/changelog.json；pre-push hook 用它檢查清單有沒有更新
│   ├── release.mjs               ← 發版機械步驟（升版號、把 unreleased 搬進新版本）
│   ├── publish-stores.mjs        ← 用 API 金鑰上傳新版 zip 到 Chrome / Edge / Firefox（不會按發布）
│   ├── test-whats-new.mjs        ← 用真的 Chrome 測「更新內容」popup
│   ├── gen-icons.mjs             ← 重新產生圖示
│   └── capture-screenshots.mjs   ← 自動開瀏覽器截三語系商店截圖（見下）
├── package.json           ← scripts/*.mjs 用的 Node 依賴（jszip / puppeteer / sharp）
├── .env.local.example     ← 截圖用登入 cookie 的範例（複製成 .env.local 再填，見下）
└── README.md
```

所有 `scripts/` 底下的工具都是純 Node（配 [jszip](https://npm.im/jszip) 打包 zip、[sharp](https://npm.im/sharp) 處理圖片），
不依賴 Windows 專屬的 PowerShell／System.Drawing，Mac／Linux 一樣能跑，只要先 `npm install` 裝好依賴即可。

### 📦 打包（上架 Chrome Web Store / Firefox Add-ons / Microsoft Edge Add-ons 用）

這個專案不需要編譯／transpile，`src/` 底下就是可直接 `Load unpacked` 的原始碼；「打包」只是把它壓成上架用的 zip，
**沒有自動化（例如 push 前自動打包）**，要更新 `dist/` 得自己手動跑一次：

```bash
npm install                          # 第一次執行，或 node_modules 被清掉時才需要
npm run build                        # 預設：Chrome + Firefox + Edge 都打包
npm run build -- --browser=chrome     # 只打包 Chrome
npm run build -- --browser=firefox    # 只打包 Firefox
npm run build -- --browser=edge       # 只打包 Edge
```

Chrome／Edge 用同一份 `src/manifest.json`（Edge 是 Chromium 內核，Manifest V3 與 Chrome 完全相容，
不需要另外的 manifest），Firefox 用 `src/manifest.firefox.json`。會讀對應 manifest 的 `version`，
把 `src/` **底下的內容**（manifest 換成 `manifest.json` 放在 zip 最上層）壓成
`dist/bilibili-cdn-switcher-<browser>-<版本>.zip`。Chrome／Firefox 兩份 manifest 的 `version`
要保持一致，不一致時腳本會跳警告（Edge 沿用 Chrome 的 manifest，版本必然一致，不用另外檢查）。

打包結果是可重現的（reproducible build）：只要 `src/` 內容沒變，同一個瀏覽器目標每次包出來的
zip bytes 完全相同（跨 Windows／Mac 也一樣），方便日後要接 CI 時判斷 `dist/` 是否真的需要更新。

### 📝 更新紀錄與發版

- `src/changelog.json` 同時記「尚未上架的新功能（`unreleased`）」與「各已上架版本相較前一版追加的內容（`releases`）」，三語（zh_TW / zh_CN / en）。
  老使用者更新後第一次開設定選單，會看到一次性的「更新內容」popup（內容就來自這份檔案；打包進 zip 時會自動拿掉 `unreleased`）。
- `.githooks/pre-push`：push 時若相較於分支出來的基準 `src/changelog.json` 沒有變動，會詢問是否仍要 push，選 No 就擋下。
  `npm install` 會自動設定 `core.hooksPath`（或手動 `git config core.hooksPath .githooks`）。確定不需要記錄時：`CHANGELOG_CHECK_IGNORE=1 git push`。
- 發版用 Claude Code 的 `/release`（`.claude/skills/release/SKILL.md`）；上架金鑰放 `.env.local`（見 `.env.local.example`）。商店的「發布」按鈕一律人工按。
- `npm run test:whats-new`：用 puppeteer 的 Chrome 載入 `src/`，自動測更新提示 popup。

### 🍎 打包 Safari（上架 App Store 用）

Safari 擴充不能像 Chrome 那樣直接載入 zip，必須包成一個「內含擴充的 App」（macOS 是 `.app`、iOS 是 `.ipa`），
透過 App Store 分發。`safari/` 底下就是 `xcrun safari-web-extension-converter` 產生的 Xcode 工程，裡面用相對路徑
（`../../../src/`）直接引用倉庫的 `src/`，所以**改 `src/` 不需要同步任何檔案**，重新打包就會帶到最新內容；換到任何一台
Mac clone 整個倉庫都能跑（工程裡沒有寫死的絕對路徑）。

**需求**：一台裝了完整 Xcode 的 Mac（只有 Command Line Tools 不夠）。

```bash
npm run build:safari                       # macOS，Release，ad-hoc 簽章 → dist/
npm run build:safari -- --platform=ios     # 改打包 iOS
npm run build:safari -- --configuration=Debug
```

腳本會呼叫 `xcodebuild`，並把 `MARKETING_VERSION` 覆蓋成 `src/manifest.json` 的 `version`（讓 .app 內部版本跟擴充一致，
Xcode 工程預設寫死 1.0），產出兩個東西：

- `dist/Bilibili CDN Switcher (<平台>).app` —— 可直接雙擊安裝／測試的 App
- `dist/bilibili-cdn-switcher-safari-<平台>-<版本>.zip` —— 對齊其他平台的 `bilibili-cdn-switcher-<平台>-<版本>` 命名規範，方便傳給別台機器

⚠️ 這裡是 **ad-hoc 簽章，只供本機測試**。真正上架 App Store 仍需在 Xcode 開啟 `safari/` 裡的工程 →
Product > Archive > Distribute App，用你的 Apple Developer 帳號簽章上傳（這步需要簽章憑證，無法純命令列完成）。

### 🎨 重新產生圖示

```bash
npm run gen-icons
```

以 512px 母檔縮出 16/32/48/128，同時產生兩份：`src/icons/`（開發版，帶紅點角標，`Load unpacked` 平常讀到的就是這份，方便跟已安裝的正式版分辨）與 `assets/icons-prod/`（正式版，無角標）。`scripts/build.mjs` 打包 zip 時會自動把圖示換成 `assets/icons-prod/` 底下的正式版。

### 📸 產生商店截圖（三語系 main / debug / speedtest，共 9 張 1280x800 png）

```bash
npm run capture-screenshots                      # 預設 1280x800（Chrome 商店固定要這尺寸）
npm run capture-screenshots -- --size=2560x1600  # Mac App Store 用的高解析版；檔名帶尺寸，另存一套不覆蓋 1280x800
```

用 Puppeteer 載入 unpacked 的 `src/`，依序切 `en-US`／`zh-CN`／`zh-TW` 三個瀏覽器語系，實際打開一支
bilibili 影片頁（網址寫在 `scripts/capture-screenshots.mjs` 開頭的 `VIDEO_URL`，要換片直接改那行），
分別截 popup 主畫面、頁面上的 debug 疊層、測速中的畫面，等比縮放＋黑邊填成 1280x800，輸出到 `store/`
覆蓋同名檔案（`screenshot-<畫面>-<語系>-1280x800.png`）。因為要連真實 bilibili 影片頁測速，跑一輪約
數分鐘，且吃網路狀況。

**登入 cookie（選用，決定截圖畫質）**：未登入時 B 站只給約 480P，截圖裡的 `qn` 就會是 480P。
想要高畫質截圖的話，把 `.env.local.example` 複製成 `.env.local`，填入自己的 `BILI_COOKIE`
（登入 B 站 → DevTools → Network → 任一請求 → Request Headers → 複製整段 Cookie）。
腳本有讀到就帶登入狀態開影片頁，沒有這個檔就照舊用未登入狀態跑，其餘流程完全一樣。
`.env.local` 已列入 `.gitignore`，**裡面的 `SESSDATA` 等同帳號憑證，不要 commit 或外傳**。

---

## 🎛️ UI 說明

| 選項 | 行為 |
|:--|:--|
| ⚙️ **進階設定（右上角齒輪）** | 「失敗自動切換」與「顯示頁面 debug 疊層」兩個開關收在這裡（各附白話說明），開啟 debug 疊層時同一區會顯示目前分頁的 debug 資訊；主頁標題顯示擴充在當前語系的正式名稱，「⭐ 給我 5 星鼓勵」與「🐛 問題回報」是主頁最下方的兩顆按鈕 |
| 🔘 **啟用** | 預設 **開啟** 的總開關，同時管影片與直播；關閉後完全不改動 B 站取流（debug 疊層仍會顯示當前 CDN） |
| 🎞️ **影片／直播分頁** | 「啟用」下面分成「影片」「直播」兩個分頁；目前分頁是直播間時，打開會自動停在「直播」 |
| 📡 **CDN 線路** | 「清單選擇」／「自行輸入」／「關閉」互斥單選。**預設＝清單選擇，第一項＝ bilivideo（TW/SG 最快）**，其餘為各家節點、最後一項是「備用URL」；切到「自行輸入」會出現輸入框，自行填 host；「關閉」只作用於一般影片，不介入影片 CDN 選線 |
| 📺 **直播線路** | 「偏好選擇」／「關閉」二選一，**預設＝偏好選擇，國際線路(ov)**。四個線路是同一個直播間、同一集群號下的 `ov`／`ov-b`／`cn`／`cn-b` 變體（B 站直播的簽名只在同號之間通用，點播那些節點對直播無效）；記住的是「線路種類」而非具體 host |
| 📺 **測試各直播線路速度** | 只有在直播間播放時才能測；先檢查四條線路是否都存在（不存在的不測），再對每條線路測兩項：**切台卡頓**（連測 3 次取平均的起播時間，0–800ms 低／800–1500ms 中／超過 1500ms 高，分別以綠／黃／紅字顯示）與**持續觀看**（拉 8 秒，完全跟上＝綠字「優秀」、掉隊 1 秒內＝黃字「中等」、超過 1 秒＝紅字「差勁」）。測速會與正在播放的直播搶頻寬 |
| 🔍 **測試各節點速度** | 按下後切到獨立的測速頁面，上方顯示目前影片標題與畫質；抓「當前影片、當前畫質」的分段，依序換各節點 host 實測下載速度（8MB 或 5 秒先到為準，5 秒內完全沒收到資料才算超時；有收到但不到 8MB 就顯示實際測到的速度），逐格顯示「等待中／測試中／結果」，可按「🔄 重新測速」重跑（測速中也能按，會中斷目前的重新開始）。**只顯示數字，不會更動你目前選擇的 CDN**；按左上角「← 返回」或關掉 popup 會立即中止測速。開啟「啟用」時，playurl 一解析完就能測，不用等真的開始播放；若「啟用」是關閉的，則要等實際下載過分段才有樣本 |
| 🔁 **失敗自動切換 CDN** | 預設開啟，可在進階設定關閉（網路本身不穩、如 WiFi 訊號弱時建議關閉，避免頻繁黑屏重載）；開啟時偵測到分段請求失敗（403/404/5xx/網路錯誤）或播放確實卡住（8 秒內進度不動、且線路上也沒有資料在動），先靜默切到 B 站原生給的備援節點（分段層即時差替、不整頁刷新，並跳出提示）；這個備援也播不動時，改彈出一個不會自動消失的提示，讓你自己決定要不要「重載並切換至備用URL」。直播間則是：先檢查你選的線路在這個直播是否存在（不存在就直接退回國際線路 ov），之後持續一段時間沒有碼流也退回 ov |
| 🌏 **語言** | 沒有手動切換選項，跟隨瀏覽器／作業系統語言自動顯示繁體中文／简体中文／English（其餘語言預設顯示繁體中文）；如需強制指定，可調整瀏覽器的語言偏好順序 |
| ⏱️ **測速門檻** | 在進階設定中，分「影片」「直播」兩區：影片是每個節點最多下載幾 MB／最多測幾秒（預設 8MB／5 秒，先到為準）；直播是切台卡頓測幾次取平均／持續觀看每條線路測幾秒（預設 3 次／8 秒）。調整後永久儲存，各區有「恢復預設」 |
| 🔢 **節點按測速排序** | 在進階設定中；預設 **關閉**。開啟後，測速時每測完一個節點就以平移動畫排到「由快到慢」的位置（影片看下載速度；直播先看持續觀看等級，同級再比切台卡頓）。排出的順序存在本機，主畫面的節點清單也照這個順序，直到下次重新測速；關閉即恢復預設順序 |
| 🐛 **顯示頁面 debug 疊層** | 在進階設定中；預設 **關閉**；獨立於重排開關，關閉重排時仍可顯示當前 CDN，方便比較 |

<details>
<summary>🔍 <b>Debug 疊層長什麼樣</b>（播放器左上角）</summary>

```text
CDN 線路
mode=on  target=cn-jxnc-cmcc-bcache-06.bilivideo.com
cdn=<當前實際串流的 host>
v=<video 主用 host>  a=<audio 主用 host>
src=playinfo|playurl  rw=<改寫次數>  seg=<分段差替數>  qn=<畫質>
```

</details>

---

## 🗂️ 設定與檔案

- 📋 節點清單放在 **`src/cdn-list.json`** —— 要新增／調整節點，改這個檔即可，於擴充頁「重新整理」後生效。
- 🧩 每個項目格式：

  ```json
  { "value": "upos-sz-mirrorhw.bilivideo.com", "name": "hw", "noteKey": "cdnNoteHuaweiHybrid" }
  ```

  `value` 特殊值：🔁 `backup`＝優先備用URL（這個特殊選項用 `nameKey` 代替 `name`）。「關閉」不在清單裡，是 popup 獨立的一個模式（存成 `videoEnabled=false`）。
  `noteKey` 對應到 `src/_locales/{zh_TW,zh_CN,en}/messages.json` 裡的訊息鍵，讓備註文字跟著語言切換；
  只是想快速加一個節點又不想動三份語系檔的話，也可以直接寫 `"note": "自訂備註"`（不會多語系，但能動）。
  「自行輸入」是 popup 裡獨立的互斥選項，不算在這份清單裡。

---

## ⚠️ 注意

- 🔒 一律保留原 host 為 `backupUrl` fallback，避免個別 host-bound URL 整段播不出。
- 📍 最優節點為 TW/SG 最佳化；其他地區使用者可自行切換到較近的節點，或切到「自行輸入」模式填自己的 host。
- 📶 「測試各節點速度」是短時間實測單一分段，結果僅供參考：CDN 是否已對這支影片、這個畫質建立快取，
  以及路由在不同時段的壅塞狀況都會影響實際觀看體驗，測速當下最快不代表長時間播放最順。

---

## 📜 授權 License

原始碼公開，採自訂的 **[Source-Available License](LICENSE)**：

- ✅ 可以查看、Fork、修改原始碼，個人使用、教學／研究等非商業用途皆可自由進行
- ❌ 不可將本專案或修改版重新包裝成競爭性的瀏覽器擴充／App／服務並對外發佈上架，也不可移除版權聲明
- 完整條款請見 [LICENSE](LICENSE)；商業合作或例外授權需求歡迎開 issue 聯絡

隱私權政策：[PRIVACY.md](PRIVACY.md)

---

<div align="center">

Made with ❤️ for 🇹🇼 / 🇸🇬 bilibili viewers · 靈感致謝 [@roge4444](https://github.com/roge4444) 的 [PiliNaraRogerMod](https://github.com/roge4444/PiliNaraRogerMod) ／ [blblRogerMod](https://github.com/roge4444/blblRogerMod)

</div>
