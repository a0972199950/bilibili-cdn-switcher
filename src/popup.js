"use strict";

var DEFAULTS = {
  enabled: true,
  cdnHost: "upos-sz-mirror08ct.bilivideo.com",
  cdnMode: null, // 一般影片用哪份節點："list"（國家清單）或 "custom"（自訂節點列表）；null = 1.6 以前的設定，載入時遷移
  customHosts: [], // 自訂節點列表（使用者加入的、測速工具匯入的），依加入順序
  cdnCountry: null, // 節點清單的國家選項（cdn-list.json countries 的 code，或 "ALL"）
  detectedCountry: "", // 依 IP 偵測到、且在清單內的國家；標「你在這裡」用
  countryAutoDone: false, // 依 IP 自動選國家只做一次（新安裝與更新後），使用者自己選過也算
  autoFallback: true,
  autoSpeedSwitch: false, // 影片自動測速並切換到最快節點（進階設定，預設關閉；實際測速在 main-hook.js）
  autoSpeedHosts: [], // 自動測速要測的節點：依目前國家寫入，content script 讀這份
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
  feedbackBtn: document.getElementById("feedbackBtn"),
  stBackBtn: document.getElementById("stBackBtn"),
  stRetestBtn: document.getElementById("stRetestBtn"),
  stMeta: document.getElementById("stMeta"),
  stList: document.getElementById("stList")
};

