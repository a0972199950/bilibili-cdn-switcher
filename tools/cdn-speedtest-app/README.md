# Bilibili CDN 測速（GUI 版，給海外朋友用）

雙擊 `CDNSpeedTest.exe`，流程：

1. **入口**：選語言（繁中／簡中／英文／日文／韓文，預設依 Windows 介面語言）；閱讀英文隱私聲明；下方是「擴充功能【名稱】線上應用程式商店」與 Chrome ∙ Firefox ∙ Edge 三個商店連結（名稱用該語言的商店名稱，擴充沒有的語言用英文）；**勾選同意才能下一步**；「開發者測試模式」給作者自己用。按下一步時送出使用紀錄（見下方「使用紀錄」）。
2. **測速目的**（兩個選項）：
   - 「單純測試／建立擴充『自訂節點列表』」（預設）：網路檢查只做參考，不限網速與 VPN（想建立自己列表的人網路環境往往比較複雜，常常過不了門禁）。
   - **進行中的抽獎**（見下方「抽獎公告」）：有的話在「參加抽獎」選項下方用 HTML 顯示，不管選哪個都看得到；有抽獎時就不再顯示 `gift_cards` 的禮物卡說明。
   - 「參加抽獎」：選了才出現禮物卡說明（依國家，`config.json` 的 `gift_cards`）、email 與**必中獎邀請碼**（選填）。按「驗證」或直接按「下一步」時，透過 Apps Script 到 Neon 檢查「邀請碼 + email」是否相符且未被作廢；成功顯示綠框（按下一步直接前進），失敗顯示原因並留在本頁，再按一次「下一步」就**當作沒填邀請碼**繼續。改了 email 或邀請碼，先前的驗證結果就作廢。
3. **網路檢查**（約 40 秒）：測總頻寬並偵測 VPN／代理。**參加抽獎時，下載速度 ≥ `min_down_mbps`（預設 50 Mbps）且沒有 VPN 才能下一步**，否則顯示原因、「重新檢查」，並提示「只是想建立自訂節點列表的話，按上一步改選單純測試就不受限制」。單純測試時只顯示警告，仍可繼續。測試模式下結果僅供參考、仍可繼續。從下一頁返回時沿用上次的結果，不重測。
   - 量得到頻寬就顯示「預計本次測試約需 N 分鐘，結束之前請不要關閉視窗」，測速頁的說明也用同一個數字。
   - N 的算法（`estimate_minutes`）：耗時主要取決於並行數（大部分時間花在等逾時的節點），所以先預測並行數，算法與測速相同：`下載頻寬 × 0.5 ÷ B 站單一連線速度`，限制在 1–8。B 站單一連線速度由 `probe_per_conn` 對 08ct／08c／hw 各下載 8MB 取中位數（約 5–20 秒），**最多算 60 Mbps**（`speedtest.PER_CONN_CAP`＝B 站 8K 串流碼率上限，正式測速決定並行數時也套用；量不到時直接用上限）。再用實測校正的 `7 + 105 ÷ 並行數` 換成分鐘（並行 4 → 29 分、3 → 43 分、2／1 → 69–80 分），1.6.0 起再乘 1.25（細測改成快篩通過且冷門探測沒回 403 的全部節點，不再只取前 80 名；尚未用實測校正），取 5 的倍數、限制在 20–150 分。
   - 頻寬：Cloudflare 測速；被限流（429）或連不上時改用回應最快的 Linode 公開測速檔。50 Mbps 的理由：最快的 B 站節點單連線約 50–80 Mbps，總頻寬低於此值時好節點都會撞到同一個天花板，排名失去意義（台灣 VPN 測試即為此情況）。
   - VPN：任一訊號成立即擋下 —— ip-api（VPN／代理、非行動網路的機房 IP）、proxycheck.io（VPN／代理）、本機預設路由走 VPN 網卡（WireGuard、OpenVPN、TAP/Wintun、Windows 內建 PPTP/L2TP/IKEv2、常見 VPN 客戶端）、電腦時區與 IP 所在地時區差 ≥ 2 小時。
   - 限制：路由器層級、且從家用／公司線路出口的 VPN（例如回家的 PPTP），若時區相同，任何方法都偵測不到。
