# report-worker：問題回報收件端

擴充內「問題回報」頁（`src/report.html`）送出時 POST 到這個 Cloudflare Worker，Worker 把完整診斷文字
commit 進私有 repo `bilibili-cdn-switcher-reports`、在公開 repo 開 issue（只放描述與去識別化摘要），再把 issue 網址回給使用者。

## 介面

`POST https://bcs-report.bilibili-cdn-switcher-tools.workers.dev/v1/report`
`Content-Type: text/plain`（body 為 JSON 字串，避免 preflight）、header `X-BCS-Token`。

```jsonc
{
  "v": 1,
  "type": "bug|feature",
  "description": "...",            // ≤ 4000 字
  "contact": "..." | null,         // 是 email 時會寄確認信（附 issue 連結，可直接回信補充）
  "lang": "zh-TW",                  // 確認信語言
  "includeDiag": true,             // feature 為 false
  "summary": { version, browser, os, country, isp, vpnSuspect, configured, effective, playurlGiven, currentCdn, qn, speed, pattern, recentKinds[] },
  "diagText": "...",               // 完整診斷純文字（journal + samples + snapshot），整個 body ≤ 256 KB
  "clientTime": 1760000000000
}
```

回應：`{ ok, id, issueUrl, issueNumber, emailed, error }`；4xx：`bad_token` / `bad_json` / `too_large` / `rate_limited`。

## 進行中的抽獎（測速 exe）

`GET https://bcs-report.bilibili-cdn-switcher-tools.workers.dev/v1/lotteries`，不用 token。
回傳進行中（`now()` 介於 `starts_at`、`ends_at`，沒有提前結束）且有 metadata 的抽獎，依結束時間排序、不分國家（各端依使用者國家自己篩）：

```jsonc
{ "ok": true, "items": [{
  "id": 5, "title": "2026-10 台灣有線寬頻抽獎", "country": "TW",   // title：擴充跑馬燈捲動的那段
  "prize": { "amount": 200, "currency": "TWD", "giftCards": ["7-11 禮物卡", "Apple 禮物卡"] },
  "winners": 3, "isps": ["台灣大寬頻", "…"],   // 空陣列＝該國所有使用者
  "drawDays": 7, "startDate": "2026-10-01", "endDate": "2026-10-30", "drawBy": "2026-11-06",   // 台灣時間
  "startsAt": 1790784000000, "endsAt": 1793376000000   // 毫秒；endsAt 不含（結束日隔天 00:00 台灣時間）
}] }
```

文字由各端依 metadata 組（擴充 `src/lottery-text.js`、exe `tools/cdn-speedtest-app/lottery_text.py`）。
資料來自 Neon 的 `lotteries`（`npm run lottery:add` / `lottery:update`，見 `scripts/lottery.mjs`），需要 secret `DATABASE_URL`。
結果在 Cloudflare 邊緣快取 1 分鐘（`LOTTERY_CACHE_S`），所以提前結束（`lottery:end`）約 1 分鐘後 exe 就看不到；
到期的則由各端依 `endsAt` 自己隱藏。

## 擴充的公告

`GET https://bcs-report.bilibili-cdn-switcher-tools.workers.dev/v1/announcements`，不用 token。擴充 popup 的公告欄與公告視窗用。
回傳 Neon 的 `announcements`（新的在前、不分國家，擴充依使用者國家自己篩），兩種：

```jsonc
{ "ok": true, "items": [
  { "id": 3, "type": "html", "prefix": { "zh-TW": "系統公告:" } | null, "title": { "zh-TW": "…", "en": "…" },
    "html": { "zh-TW": "<p>…</p>" }, "countries": ["TW"] | null },   // 一般公告：本機後台寫，各語言可只填一種；countries null＝全部
  { "id": 1, "type": "lottery", "lottery": { /* 同 /v1/lotteries 的一筆 */ } }   // 抽獎公告：只列進行中的抽獎，文字由擴充組
] }
```

抽獎公告在新增抽獎時自動建立（`scripts/lib/lotteries.mjs` 的 `addLottery`），一般公告由本機後台 `admin/` 維護（`scripts/lib/announcements.mjs`）。

## 抽獎 v2（`/v2/lotteries`、`/v2/announcements`）

新版擴充（公告欄、公告視窗）與新版 exe 用的版本。抽獎只來自抽獎 v2（Neon 的 `lotteries_v2`，`scripts/lib/lotteries-v2.mjs`，
本機後台「抽獎 v2」），跟 `/v1/*`（只來自 `lotteries`）各自獨立：v2 建的抽獎舊版看不到。格式同上，差別只在抽獎那一筆——禮物卡各自有面額、多了備註 HTML：

```jsonc
{ "id": 1,   // v2 的 id
  "title": { "zh-TW": "…", "en": "…" },   // 各語言可只填一種，各端依 介面語言 → en → zh-TW → 任一 取一種
  "prize": { "currency": "HKD", "giftCards": [{ "name": "7-Eleven 電子現金券", "amount": 100 }, { "name": "Google Play 禮品卡", "amount": 150 }] },
  "note": { "zh-TW": "<p>…</p>" } | null,   // 擴充公告視窗的「備註」區塊（html-sanitize.js 依白名單重建），語言退回同 title
  /* 其餘欄位同 /v1/lotteries */ }
```

