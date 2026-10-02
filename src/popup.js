"use strict";

var DEFAULTS = {
  enabled: true,
  cdnHost: "cn-jxnc-cmcc-bcache-06.bilivideo.com",
  autoFallback: true,
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
  stLiveSec: 8
};

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
  customHost: document.getElementById("customHost"),
  customHint: document.getElementById("customHint"),
  showDebug: document.getElementById("showDebug"),
  debug: document.getElementById("debug"),
  mainView: document.getElementById("mainView"),
  speedtestView: document.getElementById("speedtestView"),
  speedtestBtn: document.getElementById("speedtestBtn"),
  rateBtn: document.getElementById("rateBtn"),
  feedbackBtn: document.getElementById("feedbackBtn"),
  stBackBtn: document.getElementById("stBackBtn"),
  stRetestBtn: document.getElementById("stRetestBtn"),
  stMeta: document.getElementById("stMeta"),
  stList: document.getElementById("stList")
};

// -------- i18n：套用 chrome.i18n 訊息到靜態文字節點 --------
function t(key) { return chrome.i18n.getMessage(key) || key; }
document.title = t("popupTitle");
document.documentElement.lang = chrome.i18n.getUILanguage();
[
  ["headerTitle", "extName"], ["enabledLabel", "enabledLabel"], ["autoFallbackLabel", "autoFallbackLabel"], ["autoFallbackHint", "autoFallbackHint"], ["cdnHostRowLabel", "cdnHostRowLabel"],
  ["tabVideo", "tabVideo"], ["tabLive", "tabLive"], ["advHeaderTitle", "advancedTitle"], ["advBackBtn", "stBackBtn"], ["clBackBtn", "stBackBtn"], ["clHeaderTitle", "changelogTitle"],
  ["modeListLabel", "modeListLabel"], ["modeCustomLabel", "modeCustomLabel"], ["modeOffLabel", "modeOffLabel"], ["speedtestBtn", "speedtestBtnLabel"],
  ["liveModeListLabel", "liveModePrefLabel"], ["liveModeOffLabel", "modeOffLabel"], ["liveSpeedtestBtn", "liveSpeedtestBtnLabel"],
  ["videoOffHint", "modeOffHintVideo"], ["liveOffHint", "modeOffHintLive"],
  ["rateBtn", "rateBtnLabel"], ["feedbackBtn", "feedbackBtnLabel"],
  ["showDebugLabel", "showDebugLabel"], ["debugSectionLabel", "debugSectionLabel"], ["stBackBtn", "stBackBtn"],
  ["stHeaderTitle", "stHeaderTitle"], ["stRetestBtn", "stRetestBtn"], ["stStopBtn", "stStopBtn"], ["stHintLeave", "stHintLeave"],
  ["liveRouteRowLabel", "liveRouteRowLabel"], ["videoFallbackHint", "videoFallbackHint"],
  ["sortBySpeedLabel", "sortBySpeedLabel"], ["sortBySpeedHint", "sortBySpeedHint"],
  ["stVideoLimitTitle", "stVideoLimitTitle"], ["stVideoLimitHint", "stVideoLimitHint"], ["stVideoMbLabel", "stVideoMbLabel"],
  ["stVideoSecLabel", "stVideoSecLabel"], ["stVideoSecUnit", "unitSec"], ["stVideoReset", "resetDefault"],
  ["stLiveLimitTitle", "stLiveLimitTitle"], ["stLiveLimitHint", "stLiveLimitHint"], ["stLiveRunsLabel", "stLiveRunsLabel"],
  ["stLiveRunsUnit", "unitTimes"], ["stLiveSecLabel", "stLiveSecLabel"], ["stLiveSecUnit", "unitSec"], ["stLiveReset", "resetDefault"], ["liveRouteExplain", "liveRouteExplain"], ["showDebugHint", "showDebugHint"],
  ["staleTitle", "staleTabTitle"], ["staleText", "staleTabText"], ["staleReloadBtn", "staleTabReloadBtn"],
  ["wnSubtitle", "whatsNewSubtitle"], ["wnClose", "whatsNewClose"]
].forEach(function (pair) { document.getElementById(pair[0]).textContent = t(pair[1]); });
// 逐段解析 <b>…</b> 建 DOM 节点，避免用 innerHTML 塞入语系字串（addons-linter 会挡动态 innerHTML）
function setRichText(el, str) {
  el.textContent = "";
  var re = /<b>(.*?)<\/b>/g;
  var lastIndex = 0, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > lastIndex) el.appendChild(document.createTextNode(str.slice(lastIndex, m.index)));
    var b = document.createElement("b");
    b.textContent = m[1];
    el.appendChild(b);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < str.length) el.appendChild(document.createTextNode(str.slice(lastIndex)));
}
els.gearBtn.title = t("advancedBtnTitle");
els.gearBtn.setAttribute("aria-label", t("advancedBtnTitle"));
els.customHost.placeholder = t("customHostPlaceholder");
els.debug.textContent = t("debugInitial");

