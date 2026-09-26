# 隱私權政策 / Privacy Policy

**B 站 CDN 線路重排（Bilibili CDN Switcher）**

最後更新 / Last updated：2026-09-26

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

### 意見回饋表單

擴充功能內的「問題回報／功能許願」按鈕會開啟一個 Google 表單。若你選擇填寫並送出，該筆資料由 Google 表單代管、依 [Google 隱私權政策](https://policies.google.com/privacy) 處理；本擴充功能本身不會事先蒐集或轉送這筆資料，是否填寫、填寫什麼完全由你自己決定。

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

### Feedback form

The "Report Issue / Feature Request" button in the extension opens a Google Form. If you choose to fill it in and submit, that data is hosted and processed by Google Forms under [Google's Privacy Policy](https://policies.google.com/privacy). The extension itself does not collect or relay that data beforehand — whether and what you submit is entirely your choice.

### Changes to this policy

Any material change to this policy will be reflected by updating the "Last updated" date at the top of this file, and mirrored in the privacy sections of the relevant stores (Chrome Web Store / Firefox Add-ons / Edge Add-ons / Safari App Store).

### Contact

For any privacy-related questions, please reach out via [GitHub Issues](https://github.com/a0972199950/bilibili-cdn-switcher/issues) or the feedback form inside the extension.
