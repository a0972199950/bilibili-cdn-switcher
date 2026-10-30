"use strict";

var DEFAULTS = {
  enabled: true,
  cdnHost: "upos-sz-mirror08ct.bilivideo.com",
  cdnMode: null, // 一般影片用哪份節點："list"（國家清單）或 "custom"（自訂節點列表）；null = 1.6 以前的設定，載入時遷移
  customHosts: [], // 自訂節點列表（使用者加入的、測速工具匯入的），依加入順序
  cdnCountry: null, // 節點清單的國家選項（cdn-list.json countries 的 code，或 "ALL"）
  detectedCountry: "", // 依 IP 偵測到、且在清單內的國家；標「你在這裡」用
  countryAutoDone: false, // IP-based country selection runs once per install (never reset, not even on update); a manual choice also sets it
  autoFallback: true,
  autoSpeedSwitch: false, // 影片自動測速並切換到最快節點（進階設定，預設關閉；實際測速在 main-hook.js）
  autoSpeedHosts: [], // 自動測速要測的節點：依目前國家寫入，content script 讀這份
  autoTestPending: false, // 節點是程式替使用者選的（切換國家、安裝後自動選國家、自訂切回清單）→ 第一支影片在背景測一次、換成最快節點；觸發即清，使用者自己選節點也清。受 FEATURE_AUTO_TEST_ON_COUNTRY 控制
  showDebug: false,
  videoEnabled: true,
  liveEnabled: true,
  liveRoute: "ov",
  sortBySpeed: false, // 只有 popup 用：節點按測速排序
  speedOrder: null, // 上次測速排出的順序 { video: [host...], live: [route...] }，沒重新測速就一直沿用
  // 測速門檻（進階設定，永久儲存）：影片每個節點下載到 N MB 或測滿 N 秒先到為準；
  // 直播切台卡頓測 N 次取平均、持續觀看每條線路測 N 秒
  stVideoMb: 8,
  stVideoSec: 5,
  stLiveRuns: 3,
  stLiveSec: 8,
  // 門檻的預設組合（進階設定左下角「套用：」）："fast" | "medium" | "accurate" | "custom"；
  // null = 還沒選過（新功能上線前的設定），載入時依目前數字推斷，對不上任何組合就當自訂
  stVideoPreset: null,
  stLivePreset: null,
  zoneCheckedAt: 0 // 上次查 B 站 zone API 的時間：超過 ZONE_MAX_AGE_MS 才重查（refreshZoneIfStale）
};

// 功能開關：安裝後／切換國家／自訂切回清單時，第一支影片在背景自動測速一次並換成最快節點（popup 顯示「優化中」）。
// 2.2.0 上線後各國預設節點已改為「各家 ISP 都能順暢播 4K」的普世節點，暫時不需要；程式碼保留，之後要應急再改回 true。
// main-hook.js 有同名開關，兩邊要一起改。
var FEATURE_AUTO_TEST_ON_COUNTRY = false;

var els = {
  enabled: document.getElementById("enabled"),
  autoFallback: document.getElementById("autoFallback"),
  gearBtn: document.getElementById("gearBtn"),
  advancedView: document.getElementById("advancedView"),
  advBackBtn: document.getElementById("advBackBtn"),
  tabVideo: document.getElementById("tabVideo"),
  tabLive: document.getElementById("tabLive"),
  panelVideo: document.getElementById("panelVideo"),
  panelLive: document.getElementById("panelLive"),
  modeList: document.getElementById("modeList"),
  modeCustom: document.getElementById("modeCustom"),
  modeOff: document.getElementById("modeOff"),
  videoOffHint: document.getElementById("videoOffHint"),
  liveModeList: document.getElementById("liveModeList"),
  liveModeOff: document.getElementById("liveModeOff"),
  liveSelect: document.getElementById("liveSelect"),
  liveSelectTrigger: document.getElementById("liveSelectTrigger"),
  liveSelectName: document.getElementById("liveSelectName"),
  liveSelectHost: document.getElementById("liveSelectHost"),
  liveSelectList: document.getElementById("liveSelectList"),
  liveOffHint: document.getElementById("liveOffHint"),
  liveSpeedtestBtn: document.getElementById("liveSpeedtestBtn"),
  cdnSelect: document.getElementById("cdnSelect"),
  cdnSelectTrigger: document.getElementById("cdnSelectTrigger"),
  cdnSelectName: document.getElementById("cdnSelectName"),
  cdnSelectHost: document.getElementById("cdnSelectHost"),
  cdnSelectList: document.getElementById("cdnSelectList"),
  countryRow: document.getElementById("countryRow"),
  countrySelect: document.getElementById("countrySelect"),
  countryText: document.getElementById("countryText"),
  countryCount: document.getElementById("countryCount"),
  customHost: document.getElementById("customHost"),
  customHint: document.getElementById("customHint"),
  customBox: document.getElementById("customBox"),
  customAddBtn: document.getElementById("customAddBtn"),
  customAddBox: document.getElementById("customAddBox"),
  customCount: document.getElementById("customCount"),
  customClearBtn: document.getElementById("customClearBtn"),
  showDebug: document.getElementById("showDebug"),
  debug: document.getElementById("debug"),
  mainView: document.getElementById("mainView"),
  speedtestView: document.getElementById("speedtestView"),
  speedtestBtn: document.getElementById("speedtestBtn"),
  rateBtn: document.getElementById("rateBtn"),
  donateBtn: document.getElementById("donateBtn"),
  feedbackBtn: document.getElementById("feedbackBtn"),
  stBackBtn: document.getElementById("stBackBtn"),
  stRetestBtn: document.getElementById("stRetestBtn"),
  stMeta: document.getElementById("stMeta"),
  stList: document.getElementById("stList"),
  stGuide: document.getElementById("stGuide")
};

// -------- i18n：套用 chrome.i18n 訊息到靜態文字節點（t / uiLanguage 等共用函式在 common.js）--------
document.title = t("popupTitle");
document.documentElement.lang = uiLanguage();
[
  ["headerTitle", "popupHeaderTitle"], ["gearBtnLabel", "advancedBtnLabel"], ["uiLangLabel", "uiLangLabel"], ["uiThemeLabel", "uiThemeLabel"], ["enabledLabel", "enabledLabel"], ["autoFallbackLabel", "autoFallbackLabel"], ["autoFallbackHint", "autoFallbackHint"], ["autoSpeedSwitchLabel", "autoSpeedSwitchLabel"], ["cdnHostRowLabel", "cdnHostRowLabel"],
  ["tabVideo", "tabVideo"], ["tabLive", "tabLive"], ["advHeaderTitle", "advancedTitle"], ["advBackBtn", "stBackBtn"], ["clBackBtn", "stBackBtn"], ["clHeaderTitle", "changelogTitle"],
  ["modeListLabel", "modeListLabel"], ["modeCustomLabel", "modeCustomLabel"], ["modeOffLabel", "modeOffLabel"], ["speedtestBtn", "speedtestBtnLabel"],
  ["liveModeListLabel", "liveModePrefLabel"], ["liveModeOffLabel", "modeOffLabel"], ["liveSpeedtestBtn", "liveSpeedtestBtnLabel"],
  ["videoOffHint", "modeOffHintVideo"], ["liveOffHint", "modeOffHintLive"],
  ["rateBtn", "rateBtnLabel"], ["donateBtn", "donateBtnLabel"], ["feedbackBtn", "feedbackBtnLabel"],
  ["showDebugLabel", "showDebugLabel"], ["debugSectionLabel", "debugSectionLabel"], ["stBackBtn", "stBackBtn"],
  ["stHeaderTitle", "stHeaderTitle"], ["stRetestBtn", "stRetestBtn"], ["stStopBtn", "stStopBtn"], ["stHintLeave", "stHintLeave"],
  ["liveRouteRowLabel", "liveRouteRowLabel"],
  ["sortBySpeedLabel", "sortBySpeedLabel"], ["sortBySpeedHint", "sortBySpeedHint"],
  ["optTitle", "optimizingTitle"], ["optSkip", "optimizingSkip"],
  ["stVideoLimitTitle", "stVideoLimitTitle"], ["stVideoLimitHint", "stVideoLimitHint"], ["stVideoMbLabel", "stVideoMbLabel"],
  ["stVideoSecLabel", "stVideoSecLabel"], ["stVideoSecUnit", "unitSec"], ["stVideoReset", "resetDefault"], ["stVideoPresetLabel", "stPresetLabel"],
  ["stLiveLimitTitle", "stLiveLimitTitle"], ["stLiveLimitHint", "stLiveLimitHint"], ["stLiveRunsLabel", "stLiveRunsLabel"],
  ["stLiveRunsUnit", "unitTimes"], ["stLiveSecLabel", "stLiveSecLabel"], ["stLiveSecUnit", "unitSec"], ["stLiveReset", "resetDefault"], ["stLivePresetLabel", "stPresetLabel"], ["liveRouteExplain", "liveRouteExplain"], ["showDebugHint", "showDebugHint"],
  ["staleTitle", "staleTabTitle"], ["stGuideTitle", "stGuideTitle"], ["stGuideText", "stGuideText"], ["stGuideBtn", "stGuideBtn"], ["staleText", "staleTabText"], ["staleReloadBtn", "staleTabReloadBtn"],
  ["customAddBtn", "customAddBtn"], ["customClearBtn", "customClearBtn"], ["resetAllBtn", "resetAllBtn"],
  ["wnSubtitle", "whatsNewSubtitle"], ["wnClose", "whatsNewClose"]
].forEach(function (pair) { document.getElementById(pair[0]).textContent = t(pair[1]); });
// -------- 介面語言（進階設定第一項）--------
// 選項存 localStorage（i18n.js 開頭同步讀）＋ chrome.storage.local 的 uiLang / uiMsgs（bridge.js 的頁內提示用，uiMsgs 為 null = 跟隨瀏覽器）。
// 切換後整個 popup 重載，並記一個 sessionStorage 旗標，重載完回到進階設定頁
var UI_LANG_NAMES = { zh_TW: "繁體中文", zh_CN: "简体中文", en: "English", ja: "日本語", ko: "한국어" };
var uiLangSelect = document.getElementById("uiLangSelect");
["auto"].concat(UI_LANGS).forEach(function (code) {
  var opt = document.createElement("option");
  opt.value = code;
  opt.textContent = code === "auto" ? t("uiLangAuto") : UI_LANG_NAMES[code];
  uiLangSelect.appendChild(opt);
});
uiLangSelect.value = uiLangPref;
document.getElementById("uiLangText").textContent = uiLangSelect.options[uiLangSelect.selectedIndex].textContent;
uiLangSelect.setAttribute("aria-label", t("uiLangLabel"));
uiLangSelect.addEventListener("change", function () {
  var v = uiLangSelect.value;
  setUiLangPref(v);
  try { window.sessionStorage.setItem("reopenAdvanced", "1"); } catch (e) {}
  chrome.storage.local.set({ uiLang: v, uiMsgs: v === "auto" ? null : loadUiMessages(v) }, function () { location.reload(); });
});
// localStorage 被清掉、與 storage 對不上時，以 storage 為準重載一次
chrome.storage.local.get({ uiLang: "auto" }, function (items) {
  if (window.uiLangFromUrl) return; // 測試用的 ?lang= 本來就跟設定不同，比對了會無限重載
  var v = items.uiLang;
  if (v === uiLangPref || (v !== "auto" && UI_LANGS.indexOf(v) < 0)) return;
  setUiLangPref(v);
  try { if (window.localStorage.getItem("uiLang") === v) location.reload(); } catch (e) {}
});
// -------- 外觀主題（進階設定第二項）：跟隨系統／明亮／黑暗 --------
// 選項存 localStorage（theme.js 在 <head> 同步讀、畫面出來前就套好）＋ chrome.storage.local 的 uiTheme；切換即時生效，不用重載
var UI_THEME_KEYS = { system: "uiThemeSystem", light: "uiThemeLight", dark: "uiThemeDark" };
var uiThemeSelect = document.getElementById("uiThemeSelect");
UI_THEMES.forEach(function (code) {
  var opt = document.createElement("option");
  opt.value = code;
  opt.textContent = t(UI_THEME_KEYS[code]);
  uiThemeSelect.appendChild(opt);
});
function syncUiThemeSelect() {
  uiThemeSelect.value = getUiTheme();
  document.getElementById("uiThemeText").textContent = uiThemeSelect.options[uiThemeSelect.selectedIndex].textContent;
}
syncUiThemeSelect();
uiThemeSelect.setAttribute("aria-label", t("uiThemeLabel"));
uiThemeSelect.addEventListener("change", function () {
  setUiTheme(uiThemeSelect.value);
  syncUiThemeSelect();
  chrome.storage.local.set({ uiTheme: uiThemeSelect.value });
});
// localStorage 被清掉、與 storage 對不上時，以 storage 為準
chrome.storage.local.get({ uiTheme: "system" }, function (items) {
  if (items.uiTheme === getUiTheme() || UI_THEMES.indexOf(items.uiTheme) < 0) return;
  setUiTheme(items.uiTheme);
  syncUiThemeSelect();
});
els.gearBtn.title = t("advancedBtnTitle");
els.gearBtn.setAttribute("aria-label", t("advancedBtnTitle"));
els.customHost.placeholder = t("customHostPlaceholder");
els.countrySelect.setAttribute("aria-label", t("countryLabel"));
els.countrySelect.title = t("countryLabel");
els.debug.textContent = t("debugInitial");
setRichText(document.getElementById("autoSpeedSwitchHint"), t("autoSpeedSwitchHint"));
document.getElementById("autoSpeedSwitchAllNote").textContent = t("autoSpeedSwitchAllNote");

// iPhone 的 popup 是整個螢幕寬的底部面板（見 popup.html 的 html.iphone）
var IS_IPHONE = /iPhone|iPod/.test(navigator.userAgent);
if (IS_IPHONE) document.documentElement.classList.add("iphone");

// -------- 評分按鈕：Chrome / Edge 共用同一份 popup.js，只能靠 UA 分辨（detectBrowser，common.js）；沒有對應網址就不顯示 --------
// 一律用不含 slug 的短網址：商店改名後 slug 會失效，靠 ID／slug 本身跳轉才不會壞。
// Edge Add-ons 沒有 /reviews 這層（會 404），只能導到商品頁，讓使用者自己往下捲到評論區。
// Safari 只放 Mac App Store；iOS 版還沒上架，iPhone / iPad 不顯示。
// 要用 macappstore://：https 的商品頁只會打開 App Store 的介紹頁，action=write-review（直接開評論視窗）只有這個 scheme 才吃
var STORE_REVIEW_URLS = {
  safari: "macappstore://apps.apple.com/app/id6817181919?action=write-review",
  chrome: "https://chromewebstore.google.com/detail/dfaddcffoondcendifiljhdbdagebgch/reviews",
  edge: "https://microsoftedge.microsoft.com/addons/detail/dllallgilijcacpdemjafegibdafcbdp",
  firefox: "https://addons.mozilla.org/addon/bilibili-cdn-switcher/reviews"
};

// 從擴充內按評分屬於「已安裝使用者」，跟 README 的取得管道（utm_campaign=readme）分開記，
// 免得把安裝來源報表灌成 GitHub 帶來的。
function withUtm(url, campaign) {
  var q = "utm_source=extension&utm_medium=referral&utm_campaign=" + campaign + "&utm_content=" + uiLangCode();
  return url + (url.indexOf("?") === -1 ? "?" : "&") + q;
}

// 「自訂節點列表」：一句說明＋官方測速工具的推廣卡（「自動偵測並加入」開教學文件）
var SPEEDTEST_DOC_URL = "https://lazy-cv.com/docs/bilibili-cdn-speedtest";
document.getElementById("customDesc").textContent = t("customDesc1");
document.getElementById("autoDetectText").textContent = t("autoDetectText");
document.getElementById("autoDetectBtn").textContent = t("autoDetectBtn");
document.getElementById("autoDetectBtn").addEventListener("click", function () {
  openTab(withUtm(SPEEDTEST_DOC_URL, "custom_list"));
});
// iPhone / iPad 跑不了測速工具：改用說明「在電腦上測，再掃 QR code 加到這台裝置」的文字
if (isIosSafari()) document.getElementById("autoDetectText").textContent = t("autoDetectTextIos");

// 國家清單下方：「沒有你的國家？試試最接近的國家，或是{link}」，{link} 是切到自訂節點列表的按鈕
(function renderCountryHint() {
  var box = document.getElementById("countryHint");
  var parts = t("countryMissingHint").split("{link}");
  box.appendChild(document.createTextNode(parts[0]));
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "linkBtn";
  btn.textContent = t("modeCustomLabel");
  btn.addEventListener("click", function () { els.modeCustom.click(); });
  box.appendChild(btn);
  box.appendChild(document.createTextNode(parts[1] || ""));
})();

