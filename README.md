<div align="center">

# 🎬 B 站 CDN 線路重排

**語言 / Language：** 繁體中文（本頁）｜[简体中文](docs/README.zh-CN.md)｜[English](docs/README.en.md)

### 讓 🇹🇼 台灣 / 🇸🇬 新加坡 用戶看網頁版 B 站更順的 Chrome / Edge / Firefox 擴充

`Manifest V3` · `Chrome 111+ / Edge 111+ / Firefox 128+` · `純前端 · 無需登入`

### 📥 [點此從 Chrome Web Store 安裝](https://chromewebstore.google.com/detail/twsg-%E8%A7%86%E9%A2%91%E5%8A%A0%E9%80%9F-for-bilibili-%E9%9D%9E%E5%AE%98/dfaddcffoondcendifiljhdbdagebgch)

</div>

---

> ### 🙏 Credit / 致謝
>
> 本專案移植自作者 **[@roge4444](https://github.com/roge4444)** 的兩個專案：
>
> - 📦 [PiliNaraRogerMod](https://github.com/roge4444/PiliNaraRogerMod)
> - 📦 [blblRogerMod](https://github.com/roge4444/blblRogerMod)
>
> CDN 選線策略與節點清單皆源自上述專案，**特別感謝作者** ❤️

---

![擴充 popup 設定畫面](docs/image.png)
---
![播放器 debug 疊層](docs/image-1.png)

## ✨ 這個擴充在做什麼

**🎯 主要是為了讓 🇹🇼 台灣／🇸🇬 新加坡 的使用者看網頁版 B 站（www.bilibili.com）更順。**

B 站預設分配的取流節點對台灣、新加坡使用者常常繞路、不夠快。這個擴充會**把影片的取流 CDN 重排、換成一個對 TW/SG 較快的最優節點**，讓緩衝與載入更順。

| 功能 | 說明 |
|:--|:--|
| 🚀 **TW/SG 最優節點** | 預設換成對台/星最快的 CDN，開箱即用 |
| 🌐 **其他 CDN 節點** | 阿里雲／騰訊雲／華為雲／Akamai／各海外節點…（來自 PiliNaraRogerMod），依所在地區自由比較切換 |
| ✏️ **自行輸入** | 跟「清單選擇」互斥的另一個模式，可填任意 CDN host |
| 🛑 **原始（不覆寫）** | 等同關閉，完全不動 B 站原生行為 |
| 🔁 **失敗自動切換** | 偵測到目前 CDN 分段請求失敗、或播放持續卡住（非單純緩衝已滿），先靜默切換到 B 站原生給的備援節點（顯示提示、不整頁刷新）；備援也不行時彈出提示，讓你自行決定是否切到「備用URL」。內建行為，無開關 |
| 📶 **各節點測速** | 獨立頁面，顯示影片標題／畫質，實測當前影片、當前畫質下各節點的下載速度並逐一列出，測速中也能重新測；不影響你手動選擇的 CDN，離開該頁即中止 |
| 🌏 **多語系介面** | 依瀏覽器語言自動顯示繁體中文／简体中文／English，涵蓋 popup、頁面提示與 debug 疊層 |
| 🐛 **debug 疊層** | 查看當前 CDN 節點（預設關閉，可在設定中打開） |
| 🦊 **Chrome / Edge / Firefox 三平台** | 同一份 `src/`，打包時依瀏覽器各自產生 zip（Edge 是 Chromium 內核，直接沿用 Chrome 的 manifest） |

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
├── dist/                 ← 打包產物（.zip）
├── docs/                 ← README 用的截圖 + 简体中文／English README
├── assets/               ← 圖示母檔 512px + 產生腳本
├── build.ps1             ← 打包成上架用 zip（Chrome + Edge + Firefox）
└── README.md
```

### 📦 打包（上架 Chrome Web Store / Microsoft Edge Add-ons / Firefox Add-ons 用）

```powershell
pwsh -File build.ps1                 # 預設：Chrome + Edge + Firefox 都打包
pwsh -File build.ps1 -Browser chrome # 只打包 Chrome
pwsh -File build.ps1 -Browser edge   # 只打包 Edge
pwsh -File build.ps1 -Browser firefox
```

Chrome／Edge 用同一份 `src/manifest.json`（Edge 是 Chromium 內核，Manifest V3 與 Chrome 完全相容，
不需要另外的 manifest），Firefox 用 `src/manifest.firefox.json`。會讀對應 manifest 的 `version`，
把 `src/` **底下的內容**（manifest 換成 `manifest.json` 放在 zip 最上層）壓成
`dist/bilibili-cdn-switcher-<browser>-<版本>.zip`。Chrome／Firefox 兩份 manifest 的 `version`
要保持一致，不一致時腳本會跳警告（Edge 沿用 Chrome 的 manifest，版本必然一致，不用另外檢查）。

打包結果是可重現的（reproducible build）：只要 `src/` 內容沒變，同一個瀏覽器目標每次包出來的
zip bytes 完全相同，方便搭配 CI／pre-push hook 判斷 `dist/` 是否真的需要更新。

### 🎨 重新產生圖示

```powershell
pwsh -File assets/gen-icons.ps1
```

以 512px 母檔縮出 16/32/48/128，同時產生兩份：`src/icons/`（開發版，帶紅點角標，`Load unpacked` 平常讀到的就是這份，方便跟已安裝的正式版分辨）與 `assets/icons-prod/`（正式版，無角標）。`build.ps1` 打包 zip 時會自動把圖示換成 `assets/icons-prod/` 底下的正式版。

---

## 🎛️ UI 說明

| 選項 | 行為 |
|:--|:--|
| 🔘 **啟用** | 預設 **開啟** 的總開關；關閉後完全不改動 B 站取流（debug 疊層仍會顯示當前 CDN） |
| 📡 **CDN 線路** | 「清單選擇」／「自行輸入」互斥單選。**預設＝清單選擇，第一項＝ bilivideo（TW/SG 最快）**，其餘為各家節點、倒數兩項是「備用URL」「原始」；切到「自行輸入」會出現輸入框，自行填 host |
| 🔍 **測試各節點速度** | 按下後切到獨立的測速頁面，上方顯示目前影片標題與畫質；抓「當前影片、當前畫質」的分段，依序換各節點 host 實測下載速度（8MB 或 5 秒先到為準，5 秒內完全沒收到資料才算超時；有收到但不到 8MB 就顯示實際測到的速度），逐格顯示「等待中／測試中／結果」，可按「🔄 重新測速」重跑（測速中也能按，會中斷目前的重新開始）。**只顯示數字，不會更動你目前選擇的 CDN**；按左上角「← 返回」或關掉 popup 會立即中止測速。開啟「啟用」時，playurl 一解析完就能測，不用等真的開始播放；若「啟用」是關閉的，則要等實際下載過分段才有樣本 |
| 🔁 **失敗自動切換 CDN** | 內建行為、**無開關**；偵測到分段請求失敗（403/404/5xx/網路錯誤）或播放確實卡住（8 秒內進度不動、且線路上也沒有資料在動），先靜默切到 B 站原生給的備援節點（分段層即時差替、不整頁刷新，並跳出提示）；這個備援也播不動時，改彈出一個不會自動消失的提示，讓你自己決定要不要「重載並切換至備用URL」 |
| 🌏 **語言** | 沒有手動切換選項，跟隨瀏覽器／作業系統語言自動顯示繁體中文／简体中文／English（其餘語言預設顯示繁體中文）；如需強制指定，可調整瀏覽器的語言偏好順序 |
| 🐛 **顯示頁面 debug 疊層** | 預設 **關閉**；獨立於重排開關，關閉重排時仍可顯示當前 CDN，方便比較 |

<details>
<summary>🔍 <b>Debug 疊層長什麼樣</b>（播放器左上角，仿 blblRogerMod <code>PlayerActivityDebug</code> 風格）</summary>

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

  `value` 特殊值：🛑 `base`＝不覆寫 · 🔁 `backup`＝優先備用URL（這兩個特殊選項用 `nameKey` 代替 `name`）。
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

<div align="center">

Made with ❤️ for 🇹🇼 / 🇸🇬 bilibili viewers · 移植自 [@roge4444](https://github.com/roge4444)

</div>
