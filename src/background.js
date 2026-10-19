/**
 * 背景腳本：
 *  1) 更新時補記「從哪個版本升上來」
 *  2) 收下測速工具（CDNSpeedTest.exe）推薦的節點，接到「自訂節點列表」後面（見 bridge.js 的匯入網址）
 *  3) 問題回報用的診斷日誌：收 bridge / popup 送來的事件、採樣與快照，單一寫入者序列化寫進 storage.session，
 *     回報頁（report.html）送出時讀取。關瀏覽器就清空；只保留最近 10 分鐘。
 *  4) popup 按「問題回報」時開獨立視窗顯示回報頁（沒有視窗 API 的環境退回新分頁）
 *
 * 1) 1.5.x 以前不會記錄 installedVersion，popup 沒辦法分辨「舊使用者剛更新」與「全新安裝」。
 * 瀏覽器在更新時會把 previousVersion 帶進 onInstalled，不用舊版配合，這裡把它補寫成 installedVersion，
 * popup 的 checkVersionUpdate() 就會把 (previousVersion, 目前版本] 之間的更新內容彈出來。
 * 全新安裝（reason = install）不處理，維持「新使用者不彈」。
 */
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === "install") chrome.storage.local.set({ installedAt: Date.now() });
  if (details.reason === "update") chrome.storage.local.set({ updatedAt: Date.now() });
  if (details.reason !== "update" || !details.previousVersion) return;
  chrome.storage.local.get("installedVersion", function (items) {
    // 已經有紀錄（1.6.0 起 popup 自己會寫）就不蓋掉；沒有才補上
    if (items && items.installedVersion) return;
    chrome.storage.local.set({ installedVersion: details.previousVersion });
  });
});

// 2) 匯入網址任何網站都能做出來，所以只收 cdn-list.json 裡有的節點（測速工具測的也就是這份），
//    別人沒辦法藉此把影片導到自己的網域。已經在列表裡的不重複加，新的依序接在後面
function importCustomHosts(hosts) {
  return fetch(chrome.runtime.getURL("cdn-list.json"))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var known = {};
      (data.options || []).forEach(function (o) { if (o.value !== "backup") known[o.value] = true; });
      return new Promise(function (resolve) {
        chrome.storage.local.get({ customHosts: [], cdnMode: null, cdnHost: null }, function (items) {
          var list = Array.isArray(items.customHosts) ? items.customHosts.slice() : [];
          var added = 0;
          (Array.isArray(hosts) ? hosts : []).forEach(function (h) {
            if (typeof h !== "string" || !known[h] || list.indexOf(h) >= 0) return;
            list.push(h);
            added++;
          });
          var patch = { customHosts: list };
          // 已經選了自訂節點列表、但列表原本是空的（還在用原本的節點）→ 直接改用列表第一個
          if (items.cdnMode === "custom" && list.length && list.indexOf(items.cdnHost) < 0) patch.cdnHost = list[0];
          chrome.storage.local.set(patch, function () {
            resolve({ ok: true, added: added, total: list.length });
          });
        });
      });
    })
    .catch(function (e) { return { ok: false, err: String(e) }; });
}

// 3) 診斷日誌（問題回報用）
//    storage.session 關瀏覽器就清空，隱私上剛好；舊版 Safari 沒有 session 就退回 local（一樣只留 10 分鐘）。
//    所有寫入都走這裡的 promise chain 序列化，避免 bridge / popup 同時 read-modify-write 互相蓋掉。
var DIAG_STORE = chrome.storage.session || chrome.storage.local;
var DIAG_KEEP_MS = 10 * 60 * 1000;
var JOURNAL_MAX = 200;
var SAMPLES_MAX = 60;
var MERGE_WINDOW_MS = 30000; // 同類連續事件（如 403 洪水）合併成一筆，免得把前面的紀錄洗掉
var diagChain = Promise.resolve();

function diagGet(keys) { return new Promise(function (res) { DIAG_STORE.get(keys, function (items) { res(items || {}); }); }); }
function diagSet(obj) { return new Promise(function (res) { DIAG_STORE.set(obj, function () { void chrome.runtime.lastError; res(); }); }); }
function pruneOld(list, now) { return (list || []).filter(function (e) { return e && now - (e.until || e.t) < DIAG_KEEP_MS; }); }