// -------- 評分按鈕：Chrome / Edge 共用同一份 popup.js，只能靠 UA 分辨；沒有對應網址就不顯示 --------
// UI 語言代碼，挑意見回饋表單與組 utm_content 都用這個（代碼定義見 utm-tracking/campaigns.md）
function uiLangCode() {
  var lang = (chrome.i18n.getUILanguage() || "").toLowerCase();
  if (lang.indexOf("zh") !== 0) return "en";
  return lang.indexOf("cn") !== -1 ? "zhcn" : "zhtw";
}
// 意見回饋表單：依語言分開的 Google 表單連結。zhcn / en 專用表單還沒建，先共用 zhtw 那份頂著。
var FEEDBACK_FORM_URLS = {
  zhtw: "https://forms.gle/HoSRGTyp3UEejave7",
  zhcn: "https://forms.gle/HoSRGTyp3UEejave7", // TODO: 簡體中文表單好了再換
  en: "https://forms.gle/HoSRGTyp3UEejave7" // TODO: 英文表單好了再換
};
function pickFeedbackFormUrl() { return FEEDBACK_FORM_URLS[uiLangCode()]; }
// 一律用不含 slug 的短網址：商店改名後 slug 會失效，靠 ID／slug 本身跳轉才不會壞。
// Edge Add-ons 沒有 /reviews 這層（會 404），只能導到商品頁，讓使用者自己往下捲到評論區。
var STORE_REVIEW_URLS = {
  chrome: "https://chromewebstore.google.com/detail/dfaddcffoondcendifiljhdbdagebgch/reviews",
  edge: "https://microsoftedge.microsoft.com/addons/detail/dllallgilijcacpdemjafegibdafcbdp",
  firefox: "https://addons.mozilla.org/addon/bilibili-cdn-switcher/reviews"
};
function detectBrowser() {
  var ua = navigator.userAgent;
  if (ua.indexOf("Firefox/") !== -1) return "firefox";
  if (ua.indexOf("Edg/") !== -1) return "edge";
  if (ua.indexOf("Chrome/") !== -1) return "chrome";
  return "safari";
}
function openTab(url) { try { chrome.tabs.create({ url: url }); } catch (e) { window.open(url, "_blank"); } }

// 從擴充內按評分屬於「已安裝使用者」，跟 README 的取得管道（utm_campaign=readme）分開記，
// 免得把安裝來源報表灌成 GitHub 帶來的。
function withUtm(url, campaign) {
  var q = "utm_source=extension&utm_medium=referral&utm_campaign=" + campaign + "&utm_content=" + uiLangCode();
  return url + (url.indexOf("?") === -1 ? "?" : "&") + q;
}

var reviewUrl = STORE_REVIEW_URLS[detectBrowser()];
if (reviewUrl) {
  els.rateBtn.style.display = "";
  els.rateBtn.addEventListener("click", function () { openTab(withUtm(reviewUrl, "rate")); });
}
var feedbackUrl = pickFeedbackFormUrl();
if (feedbackUrl) {
  els.feedbackBtn.style.display = "";
  els.feedbackBtn.addEventListener("click", function () { openTab(feedbackUrl); });
}

var knownValues = {}; // 清单中所有 value（用来判断储存值是否在清单内，不在的话视为自行输入）
var cdnList = []; // cdn-list.json 的 options，供测速时取节点清单与显示用的名称
var currentCdnHost = null; // 目前生效的 cdnHost，供测速页标示「目前使用」＋点击切换比对
var videoOn = true; // 一般影片没选「关闭」；关闭时测速页不标示「目前使用」

// 具名节点：技术代号 + noteKey 註記；特殊选项（base/backup）用 nameKey + noteKey
function cdnDisplayName(o) {
  var name = o.nameKey ? t(o.nameKey) : o.name;
  var note = o.noteKey ? t(o.noteKey) : (o.note || "");
  return name + (note ? " (" + note + ")" : "");
}

