// popup 的語言覆寫：使用者在進階設定選了語言時，t() 改讀 _locales/<lang>/messages.json，
// 不選（"auto"）就維持 chrome.i18n 依瀏覽器語言挑的結果。
// chrome.i18n 無法指定語言，所以這裡自己載入；選擇存在 popup 自己的 localStorage（同步讀得到，
// popup.js 一開始就要用 t()），並同步寫進 chrome.storage.local 的 uiLang / uiMsgs，後者給 bridge.js 的頁內提示用。
(function () {
  "use strict";
  var LANGS = ["zh_TW", "zh_HK", "zh_CN", "en", "ja", "ko"]; // 對應 _locales/ 資料夾，新增語言時一併加到這裡
  var PREF_KEY = "uiLang";
  var pref = "auto";
  try { pref = window.localStorage.getItem(PREF_KEY) || "auto"; } catch (e) {}
  if (LANGS.indexOf(pref) < 0) pref = "auto";
  // 測試各語言用：網址加 ?lang=ja（zh_TW、zh_HK、zh_CN、en、ja、ko）只換這一頁的語言，不存進設定
  var urlLang = null;
  try { urlLang = (new URLSearchParams(window.location.search).get("lang") || "").replace("-", "_"); } catch (e) {}
  var fromUrl = LANGS.indexOf(urlLang) >= 0;
  if (fromUrl) pref = urlLang;

  function load(lang) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", chrome.runtime.getURL("_locales/" + lang + "/messages.json"), false); // 同步：popup.js 一載入就要用
      xhr.send();
      var raw = JSON.parse(xhr.responseText), out = {};
      for (var k in raw) out[k] = raw[k].message;
      return out;
    } catch (e) { return null; }
  }

  // 「跟隨瀏覽器」時 chrome.i18n 只認得 zh_TW / zh_CN（Chrome 不支援 zh_HK 資料夾，香港用戶會退回 zh_TW），
  // 所以瀏覽器介面是中文、而介面語言或第一偏好語言是香港／澳門／粵語時，自己改載入 zh_HK。
  function detectAuto() {
    var isHk = function (l) { return /^(yue|zh-(hk|mo)|zh-hant-(hk|mo))/.test(String(l || "").toLowerCase().replace("_", "-")); };
    var ui = "", first = "";
    try { ui = chrome.i18n.getUILanguage(); } catch (e) {}
    try { first = (navigator.languages && navigator.languages[0]) || navigator.language; } catch (e) {}
    if (isHk(ui) || (String(ui).toLowerCase().indexOf("zh") === 0 && isHk(first))) return "zh_HK";
    return null;
  }
  var autoLang = detectAuto();

  window.UI_LANGS = LANGS;
  window.uiLangPref = pref;
  window.uiAutoLang = autoLang; // 跟隨瀏覽器時實際用的語言（null = 交給 chrome.i18n）
  window.uiLangFromUrl = fromUrl; // 網址指定的語言：popup 不要拿它跟設定比對、重載（會無限重載）
  window.uiMessages = pref === "auto" ? (autoLang ? load(autoLang) : null) : load(pref);
  window.loadUiMessages = load;
  // 存進 chrome.storage.local 的 uiMsgs（bridge.js 頁內提示用）：跟隨瀏覽器且偵測到 zh_HK 時也要存整份文案
  window.uiMessagesFor = function (value) { return value === "auto" ? (autoLang ? load(autoLang) : null) : load(value); };
  window.setUiLangPref = function (value) {
    try { window.localStorage.setItem(PREF_KEY, value); } catch (e) {}
  };
})();
