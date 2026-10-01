# B 站直播 CDN 切换可行性研究

> 调研日期：2026-09-26 · 测试机所在地：新加坡（B 站因此分配海外 `ov-` 直播节点）
> 目的：判断现有点播（VOD）扩充的「改写 CDN host」思路能否套用到**直播**，以及切国内节点对 SG 用户是否真有帮助。
> 结论先行：**技术上可做，但机制与点播完全不同；收益集中在「刷直播的切台首帧速度」，连续观看几乎无差。**
> **2026-10-01 更新**：补充验证后结论有修正，以 **0.1 节**为准。

---

## 0.1 最新结论与建议（2026-10-01，汇总 2.1–2.5）

**结论**

1. **直播节点只在「官方 ov / ov-b / 同号 cn（/cn-b）」里选就够了，换其他节点没有更好。**
   - 扩充清单的点播节点（08c 等 `upos-*`）直播一律 959/403，**完全不能用**；「点播顺」与「直播能用」无关（两套签名体系）。
   - PiliNara 清单约 170–180 个节点能播 HLS-fMP4（签名对 fmp4 实际不绑节点），但在 SG 与台湾 VPN 实测**没有任何一个比官方 ov 更顺**，最多打平（2.4）。
   - FLV（约 4–5 成房间只有 FLV）本来就只能用同号 ov/cn/b（2.1）。
2. **三者之间：默认官方 ov 最稳；cn 是否更好取决于时段与协议。** FLV 白天 cn 首帧较快、持续相当（4、5 节）；fMP4 傍晚（大陆晚高峰）cn 明显较差（2.3）。ov-b 与 ov 表现几乎相同。
3. **网页播放器**：有 fMP4 的房间默认就走 HLS-fMP4，否则走 FLV（2.2）。用户无从切协议，也不需要。

**若要做「直播节点测速 / 手动选择」——可行，建议设计**（已实测关键路径，见 2.5）：

- **拦截**：直播流（FLV 长连线、m3u8、m4s）都由页面 `fetch` 发出 → 沿用 `main-hook.js` 的 fetch hook，多匹配 `/live-bvc/` 改 host。
- **页内切换**：`window.livePlayer.reload()` 会以新 host 重新拉流、不整页重载（FLV、fMP4 都验证过）。
- **读当前节点**：`window.livePlayer.getPlayerInfo().playurl`。
- **候选是动态的**：从当前 host 推出 `ov-gotchaN`、`ov-gotchaNb`、`cn-gotchaN`、`cn-gotchaNb`，先探测剔除 DNS 不存在的（部分 `cn-…b` 不存在）；FLV 与 fMP4 集群号不同（如 07 vs 207），以实际在播的为准。
- **测速指标不能照搬点播的「拉 8MB」**：FLV 是按码率推送，吞吐≈码率，量不出余量。建议每个候选测 5–10 秒，显示两项：
  - **起播**：FLV 到第一个 media tag、fMP4 到 m3u8+首片的时间；
  - **持续**：fMP4 用最新分片下载速度；FLV 用「收到节目秒 / 墙上秒」是否 ≥1。
  这两项是独立的轴（3 节 Q3），要并列给用户看，不要合成单一分数。
- **记住的是「偏好 ov / ov-b / cn」，不是具体 host**：集群号随房间而变，进房后再套到该房的号。
- **默认保持官方**，测速时提示会与正在播放的直播抢带宽；UI 与点播节点列表分开。

**风险 / 未验证**

- 播放器带 P2P 模块（`livePlayer.getP2PTransport()` 回传对象，含 `downloadExtraFile/shareExtraFile`），P2P 开启时部分数据可能不经 CDN，测速与切换效果可能失真。
- 所有对比都在同一天傍晚（大陆晚高峰）；台湾是「SG 本机经台湾 VPN」，不等于台湾本地用户。
- 收益本身偏小：今天的数据里官方 ov 几乎总是最好，此功能主要价值在「特定时段/网络下 cn 更快」的用户与故障备援。