// -------- 公告欄：主頁的跑馬燈，公布使用者所在國家的公告（每則「前綴＋捲動的標題」，點了開公告視窗 announcement.html，只顯示那一則）--------
// 多則時像兩張疊在一起的紙（後面那張往右下錯開、露出一角），手動切換、無限循環；樣式與動畫見 popup.html 的 #lotteryWrap。
// 資料來自 report worker 的 GET /v2/announcements（Neon 的 announcements，本機後台 admin/ 維護，見 scripts/lib/announcements.mjs）：
//   · type "lottery"：抽獎建立時自動產生。前綴（NT$200 抽獎:）與標題由 lottery-text.js 依抽獎資料組；只在抽獎期間、該國顯示。
//     抽獎 v2 的禮物卡各自有面額（前綴的金額變成範圍，例如 HK$100–150）、可能有備註（公告視窗才顯示）
//   · type "html"：後台寫的一般公告。前綴（可省略）、標題、點開的 HTML 都是 { 語言: 文字 }，依介面語言 → en → zh-TW 退回；
//     countries 空＝所有國家
// 只下載、不送任何資料；國家由這裡依本機的 detectedCountry 自己篩，國家不會送出去。
// storage.local.announcementFeed = { v, at, items } 快取 LOTTERY_TTL_MS（v 不是 ANNOUNCE_FEED_V 的舊格式快取直接作廢）：開 popup 先畫快取、過期再背景更新。
// 按 × 只關目前那一則：announcementDismissed = { <公告 id>: 到期時間（現在 + 3 天） }，其他則照常顯示，新公告自然會出現。
var ANNOUNCE_API = "https://bcs-report.bilibili-cdn-switcher-tools.workers.dev/v2/announcements";
var LOTTERY_TTL_MS = 15 * 60 * 1000; // 擴充自己的公告快取；加上 worker 的 1 分鐘，改了公告最慢約 16 分鐘使用者看得到
var ANNOUNCE_FEED_V = 2; // announcementFeed 的格式版本：公告 API 的回應格式改了就 +1，舊快取自動作廢（announcement.js 的同名常數要一起改）；2＝/v2/announcements
var LOTTERY_HIDE_MS = 3 * 24 * 60 * 60 * 1000;
var LOTTERY_PX_PER_SEC = 40; // 捲動速度
var LOTTERY_HOLD_MS = 1500; // 跑馬燈開始捲動前先停多久
var LOTTERY_FADE_MS = 180;
var LOTTERY_SWAP_MS = 480; // 換則時「下面那張翻到上面」的動畫
(function announcementBar() {
  var wrap = document.getElementById("lotteryWrap");
  var stack = document.getElementById("lotteryStack");
  var nextBtn = document.getElementById("lotteryNext");
  var tpl = document.getElementById("lotteryCardTpl");
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var lang = uiLangTag(); // lottery-text.js 與公告的語言鍵是 zh-TW 這種寫法
  var items = [], shown = [], shownKey = "", idx = 0, country = "", dismissed = {}, showAll = false;
  chrome.storage.local.remove(["lotteryFeed", "lotteryDismissed", "lotteryShowAll"]); // 改成公告之前（未上架的開發版）留下的舊資料
  var front = null, back = null, anim = null, swapping = false, paused = false, laidOutWidth = 0;
  stack.setAttribute("aria-label", t("lotteryBarLabel"));

  // 一張紙：從 <template> 複製，記住裡面會用到的元素
  function makeCard() {
    var el = tpl.content.firstElementChild.cloneNode(true);
    var c = { el: el, main: el.querySelector(".lotteryMain"), label: el.querySelector(".lotteryLabel"),
      viewport: el.querySelector(".lotteryViewport"), text: el.querySelector(".lotteryText"),
      close: el.querySelector(".lotteryClose"), full: "" };
    c.close.setAttribute("aria-label", t("lotteryBarHide"));
    c.close.title = t("lotteryBarHide");
    c.main.addEventListener("click", function () { if (c === front) openWindow(); });
    c.close.addEventListener("click", function (ev) { ev.stopPropagation(); if (c === front) dismissCurrent(); });
    c.main.addEventListener("mouseenter", function () { if (c === front) setPaused(true); });
    c.main.addEventListener("mouseleave", function () { if (c === front) setPaused(document.activeElement === c.main); });
    c.main.addEventListener("focus", function () { if (c === front) setPaused(true); });
    c.main.addEventListener("blur", function () { if (c === front) setPaused(c.main.matches(":hover")); });
    return c;
  }
  // 把第 i 則的文字放進這張紙
  function fill(c, i) {
    var l = shown[i];
    c.label.textContent = l.label;
    c.label.style.display = l.label ? "" : "none";
    c.full = l.text;
    c.text.textContent = l.text;
    c.main.title = l.label + l.text;
    c.text.style.transform = "";
    c.viewport.className = "lotteryViewport";
  }
  // 「下一則」按鈕：多則才顯示；3 則以上時提示下一則是第幾則
  function updateNext() {
    var n = shown.length;
    nextBtn.style.display = n > 1 ? "" : "none";
    var tip = t("lotteryBarNext") + (n > 2 ? " (" + ((idx + 1) % n + 1) + "/" + n + ")" : "");
    nextBtn.setAttribute("aria-label", tip);
    nextBtn.title = tip;
  }
  // 前面那張可以操作；後面那張只露出一角，設成 inert（點擊會落到 #lotteryStack，由它切到下一則）
  function setRoles() {
    front.el.className = "lotteryCard front";
    front.el.removeAttribute("inert");
    front.el.removeAttribute("aria-hidden");
    if (back) {
      back.el.className = "lotteryCard back";
      back.el.setAttribute("inert", "");
      back.el.setAttribute("aria-hidden", "true");
    }
  }

  function visibleAnnouncements() {
    var now = Date.now(), out = [];
    items.forEach(function (it) {
      if (!it || (dismissed[it.id] && now < dismissed[it.id])) return; // 這則按過 ×，3 天內不顯示
      if (it.type === "lottery") {
        var l = it.lottery;
        if (!l || !l.country || now < l.startsAt || now >= l.endsAt) return;
        if (!showAll && l.country !== country) return;
        try {
          var c = LotteryText.compose(l, lang);
          out.push({ id: it.id, label: c.label, text: c.line });
        } catch (e) {} // metadata 不完整（理論上 lottery.mjs 會擋）就略過這筆
      } else if (it.type === "html") {
        if (!showAll && it.countries && it.countries.length && it.countries.indexOf(country) === -1) return;
        var title = pickLang(it.title);
        if (title) out.push({ id: it.id, label: pickLang(it.prefix), text: title });
      }
    });
    return out;
  }

  function stop() {
    if (anim) { anim.onfinish = null; anim.cancel(); anim = null; }
  }
  // 播前面那張：標題放得下就靜止；放不下就跑馬燈——後面接一份同樣的文字（中間「•」），停一下後一直往左捲，
  // 每捲完一份的寬度剛好回到開頭的樣子，無縫循環。不會自動換下一則
  function play() {
    stop();
    var c = front;
    c.text.textContent = c.full;
    c.text.style.transform = "";
    c.viewport.className = "lotteryViewport";
    laidOutWidth = c.viewport.clientWidth;
    if (!laidOutWidth) return; // 主頁目前沒顯示（在別的頁面）：等 ResizeObserver 有寬度再排
    var over = c.text.offsetWidth - laidOutWidth;
    if (over <= 0) return;
    if (reduceMotion) { c.viewport.classList.add("ellipsis"); return; }
    c.viewport.classList.add("scroll");
    c.text.textContent = "";
    var first = document.createElement("span"), gap = document.createElement("span"), copy = document.createElement("span");
    first.textContent = copy.textContent = c.full;
    gap.className = "lotteryGap";
    gap.textContent = "•";
    gap.setAttribute("aria-hidden", "true");
    copy.setAttribute("aria-hidden", "true"); // 第二份只是視覺上的循環，螢幕閱讀器不重複念
    c.text.appendChild(first);
    c.text.appendChild(gap);
    c.text.appendChild(copy);
    var dist = first.offsetWidth + gap.offsetWidth;
    anim = c.text.animate([{ transform: "translateX(0)" }, { transform: "translateX(" + (-dist) + "px)" }], {
      duration: dist / LOTTERY_PX_PER_SEC * 1000, delay: LOTTERY_HOLD_MS, iterations: Infinity, easing: "linear"
    });
    if (paused) anim.pause();
  }

  // 下一則（手動；無限循環）：下面那張從後面往右上抽出、翻到最上面再落到前面，原本前面那張退到後面
  function advance() {
    if (swapping || shown.length < 2) return;
    stop();
    var n = shown.length, oldFront = front, oldBack = back;
    idx = (idx + 1) % n;
    function finish() {
      front = oldBack;
      back = oldFront;
      oldFront.el.style.zIndex = oldBack.el.style.zIndex = "";
      setRoles();
      fill(back, (idx + 1) % n); // 退到後面那張換成再下一則
      swapping = false;
      updateNext();
      play();
    }
    if (reduceMotion) { finish(); return; }
    swapping = true;
    var opts = { duration: LOTTERY_SWAP_MS, easing: "ease-in-out" };
    oldBack.el.animate([
      { transform: "translate(5px, 5px)" },
      { transform: "translate(16px, -12px) rotate(1.5deg)", offset: 0.45 },
      { transform: "translate(0, 0)" }
    ], opts);
    oldFront.el.animate([
      { transform: "translate(0, 0)" },
      { transform: "translate(-3px, 2px)", offset: 0.45 },
      { transform: "translate(5px, 5px)" }
    ], opts).onfinish = finish;
    // 抽到最高點時換上下：下面那張蓋到上面
    setTimeout(function () {
      oldBack.el.style.zIndex = "3";
      oldBack.el.classList.remove("back"); // 內容不再變淡
    }, LOTTERY_SWAP_MS * 0.45);
  }

  // 依目前的 shown 重建：一則＝一張紙；多則＝前後兩張（前面第 idx 則、後面下一則）
  function build() {
    stop();
    swapping = false;
    stack.textContent = "";
    front = back = null;
    if (!shown.length) { wrap.style.display = "none"; return; }
    wrap.style.display = "";
    idx = idx % shown.length;
    front = makeCard();
    fill(front, idx);
    if (shown.length > 1) {
      back = makeCard();
      fill(back, (idx + 1) % shown.length);
      stack.appendChild(back.el);
    }
    stack.appendChild(front.el);
    stack.classList.toggle("multi", shown.length > 1);
    wrap.classList.toggle("multi", shown.length > 1);
    setRoles();
    updateNext();
    play();
  }
  function render() {
    var list = visibleAnnouncements();
    var key = JSON.stringify(list);
    if (key === shownKey) return;
    var cur = front && shown[idx] ? shown[idx].id : null;
    shownKey = key;
    shown = list;
    // 盡量停在原本那一則；那一則不見了（例如剛按 ×）就停在同一個位置，也就是原本的下一則
    idx = Math.min(idx, Math.max(0, shown.length - 1));
    for (var i = 0; i < shown.length; i++) if (shown[i].id === cur) idx = i;
    build();
  }

  function setPaused(v) {
    paused = v;
    if (anim) { if (v) anim.pause(); else anim.play(); }
  }
  // 點到後面那張露出的一角（inert，點擊落到 stack 本身）→ 下一則
  stack.addEventListener("click", function (ev) { if (ev.target === stack && back) advance(); });
  nextBtn.addEventListener("click", advance);
  if (window.ResizeObserver) new ResizeObserver(function () {
    if (front && !swapping && front.viewport.clientWidth && front.viewport.clientWidth !== laidOutWidth) play();
  }).observe(stack);

  // 公告視窗（只顯示點到的那一則）：同問題回報，由 background 開成獨立視窗，popup 隨即關閉
  function openWindow() {
    var l = shown[idx];
    chrome.runtime.sendMessage({ type: "CDN_SWITCHER_OPEN_ANNOUNCEMENT_WINDOW", id: l ? l.id : null }, function () { void chrome.runtime.lastError; window.close(); });
  }
  // × 只關目前這一則（3 天），其他照常顯示；新的抽獎本來就沒被關過，自然會出現
  function dismissCurrent() {
    var l = shown[idx];
    if (!l || swapping) return;
    var now = Date.now();
    dismissed[l.id] = now + LOTTERY_HIDE_MS;
    for (var k in dismissed) if (dismissed[k] <= now) delete dismissed[k]; // 順便清掉過期的
    chrome.storage.local.set({ announcementDismissed: dismissed });
    stop();
    function rebuild() { shownKey = ""; render(); }
    if (reduceMotion) { rebuild(); return; }
    swapping = true;
    front.el.animate([{ opacity: 1, transform: "translate(0, 0)" }, { opacity: 0, transform: "translate(0, -6px)" }],
      { duration: LOTTERY_FADE_MS, fill: "forwards" }).onfinish = rebuild;
  }
  // Test seam: only the unit-test harness (test/helpers/load.mjs) defines __BCS_TEST__.
  if (globalThis.__BCS_TEST__ && typeof globalThis.__BCS_TEST__.register === "function") {
    globalThis.__BCS_TEST__.register("popup-announcement", {
      visibleAnnouncements: visibleAnnouncements, pickLang: pickLang,
      setState: function (s) { if (s.items) items = s.items; if (s.country != null) country = s.country; if (s.dismissed) dismissed = s.dismissed; if (s.showAll != null) showAll = s.showAll; },
      shown: function () { return shown; }, render: render
    });
  }

  // 第一次開 popup 時國家是查完 zone API 才寫入的：寫入後重新篩一次（announcementShowAll 是除錯開關，見檔尾 announcementShowAll()）
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local") return;
    if (ch.detectedCountry) country = ch.detectedCountry.newValue || "";
    if (ch.announcementShowAll) showAll = !!ch.announcementShowAll.newValue;
    if (ch.detectedCountry || ch.announcementShowAll) render();
  });

  chrome.storage.local.get({ announcementFeed: null, announcementDismissed: null, detectedCountry: "", announcementShowAll: false }, function (s) {
    showAll = !!s.announcementShowAll;
    if (s.announcementDismissed && typeof s.announcementDismissed === "object") dismissed = s.announcementDismissed;
    country = s.detectedCountry || "";
    var feed = s.announcementFeed;
    if (feed && (feed.v !== ANNOUNCE_FEED_V || !Array.isArray(feed.items))) feed = null; // 舊格式的快取：當作沒有，直接重抓
    if (feed) { items = feed.items; render(); }
    if (feed && Date.now() - feed.at < LOTTERY_TTL_MS) return;
    // no-store：不用瀏覽器的 HTTP 快取（worker 回應帶 max-age=60，給 Cloudflare 用的）；快取由擴充自己的 announcementFeed 管，
    // 不然 announcementReset() 清掉之後重抓，還是會拿到瀏覽器存著的舊回應
    fetch(ANNOUNCE_API, { credentials: "omit", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.items)) return;
        chrome.storage.local.set({ announcementFeed: { v: ANNOUNCE_FEED_V, at: Date.now(), items: j.items } });
        items = j.items;
        render();
      })
      .catch(function () {});
  });
})();

var reviewUrl = isIosSafari() ? null : STORE_REVIEW_URLS[detectBrowser()];
if (reviewUrl) {
  els.rateBtn.style.display = "";
  els.rateBtn.addEventListener("click", function () {
    // macappstore:// 由 App Store 接手，分頁本身不會載入任何東西，要把留下的空白分頁關掉；
    // App Store 一搶走焦點 popup 就關了，計時器跟著消失，所以交給 background 開與關
    if (reviewUrl.indexOf("macappstore:") === 0) {
      chrome.runtime.sendMessage({ type: "CDN_SWITCHER_OPEN_HANDOFF_URL", url: reviewUrl });
      return;
    }
    openTab(withUtm(reviewUrl, "rate"));
  });
}
// 贊助：在新分頁開 donate.html（先顯示乾爹排行榜），跟一般擴充的設定頁一樣是個網址，可以加書籤、重新整理。
// 還沒開放：只在本機載入的開發版（chrome://extensions「載入未封裝項目」、Firefox 暫時載入）顯示，商店版看不到；
// management.getSelf 不需要 management 權限。開放時把 DONATE_DEV_ONLY 改成 false。
// 金流與排行榜後端還沒部署，開發版先開假資料（donate.html?mock，見 donate.js 的 mockBoard）。
// Safari 版包在 App Store 的 App 裡，App Store 審核規定不能導去外部付款，所以不顯示（見 spec/donate.md 的商店規範）
var DONATE_DEV_ONLY = true;
function showDonateBtn(dev) {
  els.donateBtn.style.display = "";
  els.rateBtn.parentNode.style.display = "";
  els.donateBtn.addEventListener("click", function () {
    openTab(chrome.runtime.getURL("donate.html" + (dev ? "?mock" : "")));
    window.close();
  });
}
if (detectBrowser() !== "safari") {
  if (!DONATE_DEV_ONLY) showDonateBtn(false);
  else if (chrome.management && chrome.management.getSelf) {
    chrome.management.getSelf(function (self) { if (self && self.installType === "development") showDonateBtn(true); });
  }
}
// 兩顆都沒顯示（iPhone / iPad Safari、還沒開放贊助的商店版且沒有評分連結）時整列收起來，不然空的一列會多佔一個間距
if (els.rateBtn.style.display === "none") els.rateBtn.parentNode.style.display = "none";
// 問題回報：一律由 background 開成獨立視窗（report.html），帶上目前分頁 id 讓回報頁能向 B 站頁面要此刻的快照；popup 隨即關閉
els.feedbackBtn.style.display = "";
els.feedbackBtn.addEventListener("click", function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    var tabId = tab && BILI_TAB_RE.test(tab.url || "") ? tab.id : null;
    chrome.runtime.sendMessage({ type: "CDN_SWITCHER_OPEN_REPORT_WINDOW", tab: tabId }, function () { void chrome.runtime.lastError; window.close(); });
  });
});

