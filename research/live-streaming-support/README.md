# B 站直播 CDN 切換可行性研究

> 調研日期：2026-09-26 · 測試機所在地：新加坡（B 站因此分配海外 `ov-` 直播節點）
> 目的：判斷現有點播（VOD）擴充的「改寫 CDN host」思路能否套用到**直播**，以及切國內節點對 SG 使用者是否真有幫助。
> 結論先行：**技術上可做，但機制與點播完全不同；收益集中在「刷直播的切台首幀速度」，連續觀看幾乎無差。**
> **2026-10-01 更新**：補充驗證後結論有修正，以 **0.1 節**為準。

---

## 0.1 最新結論與建議（2026-10-01，彙總 2.1–2.5）

**結論**

1. **直播節點只在「官方 ov / ov-b / 同號 cn（/cn-b）」裡選就夠了，換其他節點沒有更好。**
   - 擴充清單的點播節點（08c 等 `upos-*`）直播一律 959/403，**完全不能用**；「點播順」與「直播能用」無關（兩套簽名體系）。
   - PiliNara 清單約 170–180 個節點能播 HLS-fMP4（簽名對 fmp4 實際不綁節點），但在 SG 與台灣 VPN 實測**沒有任何一個比官方 ov 更順**，最多打平（2.4）。
   - FLV（約 4–5 成房間只有 FLV）本來就只能用同號 ov/cn/b（2.1）。
2. **三者之間：預設官方 ov 最穩；cn 是否更好取決於時段與協定。** FLV 白天 cn 首幀較快、持續相當（4、5 節）；fMP4 傍晚（大陸晚高峰）cn 明顯較差（2.3）。ov-b 與 ov 表現幾乎相同。
3. **網頁播放器**：有 fMP4 的房間預設就走 HLS-fMP4，否則走 FLV（2.2）。使用者無從切協定，也不需要。

**若要做「直播節點測速 / 手動選擇」——可行，建議設計**（已實測關鍵路徑，見 2.5）：

- **攔截**：直播流（FLV 長連線、m3u8、m4s）都由頁面 `fetch` 發出 → 沿用 `main-hook.js` 的 fetch hook，多匹配 `/live-bvc/` 改 host。
- **頁內切換**：`window.livePlayer.reload()` 會以新 host 重新拉流、不整頁重載（FLV、fMP4 都驗證過）。
- **讀當前節點**：`window.livePlayer.getPlayerInfo().playurl`。
- **候選是動態的**：從當前 host 推出 `ov-gotchaN`、`ov-gotchaNb`、`cn-gotchaN`、`cn-gotchaNb`，先探測剔除 DNS 不存在的（部分 `cn-…b` 不存在）；FLV 與 fMP4 集群號不同（如 07 vs 207），以實際在播的為準。
- **測速指標不能照搬點播的「拉 8MB」**：FLV 是按碼率推送，吞吐≈碼率，量不出餘量。建議每個候選測 5–10 秒，顯示兩項：
  - **起播**：FLV 到第一個 media tag、fMP4 到 m3u8+首片的時間；
  - **持續**：fMP4 用最新分片下載速度；FLV 用「收到節目秒 / 牆上秒」是否 ≥1。
  這兩項是獨立的軸（3 節 Q3），要並列給使用者看，不要合成單一分數。
- **記住的是「偏好 ov / ov-b / cn」，不是具體 host**：集群號隨房間而變，進房後再套到該房的號。
- **預設保持官方**，測速時提示會與正在播放的直播搶頻寬；UI 與點播節點列表分開。

**風險 / 未驗證**

- 播放器帶 P2P 模組（`livePlayer.getP2PTransport()` 回傳物件，含 `downloadExtraFile/shareExtraFile`），P2P 開啟時部分資料可能不經 CDN，測速與切換效果可能失真。
- 所有對比都在同一天傍晚（大陸晚高峰）；台灣是「SG 本機經台灣 VPN」，不等於台灣本地使用者。
- 收益本身偏小：今天的資料裡官方 ov 幾乎總是最好，此功能主要價值在「特定時段/網路下 cn 更快」的使用者與故障備援。

