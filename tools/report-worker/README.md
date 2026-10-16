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
快取：邊緣 1 分鐘（同 `/v1/lotteries`；各邊緣節點各自快取，新增後不同節點可能要等滿 1 分鐘才一致）、擴充另外 15 分鐘（`storage.local.announcementFeed`），
改了公告最慢約 16 分鐘使用者看得到。

## 部署

```sh
npx wrangler login
npx wrangler kv namespace create RATE_KV --config tools/report-worker/wrangler.toml   # 把 id 填回 wrangler.toml
npx wrangler secret put GITHUB_TOKEN --config tools/report-worker/wrangler.toml
npx wrangler secret put REPORT_TOKEN --config tools/report-worker/wrangler.toml
npx wrangler secret put MAIL_URL --config tools/report-worker/wrangler.toml      # Apps Script web app /exec
npx wrangler secret put MAIL_SECRET --config tools/report-worker/wrangler.toml
npx wrangler secret put DATABASE_URL --config tools/report-worker/wrangler.toml   # Neon 連線字串（抽獎跑馬燈）
npm run worker:deploy
```

`GITHUB_TOKEN` 用 fine-grained PAT，只授權兩個 repo：私有 reports repo 的 Contents 讀寫、公開 repo 的 Issues 讀寫。

## 確認信（Apps Script）

填了 email 的回報，Worker 會 POST `{ secret, to, lang, id, issueUrl, issueNumber }` 到 `MAIL_URL`。收件端是既有的 Apps Script 專案
「bilibili-cdn-switcher 回報表單同步 issue」（與 `scripts/feedback-form/` 同一個專案，共用已授權的 MailApp）裡的 `Mailer.gs`，
部署成 Web app（執行身分 = 我、存取 = 任何人），以作者的 Gmail 寄出、五語模板；使用者直接回信就進作者的收件匣。
原始碼副本在 `mailer/Mailer.gs`（secret 已遮），改完要在 Apps Script 編輯器「部署 → 管理部署 → 編輯 → 新版本」才會生效。
Gmail 免費帳號每天上限 100 封。Apps Script 對 POST 會先回 302 再給內容，Worker 用 `redirect: "follow"` 即可。