// 回報紀錄列：storage.local.reportHistory = [{ n, url, t, type }]，由 report.js 送出成功時寫入。
// 永久保留，只有使用者按 × 才移除；擴充更新不會清掉。
function renderReportHistory() {
  chrome.storage.local.get({ reportHistory: [] }, function (items) {
    var list = Array.isArray(items.reportHistory) ? items.reportHistory : [];
    var box = document.getElementById("reportHistory");
    box.textContent = "";
    if (!list.length) { box.style.display = "none"; return; }
    box.style.display = "";
    var lbl = document.createElement("span"); lbl.textContent = t("reportHistoryLabel"); box.appendChild(lbl);
    list.slice().reverse().forEach(function (rec) {
      if (!rec || !rec.url) return;
      var chip = document.createElement("span"); chip.className = "rhChip";
      var a = document.createElement("a"); a.href = rec.url; a.textContent = "#" + rec.n;
      a.title = (rec.t ? new Date(rec.t).toLocaleString() : "") + "\n" + rec.url;
      a.addEventListener("click", function (e) { e.preventDefault(); openTab(rec.url); });
      var x = document.createElement("button"); x.type = "button"; x.textContent = "×"; x.title = t("reportHistoryRemove"); x.setAttribute("aria-label", t("reportHistoryRemove"));
      x.addEventListener("click", function () {
        chrome.storage.local.get({ reportHistory: [] }, function (it) {
          var cur = Array.isArray(it.reportHistory) ? it.reportHistory : [];
          chrome.storage.local.set({ reportHistory: cur.filter(function (r) { return !r || r.url !== rec.url; }) }, renderReportHistory);
        });
      });
      chip.appendChild(a); chip.appendChild(x); box.appendChild(chip);
    });
  });
}
renderReportHistory();
try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && ch.reportHistory) renderReportHistory(); }); } catch (e) {}

var knownValues = {}; // 清单中所有 value（1.6 以前用来判断储存值是否为自行输入，见载入时的迁移）
var cdnMode = "list"; // 目前用哪份节点（"list" / "custom"）；选「关闭」时保留关闭前的那份
var customHosts = []; // 自订节点列表
var cdnList = []; // cdn-list.json 的 options（全部节点，「全部」选项的顺序），供显示名称与查找
var cdnPools = {}; // cdn-list.json 的 pools：池类型的多语标签
var currentCdnHost = null; // 目前生效的 cdnHost，供测速页标示「目前使用」＋点击切换比对
var videoOn = true; // 一般影片没选「关闭」；关闭时测速页不标示「目前使用」

// 具名节点：「技术代号 (池类型)」；特殊选项（backup）用 nameKey + noteKey
function cdnDisplayName(o) {
  var name = o.nameKey ? t(o.nameKey) : o.name;
  var note = o.noteKey ? t(o.noteKey) : o.pool ? localized(cdnPools[o.pool]) : (o.note || "");
  return name + (note ? " (" + note + ")" : "");
}

// -------- 國家：節點下拉只列該國的建議節點（研究報告預先篩出的前 10 名），最後接 B 站備援；「全部」列出全部節點 --------
var COUNTRY_ALL = "ALL";
var COUNTRY_FALLBACK = "TW"; // 偵測不到、或使用者所在國家不在清單內時的預設
// 舊版清單裡、已確定網域不存在而移除的節點：還存著它們的使用者搬回預設
var REMOVED_HOSTS = ["upos-sz-mirrorhwov.bilivideo.com", "cn-hk-eq-bcache-01.bilivideo.com"];
var cdnCountries = []; // cdn-list.json 的 countries
var countrySel = COUNTRY_FALLBACK;
var detectedCountry = ""; // 依 IP 偵測到的國家（在清單內才有值）

function findCountry(code) {
  for (var i = 0; i < cdnCountries.length; i++) if (cdnCountries[i].code === code) return cdnCountries[i];
  return null;
}
function validCountry(code) { return code === COUNTRY_ALL || !!findCountry(code); }
// 目前國家要測速／列出的節點 host（不含 backup），依該國預設排序
function countryHosts(code) {
  if (code === COUNTRY_ALL) return cdnList.filter(function (o) { return o.value !== "backup"; }).map(function (o) { return o.value; });
  var c = findCountry(code);
  return c ? c.nodes.filter(function (h) { return !!findCdnOpt(h); }) : [];
}
// 目前這份節點（國家清單或自訂節點列表）：測速、自動測速都測這份
function activeHosts() { return cdnMode === "custom" ? customHosts.slice() : countryHosts(countrySel); }
// 自訂節點不一定在 cdn-list.json 裡：不在的就用 host 當名稱
function customOpt(h) { return findCdnOpt(h) || { value: h, name: h, unknown: true }; }
// 下拉要列的選項：國家節點 + 最後的 B 站備援；自訂節點列表就只列使用者的節點
function visibleCdnOptions() {
  if (cdnMode === "custom") return customHosts.map(customOpt);
  var opts = countryHosts(countrySel).map(findCdnOpt);
  var backup = findCdnOpt("backup");
  if (backup) opts.push(backup);
  return opts;
}
function renderCountrySelect() {
  var sel = els.countrySelect;
  sel.textContent = "";
  // 目前選的國家排第一個，其餘照清單原本的順序
  var cur0 = findCountry(countrySel);
  (cur0 ? [cur0].concat(cdnCountries.filter(function (c) { return c !== cur0; })) : cdnCountries).forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = c.code === detectedCountry ? t("countryYouAreHere").replace("{name}", localized(c.name)) : localized(c.name);
    sel.appendChild(opt);
  });
  var all = document.createElement("option");
  all.value = COUNTRY_ALL;
  all.textContent = t("countryAll");
  sel.appendChild(all);
  sel.value = countrySel;
  // 收合時顯示的文字另外放：「你在這裡」只在展開的清單裡標，已選的國家不標
  var cur = findCountry(countrySel);
  els.countryText.textContent = cur ? localized(cur.name) : t("countryAll");
  var n = countryHosts(countrySel).length;
  els.countryCount.textContent = t("countryNodeCount").replace("{n}", n);
  els.countryCount.classList.toggle("all", countrySel === COUNTRY_ALL);
}
// 切換國家（或首次自動選國家）：重建下拉；節點排序一律回到該國的原始排序，不分國家記憶
function applyCountry(code) {
  countrySel = code;
  if (speedOrder.video && speedOrder.video.length) {
    speedOrder.video = [];
    save({ speedOrder: sortOn ? speedOrder : null });
  }
  renderCountrySelect();
  buildCdnSelectList(visibleCdnOptions());
  selectCdnValue(cdnSelectValue);
  saveAutoSpeedHosts();
}
// 自動測速要測的節點跟著國家走；選「全部」時不能用（約 300 個節點，背景測不完）：
// 寫入空清單讓 content script 不測，進階設定的開關也停用並顯示原因
var savedAutoSpeedHosts = "";
function saveAutoSpeedHosts() {
  var isAll = cdnMode === "list" && countrySel === COUNTRY_ALL;
  var sw = document.getElementById("autoSpeedSwitch");
  sw.disabled = isAll;
  sw.closest(".advItem").classList.toggle("disabled", isAll);
  document.getElementById("autoSpeedSwitchAllNote").style.display = isAll ? "" : "none";
  var hosts = isAll ? [] : activeHosts();
  var sig = hosts.join("|");
  if (sig === savedAutoSpeedHosts) return;
  savedAutoSpeedHosts = sig;
  save({ autoSpeedHosts: hosts });
}
// 選用該國第一個節點（該國預設）：寫進 patch，並同步畫面上的選取值
function useCountryFirstNode(code, patch) {
  var first = countryHosts(code)[0];
  if (!first) return;
  patch.cdnHost = first;
  cdnSelectValue = first;
  if (els.modeList.checked) currentCdnHost = first;
}
els.countrySelect.addEventListener("change", function () {
  var code = els.countrySelect.value;
  if (!validCountry(code) || code === countrySel) return;
  countryAutoPending = false; // 使用者自己選了，偵測結果晚到也不要蓋掉
  var patch = { cdnCountry: code, countryAutoDone: true };
  useCountryFirstNode(code, patch); // 國家選單只在清單模式顯示，切國家就直接換成該國第一個節點
  // 下一支影片在背景測一次、換成最快的（「全部」300 個測不完，不測）。要測的清單跟旗標一起寫，
  // content script 收到旗標時清單已經是新國家的，不用等 saveAutoSpeedHosts 的第二次寫入
  patch.autoTestPending = FEATURE_AUTO_TEST_ON_COUNTRY && code !== COUNTRY_ALL;
  patch.autoSpeedHosts = code === COUNTRY_ALL ? [] : countryHosts(code);
  savedAutoSpeedHosts = patch.autoSpeedHosts.join("|");
  save(patch);
  applyCountry(code);
});

// 依 IP 判斷國家：B 站 zone API（fetchZone，common.js）。
// 回傳清單內的國家 code；不在清單內回 ""；查詢失敗回 null（下次開啟再試）
var countryAutoPending = false;
// The zone API only reports the international dialing code, and some codes are shared:
// +7 is Russia and Kazakhstan, +1 is the US, Canada and most of the Caribbean. We deliberately
// treat every +7 user as RU and every +1 user as US — the node lists are the same either way,
// only the "you are here" label can be off.
function countryByDial(dial) {
  for (var i = 0; i < cdnCountries.length; i++) if (cdnCountries[i].dial === dial) return cdnCountries[i].code;
  return "";
}
function detectCountry() {
  return fetchZone().then(function (d) { return d ? countryByDial(Number(d.country_code)) : null; });
}
function refreshZoneIfStale(items) {
  if (items && items.countryAutoDone === false) return; // 第一次：autoSelectCountry 自己會查
  if (items && items.zoneCheckedAt && Date.now() - items.zoneCheckedAt < ZONE_MAX_AGE_MS) return;
  detectCountry().then(function (code) {
    // 使用者換了網路、IP 國家變了：只更新「你在這裡」標記，不動使用者選的國家
    if (code === null || code === detectedCountry) return;
    detectedCountry = code; save({ detectedCountry: code }); renderCountrySelect();
  });
}
function autoSelectCountry(cfg) {
  if (cfg.countryAutoDone) return;
  countryAutoPending = true;
  detectCountry().then(function (code) {
    if (!countryAutoPending || code === null) return;
    countryAutoPending = false;
    detectedCountry = code;
    var target = code || COUNTRY_FALLBACK;
    var patch = { cdnCountry: target, detectedCountry: code, countryAutoDone: true };
    // First run only (countryAutoDone is never reset): switch to the country's first node, because a
    // node chosen before the country lists existed is usually not in the list and would be invisible
    // in the dropdown. Users on the custom list keep their node.
    if (cdnMode !== "custom") {
      useCountryFirstNode(target, patch);
      patch.autoTestPending = FEATURE_AUTO_TEST_ON_COUNTRY && target !== COUNTRY_ALL;
      patch.autoSpeedHosts = target === COUNTRY_ALL ? [] : countryHosts(target);
      savedAutoSpeedHosts = patch.autoSpeedHosts.join("|");
    }
    save(patch);
    applyCountry(target);
  });
}

// -------- CDN 清单：自制下拉（原生 select 的 option 不能分两行、不能弱化网域字重，改用 div 清单模拟）--------
var cdnSelectValue = ""; // 目前下拉「显示/选取」的 value；选「关闭」时 currentCdnHost 不算生效，这里仍记着关闭前的选择

function findCdnOpt(value) {
  for (var i = 0; i < cdnList.length; i++) if (cdnList[i].value === value) return cdnList[i];
  return null;
}
function renderCdnSelectTrigger() {
  var o = findCdnOpt(cdnSelectValue);
  els.cdnSelectName.textContent = o ? cdnDisplayName(o) : cdnSelectValue;
  var isHost = !!o && o.value !== "base" && o.value !== "backup";
  els.cdnSelectHost.textContent = isHost ? o.value : "";
  els.cdnSelectHost.style.display = isHost ? "" : "none";
}
function closeCdnSelect() { els.cdnSelect.classList.remove("open"); }
function selectCdnValue(value) {
  cdnSelectValue = value;
  renderCdnSelectTrigger();
  var rows = els.cdnSelectList.children;
  for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("selected", rows[i].dataset.value === value);
}
function buildCdnSelectList(options) {
  els.cdnSelectList.textContent = "";
  var custom = cdnMode === "custom";
  options.forEach(function (o) {
    var isHost = o.value !== "base" && o.value !== "backup" && !o.unknown; // 不在清单内的自订节点名称就是 host，不再重复显示
    var row = document.createElement("div");
    row.className = "cdnOptRow" + (custom ? " hasDel" : "");
    row.dataset.value = o.value;
    var nameEl = document.createElement("span");
    nameEl.className = "cdnOptName";
    nameEl.textContent = o.unknown ? o.value : cdnDisplayName(o);
    row.appendChild(nameEl);
    if (isHost) {
      var hostEl = document.createElement("span");
      hostEl.className = "cdnOptHost";
      hostEl.textContent = o.value;
      row.appendChild(hostEl);
    }
    if (custom) {
      var del = document.createElement("button");
      del.type = "button";
      del.className = "cdnOptDel";
      del.textContent = "✕";
      del.title = t("customDelTitle");
      del.setAttribute("aria-label", t("customDelTitle"));
      del.addEventListener("click", function (ev) { ev.stopPropagation(); removeCustomHost(o.value); });
      row.appendChild(del);
    }
    row.addEventListener("click", function () {
      closeCdnSelect();
      if (o.value === cdnSelectValue) return;
      selectCdnValue(o.value);
      currentCdnHost = o.value;
      save({ videoEnabled: true, cdnHost: o.value, autoTestPending: false }); // 使用者自己選了，切換國家後的自動測速取消
    });
    els.cdnSelectList.appendChild(row);
  });
}
els.cdnSelectTrigger.addEventListener("click", function (ev) {
  ev.stopPropagation();
  els.cdnSelect.classList.toggle("open");
});
document.addEventListener("click", function (ev) {
  if (!els.cdnSelect.contains(ev.target)) closeCdnSelect();
  if (!els.liveSelect.contains(ev.target)) els.liveSelect.classList.remove("open");
});