---

## 0. 一句話結論

| 使用方式 | 海外 ov 節點 | 切國內 cn 是否值得 |
|---|---|---|
| **盯著一個台連續看** | 完全夠用（連 10.4Mbps 都零掉隊）| ❌ 幾乎無意義（延遲差 ≤0.6s、掉隊差可忽略）|
| **頻繁刷直播（每台幾秒就切）** | 首幀慢、且有 2–2.7s 冷啟動長尾 | ✅ **明顯有感**（TTFB 砍半、更穩定）|

海外節點的短板**不是頻寬跟不上，而是首幀冷啟動慢（TTFB 長尾）**。這驗證了「海外更差」直覺的一半，但差在**開播/切台延遲**，不在持續播放。

---

## 1. 直播 vs 點播：取流機制根本不同

| 維度 | 點播 VOD | 直播 Live |
|---|---|---|
| 協定 | DASH `.m4s` | FLV（`.flv`）+ HLS（`.m3u8` ts/fmp4）|
| 路徑 | `/upgcxcode/…` | `/live-bvc/…` |
| host 形態 | `*.bilivideo.com` 一大堆通用快取節點 | `d1--{ov\|cn}-gotcha{NN}.bilivideo.com` 指定節點 |
| 可選節點 | 幾十個不同 CDN，隨便挑（08c/阿里/騰訊/Akamai…）| **只有分配給你那個集群號的 cn/ov/b 變體** |
| 現有擴充匹配 | `SEG_RE=/\/upgcxcode\//` 命中 | **不命中**（沒有 `/upgcxcode/`）→ 現狀對直播無效、也無害 |

**現有擴充的點播節點庫（08c/ali/tencent/akamai…）對直播全部 403**——它們不屬於直播基建。直播是獨立的 `gotcha` 節點體系。

---

## 2. 核心機制：token 綁「集群號」，不綁 cn/ov 地區

直播流 URL 帶簽名參數（`expires`/`oi`/`trid`…）。實測換 host：

```
官方節點1  d1--ov-gotcha05        → HTTP 200 ✅ FLV
官方節點2  d1--ov-gotcha05b       → HTTP 200 ✅ FLV
同號國內   d1--cn-gotcha05        → HTTP 200 ✅ FLV      ← 關鍵
別的號     d1--{ov,cn}-gotcha08…  → HTTP 403 ✗          ← token 不認
點播節點   cn-jxnc / upos-…-ali   → HTTP 403 / 959 ✗
```

**結論：signature 綁定「分配給你的集群號 N」，但在同號的 `cn` / `ov` / `b` 之間通用。** 所以可行的切換動作 = 把海外 `ov-gotcha{N}` 改寫成同號國內 `cn-gotcha{N}`。

> ⚠️ 上面這條只對 **FLV** 成立。HLS（尤其 fMP4）不受此限，見 2.1。

### 2.1 補充驗證（2026-10-01）：PiliNara「任意直播節點」是否推翻上述結論？

PiliNara 的直播 CDN 設定就是把 `url_info.host` **整個替換**成使用者指定的 host（`VideoUtils.getLiveCdnUrl`），節點清單是它內建的 `assets/cdn_nodes.json`（362 個 host / 25 區，絕大多數其實是點播節點）；它自己的 UI 也註明「列表節點對直播的有效性未經驗證」。
用 PiliNara 同樣的請求參數（`protocol=0,1&format=0,1,2&codec=0,1`）拿到所有串流變體，逐一換成清單裡每個 host 實測（腳本：`live-any-node-probe.py`；HLS 會再抓 m3u8 裡的分片，分片是相對路徑、確實從替換後的 host 下載、內容為 `moof`）：