---

## 0. 一句话结论

| 使用方式 | 海外 ov 节点 | 切国内 cn 是否值得 |
|---|---|---|
| **盯着一个台连续看** | 完全够用（连 10.4Mbps 都零掉队）| ❌ 几乎无意义（延迟差 ≤0.6s、掉队差可忽略）|
| **频繁刷直播（每台几秒就切）** | 首帧慢、且有 2–2.7s 冷启动长尾 | ✅ **明显有感**（TTFB 砍半、更稳定）|

海外节点的短板**不是带宽跟不上，而是首帧冷启动慢（TTFB 长尾）**。这验证了「海外更差」直觉的一半，但差在**开播/切台延迟**，不在持续播放。

---

## 1. 直播 vs 点播：取流机制根本不同

| 维度 | 点播 VOD | 直播 Live |
|---|---|---|
| 协议 | DASH `.m4s` | FLV（`.flv`）+ HLS（`.m3u8` ts/fmp4）|
| 路径 | `/upgcxcode/…` | `/live-bvc/…` |
| host 形态 | `*.bilivideo.com` 一大堆通用缓存节点 | `d1--{ov\|cn}-gotcha{NN}.bilivideo.com` 指定节点 |
| 可选节点 | 几十个不同 CDN，随便挑（08c/阿里/腾讯/Akamai…）| **只有分配给你那个集群号的 cn/ov/b 变体** |
| 现有扩充匹配 | `SEG_RE=/\/upgcxcode\//` 命中 | **不命中**（没有 `/upgcxcode/`）→ 现状对直播无效、也无害 |

**现有扩充的点播节点库（08c/ali/tencent/akamai…）对直播全部 403**——它们不属于直播基建。直播是独立的 `gotcha` 节点体系。

---

## 2. 核心机制：token 绑「集群号」，不绑 cn/ov 地区

直播流 URL 带签名参数（`expires`/`oi`/`trid`…）。实测换 host：

```
官方节点1  d1--ov-gotcha05        → HTTP 200 ✅ FLV
官方节点2  d1--ov-gotcha05b       → HTTP 200 ✅ FLV
同号国内   d1--cn-gotcha05        → HTTP 200 ✅ FLV      ← 关键
别的号     d1--{ov,cn}-gotcha08…  → HTTP 403 ✗          ← token 不认
点播节点   cn-jxnc / upos-…-ali   → HTTP 403 / 959 ✗
```

**结论：signature 绑定「分配给你的集群号 N」，但在同号的 `cn` / `ov` / `b` 之间通用。** 所以可行的切换动作 = 把海外 `ov-gotcha{N}` 改写成同号国内 `cn-gotcha{N}`。

> ⚠️ 上面这条只对 **FLV** 成立。HLS（尤其 fMP4）不受此限，见 2.1。

### 2.1 补充验证（2026-10-01）：PiliNara「任意直播节点」是否推翻上述结论？

PiliNara 的直播 CDN 设置就是把 `url_info.host` **整个替换**成用户指定的 host（`VideoUtils.getLiveCdnUrl`），节点清单是它内置的 `assets/cdn_nodes.json`（362 个 host / 25 区，绝大多数其实是点播节点）；它自己的 UI 也注明「列表节点对直播的有效性未经验证」。
用 PiliNara 同样的请求参数（`protocol=0,1&format=0,1,2&codec=0,1`）拿到所有串流变体，逐一换成清单里每个 host 实测（脚本：`live-any-node-probe.py`；HLS 会再抓 m3u8 里的分片，分片是相对路径、确实从替换后的 host 下载、内容为 `moof`）：