// 把使用者输入正规化成 host（去掉 http://、路径等）；无效回 ""
function normHost(s) {
  s = (s || "").trim();
  if (!s) return "";
  try { if (/^https?:\/\//i.test(s)) return new URL(s).host.toLowerCase(); } catch (e) {}
  s = s.replace(/^\/+/, "").split("/")[0].split("?")[0].split("#")[0].toLowerCase();
  return (/^[a-z0-9.-]+(:\d+)?$/.test(s) && s.indexOf(".") >= 0) ? s : "";
}

function buildOptions(current, on) {
  renderCountrySelect();
  buildCdnSelectList(visibleCdnOptions());
  selectCdnValue(current);
  // 还原目前选择：「关闭」优先；否则看用的是国家清单还是自订节点列表
  (!on ? els.modeOff : cdnMode === "custom" ? els.modeCustom : els.modeList).checked = true;
  syncModeUI();
}

// 依目前是「清单选择」「自订节点列表」还是「关闭」互斥显示对应的元件
function syncModeUI() {
  var isCustom = els.modeCustom.checked, isOff = els.modeOff.checked, hasCustom = customHosts.length > 0;
  els.cdnSelect.style.display = isOff ? "none" : "block";
  els.countryRow.style.display = (isCustom || isOff) ? "none" : "flex";
  document.getElementById("countryHint").style.display = (isCustom || isOff) ? "none" : "block";
  els.customBox.style.display = isCustom ? "block" : "none";
  els.customAddBox.style.display = isCustom ? "block" : "none";
  els.customCount.textContent = t("countryNodeCount").replace("{n}", customHosts.length); // 跟國家清單同一個樣式與文字
  els.customClearBtn.disabled = !hasCustom;
  els.videoOffHint.style.display = isOff ? "block" : "none";
  els.speedtestBtn.disabled = !activeHosts().length;
  els.speedtestBtn.parentNode.style.display = isOff ? "none" : ""; // 選「關閉」就沒有節點可測，整列藏起來
  // 自訂節點列表是空的：下拉照樣顯示，但不能展開，文字改成「空列表」
  var empty = isCustom && !hasCustom;
  els.cdnSelect.classList.toggle("empty", empty);
  els.cdnSelectTrigger.disabled = empty;
  if (empty) {
    els.cdnSelectName.textContent = t("customListEmpty");
    els.cdnSelectHost.style.display = "none";
  } else {
    renderCdnSelectTrigger();
  }
  if (isOff || empty) closeCdnSelect();
}

// 换了节点那份（国家清单 ↔ 自订节点列表、自订列表增删）：重建下拉、选取值、自动测速的节点
function rebuildCdnList() {
  customHint("");
  buildCdnSelectList(visibleCdnOptions());
  applyDropdownOrder();
  selectCdnValue(cdnSelectValue);
  saveAutoSpeedHosts();
  syncModeUI();
}
// 改用某个节点（会写进 patch 一起存）
function useHost(host, patch) {
  patch.cdnHost = host;
  cdnSelectValue = host;
  if (videoOn) currentCdnHost = host;
}

// 問題回報用的事件日誌：使用者在 popup 的動作（換節點、換國家、開關…）統一在 save() 這裡比對前後值記下，
// 不用在每個事件處理器各記一次。載入時的遷移寫入（journalReady 之前）不算使用者動作
var journalReady = false, lastCfg = {};
var JOURNAL_TOGGLE_KEYS = ["enabled", "autoFallback", "videoEnabled", "liveEnabled", "sortBySpeed", "autoSpeedSwitch", "showDebug"];
function journalUi(k, d) {
  try { chrome.runtime.sendMessage({ type: "CDN_SWITCHER_JOURNAL", entry: { t: Date.now(), k: k, d: d } }, function () { void chrome.runtime.lastError; }); } catch (e) {}
}
function save(patch) {
  chrome.storage.local.set(patch);
  if (journalReady) {
    if ("cdnHost" in patch && patch.cdnHost !== lastCfg.cdnHost) journalUi("ui.node", { from: shortHost(lastCfg.cdnHost), to: shortHost(patch.cdnHost), mode: patch.cdnMode || lastCfg.cdnMode, auto: "autoTestPending" in patch && patch.autoTestPending ? 1 : 0 });
    if ("cdnCountry" in patch && patch.cdnCountry !== lastCfg.cdnCountry) journalUi("ui.country", { from: lastCfg.cdnCountry, to: patch.cdnCountry, auto: "detectedCountry" in patch ? 1 : 0 });
    if ("liveRoute" in patch && patch.liveRoute !== lastCfg.liveRoute) journalUi("ui.liveRoute", { from: lastCfg.liveRoute, to: patch.liveRoute });
    if ("cdnMode" in patch && patch.cdnMode !== lastCfg.cdnMode) journalUi("ui.mode", { from: lastCfg.cdnMode, to: patch.cdnMode });
    JOURNAL_TOGGLE_KEYS.forEach(function (k) { if (k in patch && !!patch[k] !== !!lastCfg[k]) journalUi("ui.toggle", { key: k, value: patch[k] ? 1 : 0 }); });
  }
  for (var k2 in patch) lastCfg[k2] = patch[k2];
}

// 读清单 + 目前设定 → 建立下拉
Promise.all([
  fetch(chrome.runtime.getURL("cdn-list.json")).then(function (r) { return r.json(); }).catch(function () { return { options: [] }; }),
  new Promise(function (res) { chrome.storage.local.get(DEFAULTS, res); })
]).then(function (arr) {
  var data = arr[0] || {};
  cdnList = data.options || [];
  cdnPools = data.pools || {};
  cdnCountries = data.countries || [];
  addFakeCountry();
  var cfg = {};
  for (var k in DEFAULTS) cfg[k] = arr[1][k] === undefined ? DEFAULTS[k] : arr[1][k];
  // 旧版「清单里的『原始(不覆写)』」(cdnHost='base') 已被独立的「关闭」取代：搬成 videoEnabled=false
  if (cfg.cdnHost === "base") {
    cfg.videoEnabled = false; cfg.cdnHost = DEFAULTS.cdnHost;
    save({ videoEnabled: false, cdnHost: DEFAULTS.cdnHost });
  }
  if (REMOVED_HOSTS.indexOf(cfg.cdnHost) >= 0) {
    cfg.cdnHost = DEFAULTS.cdnHost;
    save({ cdnHost: DEFAULTS.cdnHost });
  }
  countrySel = validCountry(cfg.cdnCountry) ? cfg.cdnCountry : COUNTRY_FALLBACK;
  detectedCountry = findCountry(cfg.detectedCountry) ? cfg.detectedCountry : "";
  if (addFakeCountry.active) { countrySel = detectedCountry = FAKE_COUNTRY.code; cfg.countryAutoDone = true; }
  els.enabled.checked = !!cfg.enabled;
  els.autoFallback.checked = !!cfg.autoFallback;
  document.getElementById("autoSpeedSwitch").checked = !!cfg.autoSpeedSwitch;
  savedAutoSpeedHosts = (cfg.autoSpeedHosts || []).join("|");
  els.showDebug.checked = !!cfg.showDebug;
  syncDebugSection();
  cdnList.forEach(function (o) { knownValues[o.value] = true; }); // 不在目前國家清單的節點也算清單內
  customHosts = Array.isArray(cfg.customHosts) ? cfg.customHosts.slice() : [];
  cdnMode = cfg.cdnMode === "custom" || cfg.cdnMode === "list" ? cfg.cdnMode : null;
  if (!cdnMode) {
    // 1.6 以前沒有 cdnMode：節點不在清單內就是當時「自行輸入」的 host，搬進自訂節點列表
    var oldCustom = !!cfg.cdnHost && !knownValues[cfg.cdnHost];
    cdnMode = oldCustom ? "custom" : "list";
    if (oldCustom && customHosts.indexOf(cfg.cdnHost) < 0) customHosts.unshift(cfg.cdnHost);
    save({ cdnMode: cdnMode, customHosts: customHosts });
  } else if (cdnMode === "custom" && customHosts.length && customHosts.indexOf(cfg.cdnHost) < 0) {
    cfg.cdnHost = customHosts[0]; // 列表原本是空的、後來才加入（例如測速工具匯入）：改用列表第一個
    save({ cdnHost: cfg.cdnHost });
  }
  currentCdnHost = cfg.cdnHost;
  videoOn = cfg.videoEnabled !== false;
  buildOptions(cfg.cdnHost, videoOn);
  saveAutoSpeedHosts();
  liveOn = cfg.liveEnabled !== false;
  liveRouteSel = LIVE_ROUTES.indexOf(cfg.liveRoute) >= 0 ? cfg.liveRoute : DEFAULTS.liveRoute;
  (liveOn ? els.liveModeList : els.liveModeOff).checked = true;
  syncLiveUI();
  renderLiveRows();
  sortOn = !!cfg.sortBySpeed;
  document.getElementById("sortBySpeed").checked = sortOn;
  if (sortOn && cfg.speedOrder) speedOrder = { video: cfg.speedOrder.video || [], live: cfg.speedOrder.live || [] };
  applyDropdownOrder();
  LIMIT_FIELDS.forEach(function (f) { limits[f.key] = clampLimit(f, cfg[f.key]); document.getElementById(f.key).value = limits[f.key]; });
  loadPresets(cfg);
  for (var jk in cfg) lastCfg[jk] = cfg[jk];
  journalReady = true;
  autoSelectCountry(cfg);
  refreshZoneIfStale(arr[1]);
});

els.enabled.addEventListener("change", function () { save({ enabled: els.enabled.checked }); });
els.autoFallback.addEventListener("change", function () { save({ autoFallback: els.autoFallback.checked }); });
// 自動測速副作用大：打開前先跳警告，按「仍要開啟」才真的開；關閉不用確認
document.getElementById("autoSpeedSwitch").addEventListener("change", function () {
  var sw = this;
  if (!sw.checked) { save({ autoSpeedSwitch: false }); return; }
  sw.checked = false;
  showWarnDialog({
    title: t("autoSpeedWarnTitle"),
    paras: [t("autoSpeedWarnText"), t("autoSpeedWarnAdvice")],
    cancel: t("autoSpeedWarnCancel"),
    confirm: t("autoSpeedWarnConfirm"),
    onConfirm: function () { sw.checked = true; save({ autoSpeedSwitch: true }); }
  });
});
// Debug（目前分頁）的文字只在開啟 debug 疊層時才顯示，跟該開關放在同一區
function syncDebugSection() { document.getElementById("debugSection").style.display = els.showDebug.checked ? "" : "none"; }
els.showDebug.addEventListener("change", function () { syncDebugSection(); save({ showDebug: els.showDebug.checked }); });

// 國家清單 ↔ 自訂節點列表互切時，一律改用新那份的第一個節點（自訂列表是空的就先不動）；
// 從「關閉」切回關閉前用的那份則沿用原本的節點
els.modeList.addEventListener("change", function () {
  if (!els.modeList.checked) return;
  videoOn = true;
  var patch = { videoEnabled: true, cdnMode: "list" };
  if (cdnMode !== "list") {
    // 從自訂切回清單：節點是程式替使用者選的（該國第一個），跟切換國家一樣，下一支影片在背景測一次
    cdnMode = "list";
    useCountryFirstNode(countrySel, patch);
    patch.autoTestPending = FEATURE_AUTO_TEST_ON_COUNTRY && countrySel !== COUNTRY_ALL;
    patch.autoSpeedHosts = countrySel === COUNTRY_ALL ? [] : countryHosts(countrySel);
    savedAutoSpeedHosts = patch.autoSpeedHosts.join("|");
  }
  currentCdnHost = cdnSelectValue;
  save(patch);
  rebuildCdnList();
});
els.modeCustom.addEventListener("change", function () {
  if (!els.modeCustom.checked) return;
  videoOn = true;
  var patch = { videoEnabled: true, cdnMode: "custom", autoTestPending: false };
  if ((cdnMode !== "custom" || customHosts.indexOf(cdnSelectValue) < 0) && customHosts.length) useHost(customHosts[0], patch);
  cdnMode = "custom";
  currentCdnHost = cdnSelectValue;
  save(patch);
  rebuildCdnList();
  if (!customHosts.length) els.customHost.focus();
});
els.modeOff.addEventListener("change", function () {
  if (!els.modeOff.checked) return;
  syncModeUI();
  videoOn = false;
  save({ videoEnabled: false, autoTestPending: false });
});

// -------- 自訂節點列表：輸入網址或 host 按 Enter／加入；每列可移除、可整個清空 --------
function customHint(key) {
  els.customHint.textContent = key ? t(key) : "";
  els.customHint.style.display = key ? "block" : "none";
  els.customHint.style.color = "#e00";
}
// 可以一次加入多個（空白、逗號、換行分隔，例如貼上測速工具「全部複製」的清單）
function addCustomHost(text) {
  var tokens = (text != null ? text : els.customHost.value).split(/[\s,，、]+/).filter(Boolean);
  var added = [], bad = 0, dup = 0;
  tokens.forEach(function (s) {
    var h = normHost(s);
    if (!h) bad++;
    else if (customHosts.indexOf(h) >= 0 || added.indexOf(h) >= 0) dup++;
    else added.push(h);
  });
  if (!added.length) { customHint(bad || !tokens.length ? "customHintInvalid" : "customHintDup"); return; }
  customHint("");
  els.customHost.value = "";
  var wasEmpty = !customHosts.length;
  customHosts = customHosts.concat(added);
  var patch = { customHosts: customHosts.slice() };
  // 列表原本是空的（目前還在用原本的節點）→ 改用第一個加入的
  if (wasEmpty && cdnMode === "custom") useHost(added[0], patch);
  save(patch);
  rebuildCdnList();
}
els.customAddBtn.addEventListener("click", function () { addCustomHost(); });
els.customHost.addEventListener("keydown", function (ev) { if (ev.key === "Enter") addCustomHost(); });
// 貼上多行（單行輸入框會把換行吃掉、黏成一串）：直接全部加入
els.customHost.addEventListener("paste", function (ev) {
  var text = (ev.clipboardData || window.clipboardData).getData("text") || "";
  if (!/[\r\n]/.test(text.trim())) return;
  ev.preventDefault();
  addCustomHost(text);
});
els.customHost.addEventListener("input", function () { customHint(""); });

// 列表清空（或最後一個被移除）：改回國家清單、用目前國家的第一個節點
function clearCustomHosts() {
  customHosts = [];
  var patch = { customHosts: [], cdnMode: "list" };
  cdnMode = "list";
  useCountryFirstNode(countrySel, patch);
  if (videoOn) { els.modeList.checked = true; currentCdnHost = cdnSelectValue; }
  save(patch);
  rebuildCdnList();
}
function removeCustomHost(h) {
  var i = customHosts.indexOf(h);
  if (i < 0) return;
  if (customHosts.length === 1) { closeCdnSelect(); clearCustomHosts(); return; }
  customHosts.splice(i, 1);
  var patch = { customHosts: customHosts.slice() };
  if (cdnSelectValue === h) useHost(customHosts[0], patch); // 移除的是目前用的節點 → 改用列表第一個
  save(patch);
  rebuildCdnList();
  els.cdnSelect.classList.add("open"); // 重建後清單還開著，方便連續移除
}
els.customClearBtn.addEventListener("click", function () {
  showWarnDialog({
    plain: true,
    title: t("customClearTitle"),
    paras: [t("customClearText").replace("{n}", customHosts.length)],
    cancel: t("customClearCancel"),
    confirm: t("customClearConfirm"),
    onConfirm: clearCustomHosts
  });
});

// 測速工具在 popup 開著時匯入節點：同步畫面
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== "local") return;
  // 背景自動測速（切換國家後那一次、或每支影片的自動測速）換了節點：popup 開著時，下拉與測速頁的打勾要跟著變
  if (changes.cdnHost && typeof changes.cdnHost.newValue === "string") {
    var host = changes.cdnHost.newValue;
    if (host !== cdnSelectValue && activeHosts().indexOf(host) >= 0) {
      selectCdnValue(host);
      currentCdnHost = host;
      if (lastSpeedtestState) renderSpeedtest(lastSpeedtestState);
    }
  }
  if (!changes.customHosts) return;
  var next = changes.customHosts.newValue || [];
  if (next.join("|") === customHosts.join("|")) return;
  customHosts = next.slice();
  if (cdnMode === "custom" && customHosts.length && customHosts.indexOf(cdnSelectValue) < 0) {
    var patch = {};
    useHost(customHosts[0], patch);
    save(patch);
  }
  rebuildCdnList();
});

// -------- 分頁：影片 / 直播 --------
function selectTab(name) {
  var isLive = name === "live";
  els.tabVideo.classList.toggle("active", !isLive);
  els.tabLive.classList.toggle("active", isLive);
  els.tabVideo.setAttribute("aria-selected", String(!isLive));
  els.tabLive.setAttribute("aria-selected", String(isLive));
  els.panelVideo.style.display = isLive ? "none" : "";
  els.panelLive.style.display = isLive ? "" : "none";
}
els.tabVideo.addEventListener("click", function () { selectTab("video"); });
els.tabLive.addEventListener("click", function () { selectTab("live"); });
// 目前分頁就是直播間 → 直接停在「直播」分頁
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  var url = (tabs && tabs[0] && tabs[0].url) || "";
  if (/^https?:\/\/live\.bilibili\.com\//i.test(url)) selectTab("live");
});

// -------- 進階設定頁 --------
function showAdvancedView() {
  els.mainView.style.display = "none";
  els.advancedView.style.display = "block";
}
function hideAdvancedView() {
  els.advancedView.style.display = "none";
  els.mainView.style.display = "block";
}
els.gearBtn.addEventListener("click", showAdvancedView);
try {
  if (window.sessionStorage.getItem("reopenAdvanced")) { window.sessionStorage.removeItem("reopenAdvanced"); showAdvancedView(); }
} catch (e) {}

