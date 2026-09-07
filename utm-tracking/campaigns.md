# UTM 追蹤設定

## 分類原則

固定三個軸，不要混用：

- **`utm_source` = 平台**（流量從哪個網站來）
- **`utm_campaign` = 一次推廣行動**（不含語言，語言進 campaign 會讓同一檔活動被切碎、無法彙總）
- **`utm_content` = 語言／素材版本**

本檔按**管道類型**分組（自有／社群／付費），不按地區語言分組 —— 語言已經在 `utm_content` 裡了。

---

## 商店連結（短網址，會自動跳轉且保留 UTM）

三份 README 一律用這組短網址，不要用帶 slug 的長網址（商店名稱改過就會失效），結尾不加斜線：

| 商店 | 網址 |
|:--|:--|
| Chrome Web Store | `https://chromewebstore.google.com/detail/dfaddcffoondcendifiljhdbdagebgch` |
| Firefox Add-ons | `https://addons.mozilla.org/addon/bilibili-cdn-switcher` |
| Edge Add-ons | `https://microsoftedge.microsoft.com/addons/detail/dllallgilijcacpdemjafegibdafcbdp` |

---

## 自有管道（owned）

### GitHub README - 繁體中文
- **ID**: github-readme-zhtw-001
- **建立**: 2026-08-29
- **參數**: `utm_source=github` · `utm_medium=referral` · `utm_campaign=readme` · `utm_content=zhtw`
- **Query**: `?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=zhtw`
- **位置**: `README.md` 的三個商店安裝連結
- **狀態**: active

### GitHub README - 簡體中文
- **ID**: github-readme-zhcn-001
- **建立**: 2026-08-29
- **參數**: `utm_source=github` · `utm_medium=referral` · `utm_campaign=readme` · `utm_content=zhcn`
- **Query**: `?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=zhcn`
- **位置**: `docs/README.zh-CN.md` 的三個商店安裝連結
- **狀態**: active

### GitHub README - English
- **ID**: github-readme-en-001
- **建立**: 2026-08-29
- **參數**: `utm_source=github` · `utm_medium=referral` · `utm_campaign=readme` · `utm_content=en`
- **Query**: `?utm_source=github&utm_medium=referral&utm_campaign=readme&utm_content=en`
- **位置**: `docs/README.en.md` 的三個商店安裝連結
- **狀態**: active

### 擴充內「評分」按鈕
- **ID**: extension-rate-001
- **建立**: 2026-08-29
- **參數**: `utm_source=extension` · `utm_medium=referral` · `utm_campaign=rate` · `utm_content=<UI 語言>`
- **Query**: `?utm_source=extension&utm_medium=referral&utm_campaign=rate&utm_content=zhtw`
- **位置**: `src/popup.js` 的 `STORE_REVIEW_URLS`，由 `withUtm()` 在點擊時動態組出
- **備註**: `utm_content` 依擴充當下的 UI 語言自動代入 `zhtw` / `zhcn` / `en`。**必須跟 `campaign=readme` 分開** —— 按這顆按鈕的人已經是安裝過的使用者，混在一起會把安裝來源報表灌成 GitHub 帶來的
- **狀態**: active

### GitHub Releases
- **ID**: github-release-001
- **建立**: 2026-08-29
- **參數**: `utm_source=github` · `utm_medium=referral` · `utm_campaign=release` · `utm_content=<版本號>`
- **Query**: `?utm_source=github&utm_medium=referral&utm_campaign=release&utm_content=v1-0-0`
- **位置**: Releases 頁面的 release notes（尚未實作）
- **備註**: `utm_content` 填該版版本號，點號換連字號（`v1.0.0` → `v1-0-0`）
- **狀態**: planned

---

## 社群管道（earned）

### Mobile01 - 論壇貼文
- **ID**: mobile01-zhtw-001
- **建立**: 2026-08-29
- **參數**: `utm_source=mobile01` · `utm_medium=referral` · `utm_campaign=buffering-fix` · `utm_content=zhtw-post1`
- **Query**: `?utm_source=mobile01&utm_medium=referral&utm_campaign=buffering-fix&utm_content=zhtw-post1`
- **貼文**: https://www.mobile01.com/topicdetail.php?f=506&t=7283515
- **備註**: 論壇連結用 `referral`，不要用 `article`（非標準值，GA4 會歸到 Unassigned）
- **狀態**: active

### Reddit - r/Bilibili
- **ID**: reddit-en-001
- **建立**: 2026-08-29
- **參數**: `utm_source=reddit` · `utm_medium=social` · `utm_campaign=buffering-fix` · `utm_content=en-post1`
- **Query**: `?utm_source=reddit&utm_medium=social&utm_campaign=buffering-fix&utm_content=en-post1`
- **貼文**: https://www.reddit.com/r/Bilibili/comments/1vire1y/finally_fix_bilibili_buffering_issues_in_singapore/
- **狀態**: active

### 小紅書（中國版）- 貼文
- **ID**: xiaohongshu-cn-001
- **建立**: 2026-09-07
- **參數**: `utm_source=xiaohongshu` · `utm_medium=social` · `utm_campaign=buffering-fix` · `utm_content=zhcn-cn-post1`
- **Query**: `?utm_source=xiaohongshu&utm_medium=social&utm_campaign=buffering-fix&utm_content=zhcn-cn-post1`
- **貼文**: （待補）
- **備註**: 中國版 App（`xiaohongshu.com`）。地區用 `utm_content` 的 `cn` 標，語言仍是 `zhcn`，跟新加坡版分開才能比對兩地成效。平台一致，不另開 `utm_source`
- **狀態**: planned