| 串流变体 | API 给的集群 | 清单 362 个 host 中可用 | 说明 |
|---|---|:--:|---|
| `http_stream` / FLV | `gotcha05` / `gotcha07` | **0–1** | 只有同号 `cn-gotcha{N}(b)` 能用 → **原结论成立** |
| `http_hls` / TS | `gotcha105` | 2–13，不稳定 | 少数点播节点偶尔放行，重测常变 403 |
| `http_hls` / fMP4 | `gotcha207` | **~178–180（约一半）** | 各省 `cn-xxx-cm/cu/ct` 点播节点、`cn-gotcha204-*`、`c0--cn-gotcha01` 都能播；别号 gotcha 回 400，香港/海外/upos 节点 403/959 |

三种变体的 `sigparams` 都含 `cdn=ov-gotchaNNN`，但 fMP4 路径上的节点**实际不校验 `cdn` 字段**，FLV 节点会校验。

**修正后的结论：**
- **FLV（API 默认第一个串流、本扩充先前的研究对象）**：仍然只能在「同集群号的 ov / cn / b」中选 → 原结论正确。
- **HLS-fMP4**：签名实际上不绑节点，可以自由选约一半的国内点播节点。PiliNara 的「自由选节点」只在用户把串流切到 HLS 时才真正有效；默认 FLV 下选清单节点基本都会失败。
### 2.2 补充验证（2026-10-01）：网页版实际用哪种串流？HLS 覆盖率？

**网页播放器的选择（Playwright / Chrome 实测）**：有 fMP4 的房间 → **默认就走 HLS-fMP4**（`index.m3u8` + `.m4s`，经 `fetch`）；没有 fMP4 的房间 → 退回 FLV。从未看到它选 TS。
→ 前面 1–7 节以 FLV 为对象的测量，只代表「无 fMP4 房间」；有 fMP4 的房间网页本来就在播 HLS。

**HLS-fMP4 覆盖率**（`getRoomPlayInfo` 实测 197 个直播中房间）：

| 样本 | 有 fMP4 | 有 FLV | 有 TS |
|---|:--:|:--:|:--:|
| 热门推荐 90 间 | 64（71%）| 90 | 90 |
| 各分区最新开播（小台）107 间 | 55（51%）| 105 | 105 |

（另有 2 间只有 fMP4、没有 FLV/TS。）→ **约 4–5 成房间没有 fMP4，只能走 FLV，仍受集群号限制。**

**扩充可否切换**：网页没有给用户切协议的 UI，但也不需要——有 fMP4 的房间播放器已自动用它。扩充端：m3u8 与分片都由页面 `fetch` 发出，可沿用点播的「分段 host 改写」做法（匹配 `/live-bvc/`）。从 `live.bilibili.com` 页面内 fetch 换 host 后的 URL 实测 **CORS 通过**：

| 换成的 host | m3u8 | 分片 |
|---|---|---|
| `cn-tj-cu-01-05` | 200 / 2.3s | 869KB / 1.4s |
| `cn-jssz-cm-02-07` | 200 / 2.0s | 802KB / 1.0s |
| `cn-gddg-ct-01-10` | 200 / 3.6s | 559KB / 2.2s |
| `d1--cn-gotcha207` | 200 / 2.5s | 102KB / 1.0s |
| `cn-hk-eq-01-01` | 403 | — |

无 fMP4 的房间无法靠改 API 回应「变出」fMP4，只能维持 FLV 同号 cn/ov/b 切换。

### 2.3 补充验证（2026-10-01 傍晚 SG）：扩充清单里「点播顺」的节点能播直播吗？

脚本：`live-vod-nodes.py`。对 `src/cdn-list.json` 全部节点量点播吞吐（av170001 拉 8MB）+ 直播各格式状态；fmp4 可用者再与官方 ov / 同号 cn **并行**模拟 HLS 播放 60s。跑了 2 个房间，结论一致。

**可用性**：
- `upos-*`（08c / 08h / 08ct / ali* / hw* / tf_hw / aliov）：点播 9–60 Mbps，直播 flv/ts/fmp4 **一律 959**（回应带 `X-Upsig-Version`：upos 只认点播的 upsig 签名）。
- `upos-*cos*` / `tf_tx` / `akamai`：直播一律 403。
- 只有默认节点 `cn-jxnc-cmcc-bcache-06` 能播直播，且只限 fmp4（flv/ts 403）。
→ **08c 点播 44–61 Mbps，但直播完全不能用。** 「点播顺」与「直播能用」无关：upos 源站系与直播 gotcha 系是两套签名体系。