// -------- 版本號 → 版本更新紀錄頁 --------
// 只列已上架的 releases（新 → 舊），每條沿用「更新內容」提示的新增／修正標籤
var clView = document.getElementById("changelogView");
var versionLink = document.getElementById("versionLink");
versionLink.textContent = "v" + chrome.runtime.getManifest().version;
versionLink.title = t("changelogTitle");
function showChangelogView() {
  var list = document.getElementById("clList");
  var current = chrome.runtime.getManifest().version;
  list.textContent = "";
  fetch(chrome.runtime.getURL("changelog.json")).then(function (r) { return r.json(); }).then(function (log) {
    (log.releases || []).forEach(function (rel) {
      var box = document.createElement("div");
      box.className = "clRelease";
      var head = document.createElement("div");
      head.className = "clHead";
      var ver = document.createElement("span");
      ver.className = "clVersion";
      ver.textContent = "v" + rel.version;
      if (rel.version === current) {
        var cur = document.createElement("span");
        cur.className = "clCurrent";
        cur.textContent = t("changelogCurrent");
        ver.appendChild(cur);
      }
      var date = document.createElement("span");
      date.className = "clDate";
      date.textContent = rel.date || "";
      head.appendChild(ver);
      head.appendChild(date);
      box.appendChild(head);
      var ul = document.createElement("ul");
      (rel.entries || []).forEach(function (e) {
        var li = document.createElement("li");
        var tag = document.createElement("span");
        tag.className = "wnTag" + (e.type === "fix" ? " fix" : "");
        tag.textContent = t(e.type === "fix" ? "whatsNewTypeFix" : "whatsNewTypeFeature");
        li.appendChild(tag);
        li.appendChild(document.createTextNode(changelogText(e)));
        ul.appendChild(li);
      });
      box.appendChild(ul);
      list.appendChild(box);
    });
  }).catch(function () {});
  els.mainView.style.display = "none";
  clView.style.display = "block";
}
versionLink.addEventListener("click", showChangelogView);
document.getElementById("clBackBtn").addEventListener("click", function () {
  clView.style.display = "none";
  els.mainView.style.display = "block";
});
els.advBackBtn.addEventListener("click", hideAdvancedView);

// -------- 直播線路 --------
var LIVE_ROUTES = ["ov", "ovb", "cn", "cnb"];
var LIVE_ROUTE_KEYS = { ov: "liveRouteOv", ovb: "liveRouteOvB", cn: "liveRouteCn", cnb: "liveRouteCnB" };
var liveOn = true; // 直播沒選「關閉」
var liveRouteSel = DEFAULTS.liveRoute; // 使用者選的線路種類（ov / ovb / cn / cnb），不是具體 host
var liveSnap = null; // 最近一次 debug 回報裡的直播資料：有 hosts 才代表「正在直播間播放、確定得到 CDN 網址」

function liveRouteAvail(route, st) {
  var a = (st && st.avail) || (liveSnap && liveSnap.avail);
  return a ? a[route] : null;
}

// 跟點播同一個下拉元件（.cdnSelect）：四列固定，只建一次、之後就地更新文字與 class
// （每秒重建的話，滑鼠按下到放開之間 DOM 被換掉，click 會掉）
var liveRowEls = {};
function liveNameInto(el, route, missing) {
  el.textContent = t(LIVE_ROUTE_KEYS[route]);
  if (missing) {
    var note = document.createElement("span");
    note.className = "liveMissingNote";
    note.textContent = t("liveRouteMissing");
    el.appendChild(note);
  }
}
(function buildLiveRows() {
  LIVE_ROUTES.forEach(function (route) {
    var row = document.createElement("div");
    row.className = "cdnOptRow";
    var name = document.createElement("span");
    name.className = "cdnOptName";
    var host = document.createElement("span");
    host.className = "cdnOptHost";
    row.appendChild(name);
    row.appendChild(host);
    row.addEventListener("click", function () {
      els.liveSelect.classList.remove("open");
      applyLiveRoute(route);
    });
    els.liveSelectList.appendChild(row);
    liveRowEls[route] = { row: row, name: name, host: host };
  });
})();
els.liveSelectTrigger.addEventListener("click", function (ev) {
  ev.stopPropagation();
  els.liveSelect.classList.toggle("open");
});

function liveHostOf(route) { return (liveSnap && liveSnap.hosts && liveSnap.hosts[route]) || ""; }

function renderLiveRows() {
  LIVE_ROUTES.forEach(function (route) {
    var e = liveRowEls[route];
    var missing = liveRouteAvail(route) === false;
    e.row.classList.toggle("selected", route === liveRouteSel);
    e.row.classList.toggle("missing", missing); // 變淡但仍可點選：不禁止使用者選
    liveNameInto(e.name, route, missing);
    var h = liveHostOf(route);
    e.host.textContent = h;
    e.host.style.display = h ? "" : "none"; // 不在直播間播放時不顯示具體網址
  });
  var selMissing = liveRouteAvail(liveRouteSel) === false;
  els.liveSelectTrigger.classList.toggle("missing", selMissing);
  liveNameInto(els.liveSelectName, liveRouteSel, selMissing);
  var sh = liveHostOf(liveRouteSel);
  els.liveSelectHost.textContent = sh;
  els.liveSelectHost.style.display = sh ? "" : "none";
}

function syncLiveUI() {
  els.liveSelect.style.display = liveOn ? "block" : "none";
  els.liveOffHint.style.display = liveOn ? "none" : "block";
  els.liveSpeedtestBtn.parentNode.style.display = liveOn ? "" : "none"; // 直播選「關閉」也不顯示測速按鈕
  if (!liveOn) els.liveSelect.classList.remove("open");
}

function applyLiveRoute(route) {
  if (route === liveRouteSel && liveOn) return;
  liveRouteSel = route;
  liveOn = true;
  els.liveModeList.checked = true;
  syncLiveUI();
  renderLiveRows();
  save({ liveEnabled: true, liveRoute: route });
  if (lastSpeedtestState && speedtestMode === "live") renderSpeedtest(lastSpeedtestState); // 測速頁立即更新打勾
}
els.liveModeList.addEventListener("change", function () {
  if (!els.liveModeList.checked) return;
  liveOn = true;
  syncLiveUI();
  save({ liveEnabled: true });
});
els.liveModeOff.addEventListener("change", function () {
  if (!els.liveModeOff.checked) return;
  liveOn = false;
  syncLiveUI();
  save({ liveEnabled: false });
});

// -------- Debug 读取（qnText / spdText 在 common.js）--------
function disp(s) { return s == null ? "-" : String(s); }
function renderDebug(d) {
  liveSnap = (d && d.live) || null;
  renderLiveRows();
  if (!d) { els.debug.textContent = t("debugNoDataAfterOpen"); return; }
  var lines, cdnLineIdx;
  if (d.live) {
    // 直播间：顯示直播線路資料（影片那組 v / a / qn / spd 在直播間沒有意義）
    var L = d.live;
    lines = ["mode=" + (d.enabled && liveOn ? "on" : "off") + "  target=" + disp(L.route)];
    if (L.auto) lines.push("auto-fallback -> " + disp(L.auto));
    cdnLineIdx = lines.length;
    lines.push(
      "cdn=" + disp(L.activeHost),
      "proto=" + disp(L.protocol) + "  cluster=" + disp(L.cluster) + "  orig=" + disp(L.origRoute) + "  seg=" + disp(d.segRewriteCount) + "  pin=" + disp(L.pinned)
    );
  } else {
    lines = [
      "mode=" + (d.enabled && videoOn ? "on" : "off") + "  target=" + disp(d.cdnTarget)
    ];
    if (d.autoHost) lines.push("auto-fallback -> " + disp(d.autoHost));
    cdnLineIdx = lines.length; // "cdn=" 这行的高亮不能写死 index：前面可能多插了 auto-fallback 那行
    lines.push(
      "cdn=" + disp(d.currentCdn),
      "v=" + disp(d.pickVideoHost) + "  a=" + disp(d.pickAudioHost),
      "src=" + disp(d.lastSource) + "  rw=" + disp(d.rewriteCount) + "  seg=" + disp(d.segRewriteCount) + "  qn=" + qnText(d.lastQn) + "  spd=" + spdText(d.speedBps, d.speedIdle)
    );
  }
  if (d.lastError) lines.push("err=" + disp(d.lastError));
  els.debug.textContent = "";
  var frag = document.createDocumentFragment();
  lines.forEach(function (l, i) {
    if (i > 0) frag.appendChild(document.createTextNode("\n"));
    if (i === cdnLineIdx) {
      var span = document.createElement("span");
      span.className = "cdnnow";
      span.textContent = l;
      frag.appendChild(span);
    } else {
      frag.appendChild(document.createTextNode(l));
    }
  });
  els.debug.appendChild(frag);
}
// 都固定打「顶层 frame」（frameId: 0）：content script 是 all_frames 注入，若不锁定 frame，
// Chrome 会把讯息广播给分页内所有 frame、取最先回应的那个 —— 万一先回应的是没有播放器的
// iframe（广告/元件），debug 会拿不到资料、测速甚至会卡在该 iframe 的残留状态而一直报错。
var TOP_FRAME = { frameId: 0 };

// 送訊息給分頁最上層 frame 的 content script。iPad Safari 上帶 frameId 選項送疑似會失敗（測速頁顯示無法開始），
// 所以失敗時改成不帶選項再送一次；bridge.js 只在最上層 frame 回應，效果跟指定 frameId: 0 一樣。
// cb 照舊在 sendMessage 的回呼裡執行，呼叫端可以直接檢查 chrome.runtime.lastError。
function sendToTop(tabId, msg, cb) {
  function plain() { chrome.tabs.sendMessage(tabId, msg, cb); }
  try {
    chrome.tabs.sendMessage(tabId, msg, TOP_FRAME, function (resp) {
      if (chrome.runtime.lastError) { plain(); return; }
      cb(resp);
    });
  } catch (e) { plain(); }
}
function connectTop(tabId, name) {
  try { return chrome.tabs.connect(tabId, { name: name, frameId: 0 }); } catch (e) {}
  try { return chrome.tabs.connect(tabId, { name: name }); } catch (e) { return null; }
}

// 擴充剛重新載入／更新時，已經開著的 B 站分頁裡還是舊的 content script（已跟擴充斷線，收不到訊息），
// 瀏覽器不會自動把新的注入進去，要重新整理分頁才行。已載入完成的 B 站分頁連續兩次聯絡不上就提示並提供重新整理按鈕
// （第一次失敗會立刻重試一次，見 pollDebug；載入中的分頁 content script 可能還沒好，不提示）。
var BILI_TAB_RE = /^https?:\/\/([a-z0-9-]+\.)*bilibili\.com\//i;
// 有播放器、能測速的頁面（對照 main-hook.js 的 pageTypeOf）：影片／番劇／課程／播放清單，直播間
var VIDEO_PAGE_RE = /^https?:\/\/([a-z0-9-]+\.)*bilibili\.com\/(video|bangumi\/play|cheese\/play|list|medialist|festival|blackboard)\//i;
var LIVE_PAGE_RE = /^https?:\/\/live\.bilibili\.com\/(blanc\/)?\d+/i;
var debugMissCount = 0;
function setStale(on) { document.getElementById("staleBanner").style.display = on ? "flex" : "none"; }
document.getElementById("staleReloadBtn").addEventListener("click", function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs && tabs[0]) chrome.tabs.reload(tabs[0].id);
    debugMissCount = 0;
    setStale(false);
  });
});

function pollDebug() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    var onBili = BILI_TAB_RE.test(tabs[0].url || "");
    sendToTop(tabs[0].id, { type: "CDN_SWITCHER_GET_DEBUG" }, function (resp) {
      if (chrome.runtime.lastError) {
        debugMissCount++;
        var maybeStale = onBili && tabs[0].status === "complete";
        setStale(maybeStale && debugMissCount >= 2);
        renderDebug(null);
        renderOptimizing(null);
        // 第一次聯絡不上就立刻再確認一次，不等下一秒的輪詢：popup 一打開就能顯示提示，不會晚一秒才把下面的內容往下推
        if (maybeStale && debugMissCount === 1) pollDebug();
        return;
      }
      debugMissCount = 0;
      setStale(false);
      renderDebug(resp && resp.debug);
      renderOptimizing(resp && resp.autoTest);
    });
  });
}
pollDebug();

// -------- 切換國家後的自動測速：目前分頁回報「正在跑」才顯示「優化中」遮罩與剩餘節點數；手動測速不顯示 --------
var optEl = document.getElementById("optimizing");
var optShown = false, optLastCount = null;
function renderOptimizing(st) {
  var on = !!(st && st.running && st.reason === "country");
  if (on) {
    var total = st.total || 0, done = Math.min(st.done || 0, total), left = total - done;
    var cnt = document.getElementById("optCount");
    if (left !== optLastCount) {
      cnt.textContent = left;
      if (optLastCount !== null) { cnt.classList.remove("pop"); void cnt.offsetWidth; cnt.classList.add("pop"); } // 每減一跳一下
      optLastCount = left;
    }
  } else {
    optLastCount = null;
  }
  if (on === optShown) return;
  optShown = on;
  optEl.classList.toggle("show", on);
}
// 略過：中斷這一輪（旗標在開始測時就已清掉，不會再測），節點維持該國第一個
document.getElementById("optSkip").addEventListener("click", function () {
  renderOptimizing(null);
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    sendToTop(tabs[0].id, { type: "CDN_SWITCHER_STOP_AUTOTEST" }, function () { void chrome.runtime.lastError; });
  });
});

// -------- 手动测速：切到独立页面，逐节点显示等待中/测试中/结果；离开页面就中止 --------
var SPEEDTEST_ERR_KEYS = {
  "no-data": "errNoData", "no-stream": "errNoStream", "timeout": "errTimeout",
  "network-error": "errNetworkError", "read-error": "errReadError", "no-sample": "errNoSample"
};
function speedtestErrText(err) { var k = SPEEDTEST_ERR_KEYS[err]; return k ? t(k) : err; }

// -------- 節點按測速排序（進階設定，預設關閉）--------
// 開啟後：測速時每測完一個節點就依速度（快→慢）重排，並有平移動畫；排出的順序存在 storage，
// 主畫面的節點下拉也照這個順序，直到下次重新測速。關閉就回到預設順序並清掉存的順序。
var sortOn = false;
var speedOrder = { video: [], live: [] };

// 把存的順序套到 keys 上：存過的照存的排，沒存過的（例如清單新增的節點）照原順序接在後面
function withSaved(mode, keys) {
  var out = (speedOrder[mode] || []).filter(function (k) { return keys.indexOf(k) >= 0; });
  keys.forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); });
  return out;
}
// scoreOf 回傳：數字越大越快；null = 還沒測完；-Infinity = 失敗／不存在（排最後）
function sortedKeys(mode, keys, scoreOf) {
  if (!sortOn) return keys.slice();
  var done = [], pending = [], failed = [];
  withSaved(mode, keys).forEach(function (k) {
    var s = scoreOf(k);
    if (s === null) pending.push(k); else if (s === -Infinity) failed.push(k); else done.push(k);
  });
  done.sort(function (a, b) { return scoreOf(b) - scoreOf(a); });
  return done.concat(pending, failed);
}
function rememberOrder(mode, order, st) {
  if (!sortOn || !st || !st.results || !st.results.length) return;
  if ((speedOrder[mode] || []).join("|") === order.join("|")) return;
  speedOrder[mode] = order.slice();
  save({ speedOrder: speedOrder });
  applyDropdownOrder();
}
// 主畫面兩個下拉清單也照存的順序（關閉排序時回到預設）
function applyDropdownOrder() {
  var vKeys = visibleCdnOptions().map(function (o) { return o.value; });
  (sortOn ? withSaved("video", vKeys) : vKeys).forEach(function (v) {
    for (var i = 0; i < els.cdnSelectList.children.length; i++) {
      var row = els.cdnSelectList.children[i];
      if (row.dataset.value === v) { els.cdnSelectList.appendChild(row); break; }
    }
  });
  (sortOn ? withSaved("live", LIVE_ROUTES) : LIVE_ROUTES).forEach(function (r) { els.liveSelectList.appendChild(liveRowEls[r].row); });
}
// FLIP 平移動畫：重建列表前記下每列位置，重建後從舊位置滑到新位置
function flipRender(build) {
  var old = {};
  Array.prototype.forEach.call(els.stList.children, function (el) {
    var k = el.dataset.host || el.dataset.route;
    if (k) old[k] = el.getBoundingClientRect().top;
  });
  build();
  if (!sortOn) return;
  Array.prototype.forEach.call(els.stList.children, function (el) {
    var k = el.dataset.host || el.dataset.route;
    if (!k || !(k in old)) return;
    var dy = old[k] - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    el.style.transition = "none";
    el.style.transform = "translateY(" + dy + "px)";
    void el.offsetHeight; // 先套用起點位置，再開動畫
    el.style.transition = "transform .45s ease";
    el.style.transform = "";
  });
}
document.getElementById("sortBySpeed").addEventListener("change", function () {
  sortOn = this.checked;
  if (!sortOn) {
    speedOrder = { video: [], live: [] };
    save({ sortBySpeed: false, speedOrder: null });
  } else {
    save({ sortBySpeed: true });
  }
  applyDropdownOrder();
  if (lastSpeedtestState) renderSpeedtest(lastSpeedtestState);
});