// -------- i18n：套用 chrome.i18n 訊息到靜態文字節點 --------
// 使用者在進階設定選了語言時，優先讀 i18n.js 載入的那份語系；沒選就走 chrome.i18n（依瀏覽器語言）
function t(key) { return (uiMessages && uiMessages[key]) || chrome.i18n.getMessage(key) || key; }
function uiLanguage() { return uiLangPref !== "auto" ? uiLangPref.replace("_", "-") : chrome.i18n.getUILanguage(); }
document.title = t("popupTitle");
document.documentElement.lang = uiLanguage();
[
  ["headerTitle", "popupHeaderTitle"], ["gearBtnLabel", "advancedBtnLabel"], ["uiLangLabel", "uiLangLabel"], ["uiThemeLabel", "uiThemeLabel"], ["enabledLabel", "enabledLabel"], ["autoFallbackLabel", "autoFallbackLabel"], ["autoFallbackHint", "autoFallbackHint"], ["autoSpeedSwitchLabel", "autoSpeedSwitchLabel"], ["cdnHostRowLabel", "cdnHostRowLabel"],
  ["tabVideo", "tabVideo"], ["tabLive", "tabLive"], ["advHeaderTitle", "advancedTitle"], ["advBackBtn", "stBackBtn"], ["clBackBtn", "stBackBtn"], ["clHeaderTitle", "changelogTitle"],
  ["modeListLabel", "modeListLabel"], ["modeCustomLabel", "modeCustomLabel"], ["modeOffLabel", "modeOffLabel"], ["speedtestBtn", "speedtestBtnLabel"],
  ["liveModeListLabel", "liveModePrefLabel"], ["liveModeOffLabel", "modeOffLabel"], ["liveSpeedtestBtn", "liveSpeedtestBtnLabel"],
  ["videoOffHint", "modeOffHintVideo"], ["liveOffHint", "modeOffHintLive"],
  ["rateBtn", "rateBtnLabel"], ["feedbackBtn", "feedbackBtnLabel"],
  ["showDebugLabel", "showDebugLabel"], ["debugSectionLabel", "debugSectionLabel"], ["stBackBtn", "stBackBtn"],
  ["stHeaderTitle", "stHeaderTitle"], ["stRetestBtn", "stRetestBtn"], ["stStopBtn", "stStopBtn"], ["stHintLeave", "stHintLeave"],
  ["liveRouteRowLabel", "liveRouteRowLabel"],
  ["sortBySpeedLabel", "sortBySpeedLabel"], ["sortBySpeedHint", "sortBySpeedHint"],
  ["stVideoLimitTitle", "stVideoLimitTitle"], ["stVideoLimitHint", "stVideoLimitHint"], ["stVideoMbLabel", "stVideoMbLabel"],
  ["stVideoSecLabel", "stVideoSecLabel"], ["stVideoSecUnit", "unitSec"], ["stVideoReset", "resetDefault"],
  ["stLiveLimitTitle", "stLiveLimitTitle"], ["stLiveLimitHint", "stLiveLimitHint"], ["stLiveRunsLabel", "stLiveRunsLabel"],
  ["stLiveRunsUnit", "unitTimes"], ["stLiveSecLabel", "stLiveSecLabel"], ["stLiveSecUnit", "unitSec"], ["stLiveReset", "resetDefault"], ["liveRouteExplain", "liveRouteExplain"], ["showDebugHint", "showDebugHint"],
  ["staleTitle", "staleTabTitle"], ["staleText", "staleTabText"], ["staleReloadBtn", "staleTabReloadBtn"],
  ["customAddBtn", "customAddBtn"], ["customClearBtn", "customClearBtn"], ["resetAllBtn", "resetAllBtn"],
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

// -------- 評分按鈕：Chrome / Edge 共用同一份 popup.js，只能靠 UA 分辨；沒有對應網址就不顯示 --------
// UI 語言代碼，挑意見回饋表單與組 utm_content 都用這個（代碼定義見 promotions/campaigns.md）
function uiLangCode() {
  var lang = (uiLanguage() || "").toLowerCase();
  if (lang.indexOf("ja") === 0) return "ja";
  if (lang.indexOf("ko") === 0) return "ko";
  if (lang.indexOf("zh") !== 0) return "en";
  return lang.indexOf("cn") !== -1 ? "zhcn" : "zhtw";
}
// uiLangCode() → cdn-list.json / changelog.json 多語字串的語系鍵
var LOCALIZED_KEYS = { zhtw: "zh_TW", zhcn: "zh_CN", en: "en", ja: "ja", ko: "ko" };
// 意見回饋表單：三語共用同一份 Google 表單（題目都是「繁中 | 簡中 | English」）。
// 用完整的 viewform 網址（短網址 forms.gle 不吃預填參數），環境資訊題的 entry ID 見 FEEDBACK_ENV_ENTRY。
var FEEDBACK_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScYPTvslktKd1AUK7SsdG-j505oMjHxdfLv1wKQlduGBAemDg/viewform";
var FEEDBACK_ENV_ENTRY = "entry.603662239"; // 表單「環境資訊」題的預填參數名
function pickFeedbackFormUrl() { return FEEDBACK_FORM_URL; }
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

// 「自訂節點列表」：一句說明＋官方測速工具的推廣卡（「自動偵測並加入」開教學文件）
var SPEEDTEST_DOC_URL = "https://lazy-cv.com/docs/bilibili-cdn-speedtest";
document.getElementById("customDesc").textContent = t("customDesc1");
document.getElementById("autoDetectText").textContent = t("autoDetectText");
document.getElementById("autoDetectBtn").textContent = t("autoDetectBtn");
document.getElementById("autoDetectBtn").addEventListener("click", function () {
  openTab(withUtm(SPEEDTEST_DOC_URL, "custom_list"));
});

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

var reviewUrl = STORE_REVIEW_URLS[detectBrowser()];
if (reviewUrl) {
  els.rateBtn.style.display = "";
  els.rateBtn.addEventListener("click", function () { openTab(withUtm(reviewUrl, "rate")); });
}
var feedbackUrl = pickFeedbackFormUrl();
if (feedbackUrl) {
  els.feedbackBtn.style.display = "";
  els.feedbackBtn.addEventListener("click", function () {
    buildFeedbackEnv(function (env) {
      openTab(feedbackUrl + "?usp=pp_url&" + FEEDBACK_ENV_ENTRY + "=" + encodeURIComponent(env));
    });
  });
}

// 「問題回報」預填的環境資訊：版本、瀏覽器、目前設定、目前分頁與 debug 快照。
// 使用者在表單上看得到、可以刪改，送不送出由使用者決定；擴充本身不會傳出這些資料。
function browserVersion() {
  var m = navigator.userAgent.match(/(Firefox|Edg|Chrome|Version)\/([\d.]+)/);
  return detectBrowser() + (m ? " " + m[2] : "");
}
function osName() {
  var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  return p || "-";
}
function buildFeedbackEnv(done) {
  chrome.storage.local.get(DEFAULTS, function (cfg) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var url = (tabs && tabs[0] && tabs[0].url) || "";
      var tab = BILI_TAB_RE.test(url) ? url.split(/[?#]/)[0] : "(not bilibili)";
      var lines = [
        "version=" + chrome.runtime.getManifest().version + "  browser=" + browserVersion() + "  os=" + osName() + "  lang=" + chrome.i18n.getUILanguage(),
        "enabled=" + cfg.enabled + "  autoFallback=" + cfg.autoFallback + "  sortBySpeed=" + cfg.sortBySpeed,
        "country=" + disp(cfg.cdnCountry) + "  detected=" + disp(cfg.detectedCountry),
        "video=" + (cfg.videoEnabled === false ? "off" : cfg.cdnHost) + "  list=" + disp(cfg.cdnMode) +
          (cfg.cdnMode === "custom" ? "(" + (cfg.customHosts || []).length + ")" : ""),
        "live=" + (cfg.liveEnabled === false ? "off" : cfg.liveRoute),
        "tab=" + tab
      ];
      if (lastDebugText) lines.push("-- debug --", lastDebugText);
      done(lines.join("\n"));
    });
  });
}

var knownValues = {}; // 清单中所有 value（1.6 以前用来判断储存值是否为自行输入，见载入时的迁移）
var cdnMode = "list"; // 目前用哪份节点（"list" / "custom"）；选「关闭」时保留关闭前的那份
var customHosts = []; // 自订节点列表
var cdnList = []; // cdn-list.json 的 options（全部节点，「全部」选项的顺序），供显示名称与查找
var cdnPools = {}; // cdn-list.json 的 pools：池类型的多语标签
var currentCdnHost = null; // 目前生效的 cdnHost，供测速页标示「目前使用」＋点击切换比对
var videoOn = true; // 一般影片没选「关闭」；关闭时测速页不标示「目前使用」

