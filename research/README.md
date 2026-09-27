# B 站直播 CDN 切换可行性研究

> 调研日期：2026-09-26 · 测试机所在地：新加坡（B 站因此分配海外 `ov-` 直播节点）
> 目的：判断现有点播（VOD）扩充的「改写 CDN host」思路能否套用到**直播**，以及切国内节点对 SG 用户是否真有帮助。
> 结论先行：**技术上可做，但机制与点播完全不同；收益集中在「刷直播的切台首帧速度」，连续观看几乎无差。**

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

全部位于 `research/`，**纯研究用、不属于扩充、`src/` 与打包脚本完全未改、随时可删**：

| 档案 | 验证内容 | 用法 |
|---|---|---|
| `live-cluster-probe.py` | Q1 `b` 含义 / Q2 集群号分布 | `python3 research/live-cluster-probe.py` |
| `live-smoothness.py` | Q3 TTFB vs 持续稳定度 | `python3 research/live-smoothness.py` |
| `live-lag-drift.py` | 单流 媒体时间 vs 墙上时间 落后 | `python3 research/live-lag-drift.py [秒]` |
| `live-hbr-sustained.py` | 场景A 高码率连续播放 ov vs cn | `python3 research/live-hbr-sustained.py [秒] [room…]` |
| `live-surf-ttfb.py` | 场景B 刷直播切台 TTFB | `python3 research/live-surf-ttfb.py [停留秒] [room…]` |

依赖：只用 Python 标准库；需要仓库根目录的 `.env.local` 里的 `BILI_COOKIE`（与截图脚本共用）。

---

## 9. 参考

- [Kanda-Akihito-Kun/ccb](https://github.com/Kanda-Akihito-Kun/ccb)（声称支持直播，用户实测「直播拉不下来」，有限）
- [anti-ip-attribution #53 — B站直播观看 解决分配海外CDN](https://github.com/SunsetMkt/anti-ip-attribution/issues/53)
- [Make-Bilibili-Great-Than-Ever-Before #26 — 直播 PCDN](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before/issues/26)