**持续播放（fmp4，60s 并行）**：

| 房间 | 节点 | 分片吞吐 | 即时比 | 缓冲见底次数 |
|---|---|:--:|:--:|:--:|
| 22908869 | 官方 `ov-gotcha207` | 5.9 Mbps | 1.09 | **0** |
| | 同号 `cn-gotcha207` | 0.7 Mbps | 0.98 | 26 |
| | `cn-jxnc-cmcc-bcache-06` | 1.3 Mbps | 0.99 | 20 |
| 25828093 | 官方 `ov-gotcha208` | 14.2 Mbps | 1.06 | **0** |
| | 同号 `cn-gotcha208` | 1.8 Mbps | 0.97 | 16 |
| | `cn-jxnc-cmcc-bcache-06` | 5.3 Mbps | 0.99 | 26 |

（「见底」用较严格的模型：从最新分片起播、只有约 1 片缓冲，绝对次数偏高，但同时段并行的**相对比较**有效。）
→ 这个时段，**能连上的国内节点播直播都明显不如官方 ov**：即时比 <1、频繁见底。和第 4 节（FLV、cn≈ov）不同，可能与时段（大陆晚高峰）有关，需换时段重测。

### 2.4 补充验证（2026-10-01 傍晚 SG）：PiliNara 能播直播的节点，会比官方更顺吗？

脚本：`live-pilinara-nodes.py`。阶段 1 把 PiliNara 清单 362 个 host 都拉最新 2 片 fmp4 筛速度（178 个可播）；阶段 2 取最快几个与官方 ov / ov-b **并行**模拟播放 90s。播放器模型比 2.3 宽松、较接近真实：先缓冲 3 片才起播，见底算卡顿一次、从下一片重新起播。

| 房间（qn） | 节点 | 分片吞吐 | 起播 | 卡顿次数 | 卡顿总秒数 |
|---|---|:--:|:--:|:--:|:--:|
| 25828093（10000 原画） | 官方 `ov-gotcha207` / `207b` | 21 Mbps | 1.0s | **0** | **0** |
| | 最快 6 个国内节点（`cn-jssz-cm-02-31/42/20`、`cn-zjhz-cm-01-17`、`cn-fjqz-cm-01-07`、`cn-tj-cm-02-05`）| 5.8–6.5 Mbps | 3.3–3.8s | 13–22 | 7–25s |
| 22908869（250 超清） | 官方 `ov-gotcha207` / `207b` | 5.7–5.9 Mbps | 0.7s | **0** | **0** |
| | 最快 6 个国内节点（`cn-jssz-cm-02-08/25/07/35`、`cn-gddg-cm-01-06`、`cn-zjhz-cm-01-17`）| 1.7–2.0 Mbps | 2.2–5.7s | 0–5 | 0–4.8s |

阶段 1 两个房间的速度第 1、2 名都是官方 ov / ov-b，国内节点最好也只有官方的约 6 成（25828093：10.7 vs 18.0 Mbps）。
→ **在 SG，PiliNara 清单里没有任何节点比官方 ov 更顺**：官方起播快 3–5 倍、零卡顿；国内节点高码率时 90s 内卡 7–25 秒。
→ 对 SG 用户，「直播换节点」目前没有收益；若要做，至少得换时段（避开大陆晚高峰）、换地区（如台湾）重测后再决定。

**台湾出口重测（同日晚间，SG 本机 → 台湾 VPN，出口 HiNet，B 站判定「台湾」）**：
- VPN 单连线仅约 17 Mbps（SG 直连同节点 209 Mbps），8 路原画并行会互抢，所以原画房间改用 `SEQ=1` 逐一测（官方与候选交替，每个 60s）。
- 阶段 1 两个房间第 1、2 名仍是官方 ov / ov-b。

