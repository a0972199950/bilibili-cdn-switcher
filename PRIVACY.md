# 隱私權政策 / Privacy Policy

**B 站 CDN 線路重排（Bilibili CDN Switcher）**

最後更新 / Last updated：2026-10-02

---

## 繁體中文

### 這個擴充功能做什麼

本擴充功能會攔截並改寫你瀏覽器對 `bilibili.com` 發出的影片 CDN 網路請求，把預設節點換成對台灣／新加坡等地區較快的節點，藉此改善網頁版 B 站的播放體驗。所有改寫都只發生在**你自己的瀏覽器裡**，不會經過任何第三方伺服器。

### 我們收集哪些資料

**完全不收集任何個人資料。** 具體來說：

- 不會讀取、記錄或上傳你的瀏覽紀錄、觀看紀錄、帳號資訊或 Cookie 內容
- 不使用任何分析、追蹤或廣告 SDK（沒有 Google Analytics、沒有任何遙測）
- 不會將任何資料傳送到本擴充功能作者或任何第三方的伺服器——本擴充功能**沒有自己的後端伺服器**
- 你在彈出視窗（popup）裡的設定（例如選擇的 CDN 節點、開關狀態）只會透過瀏覽器內建的 `chrome.storage.local` 存在**你自己的裝置上**，不會同步到雲端、不會離開你的電腦

### 使用的權限

| 權限 | 用途 |
|---|---|
| `storage` | 把你在彈出視窗裡的設定存在本機，重開瀏覽器後還記得你的選擇 |
| `*://*.bilibili.com/*`（host permission）| 讀取並改寫送往 bilibili.com 的影片 CDN 網路請求 host，這是本擴充功能唯一的核心功能所需 |

沒有要求任何其他權限（不要求分頁內容、瀏覽紀錄、其他網站存取等）。

### 依 IP 自動選擇國家

新安裝或更新後第一次打開彈出視窗時，擴充功能會向 B 站自己的 `https://api.bilibili.com/x/web-interface/zone` 查詢一次「你的 IP 位於哪個國家」，用來自動選擇節點清單的國家（只做一次，你自己換過國家後就不再查詢）。

- 這個請求只送往 bilibili.com（擴充原本就有權限、你看 B 站時本來就會連線的網站），**不帶 Cookie**，不會送往作者或任何第三方。
- 回傳結果只用來在本機挑選國家，只把「國家代碼」存進 `chrome.storage.local`，不保存 IP 或其他位置資訊，也不會上傳到任何地方。

### 意見回饋表單

擴充功能內的「問題回報／功能許願」按鈕會開啟一個 Google 表單。若你選擇填寫並送出，該筆資料由 Google 表單代管、依 [Google 隱私權政策](https://policies.google.com/privacy) 處理；開啟表單時，擴充功能會把擴充版本、瀏覽器與作業系統、目前的節點設定、目前分頁網址（僅 bilibili 網站、不含查詢參數）與 debug 資訊預先填入「環境資訊」欄位，方便排查問題；這些內容只會出現在你自己的表單畫面上，你可以檢視、修改或刪除。本擴充功能本身不會事先蒐集或轉送這筆資料，是否送出、送出什麼完全由你自己決定。

### 政策異動

若本政策有實質變更，會更新此檔案的「最後更新」日期，並反映在對應商店（Chrome Web Store / Firefox Add-ons / Edge Add-ons / Safari App Store）的隱私權說明中。

### 聯絡方式

有任何隱私權相關問題，歡迎透過 [GitHub Issues](https://github.com/a0972199950/bilibili-cdn-switcher/issues) 或專案內的意見回饋表單聯絡我們。

---

## English

### What this extension does

This extension intercepts and rewrites the video-CDN network requests your browser sends to `bilibili.com`, replacing the default node with a faster one for regions such as Taiwan/Singapore, to improve playback on the bilibili web player. All rewriting happens **entirely inside your own browser** and never passes through any third-party server.

### What data we collect

**None. No personal data is collected, period.** Specifically:

- We do not read, log, or upload your browsing history, watch history, account information, or cookie contents
- No analytics, tracking, or advertising SDKs are used (no Google Analytics, no telemetry of any kind)
- No data is ever sent to the extension author or any third party — this extension **has no backend server of its own**
- Your settings in the popup (e.g., selected CDN node, toggle states) are stored only via the browser's built-in `chrome.storage.local`, on **your own device**. They are never synced to any cloud service and never leave your computer

### Permissions used

| Permission | Purpose |
|---|---|
| `storage` | Save your popup settings locally so they persist across browser restarts |
| `*://*.bilibili.com/*` (host permission) | Read and rewrite the host of video-CDN network requests to bilibili.com — the extension's sole core function |

No other permissions are requested (no tab content, no full browsing history, no access to other sites).

### Automatic country selection by IP

The first time you open the popup after installing or updating, the extension asks bilibili's own `https://api.bilibili.com/x/web-interface/zone` once which country your IP is in, to pick the country of the node list automatically (only once — after you change the country yourself it is never queried again).

- The request goes only to bilibili.com (a site the extension already has permission for and that you connect to anyway when watching bilibili), **without cookies**, and never to the author or any third party.
- The result is only used locally to choose a country; only the country code is stored in `chrome.storage.local`. No IP address or other location data is kept or uploaded anywhere.

### Feedback form

The "Report Issue / Feature Request" button in the extension opens a Google Form. If you choose to fill it in and submit, that data is hosted and processed by Google Forms under [Google's Privacy Policy](https://policies.google.com/privacy). When opening the form, the extension pre-fills an "Environment info" field with the extension version, browser and OS, your current node settings, the current tab's URL (bilibili sites only, without query parameters) and debug info to help troubleshoot; this only appears in your own form, where you can review, edit or delete it. The extension itself does not collect or relay that data beforehand — whether and what you submit is entirely your choice.

### Changes to this policy

Any material change to this policy will be reflected by updating the "Last updated" date at the top of this file, and mirrored in the privacy sections of the relevant stores (Chrome Web Store / Firefox Add-ons / Edge Add-ons / Safari App Store).

### Contact

For any privacy-related questions, please reach out via [GitHub Issues](https://github.com/a0972199950/bilibili-cdn-switcher/issues) or the feedback form inside the extension.