| 串流變體 | API 給的集群 | 清單 362 個 host 中可用 | 說明 |
|---|---|:--:|---|
| `http_stream` / FLV | `gotcha05` / `gotcha07` | **0–1** | 只有同號 `cn-gotcha{N}(b)` 能用 → **原結論成立** |
| `http_hls` / TS | `gotcha105` | 2–13，不穩定 | 少數點播節點偶爾放行，重測常變 403 |
| `http_hls` / fMP4 | `gotcha207` | **~178–180（約一半）** | 各省 `cn-xxx-cm/cu/ct` 點播節點、`cn-gotcha204-*`、`c0--cn-gotcha01` 都能播；別號 gotcha 回 400，香港/海外/upos 節點 403/959 |

三種變體的 `sigparams` 都含 `cdn=ov-gotchaNNN`，但 fMP4 路徑上的節點**實際不校驗 `cdn` 欄位**，FLV 節點會校驗。

**修正後的結論：**
- **FLV（API 預設第一個串流、本擴充先前的研究對象）**：仍然只能在「同集群號的 ov / cn / b」中選 → 原結論正確。
- **HLS-fMP4**：簽名實際上不綁節點，可以自由選約一半的國內點播節點。PiliNara 的「自由選節點」只在使用者把串流切到 HLS 時才真正有效；預設 FLV 下選清單節點基本都會失敗。
### 2.2 補充驗證（2026-10-01）：網頁版實際用哪種串流？HLS 覆蓋率？

**網頁播放器的選擇（Playwright / Chrome 實測）**：有 fMP4 的房間 → **預設就走 HLS-fMP4**（`index.m3u8` + `.m4s`，經 `fetch`）；沒有 fMP4 的房間 → 退回 FLV。從未看到它選 TS。
→ 前面 1–7 節以 FLV 為對象的測量，只代表「無 fMP4 房間」；有 fMP4 的房間網頁本來就在播 HLS。

**HLS-fMP4 覆蓋率**（`getRoomPlayInfo` 實測 197 個直播中房間）：

| 樣本 | 有 fMP4 | 有 FLV | 有 TS |
|---|:--:|:--:|:--:|
| 熱門推薦 90 間 | 64（71%）| 90 | 90 |
| 各分區最新開播（小台）107 間 | 55（51%）| 105 | 105 |

（另有 2 間只有 fMP4、沒有 FLV/TS。）→ **約 4–5 成房間沒有 fMP4，只能走 FLV，仍受集群號限制。**

**擴充可否切換**：網頁沒有給使用者切協定的 UI，但也不需要——有 fMP4 的房間播放器已自動用它。擴充端：m3u8 與分片都由頁面 `fetch` 發出，可沿用點播的「分段 host 改寫」做法（匹配 `/live-bvc/`）。從 `live.bilibili.com` 頁面內 fetch 換 host 後的 URL 實測 **CORS 通過**：

| 換成的 host | m3u8 | 分片 |
|---|---|---|
| `cn-tj-cu-01-05` | 200 / 2.3s | 869KB / 1.4s |
| `cn-jssz-cm-02-07` | 200 / 2.0s | 802KB / 1.0s |
| `cn-gddg-ct-01-10` | 200 / 3.6s | 559KB / 2.2s |
| `d1--cn-gotcha207` | 200 / 2.5s | 102KB / 1.0s |
| `cn-hk-eq-01-01` | 403 | — |

無 fMP4 的房間無法靠改 API 回應「變出」fMP4，只能維持 FLV 同號 cn/ov/b 切換。

### 2.3 補充驗證（2026-10-01 傍晚 SG）：擴充清單裡「點播順」的節點能播直播嗎？

腳本：`live-vod-nodes.py`。對 `src/cdn-list.json` 全部節點量點播吞吐（av170001 拉 8MB）+ 直播各格式狀態；fmp4 可用者再與官方 ov / 同號 cn **並行**模擬 HLS 播放 60s。跑了 2 個房間，結論一致。

**可用性**：
- `upos-*`（08c / 08h / 08ct / ali* / hw* / tf_hw / aliov）：點播 9–60 Mbps，直播 flv/ts/fmp4 **一律 959**（回應帶 `X-Upsig-Version`：upos 只認點播的 upsig 簽名）。
- `upos-*cos*` / `tf_tx` / `akamai`：直播一律 403。
- 只有預設節點 `cn-jxnc-cmcc-bcache-06` 能播直播，且只限 fmp4（flv/ts 403）。
→ **08c 點播 44–61 Mbps，但直播完全不能用。** 「點播順」與「直播能用」無關：upos 源站系與直播 gotcha 系是兩套簽名體系。

