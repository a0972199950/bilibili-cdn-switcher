---
name: collect-speedtest-mail
description: 從使用者 Gmail 收取 CDN 測速 GUI 寄來的「[CDN 測速]」報告信，驗證附件、排除 VPN／重複／無效報告後，依國家歸檔到 cdn-speedtest-results/<國家>/，處理完的信移到垃圾桶。使用者說「收測速信」「抓測速報告」「整理 Gmail 的測速結果」或輸入 /collect-speedtest-mail 時使用。
---

# /collect-speedtest-mail

CDN 測速 GUI（`tools/cdn-speedtest-app`）測完會經 Apps Script（`apps-script/Code.gs` 的 `handleReport()`）寄一封信給使用者自己：

- 標題：`[CDN 測速][TEST]?[必中]? {國家} {城市} ｜ {ISP} ｜ {網路類型} ｜ {email 或「無 email」} #{rid}`
- 附件：`{TEST-}{國家}-{yyyyMMdd-HHmm}-{rid}-REPORT.md` 與 `…-summary.json`（`rid` = 8 碼報告編號，每封信不同）

本技能把這些信的附件收進 `cdn-speedtest-results/<國家>/<base>/`（gitignored，含出口 IP，絕不 commit），**處理過的信移到垃圾桶**，下次執行就只會看到新信（以刪信達成增量）。只負責收取與歸檔，不做跨報告的彙整分析。

以下 `$SK` = `.claude/skills/collect-speedtest-mail`，`$R` = `cdn-speedtest-results`，`$A` = `~/.workspace-mcp/attachments`（MCP 存附件的位置），都在 repo 根目錄執行。

## 依賴

- **google-workspace MCP**（stdio 模式，附件才會直接存到本機 `$A`；若回傳的是下載網址而非本機路徑，代表是 HTTP 模式，停下來告訴使用者）。用到：`search_gmail_messages`、`get_gmail_messages_content_batch`、`get_gmail_attachment_content`、`batch_modify_gmail_message_labels`。
- 帳號一律用使用者的 Gmail（`user_google_email` 帶使用者 email）。授權失效時呼叫 `start_google_auth`，請使用者在瀏覽器同意後再繼續。
- Python 3（標準函式庫即可）。腳本一律用 `python -I` 執行。

## 原則

- **不要把附件內容讀進上下文**。REPORT.md／summary.json 只由 `collect.py` 在本機檢查，你只看它印出的每份一行結果。
- **只移到垃圾桶（`TRASH` 標籤），不永久刪除**，30 天內可救回；Drive 與試算表另有備份。
- 只處理標題**以 `[CDN 測速]` 開頭**的信。Gmail 的 subject 搜尋是斷詞比對，會撈到「🎉 謝謝你協助 Bilibili CDN 測速！」這類確認信，這些不要碰。

## 流程

### 1. 搜信

```
search_gmail_messages(query='subject:"[CDN 測速]" has:attachment', page_size=100, include_headers=true)
```

有 `next_page_token` 就繼續翻頁直到取完。篩掉標題不是 `[CDN 測速]` 開頭的；從標題結尾 `#xxxxxxxx` 取出 rid，建立 rid → message_id 對照。沒有任何信就回報「沒有新報告」並結束（仍執行第 5 步清暫存）。

### 2. 排除本機已有的

```bash
python -I $SK/collect.py known $R
```

rid 已在清單內的信**不用下載**，直接列入待刪。

### 3. 下載附件

其餘的信用 `get_gmail_messages_content_batch`（每批最多 25 封）取得附件清單，再對每個附件呼叫：

```
get_gmail_attachment_content(message_id=…, attachment_id=…, attachment_index=…)
```

- 附件 ID 會過期，一律用**最近一次** batch 回傳的 ID。
- 只下載檔名符合 `…-REPORT.md`／`…-summary.json` 的附件；信裡沒有這兩個附件的，該信列入「保留」並回報。
- 下載都互相獨立，可以同一輪平行呼叫。

### 4. 驗證、去重、歸檔

先 dry-run 看結果，沒問題再正式執行：

```bash
python -I $SK/collect.py import $A $R --dry
python -I $SK/collect.py import $A $R
```

`collect.py` 的判斷：

| 狀況 | 處理 | 信 |
|---|---|---|
| 檔名 `TEST-` 開頭 | 略過 | 刪 |
| rid 本機已存在 | 略過 | 刪 |
| 缺 REPORT 或 summary、或無法解析 | 略過 | **保留**（可能是 app／Apps Script 的 bug，留著查） |
| summary 缺 `country`／`time`／`default`／`rows`，或 `stage2.full_success` 為 0 | 無效，略過 | 刪 |
| `env.vpn_check.vpn` 為 true（任一 VPN／代理訊號，含只有 proxycheck 判定） | 略過，**一律不收**（只要準確的當地網路資料） | 刪 |
| 內容指紋（國家＋測試時間＋出口 IP＋seed＋`rows` 雜湊）與已有或同批較早的相同 | 重複送出，略過 | 刪 |
| 其餘 | 複製到 `$R/<summary.country>/<base>/<base>-REPORT.md`、`-summary.json` | 刪 |

最後一行 `RESULT {"trash": [...], "keep": [...]}` 是 rid 清單。正式執行時腳本會一併刪除 `$A` 中所有符合測速附件檔名的暫存檔（不動其他檔案）。

### 5. 移信到垃圾桶、清暫存

把第 2 步的已有 rid 與 `RESULT.trash` 對應回 message_id：

```
batch_modify_gmail_message_labels(message_ids=[…], add_label_ids=["TRASH"])
```

確認回報的每個 id 都已變更；沒變更的列出來告訴使用者。

確認 `$A` 已沒有測速附件暫存檔（例如中途失敗、沒跑到正式 import 時）；有的話執行 `python -I $SK/collect.py import $A $R` 或手動刪除**符合測速附件檔名**的檔案，不要清空整個 `$A`。

### 6. 回報

簡短列出：新增幾份（依國家分組，每份一行：base、城市、建議預設節點）、略過幾份與原因、保留未刪的信（附 Gmail 連結）、各國目前總份數（`ls $R/*/ | wc -l` 之類）。
