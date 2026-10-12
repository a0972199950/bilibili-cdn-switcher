# 隱私權政策 / Privacy Policy

**B 站 CDN 線路重排（Bilibili CDN Switcher）**

最後更新 / Last updated：2026-10-10

---

## 繁體中文

### 這個擴充功能做什麼

本擴充功能會攔截並改寫你瀏覽器對 `bilibili.com` 發出的影片 CDN 網路請求，把預設節點換成對台灣／新加坡等地區較快的節點，藉此改善網頁版 B 站的播放體驗。所有改寫都只發生在**你自己的瀏覽器裡**，不會經過任何第三方伺服器。

### 我們收集哪些資料

**平常不收集、不上傳任何資料；只有你主動按下「問題回報」的「送出」時，才會把該次回報的內容與診斷資料傳給作者**（詳見下方「問題回報」）。具體來說：

- 不會讀取、記錄或上傳你的帳號資訊或 Cookie 內容
- 不使用任何分析、追蹤或廣告 SDK（沒有 Google Analytics、沒有任何遙測）
- 除了你主動送出的問題回報之外，不會將任何資料傳送到作者或任何第三方的伺服器
- 你在彈出視窗（popup）裡的設定（例如選擇的 CDN 節點、開關狀態）只會透過瀏覽器內建的 `chrome.storage.local` 存在**你自己的裝置上**，不會同步到雲端、不會離開你的電腦
- 為了讓問題回報能附上「問題發生前發生了什麼」，擴充會在**你自己的瀏覽器裡**保留最近 10 分鐘的運作紀錄（切換節點、自動切換、分段請求失敗、下載速度等），存在 `chrome.storage.session`，關閉瀏覽器即清空；沒有送出回報就不會離開你的電腦

### 使用的權限

| 權限 | 用途 |
|---|---|
| `storage` | 把你在彈出視窗裡的設定存在本機，重開瀏覽器後還記得你的選擇 |
| `*://*.bilibili.com/*`（host permission）| 讀取並改寫送往 bilibili.com 的影片 CDN 網路請求 host，這是本擴充功能唯一的核心功能所需 |

沒有要求任何其他權限（不要求分頁內容、瀏覽紀錄、其他網站存取等）。

### 依 IP 自動選擇國家

新安裝或更新後第一次打開彈出視窗時，擴充功能會向 B 站自己的 `https://api.bilibili.com/x/web-interface/zone` 查詢「你的 IP 位於哪個國家」，用來自動選擇節點清單的國家（自動選國家只做一次，你自己換過國家後就不再自動改）。

- 這個請求只送往 bilibili.com（擴充原本就有權限、你看 B 站時本來就會連線的網站），**不帶 Cookie**，不會送往作者或任何第三方。
- 回傳結果（國家、省份、ISP、IP）存在本機 `chrome.storage.local`，供節點清單選國家與「問題回報」的診斷資料使用；超過 24 小時會在你打開彈出視窗或回報頁時重新查詢。除了你主動送出的問題回報之外，不會上傳到任何地方。

### 問題回報

擴充功能內的「問題回報／功能許願」會開啟一個獨立的回報視窗。**只有在你按下「送出」時**，才會把以下內容以 HTTPS 傳送到作者架設的接收端（Cloudflare Workers），由它存進作者的**私有** GitHub 儲存庫，並在公開的專案儲存庫開一則 issue 讓你追蹤進度：

- 你填寫的問題類型、描述與（選填的）聯絡方式。聯絡方式是 email 時，會由作者的 Gmail 寄一封確認信給你（附 issue 連結），你回信就會到作者信箱；除此之外不會用於其他用途
- 回報問題（非功能許願）時附上的診斷資料：擴充版本與設定、瀏覽器與作業系統、時區與網路類型、你的 **IP 位址、ISP 與省份**（取自上述 B 站 zone API）、目前與最近 10 分鐘內看過的 bilibili 影片／直播間 ID、使用的 CDN 節點、下載速度、緩衝與卡頓情形、自動切換紀錄、以及這 10 分鐘內你在擴充上的操作（切換節點、國家、開關、測速）

送出前，表單上會完整顯示將要附上的診斷資料，你可以逐字檢視；「功能許願」不會附上診斷資料。Firefox 使用者第一次送出問題回報時，Firefox 會另外詢問是否允許擴充功能收集上述資料，你也可以隨時在附加元件管理頁的「權限與資料」撤銷。公開 issue 上只會出現描述與去識別化的摘要（版本、瀏覽器、國家、節點），**不會**出現 IP、ISP、聯絡方式或影片 ID；完整診斷資料只有作者看得到，僅用於排查該筆回報，處理完畢後刪除。接收端不會另外記錄任何存取紀錄。

