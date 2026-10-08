// 產生 Safari 版 App 打開後的引導頁：safari/Bilibili CDN Switcher/Shared (App)/Resources/<語系>.lproj/Main.html
//
// 三個語系共用同一份版型，只換文字，所以改引導頁請改這支腳本再執行：node scripts/gen-safari-onboarding.mjs
// 頁面依裝置顯示 iPhone／iPad／Mac 三套步驟（ViewController.swift 呼叫 Script.js 的 show('iphone' | 'ipad' | 'mac')），
// 每一步配一張用 HTML 畫的示意圖（樣式在 Style.css）。步驟以最新系統（iOS / iPadOS / macOS 26）為準。
// 頁面的 CSP 是 default-src 'self'：不能寫 inline style／script，樣式一律放 Style.css。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RES = path.join(ROOT, "safari", "Bilibili CDN Switcher", "Shared (App)", "Resources");

const STRINGS = {
  Base: {
    lang: "en",
    name: "BiBoost - Speedup for Bili",
    shortName: "BiBoost",
    tagline: "Smoother 4K playback on web bilibili for overseas users",
    iconAlt: "BiBoost icon",
    sample: "Illustration",
    url: "bilibili.com",
    manage: "Manage Extensions",
    installed: "Installed",
    otherExt: "Other extension",
    alwaysAllow: "Always Allow",
    allowOneDay: "Allow for One Day",
    askAccess: "Allow “BiBoost” to access bilibili.com?",
    settings: "Settings",
    apps: "Apps",
    safari: "Safari",
    extensions: "Extensions",
    allowExt: "Allow Extension",
    sitePerm: "bilibili.com",
    allow: "Allow",
    general: "General",
    tabs: "Tabs",
    advanced: "Advanced",
    alwaysAllowSite: "Always Allow on This Website",
    openSafari: "Open bilibili in Safari",
    openSafariSettings: "Quit and Open Safari Settings",
    ipad: {
      title: "Turn on the extension on iPad",
      steps: [
        "Tap the button below to open bilibili.com in Safari.",
        "Tap the Extensions icon on the right of the address bar, then tap <b>Manage Extensions</b>.",
        "Turn on <b>BiBoost - Speedup for Bili</b>, then tap ✓ to finish.",
        "Tap the Extensions icon again, tap <b>BiBoost</b>, and choose <b>Always Allow</b>. Reload the page and you're done.",
      ],
      alt: "You can also turn it on in <b>Settings › Apps › Safari › Extensions</b>.",
    },
    iphone: {
      title: "Turn on the extension on iPhone",
      steps: [
        "Open the <b>Settings</b> app and go to <b>Apps › Safari › Extensions</b>.",
        "Tap <b>BiBoost - Speedup for Bili</b> and turn on <b>Allow Extension</b>.",
        "Under website permissions, set <b>bilibili.com</b> to <b>Allow</b>.",
        "Tap the button below to open bilibili.com in Safari. Reload the page and you're done.",
      ],
      alt: "On iOS 17 or earlier, the path is <b>Settings › Safari › Extensions</b>. You can also tap <b>Manage Extensions</b> in Safari's page menu.",
    },
    mac: {
      title: "Turn on the extension on Mac",
      stateUnknown: "Turn on BiBoost in the Extensions section of Safari Settings.",
      stateOn: "BiBoost is on. You can turn it off in the Extensions section of Safari Settings.",
      stateOff: "BiBoost is off. Follow the steps below to turn it on.",
      steps: [
        "Click the button below. This app quits and Safari Settings opens to <b>Extensions</b>.",
        "Select the checkbox next to <b>BiBoost - Speedup for Bili</b>.",
        "Open bilibili.com in Safari, click the BiBoost icon in the toolbar, and choose <b>Always Allow on This Website</b>.",
      ],
    },
    disclaimer: "Unofficial third-party tool. Not affiliated with bilibili.",
  },
  "zh-Hant": {
    lang: "zh-Hant",
    name: "嗶速 - 海外B站加速",
    shortName: "嗶速",
    tagline: "讓海外使用者在網頁版 B站更順暢觀看 4K 影片",
    iconAlt: "嗶速圖示",
    sample: "示意圖",
    url: "bilibili.com",
    manage: "管理延伸功能",
    installed: "已安裝",
    otherExt: "其他延伸功能",
    alwaysAllow: "一律允許",
    allowOneDay: "允許一天",
    askAccess: "要允許「嗶速」取用 bilibili.com 嗎？",
    settings: "設定",
    apps: "App",
    safari: "Safari",
    extensions: "延伸功能",
    allowExt: "允許延伸功能",
    sitePerm: "bilibili.com",
    allow: "允許",
    general: "一般",
    tabs: "標籤頁",
    advanced: "進階",
    alwaysAllowSite: "在此網站上一律允許",
    openSafari: "用 Safari 開啟 bilibili",
    openSafariSettings: "結束並開啟 Safari 設定",
    ipad: {
      title: "在 iPad 上開啟擴充功能",
      steps: [
        "點下方按鈕，用 Safari 打開 bilibili.com。",
        "點網址列右側的延伸功能圖示，再點<b>「管理延伸功能」</b>。",
        "打開<b>「嗶速 - 海外B站加速」</b>的開關，點右上角的 ✓ 完成。",
        "再點一次延伸功能圖示，點<b>「嗶速」</b>，選擇<b>「一律允許」</b>。重新整理頁面就完成了。",
      ],
      alt: "也可以到<b>「設定」›「App」›「Safari」›「延伸功能」</b>開啟。",
    },
    iphone: {
      title: "在 iPhone 上開啟擴充功能",
      steps: [
        "打開<b>「設定」</b>App，前往<b>「App」›「Safari」›「延伸功能」</b>。",
        "點<b>「嗶速 - 海外B站加速」</b>，打開<b>「允許延伸功能」</b>。",
        "在下方的網站權限中，把<b>「bilibili.com」</b>設為<b>「允許」</b>。",
        "點下方按鈕，用 Safari 打開 bilibili.com，重新整理頁面就完成了。",
      ],
      alt: "iOS 17 以前的路徑是<b>「設定」›「Safari」›「延伸功能」</b>。也可以在 Safari 網址列的頁面選單點<b>「管理延伸功能」</b>。",
    },
    mac: {
      title: "在 Mac 上開啟擴充功能",
      stateUnknown: "請在 Safari 設定的「延伸功能」中開啟「嗶速」。",
      stateOn: "「嗶速」目前已開啟，可以在 Safari 設定的「延伸功能」中將它關閉。",
      stateOff: "「嗶速」目前已關閉，照下面的步驟開啟。",
      steps: [
        "點下方按鈕，這個 App 會結束，並打開 Safari 設定的<b>「延伸功能」</b>。",
        "勾選<b>「嗶速 - 海外B站加速」</b>。",
        "用 Safari 打開 bilibili.com，點工具列上的嗶速圖示，選擇<b>「在此網站上一律允許」</b>。",
      ],
    },
    disclaimer: "非官方第三方工具，與 bilibili 官方無關。",
  },
  "zh-Hans": {
    lang: "zh-Hans",
    name: "哔速 - 海外B站加速",
    shortName: "哔速",
    tagline: "让海外用户在网页版 B站更流畅地观看 4K 视频",
    iconAlt: "哔速图标",
    sample: "示意图",
    url: "bilibili.com",
    manage: "管理扩展",
    installed: "已安装",
    otherExt: "其他扩展",
    alwaysAllow: "始终允许",
    allowOneDay: "允许一天",
    askAccess: "要允许“哔速”访问 bilibili.com 吗？",
    settings: "设置",
    apps: "App",
    safari: "Safari浏览器",
    extensions: "扩展",
    allowExt: "允许扩展",
    sitePerm: "bilibili.com",
    allow: "允许",
    general: "通用",
    tabs: "标签页",
    advanced: "高级",
    alwaysAllowSite: "在此网站上始终允许",
    openSafari: "用 Safari 打开 bilibili",
    openSafariSettings: "退出并打开 Safari 设置",
    ipad: {
      title: "在 iPad 上开启扩展",
      steps: [
        "点下方按钮，用 Safari 打开 bilibili.com。",
        "点地址栏右侧的扩展图标，再点<b>“管理扩展”</b>。",
        "打开<b>“哔速 - 海外B站加速”</b>的开关，点右上角的 ✓ 完成。",
        "再点一次扩展图标，点<b>“哔速”</b>，选择<b>“始终允许”</b>。刷新页面就完成了。",
      ],
      alt: "也可以到<b>“设置”›“App”›“Safari浏览器”›“扩展”</b>开启。",
    },
    iphone: {
      title: "在 iPhone 上开启扩展",
      steps: [
        "打开<b>“设置”</b>App，前往<b>“App”›“Safari浏览器”›“扩展”</b>。",
        "点<b>“哔速 - 海外B站加速”</b>，打开<b>“允许扩展”</b>。",
        "在下方的网站权限中，把<b>“bilibili.com”</b>设为<b>“允许”</b>。",
        "点下方按钮，用 Safari 打开 bilibili.com，刷新页面就完成了。",
      ],
      alt: "iOS 17 及更早版本的路径是<b>“设置”›“Safari浏览器”›“扩展”</b>。也可以在 Safari 地址栏的页面菜单点<b>“管理扩展”</b>。",
    },
    mac: {
      title: "在 Mac 上开启扩展",
      stateUnknown: "请在 Safari 设置的“扩展”中开启“哔速”。",
      stateOn: "“哔速”目前已开启，可以在 Safari 设置的“扩展”中将它关闭。",
      stateOff: "“哔速”目前已关闭，按照下面的步骤开启。",
      steps: [
        "点下方按钮，这个 App 会退出，并打开 Safari 设置的<b>“扩展”</b>。",
        "勾选<b>“哔速 - 海外B站加速”</b>。",
        "用 Safari 打开 bilibili.com，点工具栏上的哔速图标，选择<b>“在此网站上始终允许”</b>。",
      ],
    },
    disclaimer: "非官方第三方工具，与 bilibili 官方无关。",
  },
};

