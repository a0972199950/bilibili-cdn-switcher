"use strict";
/*
 * 問題回報頁（report.html）：
 *  - 由 background 開成獨立視窗（chrome.windows.create type=popup；沒有視窗 API 的環境退回新分頁）；?tab=<id> 是按下回報時的 B 站分頁
 *  - 讀 storage.session 裡 background 累積的事件日誌（journal）／採樣（samples）／各分頁快照（snaps），
 *    加上目前設定、版本、瀏覽器、IP／ISP（B 站 zone API），組成一份可讀的純文字診斷資料
 *  - bug 類一律附上診斷資料（不可取消）；「功能許願」不附
 *  - POST 到 Cloudflare Worker（tools/report-worker），Worker 存進私有 repo 並開公開 issue，回 issue 網址
 *  - 失敗時提供「複製診斷資料」當退路
 */
var REPORT_ENDPOINT = "https://bcs-report.bilibili-cdn-switcher-tools.workers.dev/v1/report";
var REPORT_TOKEN = "bcs-f302715d682c1c7864032e45"; // 與 Worker 的 REPORT_TOKEN 相同：弱驗證，只擋無差別掃描
var PRIVACY_URL = "https://github.com/a0972199950/bilibili-cdn-switcher/blob/master/PRIVACY.md";
var ISSUES_URL = "https://github.com/a0972199950/bilibili-cdn-switcher/issues/new";
var ZONE_API = "https://api.bilibili.com/x/web-interface/zone";
var ZONE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
var DIAG_STORE = chrome.storage.session || chrome.storage.local;
var DIAG_KEEP_MS = 10 * 60 * 1000;
var TYPES = ["bug", "feature"];
var TYPE_KEYS = { bug: "reportTypeBug", feature: "reportTypeFeature" };

var params = new URLSearchParams(location.search);
var TAB_ID = /^\d+$/.test(params.get("tab") || "") ? Number(params.get("tab")) : null;

function t(key) { return (uiMessages && uiMessages[key]) || chrome.i18n.getMessage(key) || key; }
function uiLanguage() { return uiLangPref !== "auto" ? uiLangPref.replace("_", "-") : chrome.i18n.getUILanguage(); }
function $(id) { return document.getElementById(id); }
document.title = t("reportTitle");
document.documentElement.lang = uiLanguage();
$("title").textContent = t("reportTitle");
$("typeLabel").textContent = t("reportTypeLabel");
$("descLabel").textContent = t("reportDescLabel");
$("descNote").textContent = t("reportDescNote");
$("contactLabel").textContent = t("reportContactLabel");
$("contactNote").textContent = t("reportContactNote");
$("diagToggle").textContent = t("reportDiagView");
$("submitBtn").textContent = t("reportSubmit");
$("resultClose").textContent = t("reportClose");
$("copyBtn").textContent = t("reportCopy");
$("copied").textContent = t("reportCopied");
$("closeBtn").setAttribute("aria-label", t("reportClose"));
(function renderNote() {
  var box = $("diagNote");
  box.textContent = t("reportDiagNote") + " ";
  var a = document.createElement("a");
  a.href = PRIVACY_URL; a.target = "_blank"; a.rel = "noopener"; a.textContent = t("reportPrivacyLink");
  box.appendChild(a);
})();

// -------- 類型（chip 單選）：bug 類一律附診斷；功能許願不附、整個診斷區塊隱藏 --------
var curType = "bug";
var typesBox = $("types");
TYPES.forEach(function (code) {
  var lab = document.createElement("label");
  var inp = document.createElement("input");
  inp.type = "radio"; inp.name = "type"; inp.value = code; inp.checked = code === curType;
  lab.appendChild(inp);
  lab.appendChild(document.createTextNode(t(TYPE_KEYS[code])));
  if (inp.checked) lab.className = "on";
  inp.addEventListener("change", function () {
    curType = code;
    Array.prototype.forEach.call(typesBox.children, function (el) { el.className = el.firstChild.checked ? "on" : ""; });
    syncDiagBox();
  });
  typesBox.appendChild(lab);
});
function includeDiag() { return curType !== "feature"; }
function syncDiagBox() { $("diagBox").style.display = includeDiag() ? "" : "none"; }