4. **B 站 App 掃 QR code 登入**（必要，沒有略過選項：付費測試要以 1080P 以上測準；登入狀態在測速時失效會直接中止，不會降級成 480P）。cookie 只留在記憶體，不寫檔、不上傳。
5. **測速**（約 35–140 分鐘，有進度條、「停止並關閉」）。國家依出口 IP 自動偵測；系統 DNS 不代表當地時自動改用 Google DoH 並帶使用者出口 IP 的 /24 當 ECS。
   - **測試模式**：不實際測速，5 秒假進度，產生標示 TEST 的假報告；後續發送、寄信、試算表都會照常跑（主旨與試算表會標 TEST），用來驗證整條流程。
6. **確認發送**：顯示摘要（含 email、參加方式、要加入自訂節點列表的 10 個節點）。下方勾選「將建議節點加入擴充的自訂節點列表」（預設勾）與要加入的瀏覽器 Chrome／Firefox／Edge（預設只勾 Chrome；取消上層選項時瀏覽器停用、按鈕改成「發送」）。按「**發送並建立自訂列表**」才會傳；有勾上層卻沒選任何瀏覽器時，先問「你沒有選擇瀏覽器，此次結果不會更新自訂列表。確定發送嗎？」。上傳成功後把節點寫進勾選的瀏覽器裡的擴充（見下方）。
7. **感謝頁**：參加抽獎時顯示「接下來」（確認信已寄到 xxx…，依抽獎／必中獎不同）；單純測試不顯示這個框。
   - 勾選的瀏覽器都建立成功：不另外提示。
   - 有瀏覽器還沒裝（或版本太舊）：列出該瀏覽器與狀態，各附「安裝」（或「更新」）按鈕開該瀏覽器的商店頁；框的中間是「建立自訂列表」按鈕，裝好後按下會只對還沒成功的瀏覽器重試。
   - **按「關閉」（或視窗 ✕）時才刪除本機的結果資料夾**（只刪已上傳的；按「不發送」或上傳失敗則保留）。

按鈕位置：每頁最主要的動作（下一步、發送、關閉）在右下角，其他次要按鈕（上一步、重新檢查、停止並關閉、開啟報告資料夾、不發送、建立自訂列表）在左下角。

## 建立擴充的「自訂節點列表」

瀏覽器不讓外部程式直接寫擴充的 storage，所以 exe 用裝了擴充的瀏覽器開這個網址，由擴充自己寫入（`extdetect.py`）：

```
https://www.bilibili.com/#cdnsw-import=1.<host>,<host>,…
```

- **節點**：`summary.json` 的 `custom_list`（`speedtest.custom_list()`）：預設節點排第一，之後依 第一梯隊 → 可用 → 不穩定 → 差 往下取，**同一個池（集群）最多 2 個**，寧可往後多收其他池也要湊滿 10 個，某個池整個掛掉時還有別的池可以切。
- **只處理勾選的瀏覽器**（Chrome／Firefox／Edge，`extdetect.BROWSERS`），每個瀏覽器各自偵測、各自開匯入網址。
- **偵測有沒有裝**：Chrome／Edge 讀各設定檔的 `Preferences`、`Secure Preferences`（`extensions.settings`，商店 ID `dfaddcffoondcendifiljhdbdagebgch`、`dllallgilijcacpdemjafegibdafcbdp`；停用中的不算），Firefox 讀設定檔的 `extensions.json`。開發者載入的未封裝版（路徑裡有 `bridge.js`、`main-hook.js`、`cdn-list.json`）也算。
- **版本**：商店版要 ≥ `extdetect.MIN_VERSION`（**1.7.0**，第一個有匯入功能的版本；擴充實際發布的版本號不同的話要改這裡）。比較舊的當作「版本太舊」，提示更新。
- **開啟方式**：Chromium 系用該瀏覽器執行檔加 `--profile-directory=<設定檔>`（裝在哪個設定檔就開在哪個）；Firefox 用 `-new-tab`（預設設定檔）。執行檔位置查登錄檔 App Paths。
- **擴充端**：`bridge.js`（B 站頁面頂層 frame）讀到 hash 就清掉網址上的 hash，交給 `background.js`；background **只收 `cdn-list.json` 裡有的節點**（網址任何網站都能做出來，這樣別人沒辦法藉此把影片導到自己的網域），已在列表裡的不重複加，新的接在原本列表後面；使用者已經選了「自訂節點列表」但列表原本是空的，就直接改用第一個。頁面上方會跳出結果提示。