// cdn-list.json / changelog.json 里 { zh_TW, zh_CN, en, ja, ko } 形式的多语字串（ja / ko 缺的话退回 en）
function localized(obj) {
  if (!obj) return "";
  var key = LOCALIZED_KEYS[uiLangCode()];
  return obj[key] || obj.en || obj.zh_TW || "";
}

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
  save(patch);
  applyCountry(code);
});

// 依 IP 判斷國家：B 站 zone API（擴充原本就有 bilibili.com 的權限，不需新增權限；不帶 cookie）。
// 回傳清單內的國家 code；不在清單內回 ""；查詢失敗回 null（下次開啟再試）
var ZONE_API = "https://api.bilibili.com/x/web-interface/zone";
var countryAutoPending = false;
function detectCountry() {
  return fetch(ZONE_API, { credentials: "omit", cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || j.code !== 0 || !j.data) return null;
      var dial = Number(j.data.country_code);
      for (var i = 0; i < cdnCountries.length; i++) if (cdnCountries[i].dial === dial) return cdnCountries[i].code;
      return "";
    })
    .catch(function () { return null; });
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
    // 新安裝與更新後的使用者一律換成該國第一個節點：舊版選的節點多半不在新的國家清單裡，
    // 留著會變成下拉裡看不到的選項。用自訂節點列表的使用者不動
    if (cdnMode !== "custom") useCountryFirstNode(target, patch);
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

function save(patch) { chrome.storage.local.set(patch); }

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
  autoSelectCountry(cfg);
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
  if (cdnMode !== "list") { cdnMode = "list"; useCountryFirstNode(countrySel, patch); }
  currentCdnHost = cdnSelectValue;
  save(patch);
  rebuildCdnList();
});
els.modeCustom.addEventListener("change", function () {
  if (!els.modeCustom.checked) return;
  videoOn = true;
  var patch = { videoEnabled: true, cdnMode: "custom" };
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
  save({ videoEnabled: false });
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
  if (area !== "local" || !changes.customHosts) return;
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
var lastDebugText = ""; // 最近一次 debug 文字，問題回報時預填進表單
function renderDebug(d) {
  liveSnap = (d && d.live) || null;
  renderLiveRows();
  if (!d) { lastDebugText = ""; els.debug.textContent = t("debugNoDataAfterOpen"); return; }
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
  lastDebugText = lines.join("\n");
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
    sendToTop(tabs[0].id, { type: "CDN_SWITCHER_GET_DEBUG" }, function (resp) {
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
  save(patch);
}
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

      row.appendChild(main);
      row.appendChild(speedSpan);
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
  // 开一个长连线：popup 关闭或按返回时会自动/主动断线，content script 收到 onDisconnect 就中止测速
  speedtestPort = connectTop(tabId, "cdn-switcher-speedtest");
}

// 測速頁版面（見 popup.html 的 html.stMode）：先讓 html 撐到 600px 向瀏覽器要最大的 popup，
// popup 視窗跟著變大是非同步的，等 resize 停下來（或一段時間都沒有 resize＝本來就已經最大）後，
// 再把 html 高度鎖成實際可見高度，內容剛好等於視窗，不會超出也不會留白
var stLayoutTimer = null;
function onStLayoutResize() {
  clearTimeout(stLayoutTimer);
  stLayoutTimer = setTimeout(lockStLayout, 150);
}
function lockStLayout() {
  window.removeEventListener("resize", onStLayoutResize);
  // iPad Safari 的 popover 回報的 innerHeight 可能比實際可見高度小很多，鎖下去會把清單裁掉；量到不合理的值就維持 600px
  if (window.innerHeight < 300) return;
  document.documentElement.style.height = window.innerHeight + "px";
}
function enterStLayout() {
  var html = document.documentElement;
  html.style.height = "";
  html.classList.add("stMode");
  window.addEventListener("resize", onStLayoutResize);
  clearTimeout(stLayoutTimer);
  stLayoutTimer = setTimeout(lockStLayout, 400);
}
function leaveStLayout() {
  clearTimeout(stLayoutTimer);
  window.removeEventListener("resize", onStLayoutResize);
  document.documentElement.classList.remove("stMode");
  document.documentElement.style.height = "";
}

function showMainView() {
  setDescExpanded(false);
  els.speedtestView.style.display = "none";
  leaveStLayout();
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
  sendToTop(tabId, msg, function (resp) {
    var err = chrome.runtime.lastError;
    if (err || !resp || !resp.ok) {
      // 附上瀏覽器給的原因（沒有的話標出是哪種情況），使用者回報截圖時才看得出卡在哪
      var why = err ? err.message : !resp ? "no response" : "not ok";
      els.stList.textContent = t(live ? "liveSpeedtestCannotStart" : "speedtestCannotStart") + " (" + why + ")";
    }
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
      startSpeedtest(tabId);
    });
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