**持續播放（fmp4，60s 並行）**：

| 房間 | 節點 | 分片吞吐 | 即時比 | 緩衝見底次數 |
|---|---|:--:|:--:|:--:|
| 22908869 | 官方 `ov-gotcha207` | 5.9 Mbps | 1.09 | **0** |
| | 同號 `cn-gotcha207` | 0.7 Mbps | 0.98 | 26 |
| | `cn-jxnc-cmcc-bcache-06` | 1.3 Mbps | 0.99 | 20 |
| 25828093 | 官方 `ov-gotcha208` | 14.2 Mbps | 1.06 | **0** |
| | 同號 `cn-gotcha208` | 1.8 Mbps | 0.97 | 16 |
| | `cn-jxnc-cmcc-bcache-06` | 5.3 Mbps | 0.99 | 26 |

（「見底」用較嚴格的模型：從最新分片起播、只有約 1 片緩衝，絕對次數偏高，但同時段並行的**相對比較**有效。）
→ 這個時段，**能連上的國內節點播直播都明顯不如官方 ov**：即時比 <1、頻繁見底。和第 4 節（FLV、cn≈ov）不同，可能與時段（大陸晚高峰）有關，需換時段重測。

### 2.4 補充驗證（2026-10-01 傍晚 SG）：PiliNara 能播直播的節點，會比官方更順嗎？

腳本：`live-pilinara-nodes.py`。階段 1 把 PiliNara 清單 362 個 host 都拉最新 2 片 fmp4 篩速度（178 個可播）；階段 2 取最快幾個與官方 ov / ov-b **並行**模擬播放 90s。播放器模型比 2.3 寬鬆、較接近真實：先緩衝 3 片才起播，見底算卡頓一次、從下一片重新起播。

| 房間（qn） | 節點 | 分片吞吐 | 起播 | 卡頓次數 | 卡頓總秒數 |
|---|---|:--:|:--:|:--:|:--:|
| 25828093（10000 原畫） | 官方 `ov-gotcha207` / `207b` | 21 Mbps | 1.0s | **0** | **0** |
| | 最快 6 個國內節點（`cn-jssz-cm-02-31/42/20`、`cn-zjhz-cm-01-17`、`cn-fjqz-cm-01-07`、`cn-tj-cm-02-05`）| 5.8–6.5 Mbps | 3.3–3.8s | 13–22 | 7–25s |
| 22908869（250 超清） | 官方 `ov-gotcha207` / `207b` | 5.7–5.9 Mbps | 0.7s | **0** | **0** |
| | 最快 6 個國內節點（`cn-jssz-cm-02-08/25/07/35`、`cn-gddg-cm-01-06`、`cn-zjhz-cm-01-17`）| 1.7–2.0 Mbps | 2.2–5.7s | 0–5 | 0–4.8s |

階段 1 兩個房間的速度第 1、2 名都是官方 ov / ov-b，國內節點最好也只有官方的約 6 成（25828093：10.7 vs 18.0 Mbps）。
→ **在 SG，PiliNara 清單裡沒有任何節點比官方 ov 更順**：官方起播快 3–5 倍、零卡頓；國內節點高碼率時 90s 內卡 7–25 秒。
→ 對 SG 使用者，「直播換節點」目前沒有收益；若要做，至少得換時段（避開大陸晚高峰）、換地區（如台灣）重測後再決定。

**台灣出口重測（同日晚間，SG 本機 → 台灣 VPN，出口 HiNet，B 站判定「台灣」）**：
- VPN 單連線僅約 17 Mbps（SG 直連同節點 209 Mbps），8 路原畫並行會互搶，所以原畫房間改用 `SEQ=1` 逐一測（官方與候選交替，每個 60s）。
- 階段 1 兩個房間第 1、2 名仍是官方 ov / ov-b。

