// Helpers shared by the extension pages (popup.html, report.html, announcement.html).
// Loaded after i18n.js (needs `uiMessages` / `uiLangPref`) and before the page's own script.
// Not used by the content scripts: main-hook.js runs in the page's MAIN world as a single file.
"use strict";

// ---- i18n ----
// Prefer the language the user picked in advanced settings (i18n.js); otherwise chrome.i18n follows the browser.
function t(key) { return (uiMessages && uiMessages[key]) || chrome.i18n.getMessage(key) || key; }
function uiLanguage() { return uiLangPref !== "auto" ? uiLangPref.replace("_", "-") : chrome.i18n.getUILanguage(); }
// Short UI language code used for feedback forms and utm_content (see promotions/campaigns.md)
function uiLangCode() {
  var lang = (uiLanguage() || "").toLowerCase();
  if (lang.indexOf("ja") === 0) return "ja";
  if (lang.indexOf("ko") === 0) return "ko";
  if (lang.indexOf("zh") !== 0) return "en";
  return lang.indexOf("cn") !== -1 ? "zhcn" : "zhtw";
}
// uiLangCode() → key of the { zh_TW, zh_CN, en, ja, ko } objects in cdn-list.json / changelog.json
var LOCALIZED_KEYS = { zhtw: "zh_TW", zhcn: "zh_CN", en: "en", ja: "ja", ko: "ko" };
// uiLangCode() → "zh-TW"-style tag used by the announcement API and lottery-text.js
function uiLangTag() { return LOCALIZED_KEYS[uiLangCode()].replace("_", "-"); }
// { zh_TW: ..., en: ... } → the UI language, falling back to en, then zh_TW
function localized(obj) {
  if (!obj) return "";
  var key = LOCALIZED_KEYS[uiLangCode()];
  return obj[key] || obj.en || obj.zh_TW || "";
}
// { "zh-TW": ..., en: ... } → `lang` (default: the UI language), then en, zh-TW, then any
function pickLang(map, lang) {
  if (!map) return "";
  var keys = [lang || uiLangTag(), "en", "zh-TW"].concat(Object.keys(map));
  for (var i = 0; i < keys.length; i++) if (map[keys[i]]) return map[keys[i]];
  return "";
}

// ---- DOM / browser ----
function $(id) { return document.getElementById(id); }
// Chrome / Edge share the same popup.js, so the browser can only be told apart from the UA
function detectBrowser() {
  var ua = navigator.userAgent;
  if (ua.indexOf("Firefox/") !== -1) return "firefox";
  if (ua.indexOf("Edg/") !== -1) return "edge";
  if (ua.indexOf("Chrome/") !== -1) return "chrome";
  return "safari";
}
// iPhone / iPad Safari: neither can run the speed test tool. iPadOS Safari reports a Mac UA, so touch support tells them apart
function isIosSafari() {
  return detectBrowser() === "safari" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.maxTouchPoints > 1);
}
function openTab(url) { try { chrome.tabs.create({ url: url }); } catch (e) { window.open(url, "_blank"); } }

// ---- formatting ----
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
// bytes/s → "1.5 MB/s" / "320 kB/s"; idle = no traffic in the window, last value kept
function spdText(bps, idle) {
  if (!bps) return "-";
  var s = bps >= 1048576 ? (bps / 1048576).toFixed(1) + " MB/s" : Math.round(bps / 1024) + " kB/s";
  return idle ? s + " (idle)" : s;
}
// Drop the bilivideo domain suffix for compact display / logs; non-strings become ""
function shortHost(h) { return typeof h === "string" ? h.replace(/\.bilivideo\.(com|cn)$/i, "") : ""; }

// ---- bilibili zone API (IP / ISP / country) ----
// The extension already has bilibili.com host permission; the request is sent without cookies.
// Node quality mostly depends on the ISP, so the result is also stored for bug reports.
var ZONE_API = "https://api.bilibili.com/x/web-interface/zone";
var ZONE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Resolves to the API's `data` (or null on failure) and stores ip / isp / province / country / dial
function fetchZone() {
  return fetch(ZONE_API, { credentials: "omit", cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || j.code !== 0 || !j.data) return null;
      var d = j.data;
      chrome.storage.local.set({ detectedIp: d.addr || "", detectedIsp: d.isp || "", detectedProvince: d.province || "", detectedCountryName: d.country || "", detectedDial: Number(d.country_code) || null, zoneCheckedAt: Date.now() });
      return d;
    })
    .catch(function () { return null; });
}