// -------- CDN 清单：自制下拉（原生 select 的 option 不能分两行、不能弱化网域字重，改用 div 清单模拟）--------
var cdnSelectValue = ""; // 目前下拉「显示/选取」的 value；跟 currentCdnHost 的差别：自订模式时这里仍保留一个清单内的保底值，方便切回清单模式

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
  options.forEach(function (o) {
    knownValues[o.value] = true;
    var isHost = o.value !== "base" && o.value !== "backup";
    var row = document.createElement("div");
    row.className = "cdnOptRow";
    row.dataset.value = o.value;
    var nameEl = document.createElement("span");
    nameEl.className = "cdnOptName";
    nameEl.textContent = cdnDisplayName(o);
    row.appendChild(nameEl);
    if (isHost) {
      var hostEl = document.createElement("span");
      hostEl.className = "cdnOptHost";
      hostEl.textContent = o.value;
      row.appendChild(hostEl);
    }
    row.addEventListener("click", function () {
      closeCdnSelect();
      if (o.value === cdnSelectValue) return;
      selectCdnValue(o.value);
      currentCdnHost = o.value;
      save({ videoEnabled: true, cdnHost: o.value });
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

function buildOptions(options, current, on) {
  buildCdnSelectList(options);
  // 还原目前选择：「关闭」优先；否则储存值在清单内 → 清单模式；不在 → 视为自行输入的 host
  var known = !!(current && knownValues[current]);
  selectCdnValue(known ? current : DEFAULTS.cdnHost); // 保底，切回清单模式时有值可用
  if (!on) {
    els.modeOff.checked = true;
    if (!known) els.customHost.value = current || ""; // 关闭前用的是自行输入 → 切回自行输入时还在
  } else if (known) {
    els.modeList.checked = true;
  } else {
    els.modeCustom.checked = true;
    els.customHost.value = current || "";
  }
  syncModeUI();
}

// 依目前是「清单选择」「自行输入」还是「关闭」互斥显示对应的元件
function syncModeUI() {
  var isCustom = els.modeCustom.checked, isOff = els.modeOff.checked;
  els.cdnSelect.style.display = (isCustom || isOff) ? "none" : "block";
  els.customHost.style.display = isCustom ? "block" : "none";
  els.customHint.style.display = isCustom ? "block" : "none";
  els.videoOffHint.style.display = isOff ? "block" : "none";
  if (isCustom || isOff) closeCdnSelect();
}

function save(patch) { chrome.storage.local.set(patch); }

// 读清单 + 目前设定 → 建立下拉
Promise.all([
  fetch(chrome.runtime.getURL("cdn-list.json")).then(function (r) { return r.json(); }).catch(function () { return { options: [] }; }),
  new Promise(function (res) { chrome.storage.local.get(DEFAULTS, res); })
]).then(function (arr) {
  var list = (arr[0] && arr[0].options) || [];
  cdnList = list;
  var cfg = {};
  for (var k in DEFAULTS) cfg[k] = arr[1][k] === undefined ? DEFAULTS[k] : arr[1][k];
  // 旧版「清单里的『原始(不覆写)』」(cdnHost='base') 已被独立的「关闭」取代：搬成 videoEnabled=false
  if (cfg.cdnHost === "base") {
    cfg.videoEnabled = false; cfg.cdnHost = DEFAULTS.cdnHost;
    save({ videoEnabled: false, cdnHost: DEFAULTS.cdnHost });
  }
  els.enabled.checked = !!cfg.enabled;
  els.autoFallback.checked = !!cfg.autoFallback;
  els.showDebug.checked = !!cfg.showDebug;
  syncDebugSection();
  currentCdnHost = cfg.cdnHost;
  videoOn = cfg.videoEnabled !== false;
  buildOptions(list, cfg.cdnHost, videoOn);
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
});

els.enabled.addEventListener("change", function () { save({ enabled: els.enabled.checked }); });
els.autoFallback.addEventListener("change", function () { save({ autoFallback: els.autoFallback.checked }); });
// Debug（目前分頁）的文字只在開啟 debug 疊層時才顯示，跟該開關放在同一區
function syncDebugSection() { document.getElementById("debugSection").style.display = els.showDebug.checked ? "" : "none"; }
els.showDebug.addEventListener("change", function () { syncDebugSection(); save({ showDebug: els.showDebug.checked }); });

els.modeList.addEventListener("change", function () {
  if (!els.modeList.checked) return;
  syncModeUI();
  videoOn = true;
  currentCdnHost = cdnSelectValue || DEFAULTS.cdnHost;
  save({ videoEnabled: true, cdnHost: currentCdnHost });
});
els.modeCustom.addEventListener("change", function () {
  if (!els.modeCustom.checked) return;
  syncModeUI();
  var h = normHost(els.customHost.value);
  if (h) { videoOn = true; currentCdnHost = h; save({ videoEnabled: true, cdnHost: h }); markCustom(true); }
  else { els.customHost.focus(); markCustom(false); }
});
els.modeOff.addEventListener("change", function () {
  if (!els.modeOff.checked) return;
  syncModeUI();
  videoOn = false;
  save({ videoEnabled: false });
});

// 自订输入：即时正规化并储存
function markCustom(ok) {
  els.customHint.textContent = ok ? t("customHintDefault") : t("customHintInvalid");
  els.customHint.style.color = ok ? "#888" : "#e00";
}
els.customHost.addEventListener("input", function () {
  var h = normHost(els.customHost.value);
  if (h) { videoOn = true; currentCdnHost = h; save({ videoEnabled: true, cdnHost: h }); markCustom(true); }
  else { markCustom(false); }
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

// -------- Debug 读取 --------
function disp(s) { return s == null ? "-" : String(s); }
var QN_LABELS = {
  6: "240P", 16: "360P", 32: "480P", 64: "720P", 74: "720P60",
  80: "1080P", 100: "1080P AI", 112: "1080P+", 116: "1080P60",
  120: "4K", 125: "HDR", 126: "Dolby Vision", 127: "8K"
};
function qnText(q) {
  if (q == null) return "-";
  var name = QN_LABELS[q];
  return name ? name + " (" + q + ")" : String(q);
}
function spdText(bps, idle) {
  if (!bps) return "-";
  var s = bps >= 1048576 ? (bps / 1048576).toFixed(1) + " MB/s" : Math.round(bps / 1024) + " kB/s";
  return idle ? s + " (idle)" : s;
}
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

// 擴充剛重新載入／更新時，已經開著的 B 站分頁裡還是舊的 content script（已跟擴充斷線，收不到訊息），
// 瀏覽器不會自動把新的注入進去，要重新整理分頁才行。連續兩次聯絡不上 B 站分頁就提示並提供重新整理按鈕
// （只失敗一次可能是分頁剛好在載入中，不急著提示）。
var BILI_TAB_RE = /^https?:\/\/([a-z0-9-]+\.)*bilibili\.com\//i;
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
    chrome.tabs.sendMessage(tabs[0].id, { type: "CDN_SWITCHER_GET_DEBUG" }, TOP_FRAME, function (resp) {
      if (chrome.runtime.lastError) {
        debugMissCount++;
        setStale(onBili && tabs[0].status === "complete" && debugMissCount >= 2);
        renderDebug(null);
        return;
      }
      debugMissCount = 0;
      setStale(false);
      renderDebug(resp && resp.debug);
    });
  });
}
pollDebug();

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
  var vKeys = cdnList.map(function (o) { return o.value; });
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
  save(patch);
}
document.getElementById("stVideoReset").addEventListener("click", function () { resetLimits("video"); });
document.getElementById("stLiveReset").addEventListener("click", function () { resetLimits("live"); });
function lim(key) { return limits[key] || DEFAULTS[key]; }

var speedtestMode = "video"; // "video" | "live"：测速页两种模式共用同一个画面
var speedtestHosts = []; // 本次送出测试的 host 顺序，index 对应 speedTest.results 的顺序
var speedtestTabId = null;
var speedtestPort = null; // 只用来让 content script 侦测「离开测速页 / popup 关闭」→ 立即中止
var lastSpeedtestState = null; // 最近一次 renderSpeedtest 的资料，点击切换节点后立即重绘打勾标示用

function speedtestHostList() {
  return cdnList.filter(function (o) { return o.value && o.value !== "base" && o.value !== "backup"; });
}

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
  if (st.error === "no-sample") { els.stList.textContent = t("liveSpeedtestNoSampleHint"); return; }
  if (st.error === "unavailable") { els.stList.textContent = t("liveSpeedtestUnavailableHint"); return; }
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

function renderSpeedtest(st) {
  if (!st) return;
  lastSpeedtestState = st;
  document.getElementById("stStopBtn").disabled = !st.running;
  if (speedtestMode === "live") { renderLiveSpeedtest(st); return; }
  renderSpeedtestMeta(st);
  if (st.error === "no-sample") {
    els.stList.textContent = t("speedtestNoSampleHint");
    return;
  }
  var bestHost = null, bestBps = 0;
  st.results.forEach(function (r) { if (!r.error && r.bps > bestBps) { bestBps = r.bps; bestHost = r.host; } });

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

      row.appendChild(main);
      row.appendChild(speedSpan);
      frag.appendChild(row);
    });
    els.stList.appendChild(frag);
  });
}