### 小紅書（新加坡版）- 貼文
- **ID**: xiaohongshu-sg-001
- **建立**: 2026-09-07
- **參數**: `utm_source=xiaohongshu` · `utm_medium=social` · `utm_campaign=buffering-fix` · `utm_content=zhcn-sg-post1`
- **Query**: `?utm_source=xiaohongshu&utm_medium=social&utm_campaign=buffering-fix&utm_content=zhcn-sg-post1`
- **貼文**: （待補）
- **備註**: 新加坡／國際版 App（RedNote）。地區標 `sg`，語言 `zhcn`。受眾是新加坡的簡中使用者，跟 `reddit-en-001`、`gads-sg-*` 打的是同一批人
- **狀態**: planned

---

## 付費管道（paid）

### Google Ads - 新加坡簡中關鍵字廣告
- **ID**: gads-sg-keywords-001
- **建立**: 2026-08-29
- **參數**: `utm_source=google` · `utm_medium=cpc` · `utm_campaign=sg-keywords` · `utm_content=zhcn-{creative}` · `utm_term={keyword}`
- **Query**: `?utm_source=google&utm_medium=cpc&utm_campaign=sg-keywords&utm_content=zhcn-{creative}&utm_term={keyword}`
- **關鍵字**: bilibili 卡頓、新加坡 bilibili 看不了
- **預算**: USD 500
- **狀態**: active

### Google Ads - 新加坡簡中轉換優化廣告
- **ID**: gads-sg-conversion-001
- **建立**: 2026-08-29
- **參數**: `utm_source=google` · `utm_medium=cpc` · `utm_campaign=sg-conversion` · `utm_content=zhcn-{creative}` · `utm_term={keyword}`
- **Query**: `?utm_source=google&utm_medium=cpc&utm_campaign=sg-conversion&utm_content=zhcn-{creative}&utm_term={keyword}`
- **預算**: USD 300
- **狀態**: active

> **Google Ads 注意事項**
>
> - `{keyword}` / `{creative}` 是 Google Ads 的 ValueTrack 參數，投放時會自動代換成實際關鍵字與廣告 ID。**不要寫死成單一關鍵字**，否則一個廣告群組裡的多個關鍵字會全部混在一起。
> - 帳號若開了自動標記（auto-tagging，預設開啟），GA4 會優先採用 `gclid`，手動填的 `utm_source` / `utm_medium` 會被蓋掉。要嘛關掉自動標記、要嘛接受以 gclid 為準。
> - 轉換出價需要轉換訊號回傳。廣告直接打到商店頁時無法埋轉換代碼，`sg-conversion` 這檔實際上沒有東西可以優化 —— 要真的做轉換優化，需要中間放一個自有落地頁。

---

## 參數說明

| 參數 | 說明 | 允許值 |
|:--|:--|:--|
| `utm_source` | 平台 | `github` `extension` `mobile01` `reddit` `xiaohongshu` `google` |
| `utm_medium` | 管道類型（**只用標準值**） | `referral`（他站連入）`social`（社群）`cpc`（付費點擊）`email` |
| `utm_campaign` | 一次推廣行動，**不含語言** | `readme` `rate` `release` `buffering-fix` `sg-keywords` `sg-conversion` |
| `utm_content` | 語言／素材版本 | `zhtw` `zhcn` `en` `zhtw-post1` `zhcn-cn-post1` `zhcn-sg-post1` `v1-0-0` |
| `utm_term` | 關鍵字，僅付費搜尋使用 | `{keyword}` |

### 保留值警告

`utm_medium` 有幾個值在 GA 有特殊語意，**不要拿來當一般用途**：

| 值 | GA 會歸類成 | 說明 |
|:--|:--|:--|
| `organic` | Organic Search | 專指未付費的搜尋引擎流量。用在 GitHub 連結會讓它跟自然搜尋混在一起 |
| `(none)` | Direct | 直接流量 |
| 自訂值（如 `article`） | Unassigned | GA4 預設管道分組不認得，會掉進未分類 |

---

## 語言代碼

| 代碼 | 語言 | 主要地區 |
|:--|:--|:--|
| `zhtw` | 繁體中文 | 台灣、香港 |
| `zhcn` | 簡體中文 | 新加坡、中國大陸 |
| `en` | 英文 | 國際 |

---

## 擴充規則

新增活動時遵循：

1. **一律小寫**。UTM 值大小寫敏感，`Reddit` 和 `reddit` 在報表上會變成兩筆。
2. **只用連字號**分隔，不要底線或空白。
3. **`utm_medium` 只從標準值挑**（見上表），不要自創。
4. **語言只出現在 `utm_content`**，不要同時寫進 `utm_campaign`。
5. **ID 格式**：`{平台}-{語言或地區}-{序號}`，只在本檔內部使用，不進 URL。
6. **新增時填建立日期**，停用時把 `狀態` 改成 `paused` / `ended` 並補上結束日期，不要直接刪除。
7. **商店連結一律用短網址**（見上方表格），不要複製商店網址列的長版本。