function appendJournal(entry) {
  diagChain = diagChain.then(function () {
    return diagGet({ journal: [] }).then(function (items) {
      var now = Date.now();
      var list = pruneOld(items.journal, now);
      var last = list[list.length - 1];
      var sig = JSON.stringify(entry.d || {});
      if (last && last.k === entry.k && last.tab === entry.tab && last.sig === sig && now - (last.until || last.t) < MERGE_WINDOW_MS) {
        last.n = (last.n || 1) + 1; last.until = entry.t;
      } else {
        entry.sig = sig;
        list.push(entry);
      }
      if (list.length > JOURNAL_MAX) list = list.slice(list.length - JOURNAL_MAX);
      return diagSet({ journal: list });
    });
  }).catch(function () {});
  return diagChain;
}
function appendSample(row) {
  diagChain = diagChain.then(function () {
    return diagGet({ samples: [] }).then(function (items) {
      var list = pruneOld(items.samples, Date.now());
      list.push(row);
      if (list.length > SAMPLES_MAX) list = list.slice(list.length - SAMPLES_MAX);
      return diagSet({ samples: list });
    });
  }).catch(function () {});
  return diagChain;
}
// 每個 B 站分頁最近一次的 debug 快照：回報時目前分頁不是 B 站，就拿「最近更新的那一份」
function putSnapshot(tabId, snap) {
  diagChain = diagChain.then(function () {
    return diagGet({ snaps: {} }).then(function (items) {
      var now = Date.now(), snaps = {};
      for (var k in items.snaps || {}) if (now - items.snaps[k].t < DIAG_KEEP_MS) snaps[k] = items.snaps[k];
      snaps[String(tabId)] = snap;
      return diagSet({ snaps: snaps });
    });
  }).catch(function () {});
  return diagChain;
}

// 4) 回報頁一律開成獨立視窗（popup 按「問題回報」時）；?tab= 是按下時的 B 站分頁，沒有就不帶
function openReportWindow(tabId) {
  openExtWindow(chrome.runtime.getURL("report.html") + (tabId != null ? "?tab=" + tabId : ""), 760, 720);
}
// 公告視窗（announcement.html）：popup 的跑馬燈點下去開，?id= 是點到的那則公告（只顯示那一則）
function openAnnouncementWindow(id) {
  openExtWindow(chrome.runtime.getURL("announcement.html") + (/^\d+$/.test(String(id)) ? "?id=" + id : ""), 560, 680);
}
function openExtWindow(url, width, height) {
  try {
    if (chrome.windows && chrome.windows.create) {
      chrome.windows.create({ url: url, type: "popup", width: width, height: height, focused: true }, function () {
        if (chrome.runtime.lastError) chrome.tabs.create({ url: url }); // Firefox Android 等沒有視窗的環境
      });
      return;
    }
  } catch (e) {}
  chrome.tabs.create({ url: url });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;
  var tabId = sender && sender.tab ? sender.tab.id : (msg.tab != null ? msg.tab : null);
  if (msg.type === "CDN_SWITCHER_IMPORT_CUSTOM") { importCustomHosts(msg.hosts).then(sendResponse); return true; }
  if (msg.type === "CDN_SWITCHER_JOURNAL" && msg.entry && typeof msg.entry.k === "string") {
    var e = { t: Number(msg.entry.t) || Date.now(), tab: tabId, k: msg.entry.k, d: msg.entry.d || {} };
    appendJournal(e).then(function () { sendResponse({ ok: true }); });
    return true;
  }
  if (msg.type === "CDN_SWITCHER_SAMPLE" && msg.row) {
    var row = msg.row; row.tab = tabId; row.t = Number(row.t) || Date.now();
    appendSample(row).then(function () { sendResponse({ ok: true }); });
    return true;
  }
  if (msg.type === "CDN_SWITCHER_SNAPSHOT" && msg.payload && tabId != null) {
    putSnapshot(tabId, { t: Date.now(), tab: tabId, url: msg.url || "", payload: msg.payload }).then(function () { sendResponse({ ok: true }); });
    return true;
  }
  if (msg.type === "CDN_SWITCHER_OPEN_ANNOUNCEMENT_WINDOW") { openAnnouncementWindow(msg.id); sendResponse({ ok: true }); return true; }
  if (msg.type === "CDN_SWITCHER_OPEN_REPORT_WINDOW") { openReportWindow(msg.tab != null ? msg.tab : tabId); sendResponse({ ok: true }); return true; }
});

// Test seam: only the unit-test harness (test/helpers/load.mjs) defines __BCS_TEST__.
if (globalThis.__BCS_TEST__ && typeof globalThis.__BCS_TEST__.register === "function") {
  globalThis.__BCS_TEST__.register("background", {
    importCustomHosts: importCustomHosts, appendJournal: appendJournal, appendSample: appendSample, putSnapshot: putSnapshot, pruneOld: pruneOld,
    JOURNAL_MAX: JOURNAL_MAX, SAMPLES_MAX: SAMPLES_MAX, MERGE_WINDOW_MS: MERGE_WINDOW_MS, DIAG_KEEP_MS: DIAG_KEEP_MS
  });
}