// 测速页点一下节点列即直接切换：写回清单模式的选择并存档，主画面下次打开会同步显示
function applySpeedtestHost(host) {
  if (!knownValues[host] || (videoOn && host === currentCdnHost)) return;
  currentCdnHost = host;
  videoOn = true;
  els.modeList.checked = true;
  selectCdnValue(host);
  syncModeUI();
  save({ videoEnabled: true, cdnHost: host });
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
  chrome.tabs.sendMessage(speedtestTabId, { type: "CDN_SWITCHER_GET_SPEEDTEST" }, TOP_FRAME, function (resp) {
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
  els.speedtestView.style.display = "block";
  // 开一个长连线：popup 关闭或按返回时会自动/主动断线，content script 收到 onDisconnect 就中止测速
  try { speedtestPort = chrome.tabs.connect(tabId, { name: "cdn-switcher-speedtest", frameId: 0 }); } catch (e) { speedtestPort = null; }
}

function showMainView() {
  els.speedtestView.style.display = "none";
  els.mainView.style.display = "block";
  if (speedtestPort) { try { speedtestPort.disconnect(); } catch (e) {} speedtestPort = null; }
  speedtestTabId = null;
  speedtestHosts = [];
}

function startSpeedtest(tabId) {
  var prev = lastSpeedtestState || {};
  renderSpeedtest({ running: true, results: [], error: null, title: prev.title || "", qn: prev.qn || "", avail: prev.avail || null });
  var live = speedtestMode === "live";
  var msg = live
    ? { type: "CDN_SWITCHER_RUN_LIVE_SPEEDTEST", limits: { runs: lim("stLiveRuns"), sec: lim("stLiveSec") } }
    : { type: "CDN_SWITCHER_RUN_SPEEDTEST", hosts: speedtestHosts, limits: { mb: lim("stVideoMb"), sec: lim("stVideoSec") } };
  chrome.tabs.sendMessage(tabId, msg, TOP_FRAME, function (resp) {
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      els.stList.textContent = t(live ? "liveSpeedtestCannotStart" : "speedtestCannotStart");
    }
  });
}

els.speedtestBtn.addEventListener("click", function () {
  speedtestHosts = speedtestHostList().map(function (o) { return o.value; });
  if (!speedtestHosts.length) return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    var tabId = tabs[0].id;
    showSpeedtestView(tabId, "video");
    startSpeedtest(tabId);
  });
});