// Safari 的延伸功能圖示（方框右邊一個凸耳），示意圖裡共用
const EXT_ICON = `<svg class="ext-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h10.5a2 2 0 0 1 2 2V10h1.25a1.75 1.75 0 0 1 0 3.5H16.5v2a2 2 0 0 1-2 2H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const APP_ICON = `<img class="app-icon" src="../Icon.png" alt="">`;
const toggle = (on, hl) => `<span class="toggle${on ? " on" : ""}${hl ? " hl" : ""}"></span>`;

function mock(s, inner) {
  return `<figure class="mock" aria-hidden="true"><figcaption>${s.sample}</figcaption>${inner}</figure>`;
}

function urlbar(s, { hlIcon = false } = {}) {
  return `<div class="m-urlbar"><span class="m-url">${s.url}</span><span class="m-urlicon${hlIcon ? " hl" : ""}">${EXT_ICON}</span><span class="m-reload">↻</span></div>`;
}

function ipadSteps(s) {
  return [
    mock(s, urlbar(s)),
    mock(s, `${urlbar(s, { hlIcon: true })}<div class="m-menu"><div class="m-row hl">${EXT_ICON}<span>${s.manage}</span></div><div class="m-row dim"><span class="m-dot"></span><span>${s.otherExt}</span></div></div>`),
    mock(s, `<div class="m-sheet"><div class="m-sheet-title">${s.manage}<span class="m-done">✓</span></div><div class="m-label">${s.installed}</div><div class="m-row">${APP_ICON}<span class="grow">${s.name}</span>${toggle(true, true)}</div><div class="m-row dim"><span class="m-dot"></span><span class="grow">${s.otherExt}</span>${toggle(true)}</div></div>`),
    mock(s, `<div class="m-alert"><div class="m-alert-title">${APP_ICON}<span>${s.askAccess}</span></div><div class="m-btn">${s.allowOneDay}</div><div class="m-btn hl">${s.alwaysAllow}</div></div>`),
  ];
}

function iphoneSteps(s) {
  const crumb = [s.settings, s.apps, s.safari, s.extensions].map((x, i, a) => `<span class="m-crumb${i === a.length - 1 ? " hl" : ""}">${x}</span>`).join(`<span class="m-chev">›</span>`);
  return [
    mock(s, `<div class="m-crumbs">${crumb}</div>`),
    mock(s, `<div class="m-sheet"><div class="m-sheet-title">${APP_ICON}<span>${s.name}</span></div><div class="m-row"><span class="grow">${s.allowExt}</span>${toggle(true, true)}</div></div>`),
    mock(s, `<div class="m-sheet"><div class="m-row"><span class="grow">${s.sitePerm}</span><span class="m-value hl">${s.allow} ›</span></div></div>`),
    mock(s, urlbar(s)),
  ];
}

function macSteps(s) {
  const tab = (label, hl) => `<span class="m-tab${hl ? " hl" : ""}">${label}</span>`;
  return [
    mock(s, `<div class="m-window"><div class="m-titlebar"><i></i><i></i><i></i></div><div class="m-tabs">${tab(s.general)}${tab(s.tabs)}${tab(s.extensions, true)}${tab(s.advanced)}</div></div>`),
    mock(s, `<div class="m-window"><div class="m-titlebar"><i></i><i></i><i></i></div><div class="m-row"><span class="m-check hl">✓</span>${APP_ICON}<span class="grow">${s.name}</span></div><div class="m-row dim"><span class="m-check"></span><span class="m-dot"></span><span class="grow">${s.otherExt}</span></div></div>`),
    mock(s, `<div class="m-toolbar"><span class="m-url">${s.url}</span><span class="m-tbicon hl">${APP_ICON}</span></div><div class="m-menu right"><div class="m-row hl"><span>${s.alwaysAllowSite}</span></div></div>`),
  ];
}

// button：[第幾步（從 0 起算）, 按鈕 HTML]，按鈕放在提到它的那一步裡，不用捲到頁尾找
function stepsList(texts, mocks, [buttonAt, button]) {
  return `<ol class="steps">\n${texts.map((t, i) => `      <li><div class="step-text"><span class="num">${i + 1}</span><p>${t}</p></div>${mocks[i]}${i === buttonAt ? button : ""}</li>`).join("\n")}\n    </ol>`;
}

function page(s) {
  const safariButton = `<button class="primary open-safari" type="button">${s.openSafari}</button>`;
  return `<!DOCTYPE html>