## 抽獎公告（Neon）

「測速目的」頁顯示進行中的抽獎，內容是 HTML，存在 Neon 的 `lotteries`（各語言一份）。exe 透過 Apps Script（`action: "lotteries"`）讀取，用 [tkinterweb](https://github.com/Andereoo/TkinterWeb) 內嵌顯示：支援常見的 HTML／CSS（標題、粗體、顏色、清單、連結），**不跑 JavaScript**，連結會用瀏覽器開；高度跟著內容，最高約 220px，超過就捲動。讀不到或沒有進行中的抽獎時，照舊顯示 `gift_cards` 的禮物卡說明。

```bash
# 資料夾裡放 zh-TW.html、zh-CN.html、en.html、ja.html、ko.html（至少一個；缺的語言依序退回 en、zh-TW）
npm run lottery:add -- scripts/lottery-example --start 2026-10-01 --end 2026-10-31 --title 十月抽獎
npm run lottery:show          # 全部抽獎與狀態（進行中／未開始／已結束／提前結束）
npm run lottery:end -- 3      # 提前結束第 3 個（資料保留）
```

- 日期是台灣時間，`--end` 當天整天都算。期間重疊時**只顯示最新開始的那一個**（開始時間相同取後新增的）；較舊的等新的結束後才會再出現。`lottery:show` 會標出「進行中（顯示中）」與「進行中（被較新的蓋過）」。
- Apps Script 會快取 5 分鐘：新增或結束後，exe 最多 5 分鐘後才看得到。
- 範例在 `scripts/lottery-example/`（五種語言，獎品寫「等值美金 15 元的禮物卡」）。HTML 不用寫 `<html>`、`<body>`，字型與底色 exe 會自己套。
- PowerShell 會吃掉 `--`，讓 npm 誤把 `--start` 當成自己的參數；在 PowerShell 請直接用 `node scripts/lottery.mjs add …`（或改用 cmd／Git Bash 跑 npm）。

## 使用紀錄

同意隱私聲明後，exe 會在下列時機送一筆紀錄到 Apps Script（`action: "log"`），寫進 Neon 的 `app_events`：

| type | 時機 | email |
|---|---|---|
| `install` | 這台電腦第一次按過入口頁的下一步（`%LOCALAPPDATA%\CDNSpeedTest\install.json` 不存在時） | |
| `run` | 每次開程式、按過入口頁的下一步（一次） | |
| `free`／`lottery`／`guaranteed` | 開始測速時，依測速目的（純測速／抽獎／必中抽獎） | 抽獎才有 |
| `test_done` | 測速完成 | 抽獎才有 |
| `send` | 報告上傳成功 | 抽獎才有 |
| `custom_list` | 成功用瀏覽器開啟匯入網址（更新自訂節點列表） | 抽獎才有 |

每筆含國家（ipinfo，網路檢查拿到的優先）、時間、App 版本、語言、`install.json` 裡的隨機 ID（統計人數用，跟身分無關）、測試模式旗標。送失敗就算了，不影響流程。為了隱私，**按下入口頁的下一步（同意隱私聲明）之前不送**，所以只開了程式就關掉的不會記到。

```bash
npm run events:show        # 最近 30 天各國各類事件次數（不含測試模式）＋最近 30 筆；第一次執行會建立資料表
npm run events:show -- 7   # 最近 7 天
```

Apps Script 端限流：同一個 install_id 每 10 分鐘 30 筆、全部合計 1000 筆（`EVENT_RATE`／`EVENT_RATE_ALL`）。

測速核心在 `core/`（從 `.claude/skills/cdn-speedtest` 複製出來，**與 skill 各自維護、互不影響**；打包時一起包進 exe）。記錄內容：出口 IP、國家、城市、ISP、網路類型（有線／Wi-Fi／疑似行動網路，含 Wi-Fi 規格與訊號，不含 SSID）、總頻寬（Cloudflare）、B 站節點測速結果、語言、App 版本、email（選填）。

## 檔案

| 檔案 | 用途 |
|---|---|
| `app.py` | GUI（tkinter）七個頁面 |
| `i18n.py` | 五種語言的介面文字；隱私聲明（英文） |
| `qrlogin.py` | B 站網頁版 QR code 登入 |
| `extdetect.py` | 找出裝了擴充的瀏覽器／設定檔，開匯入網址建立「自訂節點列表」；各瀏覽器的商店網址 |
| `apps-script/Code.gs` | 報告接收端：寄信給你（附件）、存雲端硬碟、寫試算表、寄確認信給測試者 |
| `config.example.json` | 設定範本；實際的 `config.json` 不進版控 |
| `build.ps1` | 建 `.venv`、裝 PyInstaller / qrcode / Pillow / tkinterweb（抽獎公告的 HTML 元件，連同 Tkhtml 一起打包）、打包成 `<repo>\release\CDNSpeedTest.exe`（視窗 icon 用正式版 `assets/icons-prod/icon128.png`，exe 檔案 icon 用 `assets/icon-master.png`；`src/icons` 是開發版，右上有紅點） |

## config.json

```jsonc
{
  "upload_url": "https://script.google.com/macros/s/<部署 ID>/exec",
  "token": "<與 Apps Script 指令碼屬性 TOKEN 相同>",
  "extension_url": "Chrome 線上應用程式商店連結（入口頁與隱私聲明用）",
  "support_url": "隱私聲明裡「要求刪除資料」的聯絡頁",
  "gift_cards": {
    "default": { "vendor": "", "amount": "" },   // 沒有該國設定時用這個
    "JP": { "vendor": "Amazon.co.jp", "amount": "¥1,500" }
    // 國家代碼 = ipinfo 的兩字母代碼；vendor / amount 都空 → 顯示「一張禮物卡（品牌與金額之後以 email 通知）」
  }
}
```

改了 `config.json` 要重新打包才會生效（它被包進 exe）。

## Apps Script（接收端）

**第一次部署**

1. <https://script.google.com/> → 新專案 → 貼上 `apps-script/Code.gs`。
2. 專案設定 → 指令碼屬性 → 新增 `TOKEN` = `config.json` 的 `token`。
3. 編輯器選 `testSend` → 執行 → 授權（Gmail 寄信、雲端硬碟、試算表）。執行紀錄會印出試算表網址；你會收到一封報告信與一封確認信（寄給自己，模擬測試者）。
4. 部署 → 新增部署作業 → 網頁應用程式（執行身分：我；存取權：所有人）→ 網址填進 `config.json` 的 `upload_url`。

**更新 Code.gs 之後（例如這次新增試算表與確認信）**

1. 貼上新版 `Code.gs` → 儲存。
2. 執行一次 `testSend`：新功能需要**試算表**權限，會再跳一次授權；同時自動建立試算表「CDN SpeedTest Log」（ID 存在指令碼屬性 `SHEET_ID`）。
3. 部署 → 管理部署作業 → 編輯（鉛筆）→ 版本「新版本」→ 部署。**網址不變**，exe 不用重新打包。
4. 想先看確認信長怎樣：在編輯器執行 `previewConfirm`，會把五種語言 × 抽獎／必中獎的確認信各寄一封給你自己（不寫試算表、不計入每日上限）。

## 必中獎邀請碼（Neon）

不需要自架伺服器：exe 呼叫 Apps Script（`action: "verify_invite"`），Apps Script 再用 `UrlFetchApp` 打 Neon 的 HTTP SQL 端點（`https://api.<region>.neon.tech/sql`，header 帶連線字串）。

**設定（一次）**

1. Neon 主控台 → 專案 → **Connect** → 複製 Postgres 連線字串（`postgresql://…`）。
2. 專案根目錄的 `.env.local` 加一行 `DATABASE_URL=<連線字串>`（見 `.env.local.example`）。第一次執行任何 `invite:*` 腳本時會自動建立資料表 `invite_codes`。
3. Apps Script 專案設定 → 指令碼屬性 → 新增 `NEON_URL` = 同一個連線字串。
4. 編輯器執行 `testNeon` → 授權「連線到外部服務」→ 執行紀錄顯示「Neon 連線正常：邀請碼 N 組」。
5. 部署 → 管理部署作業 → 編輯 → 版本「新版本」→ 部署（網址不變）。

**管理邀請碼**（在本機終端機，直接連 Neon；Apps Script 只讀取狀態、記錄使用次數，不能新增或作廢）

```bash
npm run invite:create -- a@x.com b@y.com     # 每個 email 產生一組 8 碼（不含 0/O/1/I）並印出；同一個 email 可以有多組
npm run invite:delete -- K7QM3XPA H4RT9WCE   # 標記為已失效（不刪資料，紀錄保留）
npm run invite:show                          # email、邀請碼、有效／已失效、最後驗證、報告數、最後一份報告
```

想手動查看或修改，也可以用 Neon 主控台的 Tables／SQL Editor（`invite_codes`：`code`、`email`、`created_at`、`revoked_at`、`last_verified_at`、`report_count`、`last_report_id`、`last_report_at`）。

**規則**

- 邀請碼和 email 相符（email 不分大小寫；邀請碼比對時去掉空白、`-` 並轉大寫）、且 `revoked_at` 是空的，就是有效。
- 有效期間可以**無限次**驗證、送報告（你自己拿來測試也可以）；驗證和送報告都不會讓它失效。確定發出獎品後，用 `invite:delete` 標記失效。
- 報告送出時，Apps Script 會**再驗證一次**（以伺服器為準），正式報告會累計 `report_count` 並記下 `last_report_id`；測試模式只驗證、不累計。
- 防暴力猜碼：同一個 email 每 10 分鐘最多 10 次、全部合計 60 次（`INVITE_RATE`／`INVITE_RATE_ALL`）。
- 驗證失敗（不符、已失效、Neon 連不上）時，測試者仍可繼續，以一般抽獎參加。

## 打包

```powershell
npm run package        # 擴充三個瀏覽器的離線安裝 zip ＋ CDNSpeedTest.exe，全部放到 <repo>\release\
powershell -ExecutionPolicy Bypass -File tools\cdn-speedtest-app\build.ps1   # 只打包 exe（同樣輸出到 release\）
```

產出 `release\CDNSpeedTest.exe`（約 20 MB）。`release/` 不進版控，`npm run package` 每次會先清空它。exe 執行中無法覆寫，要先關掉。

## 發布到 GitHub Release

不用另外發：擴充每次發版（`/release`）都會把 `release/` 整包上傳到該版本的 GitHub Release，所以**每個 Release 都有 exe**，Latest 永遠下載得到。

**附件檔名固定為 `CDNSpeedTest.exe`**：教學文件（lazy-cv `/docs/bilibili-cdn-speedtest`）用的下載連結是
`https://github.com/a0972199950/bilibili-cdn-switcher/releases/latest/download/CDNSpeedTest.exe`，檔名一改就會失效。

只改了 exe、想在擴充沒發版時更新：重新 `npm run package`（或只跑 `build.ps1`）後，覆蓋到目前的 Latest：

```bash
gh release upload v<目前版本> release/CDNSpeedTest.exe --clobber
```

- 公開 Release 任何人都下載得到；exe 內含 `upload_url` 與 `token`，可被拆出（最壞是被亂送報告、受每日確認信上限保護）。不想公開可只把 exe 私下傳給朋友。
- 發布新版時同步更新 `app.py` 的 `APP_VERSION`。

## 發給朋友前要說明

- Windows 可能跳出「Windows 已保護您的電腦」（沒有程式碼簽章）→ **其他資訊 → 仍要執行**。少數防毒軟體會誤判 PyInstaller 打包的程式。
- 一定要有 B 站帳號（用手機 App 掃碼登入），沒有帳號無法參加。
- 請關閉 VPN／代理，用當地網路（手機漫遊通常從母國出口，不準）。
- 約 35–140 分鐘（網路檢查通過後會顯示預估），期間盡量不要看影片或下載；視窗不要關。
- 報告存在朋友電腦的 `文件\CDN-SpeedTest\<國家>-<時間>\`，上傳成功並關閉視窗後會自動刪除；傳送失敗時可請朋友手動傳資料夾。
- 想把測出來的節點用在擴充裡：先裝好擴充（1.7.0 以上）再按發送；沒裝的話感謝頁不要關，裝好後按「建立自訂列表」。

## 開發

```bash
tools/cdn-speedtest-app/.venv/Scripts/python.exe tools/cdn-speedtest-app/app.py
CDNST_SMOKE=1 tools/cdn-speedtest-app/.venv/Scripts/python.exe tools/cdn-speedtest-app/app.py   # 實測但只用 8 個節點、2 支影片
```


## 命令列版（除錯、特殊網路環境）

`core/speedtest.py` 就是 exe 用的測速程式，也能直接在命令列跑：只用 Python 標準函式庫，Windows、macOS、Linux 都可以。適合 exe 不方便的情況，例如用 Mac、要手動指定 DNS 或並行數、把流量導進 VPN 測試。原本的 `/cdn-speedtest` 技能已移除，改用這個。

```bash
python tools/cdn-speedtest-app/core/speedtest.py detect               # 出口國家、DNS 解析器是否在當地、登入狀態
python tools/cdn-speedtest-app/core/speedtest.py all <國家> [選項]     # 全流程；中斷後原指令再跑一次會續跑
python tools/cdn-speedtest-app/core/speedtest.py <步驟> <國家>         # env、pool、pick、ceiling、stage1、probe、stage2、report 單獨執行
```

- 結果寫到 `<目前目錄>/cdn-speedtest-results/<國家>-<YYYYMMDD-HHMM>/`（`--out` 可改），格式與 exe 相同。
- **命令列版不會寄信**，報告不會經過 `/collect-speedtest-mail`。要納入 `/analyze-cdn`，請改用 exe 發送；或手動把 `REPORT.md`、`summary.json` 改名成 `<國家>-<yyyyMMdd-HHmm>-<8 碼編號>-REPORT.md`／`-summary.json`，放進 `cdn-speedtest-results/<國家>/<同名資料夾>/`。
- 登入：讀環境變數 `BILI_COOKIE`，否則讀目前目錄的 `.env.local`（`BILI_COOKIE=...` 一行）。cookie 不要印出或貼到任何地方。
- 常用選項：`--dns doh`（Google DoH，帶自己出口 IP 的 ECS）、`--dns <IP>`（改用指定 DNS 解析節點）、`--conc N`（並行數）、`--budget 秒數`（跑到時間就停，exit 3，再跑一次續跑）、`--ignore-country-mismatch`、`--ignore-dns-mismatch`；試跑用 `--quick --limit-nodes N --limit-videos N`。
- Exit code：0 完成、3 未完成（再跑一次續跑）、4 未登入、5 出口國家與指定不符（疑似 VPN／漫遊）、6 DNS 解析器與所在地不一致、2 參數或前置步驟錯誤。

### DNS 陷阱（實際踩過）

2026-10-02 在新加坡經 VPN 模擬台灣時發現：開 VPN 後系統 DNS 變成 Cloudflare 公共解析器，而且不帶 ECS（EDNS Client Subnet）。B 站部分節點網域是 GeoDNS，會依查詢者所在地回傳不同 IP，例如 `upos-sz-mirrorali`、`upos-hz-mirrorakam`。解析器不在當地又不帶 ECS 時，會被分到解析器所在地的機器，而不是使用者所在地的機器，測速結果就不代表當地。當時同一個網域，系統 DNS 與中華電信 DNS（168.95.1.1）解析出的 IP 不同。

程式的處理：

- 查 `o-o.myaddr.l.google.com` 的 TXT，得到替你向 Google 權威 DNS 查詢的解析器出口 IP 與 ECS 子網，再和出口國家比對。帶 ECS 且子網在當地，或解析器本身在當地，才算正常。
- **exe**：不正常時自動改用 Google DoH，並帶使用者出口 IP 的 /24 當 ECS。
- **命令列版**：`all` 會以 exit 6 停下來，要自己選 `--dns doh`、`--dns <當地 ISP DNS>`，或確認當地本來就用公共 DNS 後加 `--ignore-dns-mismatch`。
- 另外，手機漫遊的數據通常從母國出口；要測當地，請用當地 Wi-Fi 或當地 SIM。