els.liveSpeedtestBtn.addEventListener("click", function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    var tabId = tabs[0].id;
    showSpeedtestView(tabId, "live");
    startSpeedtest(tabId);
  });
});

els.stBackBtn.addEventListener("click", showMainView);

// 停止：中止目前這一輪，已測完的結果保留，沒測到的顯示「已取消」
document.getElementById("stStopBtn").addEventListener("click", function () {
  if (speedtestTabId == null) return;
  if (lastSpeedtestState) { lastSpeedtestState.running = false; renderSpeedtest(lastSpeedtestState); }
  chrome.tabs.sendMessage(speedtestTabId, { type: "CDN_SWITCHER_STOP_SPEEDTEST" }, TOP_FRAME, function () { void chrome.runtime.lastError; });
});

els.stRetestBtn.addEventListener("click", function () {
  // 测速中也能按：main-hook.js 的 runSpeedTest 会自己中断上一轮、直接开新的
  if (speedtestTabId == null) return;
  startSpeedtest(speedtestTabId);
});

setInterval(function () { pollDebug(); pollSpeedtest(); }, 1000);

// -------- 版本更新提示 --------
// storage 記著使用者「已經看過更新內容的版本」。每次開啟設定選單都跟目前擴充版本比對：
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
// changelog.json 的語系鍵是 zh_TW / zh_CN / en，跟 uiLangCode() 的 zhtw / zhcn / en 對應
function changelogText(entry) {
  var key = { zhtw: "zh_TW", zhcn: "zh_CN", en: "en" }[uiLangCode()];
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

(function () {
  var params = new URLSearchParams(location.search);
  if (params.has("whatsNew")) previewWhatsNew(params.get("whatsNew") || undefined);
})();