// -------- 測速門檻（進階設定）--------
// 四個數字各自即時存檔；輸入超出範圍時存成邊界值，離開輸入框時把顯示值也修正回去
var LIMIT_FIELDS = [
  { key: "stVideoMb", min: 1, max: 100, group: "video" },
  { key: "stVideoSec", min: 1, max: 60, group: "video" },
  { key: "stLiveRuns", min: 1, max: 10, group: "live" },
  { key: "stLiveSec", min: 3, max: 60, group: "live" }
];
var limits = {};
function clampLimit(f, v) {
  v = Math.round(Number(v));
  if (!isFinite(v) || v <= 0) return DEFAULTS[f.key];
  return Math.min(f.max, Math.max(f.min, v));
}
LIMIT_FIELDS.forEach(function (f) {
  var input = document.getElementById(f.key);
  input.addEventListener("input", function () {
    if (input.value === "") return; // 還在打字（清空中），先不存
    limits[f.key] = clampLimit(f, input.value);
    var patch = {}; patch[f.key] = limits[f.key]; save(patch);
  });
  input.addEventListener("change", function () { input.value = limits[f.key] = clampLimit(f, input.value); var patch = {}; patch[f.key] = limits[f.key]; save(patch); });
});
function resetLimits(group) {
  var patch = {};
  LIMIT_FIELDS.forEach(function (f) {
    if (f.group !== group) return;
    limits[f.key] = patch[f.key] = DEFAULTS[f.key];
    document.getElementById(f.key).value = DEFAULTS[f.key];
  });
  presets[group] = patch[PRESET_KEY[group]] = "medium";
  syncPresetUI(group);
  save(patch);
}

// 門檻預設組合：選了快／適中／準確就把對應數字寫進 stVideoMb 等欄位（main-hook、bridge 照舊只讀數字），
// 輸入框鎖住；選自訂才能改，從目前的數字開始改。「適中」就是 DEFAULTS
var PRESET_ORDER = ["fast", "medium", "accurate", "custom"];
var PRESET_LABEL = { fast: "stPresetFast", medium: "stPresetMedium", accurate: "stPresetAccurate", custom: "stPresetCustom" };
var PRESET_KEY = { video: "stVideoPreset", live: "stLivePreset" };
var PRESET_ID = { video: "stVideo", live: "stLive" };
var PRESETS = {
  video: {
    fast: { stVideoMb: 4, stVideoSec: 3 },
    medium: { stVideoMb: DEFAULTS.stVideoMb, stVideoSec: DEFAULTS.stVideoSec },
    accurate: { stVideoMb: 25, stVideoSec: 10 }
  },
  live: {
    fast: { stLiveRuns: 2, stLiveSec: 5 },
    medium: { stLiveRuns: DEFAULTS.stLiveRuns, stLiveSec: DEFAULTS.stLiveSec },
    accurate: { stLiveRuns: 5, stLiveSec: 15 }
  }
};
var presets = { video: "medium", live: "medium" };
function inferPreset(group) {
  for (var name in PRESETS[group]) {
    var vals = PRESETS[group][name], same = true;
    for (var k in vals) if (limits[k] !== vals[k]) same = false;
    if (same) return name;
  }
  return "custom";
}
function syncPresetUI(group) {
  var sel = document.getElementById(PRESET_ID[group] + "Preset");
  sel.value = presets[group];
  document.getElementById(PRESET_ID[group] + "PresetText").textContent = t(PRESET_LABEL[presets[group]]);
  LIMIT_FIELDS.forEach(function (f) { if (f.group === group) document.getElementById(f.key).disabled = presets[group] !== "custom"; });
}
function loadPresets(cfg) {
  ["video", "live"].forEach(function (group) {
    var v = cfg[PRESET_KEY[group]];
    presets[group] = PRESET_ORDER.indexOf(v) >= 0 ? v : inferPreset(group);
    syncPresetUI(group);
  });
}
["video", "live"].forEach(function (group) {
  var sel = document.getElementById(PRESET_ID[group] + "Preset");
  PRESET_ORDER.forEach(function (name) {
    var opt = document.createElement("option");
    opt.value = name;
    opt.textContent = t(PRESET_LABEL[name]);
    sel.appendChild(opt);
  });
  sel.setAttribute("aria-label", t("stPresetLabel"));
  syncPresetUI(group);
  sel.addEventListener("change", function () {
    var name = sel.value, patch = {};
    presets[group] = patch[PRESET_KEY[group]] = name;
    var vals = PRESETS[group][name];
    for (var k in vals) { limits[k] = patch[k] = vals[k]; document.getElementById(k).value = vals[k]; }
    syncPresetUI(group);
    save(patch);
  });
});
document.getElementById("stVideoReset").addEventListener("click", function () { resetLimits("video"); });
document.getElementById("stLiveReset").addEventListener("click", function () { resetLimits("live"); });
function lim(key) { return limits[key] || DEFAULTS[key]; }

// -------- 恢復原始設置（進階設定最下方）--------
// 進階設定的開關與門檻、節點排序回到預設；影片改回清單選擇、預設國家（偵測到的國家，否則台灣）的第一個節點、清空自訂節點列表；
// 直播改回偏好選擇的國際線路。主畫面的「啟用」總開關不動
function resetAllSettings() {
  var code = detectedCountry || COUNTRY_FALLBACK;
  var patch = {
    autoFallback: DEFAULTS.autoFallback, autoSpeedSwitch: DEFAULTS.autoSpeedSwitch, showDebug: DEFAULTS.showDebug,
    sortBySpeed: DEFAULTS.sortBySpeed, speedOrder: null,
    videoEnabled: true, cdnMode: "list", customHosts: [], cdnCountry: code,
    liveEnabled: true, liveRoute: DEFAULTS.liveRoute
  };
  els.autoFallback.checked = DEFAULTS.autoFallback;
  document.getElementById("autoSpeedSwitch").checked = DEFAULTS.autoSpeedSwitch;
  els.showDebug.checked = DEFAULTS.showDebug;
  syncDebugSection();
  sortOn = DEFAULTS.sortBySpeed;
  document.getElementById("sortBySpeed").checked = sortOn;
  speedOrder = { video: [], live: [] };
  LIMIT_FIELDS.forEach(function (f) {
    limits[f.key] = patch[f.key] = DEFAULTS[f.key];
    document.getElementById(f.key).value = DEFAULTS[f.key];
  });
  ["video", "live"].forEach(function (group) { presets[group] = patch[PRESET_KEY[group]] = "medium"; syncPresetUI(group); });
  // 影片
  videoOn = true;
  cdnMode = "list";
  customHosts = [];
  countrySel = code;
  countryAutoPending = false;
  els.modeList.checked = true;
  useCountryFirstNode(code, patch);
  currentCdnHost = cdnSelectValue;
  // 直播
  liveOn = true;
  liveRouteSel = DEFAULTS.liveRoute;
  els.liveModeList.checked = true;
  save(patch);
  renderCountrySelect();
  rebuildCdnList();
  syncLiveUI();
  renderLiveRows();
}
document.getElementById("resetAllBtn").addEventListener("click", function () {
  showWarnDialog({
    plain: true,
    title: t("resetAllTitle"),
    paras: [t("resetAllText")],
    cancel: t("customClearCancel"),
    confirm: t("customClearConfirm"),
    onConfirm: resetAllSettings
  });
});

var speedtestMode = "video"; // "video" | "live"：测速页两种模式共用同一个画面
var speedtestHosts = []; // 本次送出测试的 host 顺序，index 对应 speedTest.results 的顺序
var speedtestTabId = null;
var speedtestPort = null; // 只用来让 content script 侦测「离开测速页 / popup 关闭」→ 立即中止
var lastSpeedtestState = null; // 最近一次 renderSpeedtest 的资料，点击切换节点后立即重绘打勾标示用
var stReloadTabId = null; // 測速頁按了「重新整理」的分頁：重新整理完就自動開測（見 pollSpeedtest）
var stAwaitStart = false; // 剛進測速頁、這一輪還沒開始：輪詢先不畫，免得畫出分頁上一輪留下的測速狀態
// 目前分頁沒有影片可測時，「前往範例影片」開的影片（跟商店截圖用的同一部 4K 展示片）
var SAMPLE_VIDEO_URL = "https://www.bilibili.com/video/BV1R1e4zKEh1/";

function speedtestHostList() { return activeHosts(); }

// -------- 「全部」節點測速前的警告：估算耗時（每個節點最多測滿「秒數」上限），引導改選國家 --------
function durationText(totalSec) {
  var h = Math.floor(totalSec / 3600), m = Math.floor(totalSec % 3600 / 60), s = totalSec % 60;
  return t("durationHMS").replace("{h}", h).replace("{m}", m).replace("{s}", s);
}
// 不是「全部」就直接開測；是的話先跳警告，按確定才開測
function confirmSpeedtestHosts(hosts, onConfirm) {
  if (cdnMode === "custom" || countrySel !== COUNTRY_ALL) { onConfirm(); return; }
  showWarnDialog({
    title: t("allWarnTitle"),
    paras: [
      t("allWarnText").replace("{n}", hosts.length).replace("{time}", durationText(hosts.length * lim("stVideoSec"))),
      t("allWarnAdvice"),
      t("allWarnQuestion")
    ],
    cancel: t("allWarnCancel"),
    confirm: t("allWarnConfirm"),
    onConfirm: onConfirm
  });
}

// 紅色警告彈窗（全量測速、開啟自動測速共用）：主按鈕是「取消」，確認只是一行小字連結，引導使用者取消。
// plain: true（清空自訂節點列表）則是一般確認框：確認、取消兩個按鈕並排，不引導。paras 每段可含 <b>…</b>
function showWarnDialog(o) {
  var box = document.getElementById("allWarn");
  box.classList.toggle("plain", !!o.plain);
  document.getElementById("awTitle").textContent = o.title;
  var body = document.getElementById("awBody");
  body.textContent = "";
  o.paras.forEach(function (txt) {
    var p = document.createElement("p");
    setRichText(p, txt);
    body.appendChild(p);
  });
  var cancelBtn = document.getElementById("awCancel"), confirmBtn = document.getElementById("awConfirm");
  cancelBtn.textContent = o.cancel;
  confirmBtn.textContent = o.confirm;
  function close() { box.classList.remove("show"); }
  cancelBtn.onclick = function () { close(); if (o.onCancel) o.onCancel(); };
  confirmBtn.onclick = function () { close(); o.onConfirm(); };
  box.classList.add("show");
  cancelBtn.focus();
}

// -------- 測速頁說明區：固定三行高，超出時顯示箭頭；展開時改成 fixed 浮在原位，不影響整頁高度 --------
var stDesc = document.getElementById("stDesc");
var stDescInner = document.getElementById("stDescInner");
var stDescToggle = document.getElementById("stDescToggle");
function setDescExpanded(on) {
  stDesc.classList.toggle("expanded", on);
  if (on) {
    var r = stDesc.getBoundingClientRect();
    stDescInner.style.top = r.top + "px";
    stDescInner.style.left = r.left + "px";
    stDescInner.style.width = r.width + "px";
    stDescInner.style.maxHeight = (window.innerHeight - r.top - 8) + "px";
  } else {
    stDescInner.style.top = stDescInner.style.left = stDescInner.style.width = stDescInner.style.maxHeight = "";
  }
  stDescToggle.textContent = on ? "▴" : "▾";
  stDescToggle.setAttribute("aria-label", t(on ? "stDescCollapse" : "stDescExpand"));
  stDescToggle.title = t(on ? "stDescCollapse" : "stDescExpand");
  stDescToggle.setAttribute("aria-expanded", String(on));
}
// 說明文字換了（影片／直播、語系）就重新判斷要不要顯示箭頭
function syncDescOverflow() {
  setDescExpanded(false);
  stDesc.classList.toggle("overflowing", stDescInner.scrollHeight > stDescInner.clientHeight + 1);
}
// 點說明區任何地方都能展開／收合（平板上只點箭頭太小）；箭頭在說明區裡，點它也會走到這裡
stDesc.addEventListener("click", function () {
  if (!stDesc.classList.contains("overflowing")) return;
  setDescExpanded(!stDesc.classList.contains("expanded"));
});


function renderSpeedtestMeta(st) {
  els.stMeta.textContent = "";
  if (!st || !st.title) return;
  var titleEl = document.createElement("span");
  titleEl.className = "stTitle";
  titleEl.textContent = st.title;
  els.stMeta.appendChild(titleEl);
  if (st.qn) {
    var qnEl = document.createElement("span");
    qnEl.className = "stQn";
    qnEl.textContent = st.qn;
    els.stMeta.appendChild(qnEl);
  }
}

// -------- 直播测速：每条线路两个指标（切台卡顿 / 持续观看），颜色分级 --------
// 切台卡顿（毫秒）：0-800 低(绿)、800-1500 中(黄)、超过 1500 高(红)
function startupLevel(ms) { return ms <= 800 ? "Low" : ms <= 1500 ? "Mid" : "High"; }
var STARTUP_CLS = { Low: "lvGood", Mid: "lvFair", High: "lvBad" };
// 持续观看（掉队秒数）：完全跟上 优秀(绿)、掉队 1 秒内 中等(黄)、超过 1 秒 差勁(红)。
// 0.3 秒以内当作量测抖动（tag / 分片本来就是一批一批到），算「完全跟上」。
function sustainLevel(lag) { return lag <= 0.3 ? "Good" : lag <= 1 ? "Fair" : "Poor"; }
var SUSTAIN_CLS = { Good: "lvGood", Fair: "lvFair", Poor: "lvBad" };

function metricLine(label, text, cls) {
  var line = document.createElement("span");
  var lab = document.createElement("span");
  lab.className = "stMetricLabel";
  lab.textContent = label;
  var val = document.createElement("span");
  val.textContent = text;
  if (cls) val.className = cls;
  line.appendChild(lab);
  line.appendChild(val);
  return line;
}

function liveMetrics(st, r, testing) {
  var box = document.createElement("div");
  box.className = "stMetrics";
  var startLabel = t("stLiveStartupLabel") + ": ", sustainLabel = t("stLiveSustainLabel") + ": ";
  if (!r) {
    // 还没有任何结果且没在测：还没测过，不是「已取消」
    var none = !st.running && !st.results.length;
    var idle = none ? t("speedtestStatusIdle") : !st.running ? t("speedtestStatusCanceled") : testing ? t("speedtestStatusTesting") : t("speedtestStatusWaiting");
    box.appendChild(metricLine(startLabel, idle, testing ? "lvTesting" : ""));
    box.appendChild(metricLine(sustainLabel, none ? t("speedtestStatusIdle") : !st.running ? t("speedtestStatusCanceled") : t("speedtestStatusWaiting")));
    return box;
  }
  if (r.error) {
    box.appendChild(metricLine(startLabel, t("speedtestFailedTemplate").replace("{err}", speedtestErrText(r.error)), "lvBad"));
    return box;
  }
  var lv = startupLevel(r.startup.avg);
  box.appendChild(metricLine(startLabel, Math.round(r.startup.avg) + "ms " + t("level" + lv), STARTUP_CLS[lv]));
  if (r.sustain) {
    var sv = sustainLevel(r.sustain.lag);
    box.appendChild(metricLine(sustainLabel, t("stLiveLagTemplate").replace("{ms}", Math.round(r.sustain.lag * 1000)) + " " + t("sustain" + sv), SUSTAIN_CLS[sv]));
  } else if (r.sustainError) {
    box.appendChild(metricLine(sustainLabel, t("speedtestFailedTemplate").replace("{err}", speedtestErrText(r.sustainError)), "lvBad"));
  } else {
    box.appendChild(metricLine(sustainLabel, !st.running ? t("speedtestStatusCanceled") : t("speedtestStatusTesting"), "lvTesting"));
  }
  return box;
}

function renderLiveSpeedtest(st) {
  renderSpeedtestMeta(st);
  if (st.error === "no-sample") { fillStNotice({ icon: "info", text: t("liveSpeedtestNoSampleHint") }); return; }
  if (st.error === "unavailable") { fillStNotice({ icon: "info", text: t("liveSpeedtestUnavailableHint") }); return; }
  var byRoute = {};
  st.results.forEach(function (r) { if (r.route) byRoute[r.route] = r; });
  function finished(r) { return !!r && (r.error || r.sustain || r.sustainError); }
  // 正在測的是「第一條存在、還沒測完」的線路；探測結果還沒回來（avail 為 null）前都算等待中
  var testingRoute = null;
  if (st.running && st.avail) {
    for (var i = 0; i < LIVE_ROUTES.length; i++) {
      var rt = LIVE_ROUTES[i];
      if (st.avail[rt] !== false && !finished(byRoute[rt])) { testingRoute = rt; break; }
    }
  }
  // 直播的「快」：先看持續觀看等級（優秀 > 中等 > 差勁），同級再比切台卡頓（越短越快）
  var order = sortedKeys("live", LIVE_ROUTES, function (route) {
    if (liveRouteAvail(route, st) === false) return -Infinity;
    var r = byRoute[route];
    if (!finished(r)) return null;
    if (r.error || r.sustainError) return -Infinity;
    var lv = sustainLevel(r.sustain.lag);
    return (lv === "Good" ? 2 : lv === "Fair" ? 1 : 0) * 1e6 - r.startup.avg;
  });
  rememberOrder("live", order, st);
  flipRender(function () {
    els.stList.textContent = "";
    var frag = document.createDocumentFragment();
    order.forEach(function (route) {
      var missing = liveRouteAvail(route, st) === false;
      var isCur = liveOn && route === liveRouteSel;
      var row = document.createElement("div");
      row.className = "stRow stRowLive stClickable" + (isCur ? " stCurrent" : "") + (missing ? " stMissing" : "");
      row.dataset.route = route;

      var main = document.createElement("span");
      main.className = "stRowMain";
      var titleSpan = document.createElement("span");
      titleSpan.className = "stRowTitle";
      titleSpan.textContent = (isCur ? "✓ " : "") + t(LIVE_ROUTE_KEYS[route]);
      if (missing) {
        var note = document.createElement("span");
        note.className = "stRowNote";
        note.textContent = t("liveRouteMissing");
        titleSpan.appendChild(note);
      }
      main.appendChild(titleSpan);
      var h = (byRoute[route] && byRoute[route].host) || (liveSnap && liveSnap.hosts && liveSnap.hosts[route]) || "";
      if (h) {
        var hostSpan = document.createElement("span");
        hostSpan.className = "stRowHost";
        hostSpan.textContent = h;
        main.appendChild(hostSpan);
      }
      row.appendChild(main);
      if (!missing) row.appendChild(liveMetrics(st, byRoute[route], route === testingRoute));
      frag.appendChild(row);
    });
    els.stList.appendChild(frag);
  });
}

