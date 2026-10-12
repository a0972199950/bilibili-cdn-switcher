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

## 部署

```sh
npx wrangler login
npx wrangler kv namespace create RATE_KV --config tools/report-worker/wrangler.toml   # 把 id 填回 wrangler.toml
npx wrangler secret put GITHUB_TOKEN --config tools/report-worker/wrangler.toml
npx wrangler secret put REPORT_TOKEN --config tools/report-worker/wrangler.toml
npx wrangler secret put MAIL_URL --config tools/report-worker/wrangler.toml      # Apps Script web app /exec
npx wrangler secret put MAIL_SECRET --config tools/report-worker/wrangler.toml
npm run worker:deploy
```

`GITHUB_TOKEN` 用 fine-grained PAT，只授權兩個 repo：私有 reports repo 的 Contents 讀寫、公開 repo 的 Issues 讀寫。

## 確認信（Apps Script）

填了 email 的回報，Worker 會 POST `{ secret, to, lang, id, issueUrl, issueNumber }` 到 `MAIL_URL`。收件端是既有的 Apps Script 專案
「bilibili-cdn-switcher 回報表單同步 issue」（與 `scripts/feedback-form/` 同一個專案，共用已授權的 MailApp）裡的 `Mailer.gs`，
部署成 Web app（執行身分 = 我、存取 = 任何人），以作者的 Gmail 寄出、五語模板；使用者直接回信就進作者的收件匣。
原始碼副本在 `mailer/Mailer.gs`（secret 已遮），改完要在 Apps Script 編輯器「部署 → 管理部署 → 編輯 → 新版本」才會生效。
Gmail 免費帳號每天上限 100 封。Apps Script 對 POST 會先回 302 再給內容，Worker 用 `redirect: "follow"` 即可。