抽獎公告：`/v2/announcements` 只列掛在抽獎 v2 上的（`announcements.lottery_v2_id`），`/v1/announcements` 只列掛在 v1 上的（`lottery_id`）。
從 v1 遷移的抽獎，那則公告兩個都有（舊版看 v1、新版看 v2，公告 id 不變）。
**`lotteries_v2` 與 `announcements.lottery_v2_id` 要先存在（後台打開過「抽獎 v2」就會建）再部署有 `/v2/*` 的 worker，否則 `/v2/*` 回 502。**
快取：邊緣 1 分鐘（同 `/v1/lotteries`；各邊緣節點各自快取，新增後不同節點可能要等滿 1 分鐘才一致）、擴充另外 15 分鐘（`storage.local.announcementFeed`），
改了公告最慢約 16 分鐘使用者看得到。

### 下載次數統計

`/v1/announcements`、`/v2/announcements` 每被請求一次，`countOpen` 就在 Workers Analytics Engine 的 `bcs_announce_opens`
（綁定 `OPENS`，見 `wrangler.toml`）記一筆 `blobs = [國家, 瀏覽器, 路徑]`：

- 國家：`request.cf.country`（Cloudflare 依 IP 判斷，`XX` 不明、`T1` Tor）；**IP、User-Agent 都不寫入**。
- 瀏覽器：由 `Origin` 判斷——`chrome`／`edge`（依商店的擴充 ID）、`chromium-dev`（其他 ID，開發中的未封裝版）、`firefox`
  （`moz-extension://` 的主機名是每次安裝不同的 UUID，只記種類）、`safari`、`other`（不是從擴充發出的請求）。

擴充自己快取 15 分鐘，所以這是「打開 popup 且快取過期」的次數，不是使用者數。用途是看各國實際在用的比例，
對照商店後台按區域分的每週使用者（例如 Chrome 後台 2026-10-18 起美國每週使用者暴增、卻沒有對應的安裝與商店頁瀏覽）。
查詢：`npm run worker:opens [天數]`（預設 14 天，日期是 UTC），需要 `.env.local` 的 `BCS_CF_ACCOUNT_ID`、`BCS_CF_ANALYTICS_TOKEN`
（權限 Account Analytics: Read）。Analytics Engine 免費版每天可寫 10 萬筆，資料保留 3 個月。這項統計已寫進 `PRIVACY.md` 的「公告」。

## 部署

```sh
npx wrangler login
npx wrangler kv namespace create RATE_KV --config tools/report-worker/wrangler.toml   # 把 id 填回 wrangler.toml
npx wrangler secret put GITHUB_TOKEN --config tools/report-worker/wrangler.toml
npx wrangler secret put REPORT_TOKEN --config tools/report-worker/wrangler.toml
npx wrangler secret put MAIL_URL --config tools/report-worker/wrangler.toml      # Apps Script web app /exec
npx wrangler secret put MAIL_SECRET --config tools/report-worker/wrangler.toml
npx wrangler secret put DATABASE_URL --config tools/report-worker/wrangler.toml   # Neon 連線字串（抽獎跑馬燈、贊助排行榜）
npx wrangler secret put ECPAY_MERCHANT_ID --config tools/report-worker/wrangler.toml      # 贊助結帳：新台幣（綠界），見下方「贊助與乾爹排行榜」
npx wrangler secret put ECPAY_HASH_KEY --config tools/report-worker/wrangler.toml
npx wrangler secret put ECPAY_HASH_IV --config tools/report-worker/wrangler.toml
npx wrangler secret put STRIPE_SECRET_KEY --config tools/report-worker/wrangler.toml      # 贊助結帳：其他幣別（Stripe）
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config tools/report-worker/wrangler.toml
npm run worker:deploy
```

`GITHUB_TOKEN` 用 fine-grained PAT，只授權兩個 repo：私有 reports repo 的 Contents 讀寫、公開 repo 的 Issues 讀寫。

## 贊助與乾爹排行榜（`/v1/donors`、`/v1/donate/*`，`src/donate.js`）

擴充的贊助頁（`src/donate.html`）用。資料表在 Neon（`donors`、`donation_intents`、`donations`，見 `scripts/lib/donations.mjs`），
**部署前先 `npm run donations:setup` 建表**；管理：`npm run donations:show`、`donations:hide -- <pid> [--clear-image]`、`donations:unhide -- <pid>`。

- `GET /v1/donors`：`{ ok, items: [{ pid, name, avatar: { style } | { url }, usd, count }], totalUsd, donors }`。只算 `status = 'paid'`，同一個 pid 合併、
  依美金累計排序（同額時先達到的在前），最多 200 名；`hidden` 的人不列但算進總額。邊緣快取 1 分鐘，資料表還沒建時回空榜。