| 房间（qn） | 节点 | 分片吞吐 | 起播 | 卡顿次数 | 卡顿秒数 |
|---|---|:--:|:--:|:--:|:--:|
| 25828093（原画，逐一） | 官方 `ov-gotcha208`（5 次） | 5.4–5.8 Mbps | 3.4–4.4s | 25–45 | 6.5–13.4s |
| | `cn-gddg-ct-01-24/12/15`、`cn-zjjh-ct-04-33` | 5.2–6.3 Mbps | 3.7–5.6s | 14–20 | 9.2–24.6s |
| 22908869（超清，并行） | 官方 `ov-gotcha207` / `207b` | 2.9 Mbps | 1.5s | **0** | **0** |
| | `cn-fjqz-cm-01-01/02/03` | 1.5 Mbps | 2.8–2.9s | 0 | 0 |
| | `cn-gddg-ct-01-10/11`、`cn-zjjh-ct-04-27` | 1.5–1.6 Mbps | 2.8–3.2s | 2–9 | 1.7–7.8s |

→ 原画两边都卡，吞吐都约 5.5 Mbps，瓶颈在 VPN 链路而不是节点：国内节点卡顿次数较少，但卡顿总秒数相当或更多，**打平**。超清官方仍是唯一「起播最快且零卡顿」的。
→ 结论与 SG 一致：**没有节点比官方 ov 更顺**。
⚠️ 这是「SG 本机经台湾 VPN」，路径多绕一段、RTT 较高，不等于真正在台湾的 HiNet 用户；要定论需台湾本地用户实跑。

- 尚未验证：其他时段（避开大陆晚高峰）、真正台湾本地网络的表现。

### 2.5 补充验证（2026-10-01）：扩充能否在网页内切换直播节点？

方法：Playwright（Chrome，未登录）在页面注入与 `main-hook.js` 同形的 fetch hook（`/live-bvc/` 改 host），再调 `window.livePlayer.reload()`，观察请求 host 与 `<video>` 状态。

| 房间 | 协议 | 请求类型 | ov → cn | → ov-b |
|---|---|---|---|---|
| 25828093 | HLS-fMP4（`gotcha208`）| `fetch`（m3u8、m4s）| ✅ 请求全转到 `cn-gotcha208`，继续播放 | ✅ 转到 `ov-gotcha208b`，继续播放 |
| 1936495164 | FLV（`gotcha05`）| `fetch`（单条长连线）| ✅ 继续播放 | ✅ 继续播放 |
| 32184621 | FLV（`gotcha07`）| `fetch` | 首次切换后一度 `paused`；对照组（只 `reload()` 不换 host）正常，再切 cn 也正常播放 → 判定为偶发 | ✅ 可拉流 |

- `livePlayer` 可用方法含 `reload / refresh / loadVideo / getPlayerInfo / switchQuality / getP2PTransport` 等。
- `getPlayerInfo().playurl` 可直接取得当前完整播放 URL（含 host）。
- `data.bilibili.com` 的打点上报会带上 `.flv` URL（XHR），匹配时须同时验 host，与点播 `isSegUrl` 的教训相同。抽测 `cn-gddg-ct-01-10` 拉一个 156KB 分片要 2.5s（≈0.5 Mbps），明显不够 2.5 Mbps 的流；能连上 ≠ 能流畅播，若要做「HLS 任意节点」需另做持续吞吐测试。

---

## 3. 三个方法学问题的实测答案

### Q1：host 的 `b` 后缀 = backup？→ 是
API 回传的 `url_info` 永远「非-b 在 `[0]`、`b` 在 `[1]`」，同集群号、同 token；且部分 `cn-gotcha{N}b` 根本 DNS 不存在（非必部署）。→ `b` = 同集群的次要/备份边缘。
（脚本：`live-cluster-probe.py`）