| 房間（qn） | 節點 | 分片吞吐 | 起播 | 卡頓次數 | 卡頓秒數 |
|---|---|:--:|:--:|:--:|:--:|
| 25828093（原畫，逐一） | 官方 `ov-gotcha208`（5 次） | 5.4–5.8 Mbps | 3.4–4.4s | 25–45 | 6.5–13.4s |
| | `cn-gddg-ct-01-24/12/15`、`cn-zjjh-ct-04-33` | 5.2–6.3 Mbps | 3.7–5.6s | 14–20 | 9.2–24.6s |
| 22908869（超清，並行） | 官方 `ov-gotcha207` / `207b` | 2.9 Mbps | 1.5s | **0** | **0** |
| | `cn-fjqz-cm-01-01/02/03` | 1.5 Mbps | 2.8–2.9s | 0 | 0 |
| | `cn-gddg-ct-01-10/11`、`cn-zjjh-ct-04-27` | 1.5–1.6 Mbps | 2.8–3.2s | 2–9 | 1.7–7.8s |

→ 原畫兩邊都卡，吞吐都約 5.5 Mbps，瓶頸在 VPN 鏈路而不是節點：國內節點卡頓次數較少，但卡頓總秒數相當或更多，**打平**。超清官方仍是唯一「起播最快且零卡頓」的。
→ 結論與 SG 一致：**沒有節點比官方 ov 更順**。
⚠️ 這是「SG 本機經台灣 VPN」，路徑多繞一段、RTT 較高，不等於真正在台灣的 HiNet 使用者；要定論需台灣本地使用者實跑。

- 尚未驗證：其他時段（避開大陸晚高峰）、真正台灣本地網路的表現。

### 2.5 補充驗證（2026-10-01）：擴充能否在網頁內切換直播節點？

方法：Playwright（Chrome，未登錄）在頁面注入與 `main-hook.js` 同形的 fetch hook（`/live-bvc/` 改 host），再調 `window.livePlayer.reload()`，觀察請求 host 與 `<video>` 狀態。

| 房間 | 協定 | 請求類型 | ov → cn | → ov-b |
|---|---|---|---|---|
| 25828093 | HLS-fMP4（`gotcha208`）| `fetch`（m3u8、m4s）| ✅ 請求全轉到 `cn-gotcha208`，繼續播放 | ✅ 轉到 `ov-gotcha208b`，繼續播放 |
| 1936495164 | FLV（`gotcha05`）| `fetch`（單條長連線）| ✅ 繼續播放 | ✅ 繼續播放 |
| 32184621 | FLV（`gotcha07`）| `fetch` | 首次切換後一度 `paused`；對照組（只 `reload()` 不換 host）正常，再切 cn 也正常播放 → 判定為偶發 | ✅ 可拉流 |

- `livePlayer` 可用方法含 `reload / refresh / loadVideo / getPlayerInfo / switchQuality / getP2PTransport` 等。
- `getPlayerInfo().playurl` 可直接取得當前完整播放 URL（含 host）。
- `data.bilibili.com` 的打點上報會帶上 `.flv` URL（XHR），匹配時須同時驗 host，與點播 `isSegUrl` 的教訓相同。抽測 `cn-gddg-ct-01-10` 拉一個 156KB 分片要 2.5s（≈0.5 Mbps），明顯不夠 2.5 Mbps 的流；能連上 ≠ 能流暢播，若要做「HLS 任意節點」需另做持續吞吐測試。

---

## 3. 三個方法學問題的實測答案

### Q1：host 的 `b` 後綴 = backup？→ 是
API 回傳的 `url_info` 永遠「非-b 在 `[0]`、`b` 在 `[1]`」，同集群號、同 token；且部分 `cn-gotcha{N}b` 根本 DNS 不存在（非必部署）。→ `b` = 同集群的次要/備份邊緣。
（腳本：`live-cluster-probe.py`）