var CROWNS = ["gold", "silver", "bronze"];
var SVG_NS = "http://www.w3.org/2000/svg";
// i：0 / 1 / 2 = 第一／二／三名
function crownIcon(i) {
  var svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "stCrown " + CROWNS[i]);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("crownRank").replace("{n}", i + 1));
  var path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M2 7l5 4 5-7 5 7 5-4-2 11H4L2 7zm2 13h16v2H4v-2z");
  svg.appendChild(path);
  return svg;
}

// 测速结果下方的画质标示：用串流平台通用的保守建议频宽（8K 100 Mbps、4K 25 Mbps、1080P 5 Mbps、720P 3 Mbps）判断。
// bps 是 bytes/秒，门槛先换算好：100 Mbps ≈ 12.5 MB/s、25 Mbps ≈ 3.0 MB/s
var QUALITY_TIERS = [
  { bps: 100e6 / 8, key: "stQuality8k", cls: "q8k", stars: 2 }, // 8K 紫、4K 金，前面加星星（8K 两颗）
  { bps: 25e6 / 8, key: "stQuality4k", cls: "q4k", stars: 1 },
  { bps: 5e6 / 8, key: "stQuality1080", cls: "q1080" },
  { bps: 3e6 / 8, key: "stQuality720", cls: "q720" }
];
function starIcon() {
  var svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "stQualityStar");
  svg.setAttribute("aria-hidden", "true");
  var path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7L2 9.5l7.1-.6z");
  svg.appendChild(path);
  return svg;
}
function qualityTier(bps) {
  for (var i = 0; i < QUALITY_TIERS.length; i++) if (bps >= QUALITY_TIERS[i].bps) return QUALITY_TIERS[i];
  return { key: "stQualityLow", cls: "qLow" };
}

function renderSpeedtest(st) {
  if (!st) return;
  lastSpeedtestState = st;
  document.getElementById("stStopBtn").disabled = !st.running;
  showStGuide(speedtestMode === "video" && st.error === "no-sample");
  setStNoticeMode(st.error === "no-sample" || st.error === "unavailable");
  if (speedtestMode === "live") { renderLiveSpeedtest(st); return; }
  renderSpeedtestMeta(st);
  if (st.error === "no-sample") return;
  var bestHost = null, bestBps = 0;
  st.results.forEach(function (r) { if (!r.error && r.bps > bestBps) { bestBps = r.bps; bestHost = r.host; } });
  // 目前最快的前三名戴金／銀／銅皇冠（測速中就隨結果更新）
  var crownOf = {};
  st.results.filter(function (r) { return r.host && !r.error && r.bps > 0; })
    .sort(function (a, b) { return b.bps - a.bps; })
    .slice(0, 3)
    .forEach(function (r, i) { crownOf[r.host] = i; });

  var byHost = {};
  st.results.forEach(function (r) { if (r.host) byHost[r.host] = r; });
  var testingHost = st.running ? speedtestHosts[st.results.length] : null; // 主程式照 speedtestHosts 的順序一個個測
  var order = sortedKeys("video", speedtestHosts, function (host) {
    var r = byHost[host];
    return !r ? null : r.error ? -Infinity : r.bps;
  });
  rememberOrder("video", order, st);
  flipRender(function () {
    els.stList.textContent = "";
    var frag = document.createDocumentFragment();
    order.forEach(function (host) {
      var o = null;
      for (var j = 0; j < cdnList.length; j++) if (cdnList[j].value === host) { o = cdnList[j]; break; }
      var title = o ? cdnDisplayName(o) : host;
      var isCurHost = videoOn && host === currentCdnHost;
      if (isCurHost) title = "✓ " + title; // 打勾标示目前生效的节点
      var r = byHost[host];
      var text, cls = "stRow stClickable";
      if (isCurHost) cls += " stCurrent";
      if (r) {
        text = r.error ? t("speedtestFailedTemplate").replace("{err}", speedtestErrText(r.error)) : spdText(r.bps, false);
        cls += r.error ? " stErr" : (r.host === bestHost ? " stBest" : "");
      } else if (host === testingHost) {
        text = t("speedtestStatusTesting"); cls += " stTesting";
      } else if (!st.running) {
        text = t("speedtestStatusCanceled");
      } else {
        text = t("speedtestStatusWaiting");
      }

      var row = document.createElement("div");
      row.className = cls;
      row.dataset.host = host;

      var main = document.createElement("span");
      main.className = "stRowMain";
      var titleSpan = document.createElement("span");
      titleSpan.className = "stRowTitle";
      titleSpan.textContent = title;
      var hostSpan = document.createElement("span");
      hostSpan.className = "stRowHost";
      hostSpan.textContent = host;
      main.appendChild(titleSpan);
      main.appendChild(hostSpan);

      var speedSpan = document.createElement("span");
      speedSpan.className = "stSpeed";
      speedSpan.textContent = text;
      var speedCol = document.createElement("span");
      speedCol.className = "stSpeedCol";
      speedCol.appendChild(speedSpan);
      if (r && !r.error && r.bps > 0) {
        var tier = qualityTier(r.bps);
        var qSpan = document.createElement("span");
        qSpan.className = "stQuality " + tier.cls;
        for (var si = 0; si < (tier.stars || 0); si++) qSpan.appendChild(starIcon());
        qSpan.appendChild(document.createTextNode(t(tier.key)));
        speedCol.appendChild(qSpan);
      }

      row.appendChild(main);
      row.appendChild(speedCol);
      if (host in crownOf) row.appendChild(crownIcon(crownOf[host]));
      frag.appendChild(row);
    });
    els.stList.appendChild(frag);
  });
}

// 测速页点一下节点列即直接切换：写回目前那份节点（国家清单／自订节点列表）的选择并存档，主画面下次打开会同步显示
function applySpeedtestHost(host) {
  if (activeHosts().indexOf(host) < 0 || (videoOn && host === currentCdnHost)) return;
  currentCdnHost = host;
  videoOn = true;
  (cdnMode === "custom" ? els.modeCustom : els.modeList).checked = true;
  selectCdnValue(host);
  syncModeUI();
  save({ videoEnabled: true, cdnHost: host, autoTestPending: false });
  renderSpeedtest(lastSpeedtestState); // 立即重绘打勾标示，不用等下次 poll
}
els.stList.addEventListener("click", function (ev) {
  var row = ev.target.closest(".stRow");
  if (!row) return;
  if (row.dataset.route) applyLiveRoute(row.dataset.route);
  else if (row.dataset.host) applySpeedtestHost(row.dataset.host);
});

function pollSpeedtest() {
  if (speedtestTabId == null) return;
  if (stReloadTabId === speedtestTabId) { startAfterReload(speedtestTabId); return; }
  if (stAwaitStart) return;
  sendToTop(speedtestTabId, { type: "CDN_SWITCHER_GET_SPEEDTEST" }, function (resp) {
    if (chrome.runtime.lastError) return;
    var st = resp && resp.speedTest;
    if (!st) return;
    renderSpeedtest(st);
  });
}

function showSpeedtestView(tabId, mode) {
  speedtestTabId = tabId;
  speedtestMode = mode;
  var live = mode === "live";
  lastSpeedtestState = null; // 从主画面进来是新的一轮：不沿用上次（可能是另一种模式）的画面
  document.getElementById("stHeaderTitle").textContent = t(live ? "stLiveHeaderTitle" : "stHeaderTitle");
  document.getElementById("stHintLeave").textContent = t(live ? "stLiveHintLeave" : "stHintLeave");
  setRichText(document.getElementById("stHintBandwidth"), live
    ? t("stLiveHintBandwidth").replace("{sec}", Math.round(lim("stLiveSec") + lim("stLiveRuns") * 1.5))
    : t("stHintBandwidth"));
  els.mainView.style.display = "none";
  els.speedtestView.style.display = "";
  enterStLayout();
  syncDescOverflow(); // 要在畫面顯示後才量得到高度
  // 先只顯示標題列：確定能測（第一份測速狀態回來）才顯示說明與清單，不能測就直接換成提示，不會先閃一下測速清單
  els.stList.textContent = "";
  setStNoticeMode(true);
  stAwaitStart = true;
  // 开一个长连线：popup 关闭或按返回时会自动/主动断线，content script 收到 onDisconnect 就中止测速
  speedtestPort = connectTop(tabId, "cdn-switcher-speedtest");
}

// 測速頁版面（見 popup.html 的 html.stMode）：先讓 html 撐到 600px 向瀏覽器要最大的 popup，
// popup 視窗跟著變大是非同步的，等 resize 停下來（或一段時間都沒有 resize＝本來就已經最大）後，
// 再把 html 高度鎖成實際可見高度，內容剛好等於視窗，不會超出也不會留白
// 鎖定前的這段時間，測速頁的高度上限先設成「目前可見高度」（--st-visible-h，每次 resize 更新）：
// 頁面縮放超過 100% 時可見高度不到 600px，不設上限的話，置中的提示卡片會先照 600px 排、鎖定後又往上跳
var stLayoutTimer = null;
function setStVisibleH() {
  var h = window.innerHeight;
  if (h < 300) return; // iPad Safari 量到的不可信（見 lockStLayout），維持不設上限
  document.documentElement.style.setProperty("--st-visible-h", h + "px");
}
function onStLayoutResize() {
  setStVisibleH();
  clearTimeout(stLayoutTimer);
  stLayoutTimer = setTimeout(lockStLayout, 150);
}
function lockStLayout() {
  // iPhone 的 popup 是可以上下拉的面板：拉高後可見高度會變，要一直跟著重鎖，不然下面留一大片空白
  if (!IS_IPHONE) window.removeEventListener("resize", onStLayoutResize);
  // iPad Safari 的 popover 回報的 innerHeight 可能比實際可見高度小很多，鎖下去會把清單裁掉；量到不合理的值就維持 600px
  if (window.innerHeight < 300) return;
  document.documentElement.style.height = window.innerHeight + "px";
}
function enterStLayout() {
  var html = document.documentElement;
  html.style.height = "";
  html.classList.remove("innerScroll");
  html.classList.add("stMode");
  setStVisibleH();
  window.addEventListener("resize", onStLayoutResize);
  clearTimeout(stLayoutTimer);
  stLayoutTimer = setTimeout(lockStLayout, 400);
}
function leaveStLayout() {
  clearTimeout(stLayoutTimer);
  window.removeEventListener("resize", onStLayoutResize);
  document.documentElement.classList.remove("stMode");
  document.documentElement.style.height = "";
  document.documentElement.style.removeProperty("--st-visible-h");
  fitInnerScroll();
}

// 整頁捲動條：原生的會把 popup 撐寬（見 popup.html 的 html 樣式），改畫一條浮在右緣的細捲動條。
// 跟著捲動位置與內容高度更新，內容沒超出（或在測速頁，整頁鎖住不捲）時隱藏；拖曳滑塊可以捲動
// macOS Safari：內容比 popup 高時，整頁（html）捲不動（滾輪、觸控板都沒反應，iOS 正常），下半部的設定點不到。
// 改成 html 固定在可見高度、由 body 自己捲（html.innerScroll，見 popup.html）；內容放得下時拿掉，popup 照常依內容決定高度。
// 測速頁有自己的版面（stMode），進去時先拿掉
var INNER_SCROLL = detectBrowser() === "safari" && !isIosSafari();
function fitInnerScroll() {
  if (!INNER_SCROLL) return;
  var html = document.documentElement;
  var on = !html.classList.contains("stMode") && document.body.scrollHeight > window.innerHeight + 1;
  if (on) html.style.setProperty("--inner-h", window.innerHeight + "px");
  html.classList.toggle("innerScroll", on);
}
(function initPageScrollbar() {
  var html = document.documentElement;
  function scroller() { return html.classList.contains("innerScroll") ? document.body : (document.scrollingElement || html); }
  var bar = document.getElementById("pageScrollbar"), thumb = bar.firstElementChild;
  function update() {
    fitInnerScroll();
    var root = scroller();
    var view = root.clientHeight, total = root.scrollHeight;
    var show = total > view + 1 && !html.classList.contains("stMode");
    bar.classList.toggle("show", show);
    if (!show) return;
    var track = bar.clientHeight;
    var h = Math.max(24, track * view / total);
    thumb.style.height = h + "px";
    thumb.style.top = (track - h) * root.scrollTop / (total - view) + "px";
  }
  window.addEventListener("scroll", update, { passive: true });
  document.body.addEventListener("scroll", update, { passive: true }); // innerScroll 時捲的是 body，事件不會冒泡到 window
  window.addEventListener("resize", update);
  if (typeof ResizeObserver === "function") {
    var ro = new ResizeObserver(update);
    ro.observe(document.body); // 內容長高／變矮（展開區塊、切換畫面）
    // innerScroll 時 body 高度固定，要看裡面各區塊的大小才知道內容變了
    if (INNER_SCROLL) Array.prototype.forEach.call(document.body.children, function (el) { ro.observe(el); });
  }
  thumb.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    var root = scroller();
    var startY = e.clientY, startTop = root.scrollTop;
    var ratio = (root.scrollHeight - root.clientHeight) / Math.max(1, bar.clientHeight - thumb.offsetHeight);
    try { thumb.setPointerCapture(e.pointerId); } catch (err) {}
    thumb.classList.add("dragging");
    function move(ev) { root.scrollTop = startTop + (ev.clientY - startY) * ratio; }
    function end() {
      thumb.classList.remove("dragging");
      thumb.removeEventListener("pointermove", move);
      thumb.removeEventListener("pointerup", end);
      thumb.removeEventListener("pointercancel", end);
    }
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", end);
    thumb.addEventListener("pointercancel", end);
  });
  update();
})();

// 目前分頁沒有影片可測（不是 B 站分頁、不是影片頁、影片還沒載入）：測速清單換成操作示意動畫＋「前往範例影片」
// 示意動畫依裝置三選一：電腦版瀏覽器（右上角擴充圖示）、iPhone（頁面選單切電腦版網站、再從頁面選單開擴充）、
// iPad（網址列的延伸功能圖示）
var ST_GUIDE_SCENE = !isIosSafari() ? "sgScDesk" : IS_IPHONE ? "sgScIphone" : "sgScIpad";
// iPhone／iPad 的操作步驟不同（iPhone 要先切電腦版網站），說明文字跟著換
if (ST_GUIDE_SCENE !== "sgScDesk") document.getElementById("stGuideText").textContent = t(ST_GUIDE_SCENE === "sgScIphone" ? "stGuideTextIphone" : "stGuideTextIpad");
function showStGuide(on) {
  els.stGuide.style.display = on ? "" : "none";
  if (on) els.stGuide.querySelectorAll(".sgScene").forEach(function (svg) {
    svg.style.display = svg.classList.contains(ST_GUIDE_SCENE) ? "" : "none";
  });
  els.stList.style.display = on ? "none" : "";
}

// 測速開不了時只留標題列和提示：影片資訊、測速說明、重新測速／停止這時都用不到，藏起來
function setStNoticeMode(on) {
  if (els.speedtestView.classList.contains("stNoticeMode") === on) return;
  els.speedtestView.classList.toggle("stNoticeMode", on);
  if (!on) syncDescOverflow(); // 說明區藏著時量不到高度，回來後重量
}

// 提示卡片上方的圓形圖示（Material Icons 的路徑）。"reloading" 用同一個重新整理圖示、轉圈
var ST_NOTICE_ICONS = {
  refresh: "M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
};

