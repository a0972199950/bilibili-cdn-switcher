<div align="center">

# 🎬 B 站 CDN 线路重排

**语言 / Language：** [繁體中文](../README.md)｜简体中文（本页）｜[English](README.en.md)

### 让 🇹🇼 台湾 / 🇸🇬 新加坡 用户看网页版 B 站更顺的 Chrome / Edge / Firefox 扩充

### 📥 [点此从 Chrome Web Store 安装](https://chromewebstore.google.com/detail/twsg-%E8%A7%86%E9%A2%91%E5%8A%A0%E9%80%9F-for-bilibili-%E9%9D%9E%E5%AE%98/dfaddcffoondcendifiljhdbdagebgch) ｜ [点此从 Firefox Add-ons 安装](https://addons.mozilla.org/zh-TW/firefox/addon/bilibili-cdn-switcher/)

</div>

---

> ### 🙏 Credit / 致谢
>
> 本项目移植自作者 **[@roge4444](https://github.com/roge4444)** 的两个项目：
>
> - 📦 [PiliNaraRogerMod](https://github.com/roge4444/PiliNaraRogerMod)
> - 📦 [blblRogerMod](https://github.com/roge4444/blblRogerMod)
>
> CDN 选线策略与节点清单皆源自上述项目，**特别感谢作者** ❤️

---

![Extension popup settings](main.png)
---

Before
![alt text](before.png)

After
![Player debug overlay](after.png)

## ✨ 这个扩充在做什么

**🎯 主要是为了让 🇹🇼 台湾／🇸🇬 新加坡 的使用者看网页版 B 站（www.bilibili.com）更顺。**

B 站预设分配的取流节点对台湾、新加坡使用者常常绕路、不够快。这个扩充会**把视频的取流 CDN 重排、换成一个对 TW/SG 较快的最优节点**，让缓冲与载入更顺。

| 功能 | 说明 |
|:--|:--|
| 🚀 **TW/SG 最优节点** | 预设换成对台/星最快的 CDN，开箱即用 |
| 🌐 **其他 CDN 节点** | 阿里云／腾讯云／华为云／Akamai／各海外节点…（来自 PiliNaraRogerMod），依所在地区自由比较切换 |
| ✏️ **自行输入** | 跟「清单选择」互斥的另一个模式，可填任意 CDN host |
| 🛑 **原始（不覆写）** | 等同关闭，完全不动 B 站原生行为 |
| 🔁 **失败自动切换** | 侦测到目前 CDN 分段请求失败、或播放持续卡住（非单纯缓冲已满），先静默切换到 B 站原生给的备援节点（显示提示、不整页刷新）；备援也不行时弹出提示，让你自行决定是否切到「备用URL」。内建行为，无开关 |
| 📶 **各节点测速** | 独立页面，显示视频标题／画质，实测当前视频、当前画质下各节点的下载速度并逐一列出，测速中也能重新测；不影响你手动选择的 CDN，离开该页即中止 |
| 🌏 **多语系界面** | 依浏览器语言自动显示繁體中文／简体中文／English，涵盖 popup、页面提示与 debug 叠层 |
| 🐛 **debug 叠层** | 查看当前 CDN 节点（预设关闭，可在设定中打开） |
| 🦊 **Chrome / Edge / Firefox 三平台** | 同一份 `src/`，打包时依浏览器各自产生 zip（Edge 是 Chromium 内核，直接沿用 Chrome 的 manifest） |

---

## 🗂️ 项目结构

```text
bilibili-cdn-switcher/
├── src/                  ← 扩充本体（载入未封装 / 打包的就是这层）
│   ├── manifest.json          ← Chrome / Edge 用
│   ├── manifest.firefox.json  ← Firefox 用（含 browser_specific_settings）
│   ├── popup.html / popup.js
│   ├── main-hook.js      ← MAIN world：改写取流 URL
│   ├── bridge.js         ← ISOLATED world：storage / i18n ↔ 页面 桥接
│   ├── cdn-list.json     ← 节点清单
│   ├── _locales/{zh_TW,zh_CN,en}/  ← 三语系文案（manifest 用 __MSG_x__ 引用；popup.js／main-hook.js 执行期查表）
│   └── icons/            ← 16 / 32 / 48 / 128
├── dist/                 ← 打包产物（.zip）
├── docs/                 ← README 用的截图 + 繁體中文／English README
├── assets/               ← 图示母档 512px（icons-prod 由 gen-icons.mjs 产生）
├── store/                ← 各商店上架用截图 / 宣传图
├── scripts/              ← 所有开发／打包脚本，纯 Node，Windows／Mac／Linux 都能跑
│   ├── build.mjs                 ← 打包成上架用 zip（Chrome + Edge + Firefox）
│   ├── gen-icons.mjs             ← 重新产生图示
│   ├── make-screenshots.mjs      ← docs/ 底下的图等比缩放＋加黑边
│   └── capture-screenshots.mjs   ← 自动开浏览器截三语系商店截图（见下）
├── package.json           ← scripts/*.mjs 用的 Node 依赖（jszip / puppeteer / sharp）
└── README.md
```

`scripts/` 底下的工具都是纯 Node（打包 zip 用 [jszip](https://npm.im/jszip)、处理图片用
[sharp](https://npm.im/sharp)），不依赖 Windows 专属的 PowerShell／System.Drawing，Mac 一样能跑，
先 `npm install` 装好依赖即可。

### 📦 打包（上架 Chrome Web Store / Microsoft Edge Add-ons / Firefox Add-ons 用）

这个项目不需要编译／transpile，`src/` 底下就是可以直接 `Load unpacked` 的原始码；「打包」只是把它压成上架用的 zip，
**没有自动化（例如 push 前自动打包）**，要更新 `dist/` 得自己手动跑一次：

```bash
npm install                          # 第一次执行，或 node_modules 被清掉时才需要
npm run build                        # 预设：Chrome + Edge + Firefox 都打包
npm run build -- --browser=chrome    # 只打包 Chrome
npm run build -- --browser=edge      # 只打包 Edge
npm run build -- --browser=firefox
```

Chrome／Edge 用同一份 `src/manifest.json`（Edge 是 Chromium 内核，Manifest V3 与 Chrome 完全相容，
不需要另外的 manifest），Firefox 用 `src/manifest.firefox.json`。会读对应 manifest 的 `version`，
把 `src/` **底下的内容**（manifest 换成 `manifest.json` 放在 zip 最上层）压成
`dist/bilibili-cdn-switcher-<browser>-<版本>.zip`。Chrome／Firefox 两份 manifest 的 `version`
要保持一致，不一致时脚本会跳警告（Edge 沿用 Chrome 的 manifest，版本必然一致，不用另外检查）。

打包结果是可重现的（reproducible build）：只要 `src/` 内容没变，同一个浏览器目标每次包出来的
zip bytes 完全相同（Windows／Mac 跑出来也一样），方便日后要接 CI 时判断 `dist/` 是否真的需要更新。

### 🎨 重新产生图示

```bash
npm run gen-icons
```

以 512px 母档缩出 16/32/48/128，同时产生两份：`src/icons/`（开发版，带红点角标，`Load unpacked` 平常读到的就是这份，方便跟已安装的正式版分辨）与 `assets/icons-prod/`（正式版，无角标）。`scripts/build.mjs` 打包 zip 时会自动把图示换成 `assets/icons-prod/` 底下的正式版。

### 📸 产生商店截图（三语系 main / debug / speedtest，共 9 张 1200x800 jpg）

```bash
npm run capture-screenshots
```

用 Puppeteer 载入 unpacked 的 `src/`，依序切 `en-US`／`zh-CN`／`zh-TW` 三个浏览器语系，实际打开一支
bilibili 影片页（网址写在 `scripts/capture-screenshots.mjs` 开头的 `VIDEO_URL`，要换片直接改那行），
分别截 popup 主画面、页面上的 debug 叠层、测速中的画面，等比缩放＋黑边填成 1200x800，输出到 `store/`
覆盖同名档案（`screenshot-<画面>-<语系>-1200x800.jpg`）。因为要连真实 bilibili 影片页测速，跑一轮约
数分钟，且吃网络状况。

---

## 🎛️ UI 说明

| 选项 | 行为 |
|:--|:--|
| 🔘 **启用** | 预设 **开启** 的总开关；关闭后完全不改动 B 站取流（debug 叠层仍会显示当前 CDN） |
| 📡 **CDN 线路** | 「清单选择」／「自行输入」互斥单选。**预设＝清单选择，第一项＝ bilivideo（TW/SG 最快）**，其余为各家节点、倒数两项是「备用URL」「原始」；切到「自行输入」会出现输入框，自行填 host |
| 🔍 **测试各节点速度** | 按下后切到独立的测速页面，上方显示目前视频标题与画质；抓「当前视频、当前画质」的分段，依序换各节点 host 实测下载速度（8MB 或 5 秒先到为准，5 秒内完全没收到资料才算超时；有收到但不到 8MB 就显示实际测到的速度），逐格显示「等待中／测试中／结果」，可按「🔄 重新测速」重跑（测速中也能按，会中断目前的重新开始）。**只显示数字，不会更动你目前选择的 CDN**；按左上角「← 返回」或关掉 popup 会立即中止测速。开启「启用」时，playurl 一解析完就能测，不用等真的开始播放；若「启用」是关闭的，则要等实际下载过分段才有样本 |
| 🔁 **失败自动切换 CDN** | 内建行为、**无开关**；侦测到分段请求失败（403/404/5xx/网络错误）或播放确实卡住（8 秒内进度不动、且线路上也没有资料在动），先静默切到 B 站原生给的备援节点（分段层即时差替、不整页刷新，并跳出提示）；这个备援也播不动时，改弹出一个不会自动消失的提示，让你自己决定要不要「重载并切换至备用URL」 |
| 🌏 **语言** | 没有手动切换选项，跟随浏览器／操作系统语言自动显示繁體中文／简体中文／English（其余语言预设显示繁體中文）；如需强制指定，可调整浏览器的语言偏好顺序 |
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

- 📋 节点清单放在 **`src/cdn-list.json`** —— 要新增／调整节点，改这个档即可，于扩充页「重新整理」后生效。
- 🧩 每个项目格式：

  ```json
  { "value": "upos-sz-mirrorhw.bilivideo.com", "name": "hw", "noteKey": "cdnNoteHuaweiHybrid" }
  ```

  `value` 特殊值：🛑 `base`＝不覆写 · 🔁 `backup`＝优先备用URL（这两个特殊选项用 `nameKey` 代替 `name`）。
  `noteKey` 对应到 `src/_locales/{zh_TW,zh_CN,en}/messages.json` 里的讯息键，让备注文字跟着语言切换；
  只是想快速加一个节点又不想动三份语系档的话，也可以直接写 `"note": "自订备注"`（不会多语系，但能动）。
  「自行输入」是 popup 里独立的互斥选项，不算在这份清单里。

---

## ⚠️ 注意

- 🔒 一律保留原 host 为 `backupUrl` fallback，避免个别 host-bound URL 整段播不出。
- 📍 最优节点为 TW/SG 最佳化；其他地区使用者可自行切换到较近的节点，或切到「自行输入」模式填自己的 host。
- 📶 「测试各节点速度」是短时间实测单一分段，结果仅供参考：CDN 是否已对这支视频、这个画质建立快取，
  以及路由在不同时段的拥堵状况都会影响实际观看体验，测速当下最快不代表长时间播放最顺。

---

<div align="center">

Made with ❤️ for 🇹🇼 / 🇸🇬 bilibili viewers · 移植自 [@roge4444](https://github.com/roge4444)

</div>