### Q2：每次調 API 集群號都不同？→ 否，基本「按房間黏住」
同房間連調 12 次：
```
room 545068      → 05×10, 07×2
room 23899847    → 07×11, 05×1
room 1746709913  → 07×12（恆定）
```
每個房間有主導集群號（由 房間+你的 IP/地區 決定），偶爾才跳。**「重搖 API」幾乎給不了選擇**——你實際被鎖在 ~1 個集群，可用的就是它的 cn/ov/b（通常 2–3 個）。
（腳本：`live-cluster-probe.py`）

### Q3：卡頓只看 TTFB？→ 否
TTFB 只反映「第一個字節多快到」（開播/切台快慢）。卡頓要看「能否持續穩定 ≥ 碼率」——即最低窗吞吐、抖動、邊緣節點回源能力。實測中 cn 的 TTFB 比 ov 好 4 倍，但持續吞吐/抖動兩者相近，證明兩者是**獨立的軸**。
（腳本：`live-smoothness.py`、`live-lag-drift.py`）

---

## 4. 場景 A：高碼率連續播放（綜合穩定度）

方法：3 個高碼率房間（10.4 / 6.3 / 5.7 Mbps），同一 token 下 **ov 與 cn 並行**各拉 60s；用 FLV 媒體時間戳算 `ratio=收到節目秒/牆上秒`、drift 走勢、掉隊秒、絕對直播延遲。（腳本：`live-hbr-sustained.py`）

| 房間(碼率) | 節點 | ratio | 掉隊 | drift 走勢 | 絕對延遲 |
|---|---|:--:|:--:|---|---|
| 1703958289 (10.4M) | ov | 1.029 | 0 | 平 ~-1.7s | 基準 |
| | cn | 1.019 | 0 | 平 ~-1.2s | 快 0.6s |
| 31405244 (6.3M) | ov | 1.087 | 0 | 平 ~-5.2s | 基準 |
| | cn | 1.087 | 0 | 平 ~-5.2s | 0.0s（完全相同）|
| 23899847 (5.7–6.3M) | ov | 1.156 | 1 | 平 ~-9.4s | 基準 |
| | cn | 1.036 | 0 | 平 ~-2.2s | 快 0.1s |

**綜合**：ov 平均 ratio 1.091 / 掉隊 0.3s；cn 平均 ratio 1.047 / 掉隊 0s。
→ **兩邊都穩，連 10.4Mbps 都零掉隊**；cn 僅微弱佔優（掉隊 0 vs 0.3、離源近 ≤0.6s），不足以成為理由。

---

## 5. 場景 B：刷直播切台（首幀 TTFB）

方法：10 個直播，每台停留 3s 就切；每台重新調 `getRoomPlayInfo`，測 ov 與 cn 從請求到第一個 FLV media tag 的時間（≈點開到第一幀）。（腳本：`live-surf-ttfb.py`）

| | 平均 | 中位 | 範圍 | 勝場 |
|---|:--:|:--:|:--:|:--:|
| 海外 ov | 1562ms | 1519ms | 376–**2741** | 3/10 |
| 國內 cn | **724ms** | **726ms** | 435–1236 | **7/10** |

- 調 `getRoomPlayInfo` 本身每次 ~553ms（兩邊都要付）。
- 每切一次總成本：ov ≈ 553+1562 ≈ **2115ms**；cn ≈ 553+724 ≈ **1277ms**。
- **勝場算法**：同一房間誰的 TTFB 數字更小算誰贏（只看誰快、不看快多少，故看幅度用均值/中位）；每房間先測 ov、停留 3s、再測 cn（非同一瞬間，屬方法學小瑕疵，可改並行）。

→ **刷直播時 cn 快近一倍、分佈更窄**（海外會冒 2–2.7s 冷啟動長尾，cn 最差才 1236ms）。切台越頻繁越有感。

---

## 6. 可行性判斷與實作建議

> ⚠️ 本節為 2026-09-26 初版（只考慮 FLV、改寫 API 回應）。最新建議見 **0.1 節**。

**值得做的前提：你在意「刷直播」體驗。** 若只盯一個台看，收益太小、不值得。

