// 公開網站版贊助頁（https://biboost.app/donate）：用 localStorage 模擬贊助頁會用到的擴充 API，
// 讓 src/donate.html 那一份程式不用改就能在一般網頁上跑。由 scripts/build-site.mjs 放在 theme.js 前面載入。
//   storage.local    → localStorage（key 前面加 bb:）；沒有 storage.sync，donate.js 會退回 local
//   i18n             → 依瀏覽器語言載入 _locales/<語言>/messages.json（介面上選的語言由 i18n.js 處理）
//   tabs.create      → 同一個分頁前往付款頁（非同步拿到網址後再開新視窗會被彈出視窗攔截）
//   tabs／windows 其餘 → 不做事（網頁沒有「切回原本分頁」這回事）
(function () {
  "use strict";
  var NS = "bb:";
  function lsGet(k) {
    try { var v = window.localStorage.getItem(NS + k); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; }
  }
  function lsSet(k, v) { try { window.localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} }
  function lsRemove(k) { try { window.localStorage.removeItem(NS + k); } catch (e) {} }
  function later(cb, v) { if (typeof cb === "function") setTimeout(function () { cb(v); }, 0); }
  var local = {
    get: function (keys, cb) {
      var out = {};
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) keys.forEach(function (k) { var v = lsGet(k); if (v !== undefined) out[k] = v; });
      else for (var k in keys) { var v = lsGet(k); out[k] = v === undefined ? keys[k] : v; }
      later(cb, out);
      return Promise.resolve(out);
    },
    set: function (obj, cb) { for (var k in obj) lsSet(k, obj[k]); later(cb); return Promise.resolve(); },
    remove: function (keys, cb) { [].concat(keys).forEach(lsRemove); later(cb); return Promise.resolve(); }
  };

  // 瀏覽器語言 → _locales 的資料夾
  function pickLang() {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < list.length; i++) {
      var l = String(list[i]).toLowerCase();
      if (l.indexOf("zh") === 0) return /tw|hk|mo|hant/.test(l) ? "zh_TW" : "zh_CN";
      if (l.indexOf("ja") === 0) return "ja";
      if (l.indexOf("ko") === 0) return "ko";
      if (l.indexOf("en") === 0) return "en";
    }
    return "en";
  }
  function loadMessages(lang) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "/_locales/" + lang + "/messages.json", false);
      xhr.send();
      var raw = JSON.parse(xhr.responseText), out = {};
      for (var k in raw) out[k] = raw[k].message;
      return out;
    } catch (e) { return {}; }
  }
  var auto = pickLang();
  var messages = loadMessages(auto);

  // 預設幣別：擴充是用 IP 偵測國家，網頁沒有，改用瀏覽器語言的地區（zh-TW → TW）
  if (lsGet("detectedCountry") === undefined) {
    var m = /-([a-z]{2})$/i.exec(navigator.language || "");
    if (m) lsSet("detectedCountry", m[1].toUpperCase());
  }

  function noop() {}
  window.chrome = {
    storage: { local: local, onChanged: { addListener: noop } },
    i18n: {
      getMessage: function (k) { return messages[k] || ""; },
      getUILanguage: function () { return auto.replace("_", "-"); }
    },
    runtime: {
      id: "web",
      // donate.html → https://biboost.app/donate（網站用不帶 .html 的網址）；其他照路徑
      getURL: function (p) { return location.origin + "/" + String(p).replace(/^\//, "").replace(/\.html$/, ""); },
      getManifest: function () { return { version: "web" }; }
    },
    tabs: {
      create: function (o) { location.assign(o.url); },
      getCurrent: function (cb) { later(cb, undefined); },
      update: noop,
      remove: noop
    },
    windows: { update: noop }
  };
})();