### 政策異動

若本政策有實質變更，會更新此檔案的「最後更新」日期，並反映在對應商店（Chrome Web Store / Firefox Add-ons / Edge Add-ons / Safari App Store）的隱私權說明中。

### 聯絡方式

有任何隱私權相關問題，歡迎透過 [GitHub Issues](https://github.com/a0972199950/bilibili-cdn-switcher/issues) 或擴充內的問題回報聯絡我們。

---

## English

### What this extension does

This extension intercepts and rewrites the video-CDN network requests your browser sends to `bilibili.com`, replacing the default node with a faster one for regions such as Taiwan/Singapore, to improve playback on the bilibili web player. All rewriting happens **entirely inside your own browser** and never passes through any third-party server.

### What data we collect

**Nothing is collected or uploaded in normal use. Data is sent to the author only when you explicitly press "Send" in "Report a problem"** (see "Problem reports" below). Specifically:

- We do not read, log, or upload your account information or cookie contents
- No analytics, tracking, or advertising SDKs are used (no Google Analytics, no telemetry of any kind)
- Apart from problem reports you choose to send, no data is ever sent to the extension author or any third party
- Your settings in the popup (e.g., selected CDN node, toggle states) are stored only via the browser's built-in `chrome.storage.local`, on **your own device**. They are never synced to any cloud service and never leave your computer
- So that a problem report can show what happened before the problem, the extension keeps the last 10 minutes of its own activity (node switches, auto-switches, failed segment requests, download speed, etc.) **inside your browser** in `chrome.storage.session`, which is cleared when the browser closes. It never leaves your computer unless you send a report

### Permissions used

| Permission | Purpose |
|---|---|
| `storage` | Save your popup settings locally so they persist across browser restarts |
| `*://*.bilibili.com/*` (host permission) | Read and rewrite the host of video-CDN network requests to bilibili.com — the extension's sole core function |

No other permissions are requested (no tab content, no full browsing history, no access to other sites).

### Automatic country selection by IP

The first time you open the popup after installing or updating, the extension asks bilibili's own `https://api.bilibili.com/x/web-interface/zone` which country your IP is in, to pick the country of the node list automatically (the automatic choice happens only once — after you change the country yourself it is never changed automatically again).

- The request goes only to bilibili.com (a site the extension already has permission for and that you connect to anyway when watching bilibili), **without cookies**, and never to the author or any third party.
- The result (country, province, ISP, IP) is stored locally in `chrome.storage.local` for choosing the country and for the diagnostics attached to problem reports; it is refreshed when older than 24 hours the next time you open the popup or the report form. Apart from problem reports you choose to send, it is never uploaded anywhere.

### Problem reports

"Report a problem / Request a feature" opens a separate report window. **Only when you press "Send"** is the following sent over HTTPS to an endpoint run by the author (Cloudflare Workers), which stores it in the author's **private** GitHub repository and opens an issue in the public project repository so you can track progress:

- The problem type, description and (optional) contact you entered. If the contact is an email address, a confirmation email with the issue link is sent to you from the author's Gmail; replying to it reaches the author's inbox. It is not used for anything else
- For problem reports (not feature requests), attached diagnostics: extension version and settings, browser and OS, time zone and connection type, your **IP address, ISP and province** (from the bilibili zone API above), the IDs of the bilibili videos / live rooms viewed now and within the last 10 minutes, the CDN node in use, download speed, buffering and stall state, auto-switch history, and your actions in the extension during those 10 minutes (node, country and toggle changes, speed tests)

The full diagnostics are shown on the form before sending so you can review them word by word; feature requests carry no diagnostics. On Firefox, the first time you send a problem report Firefox will additionally ask whether to allow the extension to collect the data above; you can revoke this at any time under "Permissions and data" in the Add-ons Manager. The public issue contains only your description and a de-identified summary (version, browser, country, node) — **never** your IP, ISP, contact or video IDs. The full diagnostics are visible to the author only, used solely to investigate that report, and deleted once it is resolved. The endpoint keeps no access logs.

### Changes to this policy

Any material change to this policy will be reflected by updating the "Last updated" date at the top of this file, and mirrored in the privacy sections of the relevant stores (Chrome Web Store / Firefox Add-ons / Edge Add-ons / Safari App Store).

### Contact

For any privacy-related questions, please reach out via [GitHub Issues](https://github.com/a0972199950/bilibili-cdn-switcher/issues) or the problem-report form inside the extension.