若要實作（獨立於點播的一套邏輯）：
1. 攔截直播 `getRoomPlayInfo` 響應（或直播流請求 `/live-bvc/…`）。
2. 從 host 解析集群號 `N`（`d1--(ov|cn)-gotcha(N)`）。
3. 把 host 改寫成同號國內 `d1--cn-gotcha{N}.bilivideo.com`。
4. 必須處理的邊界：
   - **只能同號**（換別的號 → 403）；
   - 部分 `cn-gotcha{N}b` **DNS 不存在** → 用前先探測；
   - 改寫後若 403/失敗 → **回退**到原 ov host；
   - 更穩的做法：**cn/ov 都探一下挑快的**（ov 偶爾也快，3/10）。
5. UX：一個「直播優先國內節點」開關即可，跟點播的節點列表 UI 分開。

**做不到的路（記錄備查）**：anti-ip-attribution 那種「讓 `api.live.bilibili.com` 解析到國內 IP，騙 B 站分配國內集群」是 DNS/hosts 層，**瀏覽器擴充做不到**。

---

## 7. 侷限與注意

- 全部資料來自**單一機器 / 單一網路（SG）/ 單一時段**。TTFB 尤其隨網路與時段波動，勝負比例不代表恆定。
- 場景 A 的 drift 已按每條連接自身起點歸一化（測 keep-up）；絕對延遲另用「同時刻第一個 tag 的媒體時間線位置」對比。
- 場景 B 的 ov/cn 非同一瞬間測（差 ~3s），嚴格化需改並行。
- 直播間會隨時下播/改碼率，重跑腳本時房間號可能需替換（腳本支援用命令列參數傳入房間號）。

---

## 8. 測試檔案清單

全部位於 `research/live-streaming-support/`，**純研究用、不屬於擴充、`src/` 與打包腳本完全未改、隨時可刪**：

| 檔案 | 驗證內容 | 用法 |
|---|---|---|
| `live-cluster-probe.py` | Q1 `b` 含義 / Q2 集群號分佈 | `python3 research/live-streaming-support/live-cluster-probe.py` |
| `live-smoothness.py` | Q3 TTFB vs 持續穩定度 | `python3 research/live-streaming-support/live-smoothness.py` |
| `live-lag-drift.py` | 單流 媒體時間 vs 牆上時間 落後 | `python3 research/live-streaming-support/live-lag-drift.py [秒]` |
| `live-hbr-sustained.py` | 場景A 高碼率連續播放 ov vs cn | `python3 research/live-streaming-support/live-hbr-sustained.py [秒] [room…]` |
| `live-surf-ttfb.py` | 場景B 刷直播切台 TTFB | `python3 research/live-streaming-support/live-surf-ttfb.py [停留秒] [room…]` |
| `live-vod-nodes.py` | 2.3 擴充清單節點：點播吞吐 vs 直播可用性/持續播放 | `python3 research/live-streaming-support/live-vod-nodes.py [room\|auto] [秒]` |
| `live-pilinara-nodes.py` | 2.4 PiliNara 可播節點 vs 官方 ov 持續播放 | `python3 research/live-streaming-support/live-pilinara-nodes.py [room\|auto] [秒] [TOP]` |
| `live-any-node-probe.py` | 2.1 任意節點（PiliNara 清單）× 各串流變體可用性 | `python3 research/live-streaming-support/live-any-node-probe.py [房間數] [cdn_nodes.json]` |

依賴：只用 Python 標準庫；需要倉庫根目錄的 `.env.local` 裡的 `BILI_COOKIE`（與截圖腳本共用）。

---

## 9. 參考

- [Kanda-Akihito-Kun/ccb](https://github.com/Kanda-Akihito-Kun/ccb)（聲稱支援直播，使用者實測「直播拉不下來」，有限）
- [anti-ip-attribution #53 — B站直播觀看 解決分配海外CDN](https://github.com/SunsetMkt/anti-ip-attribution/issues/53)
- [Make-Bilibili-Great-Than-Ever-Before #26 — 直播 PCDN](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before/issues/26)
