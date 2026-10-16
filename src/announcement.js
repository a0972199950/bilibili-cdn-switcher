"use strict";
/*
 * 公告視窗（announcement.html）：popup 跑馬燈點下去，由 background 開成獨立視窗（同問題回報）；?id=<n> 是點到的公告，只顯示那一則。
 *  - 資料同 popup：storage.local.announcementFeed（popup 抓的快取），找不到那一則就向 report worker 的 GET /v1/announcements 重抓
 *  - type "lottery"：標題「抽獎活動」，內容由 lottery-text.js 依抽獎資料組，下面接參加方式、「下載測速工具與教學」
 *  - type "html"：標題是公告的標題，內容是後台寫的 HTML（html-sanitize.js 依白名單重建），只有「關閉」
 */
var ANNOUNCE_API = "https://bcs-report.bilibili-cdn-switcher-tools.workers.dev/v1/announcements";
var ANNOUNCE_FEED_V = 1; // 同 popup.js：announcementFeed 的格式版本，不同的舊快取不用
var SPEEDTEST_DOC_URL = "https://lazy-cv.com/docs/bilibili-cdn-speedtest";

var params = new URLSearchParams(location.search);
var ID = /^\d+$/.test(params.get("id") || "") ? Number(params.get("id")) : null;

function t(key) { return (uiMessages && uiMessages[key]) || chrome.i18n.getMessage(key) || key; }
function uiLanguage() { return uiLangPref !== "auto" ? uiLangPref.replace("_", "-") : chrome.i18n.getUILanguage(); }
// 同 popup.js 的 uiLangCode()：utm_content 用
function uiLangCode() {
  var l = (uiLanguage() || "").toLowerCase();
  if (l.indexOf("ja") === 0) return "ja";
  if (l.indexOf("ko") === 0) return "ko";
  if (l.indexOf("zh") !== 0) return "en";
  return l.indexOf("cn") !== -1 ? "zhcn" : "zhtw";
}
var LANG = { zhtw: "zh-TW", zhcn: "zh-CN", en: "en", ja: "ja", ko: "ko" }[uiLangCode()];
function $(id) { return document.getElementById(id); }
function openTab(url) { try { chrome.tabs.create({ url: url }); } catch (e) { window.open(url, "_blank"); } }
// { 語言: 文字 } 取介面語言，沒有就依序退回 en、zh-TW、任一種（同 popup.js）
function pickLang(map) {
  if (!map) return "";
  var keys = [LANG, "en", "zh-TW"].concat(Object.keys(map));
  for (var i = 0; i < keys.length; i++) if (map[keys[i]]) return map[keys[i]];
  return "";
}
function el(tag, text) {
  var e = document.createElement(tag);
  e.textContent = text;
  return e;
}

document.documentElement.lang = uiLanguage();
$("how").textContent = t("lotteryWinHow");
$("ctaBtn").textContent = t("lotteryWinCta");
$("closeBtn2").textContent = t("lotteryWinClose");
$("closeBtn").setAttribute("aria-label", t("lotteryWinClose"));
$("closeBtn").addEventListener("click", function () { window.close(); });
$("closeBtn2").addEventListener("click", function () { window.close(); });
$("ctaBtn").addEventListener("click", function () {
  openTab(SPEEDTEST_DOC_URL + "?utm_source=extension&utm_medium=referral&utm_campaign=lottery&utm_content=" + uiLangCode());
});

function setTitle(text, gift) {
  document.title = text;
  $("title").textContent = text;
  $("giftIcon").style.display = gift ? "" : "none";
}

// 抽獎公告：依抽獎資料組文字；抽獎已結束（或資料不完整）就當作找不到
function renderLottery(l) {
  var c;
  try { c = LotteryText.compose(l, LANG); } catch (e) { return false; }
  if (Date.now() >= l.endsAt) return false;
  setTitle(t("lotteryWinTitle"), true);
  var sec = $("body");
  sec.className = "lot";
  sec.appendChild(el("h2", c.title));
  sec.appendChild(el("p", c.eligible));
  if (c.ispList) sec.appendChild(el("p", c.ispList)).className = "ispList";
  [c.period, c.prize, c.draw].forEach(function (line) { sec.appendChild(el("p", line)); });
  $("how").style.display = "";
  $("ctaBtn").style.display = "";
  return true;
}

// 一般公告：標題＋後台寫的 HTML
function renderHtml(a) {
  var title = pickLang(a.title), html = pickLang(a.html);
  if (!title) return false;
  setTitle(title, false);
  $("body").className = "rich";
  HtmlSanitize.render(html, $("body"), openTab);
  return true;
}

function render(items) {
  var a = (items || []).filter(function (it) { return it && it.id === ID; })[0];
  var ok = a && (a.type === "lottery" ? a.lottery && renderLottery(a.lottery) : a.type === "html" && renderHtml(a));
  if (ok) return true;
  setTitle(t("lotteryBarLabel"), false);
  $("body").textContent = "";
  $("body").appendChild(el("p", t("announceGone"))).className = "empty";
  return false;
}

chrome.storage.local.get({ announcementFeed: null }, function (s) {
  var feed = s.announcementFeed;
  var cached = feed && feed.v === ANNOUNCE_FEED_V && Array.isArray(feed.items) ? feed.items : null;
  // 快取裡有這一則就直接畫；沒有（舊格式、還沒抓過、剛新增）才重抓
  if (cached && cached.some(function (it) { return it && it.id === ID; })) { render(cached); return; }
  // no-store：不用瀏覽器的 HTTP 快取（worker 回應帶 max-age=60，給 Cloudflare 用的）；快取由擴充自己的 announcementFeed 管，
  // 不然 announcementReset() 清掉之後重抓，還是會拿到瀏覽器存著的舊回應
  fetch(ANNOUNCE_API, { credentials: "omit", cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || !j.ok || !Array.isArray(j.items)) throw new Error("bad");
      chrome.storage.local.set({ announcementFeed: { v: ANNOUNCE_FEED_V, at: Date.now(), items: j.items } });
      render(j.items);
    })
    .catch(function () { render(cached); });
});