- `GET /v1/donors/<pid>/avatar?v=<更新時間>`：上傳的頭像（存在 `donors.avatar_image` 的 data URL 解回圖片），長期快取。
- `POST /v1/donate/checkout`：body（`text/plain` 的 JSON）`{ v: 1, donorId, name, avatar: { style } | { image }, amount, currency, lang, browser, version }`
  → 檢查金額下限（與擴充 `CURRENCIES` 相同）、同 IP 10 分鐘最多 10 次 → 建 Stripe Checkout Session（`price_data` 帶幣別與金額、`client_reference_id` = pid、
  `metadata.intent`）並記一筆 `donation_intents` → 回 `{ ok, url }`。沒設 `STRIPE_SECRET_KEY` 時回 503 `not_configured`。
- 新台幣走**綠界**（個人一般賣家、全方位金流 AIO）：結帳回 `/v1/donate/ecpay/go/<intent>`，這頁算好 CheckMacValue 後自動 form POST 到綠界付款頁
  （`ChoosePayment=ALL`，`IgnorePayment` 去掉 ATM／WebATM，NT$150 以下再去掉超商）。付款結果通知 `POST /v1/donate/webhook/ecpay`：驗 CheckMacValue，
  `RtnCode=1` 且不是模擬付款才記帳，`provider_ref` = 綠界 TradeNo、手續費取 `PaymentTypeChargeFee`；一律回純文字 `1|OK`（失敗回 `0|…` 讓綠界重送）。
  綠界的通知不給付款人 email，所以選新台幣時擴充讓使用者選填 email（存在 `donation_intents.email`），用來自動合併同一位贊助者。
- `POST /v1/donors/profile`：已上榜的人事後改名稱、頭像（body 同結帳的 `donorId`、`name`、`avatar`），沒贊助過回 404 `not_donor`。
- email 自動合併：付款 email（Stripe 付款頁收的，或綠界時擴充選填的）跟另一位贊助者相同，就把這次的 pid 併過去（`donor_aliases`），
  排行榜那一筆多一個 `pids` 陣列，擴充用它認出「你」。
- 其他幣別走 **Stripe**：驗 `Stripe-Signature`（`STRIPE_WEBHOOK_SECRET`），`checkout.session.completed`（已付款）／`checkout.session.async_payment_succeeded`
  寫進 `donations`（`provider_ref` = PaymentIntent，重送不會重複），讀 balance transaction 取手續費、實收（SGD）；美金換算用付款當下 open.er-api.com 的匯率。
  `charge.refunded` → `refunded`、`charge.dispute.created` → `disputed`（都不算進排行榜）。付款當下手續費常常還沒算出來，
  `charge.updated` 帶上 balance transaction 時再補記手續費、實收。Stripe 後台的 webhook 要勾這五個事件；查不到這個環境結帳紀錄的通知會略過（正式與測試環境共用一個 Stripe 帳戶時）。
- `GET /v1/donate/thanks`、`/v1/donate/cancel`：付款完成／取消後導回的頁面（五語，`?lang=`）。

secrets：`ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV`（測試時在 wrangler.toml 的 `[vars]` 加 `ECPAY_STAGE = "1"`，用綠界公開的測試商店 3002607）、
`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`（`npx wrangler secret put <NAME> --config tools/report-worker/wrangler.toml`）。
Stripe 新加坡帳戶的「捐款」只限註冊慈善團體，商品名稱寫成 tip（`PRODUCT_NAME`），Stripe 商家描述也不要寫 donation。

## 確認信（Apps Script）

填了 email 的回報，Worker 會 POST `{ secret, to, lang, id, issueUrl, issueNumber }` 到 `MAIL_URL`。收件端是既有的 Apps Script 專案
「bilibili-cdn-switcher 回報表單同步 issue」（與 `scripts/feedback-form/` 同一個專案，共用已授權的 MailApp）裡的 `Mailer.gs`，
部署成 Web app（執行身分 = 我、存取 = 任何人），以作者的 Gmail 寄出、五語模板；使用者直接回信就進作者的收件匣。
原始碼副本在 `mailer/Mailer.gs`（secret 已遮），改完要在 Apps Script 編輯器「部署 → 管理部署 → 編輯 → 新版本」才會生效。
Gmail 免費帳號每天上限 100 封。Apps Script 對 POST 會先回 302 再給內容，Worker 用 `redirect: "follow"` 即可。

## 網域

- `https://bcs-report.bilibili-cdn-switcher-tools.workers.dev`：**不能關**。已發布的擴充（公告、抽獎、問題回報）與 CDN 測速工具 exe 都寫死這個網址（`wrangler.toml` 的 `workers_dev = true`）。
- `https://api.biboost.app`：同一個 worker 的正式網域（`routes` 的 custom domain），贊助功能用這個；Stripe webhook 也指到這裡。
- 公開網站 `https://biboost.app`（贊助頁網頁版 `/donate`）是另一個只有靜態檔案的 worker：`tools/site/`，`npm run site:deploy`。
