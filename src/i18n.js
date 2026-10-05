// popup 的語言覆寫：使用者在進階設定選了語言時，t() 改讀 _locales/<lang>/messages.json，
// 不選（"auto"）就維持 chrome.i18n 依瀏覽器語言挑的結果。
// chrome.i18n 無法指定語言，所以這裡自己載入；選擇存在 popup 自己的 localStorage（同步讀得到，
// popup.js 一開始就要用 t()），並同步寫進 chrome.storage.local 的 uiLang / uiMsgs，後者給 bridge.js 的頁內提示用。
(function () {
  "use strict";
  var LANGS = ["zh_TW", "zh_CN", "en"]; // 對應 _locales/ 資料夾，新增語言時一併加到這裡
  var PREF_KEY = "uiLang";
  var pref = "auto";
  try { pref = window.localStorage.getItem(PREF_KEY) || "auto"; } catch (e) {}
  if (LANGS.indexOf(pref) < 0) pref = "auto";

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

  window.UI_LANGS = LANGS;
  window.uiLangPref = pref;
  window.uiMessages = pref === "auto" ? null : load(pref);
  window.loadUiMessages = load;
  window.setUiLangPref = function (value) {
    try { window.localStorage.setItem(PREF_KEY, value); } catch (e) {}
  };
})();