$("desc").addEventListener("input", function () { $("counter").textContent = this.value.length + " / 4000"; $("descErr").textContent = ""; });
$("contact").addEventListener("input", function () { $("contactErr").textContent = ""; });
$("diagToggle").addEventListener("click", function () {
  var pre = $("diagPre"), open = pre.style.display === "block";
  pre.style.display = open ? "none" : "block";
  this.textContent = t(open ? "reportDiagView" : "reportDiagHide");
});

// -------- 關閉 --------
function doClose() { try { window.close(); } catch (e) {} }
function tryClose() {
  var dirty = $("form").style.display !== "none" && $("desc").value.trim();
  if (dirty && !window.confirm(t("reportDiscardConfirm"))) return;
  doClose();
}
$("closeBtn").addEventListener("click", tryClose);
$("resultClose").addEventListener("click", doClose);
document.addEventListener("keydown", function (e) { if (e.key === "Escape") tryClose(); });

// -------- 收集資料 --------
function storageGet(area, keys) { return new Promise(function (res) { try { area.get(keys, function (items) { res(items || {}); }); } catch (e) { res({}); } }); }
function detectBrowser() {
  var ua = navigator.userAgent;
  if (ua.indexOf("Firefox/") !== -1) return "firefox";
  if (ua.indexOf("Edg/") !== -1) return "edge";
  if (ua.indexOf("Chrome/") !== -1) return "chrome";
  return "safari";
}
function browserVersion() {
  var m = navigator.userAgent.match(/(Firefox|Edg|Chrome|Version)\/([\d.]+)/);
  return detectBrowser() + (m ? " " + m[2] : "");
}
function osName() { return (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "-"; }
function shortHost(h) { return (h || "").replace(/\.bilivideo\.(com|cn)$/i, ""); }

// 目前分頁是 B 站：向它要「此刻」的快照；不是（或聯絡不上）：拿 storage 裡最近更新的那一份
function freshSnapshot() {
  return new Promise(function (res) {
    if (TAB_ID == null) { res(null); return; }
    var done = false;
    function finish(v) { if (!done) { done = true; res(v); } }
    setTimeout(function () { finish(null); }, 900);
    function plain() { try { chrome.tabs.sendMessage(TAB_ID, { type: "CDN_SWITCHER_GET_DEBUG_FRESH" }, function (r) { void chrome.runtime.lastError; finish(r && r.debug ? { t: Date.now(), tab: TAB_ID, url: r.url, payload: r.debug, fresh: true } : null); }); } catch (e) { finish(null); }
    }
    try {
      chrome.tabs.sendMessage(TAB_ID, { type: "CDN_SWITCHER_GET_DEBUG_FRESH" }, { frameId: 0 }, function (r) {
        if (chrome.runtime.lastError) { plain(); return; }
        finish(r && r.debug ? { t: Date.now(), tab: TAB_ID, url: r.url, payload: r.debug, fresh: true } : null);
      });
    } catch (e) { plain(); }
  });
}
function newestSnapshot(snaps) {
  var best = null, now = Date.now();
  for (var k in snaps || {}) { var s = snaps[k]; if (s && now - s.t < DIAG_KEEP_MS && (!best || s.t > best.t)) best = s; }
  return best;
}
// IP／ISP：B 站 zone API（擴充本來就有 bilibili.com 權限，不帶 cookie）。超過 24 小時或沒有就重查，順手存回 storage 給 popup 用
function zoneInfo(cfg) {
  var cached = { ip: cfg.detectedIp, isp: cfg.detectedIsp, province: cfg.detectedProvince, countryName: cfg.detectedCountryName, dial: cfg.detectedDial, at: cfg.zoneCheckedAt };
  if (cached.at && Date.now() - cached.at < ZONE_MAX_AGE_MS && cached.ip) return Promise.resolve(cached);
  return fetch(ZONE_API, { credentials: "omit", cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
    if (!j || j.code !== 0 || !j.data) return cached;
    var d = j.data, out = { ip: d.addr || "", isp: d.isp || "", province: d.province || "", countryName: d.country || "", dial: Number(d.country_code) || null, at: Date.now() };
    try { chrome.storage.local.set({ detectedIp: out.ip, detectedIsp: out.isp, detectedProvince: out.province, detectedCountryName: out.countryName, detectedDial: out.dial, zoneCheckedAt: out.at }); } catch (e) {}
    return out;
  }).catch(function () { return cached; });
}

function kv(obj) {
  var out = [];
  for (var k in obj) {
    var v = obj[k];
    if (v == null || v === "") v = "-";
    else if (Array.isArray(v)) v = v.join(",") || "-";
    else if (typeof v === "object") v = JSON.stringify(v);
    out.push(k + "=" + v);
  }
  return out.join("  ");
}
function fmtDetail(d) {
  var parts = [];
  for (var k in d) { var v = d[k]; if (v == null || v === "") continue; parts.push(k + "=" + (Array.isArray(v) ? v.join("|") : v)); }
  return parts.join(" ");
}
function rel(t, now) { return "-" + Math.max(0, Math.round((now - t) / 1000)) + "s"; }
function spdText(bps) { if (!bps) return "0"; return bps >= 1048576 ? (bps / 1048576).toFixed(1) + "M" : Math.round(bps / 1024) + "k"; }

// 擴充自己先算一個初判，AI 讀的時候少繞路（判錯沒關係，有原始資料可以推翻）
function detectPattern(snap, journal, samples, zone, cfg) {
  var d = (snap && snap.payload && snap.payload.diag) || {};
  var p = snap && snap.payload;
  if (zone && zone.vpnSuspect) return "vpn";
  if (d.playurlBeforeHook) return "hook-too-late";
  var http = journal.filter(function (e) { return e.k === "net.http" && e.d && (e.d.status === 403 || e.d.status === 404 || e.d.status >= 500) && !e.d.expired; });
  var httpN = http.reduce(function (a, e) { return a + (e.n || 1); }, 0);
  if (httpN >= 3) return "hard-" + http[http.length - 1].d.status;
  if (p && d.active && p.rewriteCount > 0 && p.segRewriteCount === 0 && d.lastSegReqAgo == null) return "player-no-request";
  var hits = journal.filter(function (e) { return e.k === "fb.stall" && e.d && e.d.phase === "hit"; }).length;
  var switches = journal.filter(function (e) { return e.k === "fb.switch"; }).length;
  if (hits && !switches) return "stall-no-fallback";
  if (switches >= 2) return "fallback-exhausted";
  var sp = samples.slice(-6).map(function (r) { return r.spd || 0; });
  if (sp.length >= 4) {
    var max = Math.max.apply(null, sp), last = sp[sp.length - 1], dec = true;
    for (var i = 1; i < sp.length; i++) if (sp[i] > sp[i - 1] * 1.15) dec = false;
    if (dec && max > 0 && last < max * 0.3) return "slow-decay";
  }
  var errs = journal.filter(function (e) { return e.k === "play.error"; }).length;
  if (errs) return "media-error";
  return "none";
}

function buildDiag(data) {
  var now = Date.now(), cfg = data.cfg, snap = data.snap, p = (snap && snap.payload) || {}, dg = p.diag || {}, zone = data.zone;
  var manifest = chrome.runtime.getManifest();
  var tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
  var conn = navigator.connection || {};
  var detectedCode = cfg.detectedCountry || "";
  var vpnSuspect = !!(detectedCode && cfg.cdnCountry && cfg.cdnCountry !== "ALL" && cfg.cdnCountry !== detectedCode);
  zone.vpnSuspect = vpnSuspect;
  var lines = [];
  lines.push("# bilibili-cdn-switcher diagnostics  v" + manifest.version + "  at=" + new Date(now).toISOString());
  lines.push("");
  lines.push("## snapshot");
  lines.push("[ext]  " + kv({ version: manifest.version, installedVersion: cfg.installedVersion, installedAt: cfg.installedAt ? new Date(cfg.installedAt).toISOString() : null, updatedAt: cfg.updatedAt ? new Date(cfg.updatedAt).toISOString() : null }));
  lines.push("[env]  " + kv({ browser: browserVersion(), os: osName(), uiLang: uiLanguage(), tz: tz, connType: conn.effectiveType, downlink: conn.downlink, saveData: conn.saveData }));
  lines.push("[ua]   " + navigator.userAgent);
  lines.push("[cfg]  " + kv({ enabled: cfg.enabled, autoFallback: cfg.autoFallback, sortBySpeed: cfg.sortBySpeed, autoSpeedSwitch: cfg.autoSpeedSwitch, showDebug: cfg.showDebug,
    country: cfg.cdnCountry, mode: cfg.cdnMode, video: cfg.videoEnabled === false ? "off" : cfg.cdnHost, customHosts: (cfg.customHosts || []).length,
    live: cfg.liveEnabled === false ? "off" : cfg.liveRoute, stVideo: (cfg.stVideoMb || 8) + "MB/" + (cfg.stVideoSec || 5) + "s" }));
  lines.push("[net]  " + kv({ ip: zone.ip, isp: zone.isp, province: zone.province, ipCountry: zone.countryName, ipDial: zone.dial, detectedCountry: detectedCode, zoneAge: zone.at ? Math.round((now - zone.at) / 60000) + "m" : null, vpnSuspect: vpnSuspect ? 1 : 0 }));
  lines.push("[node] " + kv({ configured: cfg.videoEnabled === false ? "off" : cfg.cdnHost, effective: dg.effective, autoHost: p.autoHost, playurlGiven: dg.playurlGiven, currentCdn: p.currentCdn, pickV: p.pickVideoHost, pickA: p.pickAudioHost, backups: (dg.backups || []).map(shortHost) }));
  if (cfg.speedOrder && cfg.speedOrder.video && cfg.speedOrder.video.length) lines.push("[rank] lastSpeedOrder=" + cfg.speedOrder.video.slice(0, 12).map(shortHost).join(" > "));
  if (snap) {
    lines.push("[page] " + kv({ snapshotAge: Math.round((now - snap.t) / 1000) + "s", fresh: snap.fresh ? 1 : 0, tab: snap.tab, url: snap.url, type: dg.page && dg.page.type, bvid: dg.page && dg.page.bvid, cid: dg.page && dg.page.cid, epid: dg.page && dg.page.epid, room: dg.page && dg.page.room, player: dg.page && dg.page.player, dash: dg.dash ? 1 : 0, spaNav: dg.spaNav, top: dg.page && dg.page.top }));
    lines.push("[play] " + kv({ src: p.lastSource, rw: p.rewriteCount, seg: p.segRewriteCount, qn: p.lastQn, spd: spdText(p.speedBps) + (p.speedIdle ? "(idle)" : ""), buf: dg.buf, rs: dg.rs, paused: dg.paused, ct: dg.ct, lat: dg.lastSegMs, lastSegReqAgo: dg.lastSegReqAgo, lastSampleAgo: dg.lastSampleAgo }));
    lines.push("[fb]   " + kv({ stallSince: dg.stallSince ? Math.round((now - dg.stallSince) / 1000) + "s" : null, stallLimit: dg.stallLimit, attempts: dg.fb && dg.fb.attempts, max: dg.fb && dg.fb.max, cooldownLeft: dg.fb && dg.fb.cooldownLeft, tried: dg.fb && dg.fb.tried.map(shortHost), hookAt: dg.hookAt, playurlBeforeHook: dg.playurlBeforeHook ? 1 : 0, active: dg.active ? 1 : 0 }));
    if (p.lastError) lines.push("[err]  " + p.lastError + (dg.lastErrorAt ? "  (" + Math.round((now - dg.lastErrorAt) / 1000) + "s ago)" : ""));
    if (p.live) lines.push("[live] " + kv({ route: p.live.route, eff: p.live.eff, auto: p.live.auto, cluster: p.live.cluster, protocol: p.live.protocol, orig: p.live.origRoute, active: p.live.activeHost, avail: p.live.avail, pinned: p.live.pinned }));
  } else {
    lines.push("[page] snapshot=none (no bilibili tab seen in the last 10 min)");
  }
  var pattern = detectPattern(snap, data.journal, data.samples, zone, cfg);
  lines.push("[hint] pattern=" + pattern);
  lines.push("");
  lines.push("## journal (last 10 min, oldest first; -Ns = seconds before report; xN = merged repeats)");
  if (!data.journal.length) lines.push("(empty)");
  data.journal.forEach(function (e) {
    var tag = e.tab != null ? "[t" + e.tab + "] " : "";
    var rep = e.n > 1 ? "  x" + e.n + (e.until ? " over " + Math.round((e.until - e.t) / 1000) + "s" : "") : "";
    lines.push(rel(e.t, now).padStart(6) + "  " + tag + e.k.padEnd(14) + " " + fmtDetail(e.d || {}) + rep);
  });
  lines.push("");
  lines.push("## samples (every 10s while media loaded)");
  lines.push("   t   spd    buf    qn  rs p  lat   host");
  if (!data.samples.length) lines.push("(empty)");
  data.samples.forEach(function (r) {
    lines.push([rel(r.t, now).padStart(6), (spdText(r.spd) + (r.idle ? "*" : "")).padStart(6), (r.buf != null ? r.buf + "s" : "-").padStart(6), String(r.qn == null ? "-" : r.qn).padStart(5), String(r.rs).padStart(3), r.paused ? "P" : "-", String(r.lat || 0).padStart(5), r.host || "-"].join(" "));
  });
  lines.push("");
  var summary = {
    version: manifest.version, browser: browserVersion(), os: osName(), country: (cfg.cdnCountry || "-") + (detectedCode ? "/" + detectedCode : ""), isp: zone.isp || "", vpnSuspect: vpnSuspect,
    configured: cfg.videoEnabled === false ? "off" : shortHost(cfg.cdnHost), effective: shortHost(dg.effective), playurlGiven: shortHost(dg.playurlGiven), currentCdn: shortHost(p.currentCdn),
    qn: p.lastQn, speed: p.speedBps ? spdText(p.speedBps) + "B/s" : "", pattern: pattern,
    recentKinds: data.journal.slice(-5).map(function (e) { return e.k; })
  };
  return { text: lines.join("\n"), summary: summary };
}

var diag = null; // { text, summary }
function collect() {
  return Promise.all([
    storageGet(chrome.storage.local, null),
    storageGet(DIAG_STORE, { journal: [], samples: [], snaps: {} }),
    freshSnapshot()
  ]).then(function (arr) {
    var cfg = arr[0] || {}, store = arr[1] || {}, fresh = arr[2];
    var now = Date.now();
    var journal = (store.journal || []).filter(function (e) { return e && now - (e.until || e.t) < DIAG_KEEP_MS; });
    var samples = (store.samples || []).filter(function (r) { return r && now - r.t < DIAG_KEEP_MS; });
    var snap = fresh || newestSnapshot(store.snaps);
    return zoneInfo(cfg).then(function (zone) {
      diag = buildDiag({ cfg: cfg, journal: journal, samples: samples, snap: snap, zone: zone || {} });
      $("diagPre").textContent = diag.text;
      var kb = Math.max(1, Math.round(new Blob([diag.text]).size / 1024));
      $("diagTitle").textContent = t("reportDiagTitle").replace("{kb}", String(kb));
    });
  });
}
$("diagTitle").textContent = t("reportDiagTitle").replace("{kb}", "…");
try { window.focus(); $("desc").focus(); } catch (e) {} // iframe 一開就取得焦點：Escape 才會送到這裡
collect().catch(function () { diag = diag || { text: "(failed to collect diagnostics)", summary: {} }; });

// -------- 送出 --------
function errText(code) {
  if (code === "rate_limited") return t("reportErrRateLimited");
  if (code === "network") return t("reportErrNetwork");
  return code || "unknown";
}
function showResult(ok, titleText, bodyText, link, allowCopy) {
  $("form").style.display = "none";
  var r = $("result");
  r.className = "result " + (ok ? "ok" : "fail");
  r.style.display = "block";
  $("resultTitle").textContent = titleText;
  $("resultText").textContent = bodyText || "";
  var lk = $("resultLink"); lk.textContent = "";
  if (link) { var a = document.createElement("a"); a.href = link; a.target = "_blank"; a.rel = "noopener"; a.textContent = link; lk.appendChild(a); }
  $("copyBtn").style.display = allowCopy ? "" : "none";
}
$("copyBtn").addEventListener("click", function () {
  var text = buildCopyText();
  function done() { $("copied").style.display = ""; }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
  else { legacyCopy(text); done(); }
});
function legacyCopy(text) {
  var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
}
function buildCopyText() {
  return "type=" + curType + "\n\n" + $("desc").value.trim() + "\n\n" + (diag ? diag.text : "");
}

// 回報紀錄：存 storage.local（擴充更新不會清掉），popup 底部顯示「#123 ×」，只有使用者按 × 才移除
function rememberReport(rec) {
  try {
    chrome.storage.local.get({ reportHistory: [] }, function (items) {
      var list = Array.isArray(items.reportHistory) ? items.reportHistory : [];
      if (!list.some(function (r) { return r && r.url === rec.url; })) list.push(rec);
      chrome.storage.local.set({ reportHistory: list });
    });
  } catch (e) {}
}

$("form").addEventListener("submit", function (ev) {
  ev.preventDefault();
  var desc = $("desc").value.trim();
  if (!desc) { $("descErr").textContent = t("reportDescRequired"); $("desc").focus(); return; }
  var contact = $("contact").value.trim();
  if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) { $("contactErr").textContent = t("reportContactInvalid"); $("contact").focus(); return; }
  var btn = $("submitBtn");
  btn.disabled = true;
  btn.textContent = ""; var sp = document.createElement("span"); sp.className = "spinner"; btn.appendChild(sp); btn.appendChild(document.createTextNode(t("reportSending")));
  var withDiag = includeDiag();
  // Firefox 140+：manifest 把資料收集權限宣告成 optional，第一次附診斷資料送出時在這裡（使用者手勢內）請求；
  // 已同意過就直接 resolve true 不再跳提示。Chrome 沒有 browser 全域、Safari 不認得 data_collection 會丟錯 → 都當作不需詢問。
  var askDc = Promise.resolve(true);
  if (withDiag && typeof browser !== "undefined" && browser.permissions && browser.permissions.request) {
    try {
      askDc = browser.permissions.request({ data_collection: ["personallyIdentifyingInfo", "locationInfo", "websiteActivity"] })
        .catch(function () { return true; });
    } catch (e) { askDc = Promise.resolve(true); }
  }
  askDc.then(function (granted) {
    if (granted === false) {
      btn.disabled = false; btn.textContent = t("reportSubmit");
      $("formErr").textContent = t("reportErrPermission");
      return;
    }
    doSend();
  });

  function doSend() {
    var body = {
      v: 1, type: curType, description: desc, contact: $("contact").value.trim() || null, lang: uiLanguage(), includeDiag: withDiag,
      summary: (diag && diag.summary) || {}, diagText: withDiag && diag ? diag.text : "", clientTime: Date.now()
    };
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
    fetch(REPORT_ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain", "X-BCS-Token": REPORT_TOKEN }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        clearTimeout(timer);
        var j = res.j || {};
        if (!j.ok) throw new Error(j.error || ("http-" + res.status));
        if (j.issueUrl) {
          rememberReport({ n: j.issueNumber, url: j.issueUrl, t: Date.now(), type: curType });
          var doneText = t("reportDoneIssue").replace("{n}", String(j.issueNumber));
          if (j.emailed) doneText += "\n" + t("reportDoneEmailed").replace("{email}", $("contact").value.trim());
          showResult(true, t("reportDoneTitle"), doneText, j.issueUrl, false);
        }
        else showResult(true, t("reportDoneTitle"), t("reportDoneNoIssue") + (j.id ? "  (" + j.id + ")" : ""), null, false);
      })
      .catch(function (e) {
        clearTimeout(timer);
        var code = (e && e.message) || "";
        if (!code || /Failed to fetch|NetworkError|aborted|network/i.test(code)) code = "network";
        $("form").style.display = "none";
        showResult(false, t("reportFailTitle") + "：" + errText(code), t("reportFailHint"), ISSUES_URL, true);
      });
  }
});

// Test seam: only the unit-test harness (test/helpers/load.mjs) defines __BCS_TEST__.
if (globalThis.__BCS_TEST__ && typeof globalThis.__BCS_TEST__.register === "function") {
  globalThis.__BCS_TEST__.register("report", {
    detectPattern: detectPattern, buildDiag: buildDiag, zoneInfo: zoneInfo, newestSnapshot: newestSnapshot, kv: kv, fmtDetail: fmtDetail, spdText: spdText,
    detectBrowser: detectBrowser, errText: errText, includeDiag: includeDiag, diag: function () { return diag; }
  });
}