### Q2：每次调 API 集群号都不同？→ 否，基本「按房间黏住」
同房间连调 12 次：
```
room 545068      → 05×10, 07×2
room 23899847    → 07×11, 05×1
room 1746709913  → 07×12（恒定）
```
每个房间有主导集群号（由 房间+你的 IP/地区 决定），偶尔才跳。**「重摇 API」几乎给不了选择**——你实际被锁在 ~1 个集群，可用的就是它的 cn/ov/b（通常 2–3 个）。
（脚本：`live-cluster-probe.py`）

### Q3：卡顿只看 TTFB？→ 否
TTFB 只反映「第一个字节多快到」（开播/切台快慢）。卡顿要看「能否持续稳定 ≥ 码率」——即最低窗吞吐、抖动、边缘节点回源能力。实测中 cn 的 TTFB 比 ov 好 4 倍，但持续吞吐/抖动两者相近，证明两者是**独立的轴**。
（脚本：`live-smoothness.py`、`live-lag-drift.py`）

---

## 4. 场景 A：高码率连续播放（综合稳定度）

方法：3 个高码率房间（10.4 / 6.3 / 5.7 Mbps），同一 token 下 **ov 与 cn 并行**各拉 60s；用 FLV 媒体时间戳算 `ratio=收到节目秒/墙上秒`、drift 走势、掉队秒、绝对直播延迟。（脚本：`live-hbr-sustained.py`）

| 房间(码率) | 节点 | ratio | 掉队 | drift 走势 | 绝对延迟 |
|---|---|:--:|:--:|---|---|
| 1703958289 (10.4M) | ov | 1.029 | 0 | 平 ~-1.7s | 基准 |
| | cn | 1.019 | 0 | 平 ~-1.2s | 快 0.6s |
| 31405244 (6.3M) | ov | 1.087 | 0 | 平 ~-5.2s | 基准 |
| | cn | 1.087 | 0 | 平 ~-5.2s | 0.0s（完全相同）|
| 23899847 (5.7–6.3M) | ov | 1.156 | 1 | 平 ~-9.4s | 基准 |
| | cn | 1.036 | 0 | 平 ~-2.2s | 快 0.1s |

**综合**：ov 平均 ratio 1.091 / 掉队 0.3s；cn 平均 ratio 1.047 / 掉队 0s。
→ **两边都稳，连 10.4Mbps 都零掉队**；cn 仅微弱占优（掉队 0 vs 0.3、离源近 ≤0.6s），不足以成为理由。

---

## 5. 场景 B：刷直播切台（首帧 TTFB）

方法：10 个直播，每台停留 3s 就切；每台重新调 `getRoomPlayInfo`，测 ov 与 cn 从请求到第一个 FLV media tag 的时间（≈点开到第一帧）。（脚本：`live-surf-ttfb.py`）

| | 平均 | 中位 | 范围 | 胜场 |
|---|:--:|:--:|:--:|:--:|
| 海外 ov | 1562ms | 1519ms | 376–**2741** | 3/10 |
| 国内 cn | **724ms** | **726ms** | 435–1236 | **7/10** |

- 调 `getRoomPlayInfo` 本身每次 ~553ms（两边都要付）。
- 每切一次总成本：ov ≈ 553+1562 ≈ **2115ms**；cn ≈ 553+724 ≈ **1277ms**。
- **胜场算法**：同一房间谁的 TTFB 数字更小算谁赢（只看谁快、不看快多少，故看幅度用均值/中位）；每房间先测 ov、停留 3s、再测 cn（非同一瞬间，属方法学小瑕疵，可改并行）。

→ **刷直播时 cn 快近一倍、分布更窄**（海外会冒 2–2.7s 冷启动长尾，cn 最差才 1236ms）。切台越频繁越有感。

---

## 6. 可行性判断与实现建议

> ⚠️ 本节为 2026-09-26 初版（只考虑 FLV、改写 API 回应）。最新建议见 **0.1 节**。

**值得做的前提：你在意「刷直播」体验。** 若只盯一个台看，收益太小、不值得。

