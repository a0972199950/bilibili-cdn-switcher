// popup 的外觀主題：進階設定可選「跟隨系統／明亮／黑暗」，在 <html> 設 data-theme="light" | "dark"，popup.html 的 CSS 變數依此切換。
// 放在 <head> 同步執行，畫面出來前就套好主題，不會先閃一下另一個主題。
// 選擇存在 popup 自己的 localStorage（同步讀得到），並同步寫進 chrome.storage.local 的 uiTheme（localStorage 被清掉時由 popup.js 補回）。
(function () {
  "use strict";
  var THEMES = ["system", "light", "dark"];
  var PREF_KEY = "uiTheme";
  var pref = "system";
  try { pref = window.localStorage.getItem(PREF_KEY) || "system"; } catch (e) {}
  if (THEMES.indexOf(pref) < 0) pref = "system";

  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function apply() {
    var dark = pref === "dark" || (pref === "system" && !!mq && mq.matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }
  apply();
  // 跟隨系統時，popup 開著也要跟著系統切換
  if (mq) {
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else if (mq.addListener) mq.addListener(apply);
  }

  window.UI_THEMES = THEMES;
  window.getUiTheme = function () { return pref; };
  window.setUiTheme = function (value) {
    if (THEMES.indexOf(value) < 0) return;
    pref = value;
    try { window.localStorage.setItem(PREF_KEY, value); } catch (e) {}
    apply();
  };
})();