// 在測速清單的位置放一張提示卡片：圖示、標題（可省略）、說明，需要的話再加一顆按鈕。
// n = { icon: "refresh" | "reloading" | "info", title, text, btn, onClick }
function fillStNotice(n) {
  els.stList.textContent = "";
  var card = document.createElement("div");
  card.className = "stCard";
  var badge = document.createElement("div");
  badge.className = "stCardIcon" + (n.icon === "reloading" ? " spin" : "");
  var svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  var path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ST_NOTICE_ICONS[n.icon === "reloading" ? "refresh" : n.icon]);
  svg.appendChild(path);
  badge.appendChild(svg);
  card.appendChild(badge);
  if (n.title) {
    var title = document.createElement("div");
    title.className = "stCardTitle";
    title.textContent = n.title;
    card.appendChild(title);
  }
  var text = document.createElement("p");
  text.className = "stCardText";
  text.textContent = n.text;
  card.appendChild(text);
  if (n.btn) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stCta";
    btn.textContent = n.btn;
    btn.addEventListener("click", n.onClick);
    card.appendChild(btn);
  }
  els.stList.appendChild(card);
}

// 不是從測速狀態來的提示（開不了測速、重新整理中）。清掉 lastSpeedtestState：別處重繪測速清單時才不會蓋掉這段提示
function renderStNotice(n) {
  lastSpeedtestState = null;
  showStGuide(false);
  setStNoticeMode(true);
  fillStNotice(n);
}

// 擴充剛安裝／更新時，之前就開著的 B 站分頁沒有可用的 content script，要重新整理才能測。
// 在測速頁直接給重新整理按鈕；重新整理完 pollSpeedtest 會自動開測，不用再回主畫面按一次
function renderStaleNotice(tabId) {
  renderStNotice({ icon: "refresh", title: t("staleTabTitle"), text: t("stStaleText"), btn: t("staleTabReloadBtn"), onClick: function () {
    renderStNotice({ icon: "reloading", text: t("stStaleReloading") });
    // 等 reload 真的開始（分頁變成 loading）才標記，免得下一次 poll 看到的還是舊頁面的 complete 就急著開測
    chrome.tabs.reload(tabId, function () {
      void chrome.runtime.lastError;
      if (speedtestTabId === tabId) stReloadTabId = tabId;
    });
  } });
}

// 重新整理的分頁載完就開測：原本的長連線連的是舊頁面，要重連，content script 才偵測得到 popup 關掉而中止測速
function startAfterReload(tabId) {
  chrome.tabs.get(tabId, function (tab) {
    if (chrome.runtime.lastError || !tab || tab.status !== "complete" || stReloadTabId !== tabId) return;
    stReloadTabId = null;
    if (speedtestPort) { try { speedtestPort.disconnect(); } catch (e) {} }
    speedtestPort = connectTop(tabId, "cdn-switcher-speedtest");
    startSpeedtest(tabId, true);
  });
}

els.stGuide.querySelector("#stGuideBtn").addEventListener("click", function () {
  chrome.tabs.create({ url: SAMPLE_VIDEO_URL });
});

function showMainView() {
  setDescExpanded(false);
  els.speedtestView.style.display = "none";
  leaveStLayout();
  els.mainView.style.display = "block";
  if (speedtestPort) { try { speedtestPort.disconnect(); } catch (e) {} speedtestPort = null; }
  speedtestTabId = null;
  speedtestHosts = [];
  stReloadTabId = null;
  stAwaitStart = false;
  showStGuide(false);
  els.speedtestView.classList.remove("stNoticeMode");
}

// 沒有影片可測：顯示操作示意＋「前往範例影片」
function renderStGuide() {
  lastSpeedtestState = null;
  showStGuide(true);
  setStNoticeMode(true);
}

// 從主畫面進測速頁：不是 B 站分頁就直接顯示操作示意，不用先試著開測
function enterSpeedtest(tabId) {
  chrome.tabs.get(tabId, function (tab) {
    void chrome.runtime.lastError;
    if (speedtestTabId !== tabId) return;
    if (speedtestMode === "video" && !(tab && BILI_TAB_RE.test(tab.url || ""))) { renderStGuide(); return; }
    startSpeedtest(tabId, true);
  });
}

// fresh：剛進測速頁（或分頁剛重新整理完），還不知道能不能測，先不畫清單，等第一份測速狀態回來再畫（見 showSpeedtestView）
function startSpeedtest(tabId, fresh) {
  save({ autoTestPending: false }); // 使用者自己測速了，切換國家後的自動測速取消（MAIN 那邊開手動測速也會讓它作廢）
  var prev = lastSpeedtestState || {};
  if (!fresh) renderSpeedtest({ running: true, results: [], error: null, title: prev.title || "", qn: prev.qn || "", avail: prev.avail || null });
  var live = speedtestMode === "live";
  var msg = live
    ? { type: "CDN_SWITCHER_RUN_LIVE_SPEEDTEST", limits: { runs: lim("stLiveRuns"), sec: lim("stLiveSec") } }
    : { type: "CDN_SWITCHER_RUN_SPEEDTEST", hosts: speedtestHosts, limits: { mb: lim("stVideoMb"), sec: lim("stVideoSec") } };
  sendToTop(tabId, msg, function (resp) {
    var err = chrome.runtime.lastError;
    if (err || !resp || !resp.ok) {
      // 附上瀏覽器給的原因（沒有的話標出是哪種情況），使用者回報截圖時才看得出卡在哪
      var why = err ? err.message : !resp ? "no response" : "not ok";
      chrome.tabs.get(tabId, function (tab) {
        void chrome.runtime.lastError;
        if (speedtestTabId !== tabId) return;
        var url = (tab && tab.url) || "";
        var onPlayPage = (live ? LIVE_PAGE_RE : VIDEO_PAGE_RE).test(url);
        // 載完的影片頁／直播間卻聯絡不上 → 擴充剛安裝／更新、分頁還沒重新整理
        if (onPlayPage && tab.status === "complete") { renderStaleNotice(tabId); return; }
        // 不是影片頁（包含剛安裝、還沒重新整理的 B 站其他頁面）：重新整理了也沒影片可測，直接給操作示意；
        // 前往範例影片開的是新頁面，content script 本來就會注入，順便解決了要重新整理的問題。直播沒有範例可用，維持原本的說明
        if (!live && !onPlayPage) { renderStGuide(); return; }
        renderStNotice({ icon: "info", text: t(live ? "liveSpeedtestCannotStart" : "speedtestCannotStart") + " (" + why + ")" });
      });
      return;
    }
    stAwaitStart = false;
    if (fresh) setTimeout(pollSpeedtest, 150); // 不等每秒一次的輪詢，盡快把第一份狀態畫出來
  });
}

els.speedtestBtn.addEventListener("click", function () {
  var hosts = speedtestHostList();
  if (!hosts.length) return;
  confirmSpeedtestHosts(hosts, function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) return;
      var tabId = tabs[0].id;
      showSpeedtestView(tabId, "video");
      speedtestHosts = hosts;
      enterSpeedtest(tabId);
    });
  });
});

els.liveSpeedtestBtn.addEventListener("click", function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    var tabId = tabs[0].id;
    showSpeedtestView(tabId, "live");
    enterSpeedtest(tabId);
  });
});

els.stBackBtn.addEventListener("click", showMainView);

// 停止：中止目前這一輪，已測完的結果保留，沒測到的顯示「已取消」
document.getElementById("stStopBtn").addEventListener("click", function () {
  if (speedtestTabId == null) return;
  if (lastSpeedtestState) { lastSpeedtestState.running = false; renderSpeedtest(lastSpeedtestState); }
  sendToTop(speedtestTabId, { type: "CDN_SWITCHER_STOP_SPEEDTEST" }, function () { void chrome.runtime.lastError; });
});

els.stRetestBtn.addEventListener("click", function () {
  // 测速中也能按：main-hook.js 的 runSpeedTest 会自己中断上一轮、直接开新的
  if (speedtestTabId == null) return;
  if (speedtestMode === "live") { startSpeedtest(speedtestTabId); return; }
  var tabId = speedtestTabId;
  confirmSpeedtestHosts(speedtestHosts, function () { if (speedtestTabId === tabId) startSpeedtest(tabId); });
});

setInterval(function () { pollDebug(); pollSpeedtest(); }, 1000);

// -------- 版本更新提示 --------
// storage 記著使用者「已經看過更新內容的版本」。每次開啟 popup 都跟目前擴充版本比對：
//  - 沒有紀錄 → 新使用者：直接寫入目前版本，不跳提示
//  - 有紀錄且較舊 → 老使用者：跳一次性提示，列出（上次版本, 目前版本] 之間新增的功能；使用者關掉提示後才寫入新版本
//  - 較舊版本之間沒有任何要顯示的紀錄 → 不打擾，直接寫入新版本
var VERSION_KEY = "installedVersion";

function parseVer(v) {
  var m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v || "");
  return m ? [+m[1], +m[2], +m[3]] : null;
}
// a > b → 正數；任一邊格式不對回 NaN
function cmpVer(a, b) {
  var pa = parseVer(a), pb = parseVer(b);
  if (!pa || !pb) return NaN;
  for (var i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
// changelog.json 的語系鍵對應見 LOCALIZED_KEYS；舊版紀錄沒有 ja / ko，會退回 en
function changelogText(entry) {
  var key = LOCALIZED_KEYS[uiLangCode()];
  var txt = entry.text || {};
  return txt[key] || txt.en || txt.zh_TW || "";
}

function showWhatsNew(version, entries, onClose) {
  var box = document.getElementById("whatsNew");
  document.getElementById("wnTitle").textContent = t("whatsNewTitle").replace("{version}", version);
  var list = document.getElementById("wnList");
  list.textContent = "";
  entries.forEach(function (e) {
    var li = document.createElement("li");
    var tag = document.createElement("span");
    tag.className = "wnTag" + (e.type === "fix" ? " fix" : "");
    tag.textContent = t(e.type === "fix" ? "whatsNewTypeFix" : "whatsNewTypeFeature");
    li.appendChild(tag);
    li.appendChild(document.createTextNode(changelogText(e)));
    list.appendChild(li);
  });
  var closed = false;
  function close() {
    if (closed) return;
    closed = true;
    box.classList.remove("show");
    onClose();
  }
  // 用 onclick 賦值而不是 addEventListener：重複呼叫（例如 previewWhatsNew）時是「取代」，不會疊出多個 close 處理器
  document.getElementById("wnClose").onclick = close;
  document.getElementById("wnX").onclick = close;
  box.classList.add("show");
}

function checkVersionUpdate() {
  var current = chrome.runtime.getManifest().version;
  chrome.storage.local.get(VERSION_KEY, function (items) {
    var prev = items && items[VERSION_KEY];
    if (prev === current) return;
    if (!prev) { save({ installedVersion: current }); return; } // 新使用者
    var diff = cmpVer(prev, current);
    if (isNaN(diff) || diff > 0) { save({ installedVersion: current }); return; } // 紀錄壞掉或降版：重設就好
    fetch(chrome.runtime.getURL("changelog.json"))
      .then(function (r) { return r.json(); })
      .then(function (log) {
        var entries = [];
        (log.releases || []).forEach(function (rel) { // changelog 由新到舊，顯示順序也是新版在前
          if (cmpVer(rel.version, prev) > 0 && cmpVer(rel.version, current) <= 0) entries = entries.concat(rel.entries || []);
        });
        if (!entries.length) { save({ installedVersion: current }); return; }
        showWhatsNew(current, entries, function () { save({ installedVersion: current }); });
      })
      .catch(function () {}); // 讀不到更新紀錄就先不寫入，下次開啟再試
  });
}
checkVersionUpdate();

// -------- 除錯用：預覽「更新內容」popup --------
// 兩種用法：
//  1. 網址列直接開 chrome-extension://<擴充 ID>/popup.html?whatsNew（或 ?whatsNew=1.4.0）
//  2. 在 popup 的 DevTools console（工具列圖示右鍵 → 檢查彈出式視窗；不是網頁分頁的 console）呼叫 previewWhatsNew()
// 不會讀寫 storage 的版本號，關掉就沒事，可以重複呼叫。
//   previewWhatsNew()          預覽尚未上架（unreleased）的內容；沒有的話顯示最新一版
//   previewWhatsNew("1.4.0")   模擬「從 1.4.0 升級到目前版本」，列出 (1.4.0, 目前版本] 之間的 releases
// 語言跟著瀏覽器介面語言；要看別的語言就改瀏覽器語言後重開。
function previewWhatsNew(from) {
  var current = chrome.runtime.getManifest().version;
  return fetch(chrome.runtime.getURL("changelog.json"))
    .then(function (r) { return r.json(); })
    .then(function (log) {
      var entries = [];
      if (from) {
        (log.releases || []).forEach(function (rel) {
          if (cmpVer(rel.version, from) > 0 && cmpVer(rel.version, current) <= 0) entries = entries.concat(rel.entries || []);
        });
      } else {
        entries = (log.unreleased || []).length ? log.unreleased : ((log.releases || [])[0] || {}).entries || [];
      }
      if (!entries.length) { console.warn("previewWhatsNew: 這個範圍沒有任何更新紀錄可顯示"); return; }
      showWhatsNew(current, entries, function () {});
      return entries.length + " 條";
    });
}

// -------- 除錯用：不管 IP 國家，一律顯示所有公告（跑馬燈）--------
// 在 popup 的 DevTools console（popup 上按右鍵 →「檢查」）執行 announcementShowAll(true) 打開、announcementShowAll(false) 關閉；
// 存在 storage.local.announcementShowAll，重開 popup 仍然有效，要記得關。按 × 關閉的紀錄照樣有效（要看的話先 announcementReset()）。
function announcementShowAll(on) {
  chrome.storage.local.set({ announcementShowAll: !!on });
  return on ? "已開啟：顯示所有國家的公告" : "已關閉：只顯示所在國家的公告";
}
function announcementReset() {
  chrome.storage.local.remove(["announcementDismissed", "announcementFeed"]);
  return "已清除關閉紀錄與快取，重開 popup 生效";
}

// -------- 除錯用：假國家（測長國名的 UI）--------
// 網址列開 chrome-extension://<擴充 ID>/popup.html?fakeCountry：清單多一個最長國名的假國家（節點沿用台灣），
// 並當成「你在這裡」選取。只影響這次開啟的畫面；手動切國家才會寫入 storage（之後正常開啟會因找不到而回到台灣）。
var FAKE_COUNTRY = {
  code: "ZZ", dial: -1,
  name: { zh_TW: "南喬治亞與南桑威奇群島", zh_CN: "南乔治亚和南桑威奇群岛", en: "South Georgia and the South Sandwich Islands", ja: "サウスジョージア・サウスサンドウィッチ諸島", ko: "사우스조지아 사우스샌드위치 제도" }
};
function addFakeCountry() {
  if (!new URLSearchParams(location.search).has("fakeCountry")) return;
  var tw = findCountry("TW");
  FAKE_COUNTRY.nodes = tw ? tw.nodes : [];
  cdnCountries.unshift(FAKE_COUNTRY);
  addFakeCountry.active = true;
}

(function () {
  var params = new URLSearchParams(location.search);
  if (params.has("whatsNew")) previewWhatsNew(params.get("whatsNew") || undefined);
})();

// Test seam: only the unit-test harness (test/helpers/load.mjs) defines __BCS_TEST__.
if (globalThis.__BCS_TEST__ && typeof globalThis.__BCS_TEST__.register === "function") {
  globalThis.__BCS_TEST__.register("popup", {
    els: els, DEFAULTS: DEFAULTS, t: t, uiLangCode: uiLangCode, localized: localized, cdnDisplayName: cdnDisplayName,
    normHost: normHost, parseVer: parseVer, cmpVer: cmpVer, changelogText: changelogText, clampLimit: clampLimit, inferPreset: inferPreset,
    findCountry: findCountry, validCountry: validCountry, countryHosts: countryHosts, activeHosts: activeHosts, visibleCdnOptions: visibleCdnOptions,
    detectCountry: detectCountry, countryByDial: countryByDial, refreshZoneIfStale: refreshZoneIfStale, autoSelectCountry: autoSelectCountry,
    withSaved: withSaved, sortedKeys: sortedKeys, qualityTier: qualityTier, QUALITY_TIERS: QUALITY_TIERS, durationText: durationText, withUtm: withUtm, detectBrowser: detectBrowser,
    setRichText: setRichText, save: save,
    state: function () {
      return { cdnMode: cdnMode, customHosts: customHosts, countrySel: countrySel, detectedCountry: detectedCountry, currentCdnHost: currentCdnHost, cdnSelectValue: cdnSelectValue,
        videoOn: videoOn, liveOn: liveOn, liveRouteSel: liveRouteSel, sortOn: sortOn, speedOrder: speedOrder, limits: limits, presets: presets, cdnList: cdnList, cdnCountries: cdnCountries };
    },
    setState: function (s) {
      if (s.cdnMode !== undefined) cdnMode = s.cdnMode; if (s.customHosts) customHosts = s.customHosts; if (s.countrySel !== undefined) countrySel = s.countrySel;
      if (s.sortOn !== undefined) sortOn = s.sortOn; if (s.speedOrder) speedOrder = s.speedOrder; if (s.limits) limits = s.limits;
    }
  });
}