若要实现（独立于点播的一套逻辑）：
1. 拦截直播 `getRoomPlayInfo` 响应（或直播流请求 `/live-bvc/…`）。
2. 从 host 解析集群号 `N`（`d1--(ov|cn)-gotcha(N)`）。
3. 把 host 改写成同号国内 `d1--cn-gotcha{N}.bilivideo.com`。
4. 必须处理的边界：
   - **只能同号**（换别的号 → 403）；
   - 部分 `cn-gotcha{N}b` **DNS 不存在** → 用前先探测；
   - 改写后若 403/失败 → **回退**到原 ov host；
   - 更稳的做法：**cn/ov 都探一下挑快的**（ov 偶尔也快，3/10）。
5. UX：一个「直播优先国内节点」开关即可，跟点播的节点列表 UI 分开。

**做不到的路（记录备查）**：anti-ip-attribution 那种「让 `api.live.bilibili.com` 解析到国内 IP，骗 B 站分配国内集群」是 DNS/hosts 层，**浏览器扩充做不到**。

---

## 7. 局限与注意

- 全部数据来自**单一机器 / 单一网络（SG）/ 单一时段**。TTFB 尤其随网络与时段波动，胜负比例不代表恒定。
- 场景 A 的 drift 已按每条连接自身起点归一化（测 keep-up）；绝对延迟另用「同时刻第一个 tag 的媒体时间线位置」对比。
- 场景 B 的 ov/cn 非同一瞬间测（差 ~3s），严格化需改并行。
- 直播间会随时下播/改码率，重跑脚本时房间号可能需替换（脚本支持用命令行参数传入房间号）。

---

## 8. 测试档案清单

全部位于 `research/live-streaming-support/`，**纯研究用、不属于扩充、`src/` 与打包脚本完全未改、随时可删**：

| 档案 | 验证内容 | 用法 |
|---|---|---|
| `live-cluster-probe.py` | Q1 `b` 含义 / Q2 集群号分布 | `python3 research/live-streaming-support/live-cluster-probe.py` |
| `live-smoothness.py` | Q3 TTFB vs 持续稳定度 | `python3 research/live-streaming-support/live-smoothness.py` |
| `live-lag-drift.py` | 单流 媒体时间 vs 墙上时间 落后 | `python3 research/live-streaming-support/live-lag-drift.py [秒]` |
| `live-hbr-sustained.py` | 场景A 高码率连续播放 ov vs cn | `python3 research/live-streaming-support/live-hbr-sustained.py [秒] [room…]` |
| `live-surf-ttfb.py` | 场景B 刷直播切台 TTFB | `python3 research/live-streaming-support/live-surf-ttfb.py [停留秒] [room…]` |
| `live-vod-nodes.py` | 2.3 扩充清单节点：点播吞吐 vs 直播可用性/持续播放 | `python3 research/live-streaming-support/live-vod-nodes.py [room\|auto] [秒]` |
| `live-pilinara-nodes.py` | 2.4 PiliNara 可播节点 vs 官方 ov 持续播放 | `python3 research/live-streaming-support/live-pilinara-nodes.py [room\|auto] [秒] [TOP]` |
| `live-any-node-probe.py` | 2.1 任意节点（PiliNara 清单）× 各串流变体可用性 | `python3 research/live-streaming-support/live-any-node-probe.py [房间数] [cdn_nodes.json]` |

依赖：只用 Python 标准库；需要仓库根目录的 `.env.local` 里的 `BILI_COOKIE`（与截图脚本共用）。

---

## 9. 参考

- [Kanda-Akihito-Kun/ccb](https://github.com/Kanda-Akihito-Kun/ccb)（声称支持直播，用户实测「直播拉不下来」，有限）
- [anti-ip-attribution #53 — B站直播观看 解决分配海外CDN](https://github.com/SunsetMkt/anti-ip-attribution/issues/53)
- [Make-Bilibili-Great-Than-Ever-Before #26 — 直播 PCDN](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before/issues/26)
