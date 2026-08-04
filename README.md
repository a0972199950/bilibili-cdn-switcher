<div align="center">

# 🎬 B 站 CDN 线路重排

### 让 🇹🇼 台湾 / 🇸🇬 新加坡 用户看网页版 B 站更顺的 Chrome / Edge / Firefox 扩充

`Manifest V3` · `Chrome 111+ / Edge 111+ / Firefox 128+` · `纯前端 · 无需登入`

### 📥 [点此从 Chrome Web Store 安装](https://chromewebstore.google.com/detail/twsg-%E8%A7%86%E9%A2%91%E5%8A%A0%E9%80%9F-for-bilibili-%E9%9D%9E%E5%AE%98/dfaddcffoondcendifiljhdbdagebgch)

</div>

---

> ### 🙏 Credit / 致谢
>
> 本专案移植自作者 **[@roge4444](https://github.com/roge4444)** 的两个专案：
>
> - 📦 [PiliNaraRogerMod](https://github.com/roge4444/PiliNaraRogerMod)
> - 📦 [blblRogerMod](https://github.com/roge4444/blblRogerMod)
>
> CDN 选线策略与节点清单皆源自上述专案，**特别感谢作者** ❤️

---

![扩充 popup 设定画面](docs/image.png)
---
![播放器 debug 叠层](docs/image-1.png)

## ✨ 这个扩充在做什么

**🎯 主要是为了让 🇹🇼 台湾 ／ 🇸🇬 新加坡 的使用者看网页版 B 站（www.bilibili.com）更顺。**

B 站预设分配的取流节点对台湾、新加坡使用者常常绕路、不够快。这个扩充会**把影片的取流 CDN 重排、换成一个对 TW/SG 较快的最优节点**，让缓冲与载入更顺。

| 功能 | 说明 |
|:--|:--|
| 🚀 **TW/SG 最优节点** | 预设换成对台/星最快的 CDN，开箱即用 |
| 🌐 **其他 CDN 节点** | 阿里云／腾讯云／华为云／Akamai／各海外节点…（来自 PiliNaraRogerMod），依所在地区自由比较切换 |
| ✏️ **自行输入** | 跟「清单选择」互斥的另一个模式，可填任意 CDN host |
| 🛑 **原始（不覆写）** | 等同关闭，完全不动 B 站原生行为 |
| 🔁 **失败自动切换** | 侦测到目前 CDN 分段请求失败、或播放中速度持续为 0，自动切到「备用URL」（B 站原生给的备援节点）。内建行为，无开关 |
| 📶 **各节点测速** | 独立页面，显示影片标题／画质，实测当前影片、当前画质下各节点的下载速度并逐一列出，测速中也能重新测；不影响你手动选择的 CDN，离开该页即中止 |
| **debug 叠层** | 查看当前 CDN 节点（预设关闭，可在设定中打开） |
| 🦊 **Chrome / Edge / Firefox 三平台** | 同一份 `src/`，打包时依浏览器各自产生 zip（Edge 是 Chromium 内核，直接沿用 Chrome 的 manifest） |

---

## 🗂️ 专案结构

```text
bilibili-cdn-switcher/
├── src/                  ← 扩充本体（载入未封装 / 打包的就是这层）
│   ├── manifest.json          ← Chrome / Edge 用
│   ├── manifest.firefox.json  ← Firefox 用（含 browser_specific_settings）
│   ├── popup.html
│   ├── popup.js
│   ├── main-hook.js      ← MAIN world：改写取流 URL
│   ├── bridge.js         ← ISOLATED world：storage ↔ 页面 桥接
│   ├── cdn-list.json     ← 节点清单
│   ├── _locales/zh_TW/   ← 扩充名称/描述的繁体中文文案（manifest 用 __MSG_x__ 引用）
│   └── icons/            ← 16 / 32 / 48 / 128
├── dist/                 ← 打包产物（.zip）
├── docs/                 ← README 用的截图
├── assets/               ← 图示母档 512px + 产生脚本
├── build.ps1             ← 打包成上架用 zip（Chrome + Edge + Firefox）
└── README.md
```

### 📦 打包（上架 Chrome Web Store / Microsoft Edge Add-ons / Firefox Add-ons 用）

```powershell
pwsh -File build.ps1                 # 预设：Chrome + Edge + Firefox 都打包
pwsh -File build.ps1 -Browser chrome # 只打包 Chrome
pwsh -File build.ps1 -Browser edge   # 只打包 Edge
pwsh -File build.ps1 -Browser firefox
```

Chrome／Edge 用同一份 `src/manifest.json`（Edge 是 Chromium 内核，Manifest V3 与 Chrome 完全相容，
不需要另外的 manifest），Firefox 用 `src/manifest.firefox.json`。会读对应 manifest 的 `version`，
把 `src/` **底下的内容**（manifest 换成 `manifest.json` 放在 zip 最上层）压成
`dist/bilibili-cdn-switcher-<browser>-<版本>.zip`。Chrome／Firefox 两份 manifest 的 `version`
要保持一致，不一致时脚本会跳警告（Edge 沿用 Chrome 的 manifest，版本必然一致，不用另外检查）。

打包结果是可重现的（reproducible build）：只要 `src/` 内容没变，同一个浏览器目标每次包出来的
zip bytes 完全相同，方便搭配 CI／pre-push hook 判断 `dist/` 是否真的需要更新。

### 🎨 重新产生图示

```powershell
pwsh -File assets/gen-icons.ps1
```

以 512px 母档缩出 16/32/48/128，同时产生两份：`src/icons/`（开发版，带红点角标，`Load unpacked` 平常读到的就是这份，方便跟已安装的正式版分辨）与 `assets/icons-prod/`（正式版，无角标）。`build.ps1` 打包 zip 时会自动把图示换成 `assets/icons-prod/` 底下的正式版。

---

## 🎛️ UI 说明

| 选项 | 行为 |
|:--|:--|
| 🔘 **启用** | 预设 **开启** 的总开关；关闭後完全不改动 B 站取流（debug 叠层仍会显示当前 CDN） |
| 📡 **CDN 线路** | 「清单选择」／「自行输入」互斥单选。**预设＝清单选择，第一项＝ bilivideo（TW/SG 最快）**，其余为各家节点、倒数两项是「备用URL」「原始」；切到「自行输入」会出现输入框，自行填 host |
| 🔍 **测试各节点速度** | 按下後切到独立的测速页面，上方显示目前影片标题与画质；抓「当前影片、当前画质」的分段，依序换各节点 host 实测下载速度（8MB 或 5 秒先到为准，5 秒内完全没收到资料才算超时；有收到但不到 8MB 就显示实际测到的速度），逐格显示「等待中／测试中／结果」，可按「🔄 重新测速」重跑（测速中也能按，会中断目前的重新开始）。**只显示数字，不会更动你目前选择的 CDN**；按左上角「← 返回」或关掉 popup 会立即中止测速。开启「启用」时，playurl 一解析完就能测，不用等真的开始播放；若「启用」是关闭的，则要等实际下载过分段才有样本 |
| 🔁 **失败自动切换 CDN** | 内建行为、**无开关**；侦测到分段请求失败（403/404/5xx/网路错误）或播放中速度持续为 0（8 秒），自动切到「备用URL」（重排 playurl 時已算好、B 站原生给的备援节点） |
| 🐛 **显示页面 debug 叠层** | 预设 **关闭**；独立于重排开关，关闭重排时仍可显示当前 CDN，方便比较 |

<details>
<summary>🔍 <b>Debug 叠层长什么样</b>（播放器左上角，仿 blblRogerMod <code>PlayerActivityDebug</code> 风格）</summary>

```text
CDN 线路
mode=on  target=cn-jxnc-cmcc-bcache-06.bilivideo.com
cdn=<当前实际串流的 host>
v=<video 主用 host>  a=<audio 主用 host>
src=playinfo|playurl  rw=<改写次数>  seg=<分段差替数>  qn=<画质>
```

</details>

---

## 🗂️ 设定与档案

- 📋 节点清单放在 **`src/cdn-list.json`** —— 要新增／调整节点或注记，改这个档即可，于扩充页「重新整理」後生效。
- 🧩 每个项目格式：

  ```json
  { "value": "upos-sz-mirrorhw.bilivideo.com", "name": "hw", "note": "华为云 融合CDN" }
  ```

  `value` 特殊值：🛑 `base`＝不覆写 · 🔁 `backup`＝优先备用URL。「自行输入」是 popup 里独立的互斥选项，不算在这份清单里。

---

## ⚠️ 注意

- 🔒 一律保留原 host 为 `backupUrl` fallback，避免个别 host-bound URL 整段播不出。
- 📍 最优节点为 TW/SG 最佳化；其他地区使用者可自行切换到较近的节点，或切到「自行输入」模式填自己的 host。
- 📶 「测试各节点速度」是短时间实测单一分段，结果仅供参考：CDN 是否已对这支影片、这个画质建立快取，
  以及路由在不同时段的壅塞状况都会影响实际观看体验，测速当下最快不代表长时间播放最顺。

---

<div align="center">

Made with ❤️ for 🇹🇼 / 🇸🇬 bilibili viewers · 移植自 [@roge4444](https://github.com/roge4444)

</div>