<!-- 由 scripts/gen-safari-onboarding.mjs 產生，請改那支腳本，不要直接改這個檔 -->
<html lang="${s.lang}">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
    <meta name="color-scheme" content="light">
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">

    <link rel="stylesheet" href="../Style.css">
    <script src="../Script.js" defer></script>
</head>
<body>
  <header class="hero">
    <img class="hero-icon" src="../Icon.png" width="88" height="88" alt="${s.iconAlt}">
    <h1>${s.name}</h1>
    <p class="tagline">${s.tagline}</p>
  </header>

  <main>
  <section class="guide platform-ipad">
    <h2>${s.ipad.title}</h2>
    ${stepsList(s.ipad.steps, ipadSteps(s), [0, safariButton])}
    <p class="alt">${s.ipad.alt}</p>
  </section>

  <section class="guide platform-iphone">
    <h2>${s.iphone.title}</h2>
    ${stepsList(s.iphone.steps, iphoneSteps(s), [3, safariButton])}
    <p class="alt">${s.iphone.alt}</p>
  </section>

  <section class="guide platform-mac">
    <h2>${s.mac.title}</h2>
    <p class="status state-unknown">${s.mac.stateUnknown}</p>
    <p class="status state-on">${s.mac.stateOn}</p>
    <p class="status state-off">${s.mac.stateOff}</p>
    ${stepsList(s.mac.steps, macSteps(s), [0, `<button class="primary open-preferences" type="button">${s.openSafariSettings}</button>`])}
  </section>
  </main>

  <footer class="disclaimer">${s.disclaimer}</footer>
</body>
</html>
`;
}

for (const [dir, s] of Object.entries(STRINGS)) {
  const out = path.join(RES, `${dir}.lproj`, "Main.html");
  fs.writeFileSync(out, page(s));
  console.log(`寫入 ${path.relative(ROOT, out)}`);
}
