/*
 * B 站 CDN 线路 —— ISOLATED world 桥接脚本
 *
 * 职责：
 *  1) 读取 chrome.storage.local 设定，写进同源 localStorage（供 MAIN 同步读取），
 *     并用 postMessage 推给 MAIN world。
 *  2) 监听 chrome.storage 变更 → 即时同步给 MAIN。
 *  3) 收集 MAIN 回报的 debug 快照，回应 popup 的查询。
 */
(function () {
  "use strict";
  var CFG_KEY = "__CDN_SWITCHER_CFG__";
  var DEFAULTS = {
    enabled: true,
    cdnHost: "upos-sz-mirror08ct.bilivideo.com",
    autoFallback: true,
    showDebug: false,
    videoEnabled: true,
    liveEnabled: true,
    liveRoute: "ov",
    autoSpeedSwitch: false,
    autoSpeedHosts: [],
    autoTestPending: false,
    stVideoMb: 8,
    stVideoSec: 5
  };

  var latestDebug = null;

  var latestAutoTest = null; // 切换国家后自动测速的进度（autotest-start/progress/end）
  var speedTest = { running: false, results: [], total: 0, error: null, title: "", qn: "", avail: null };

  function pushConfig(cfg) {
    try { window.localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
    try { window.postMessage({ __cdnSwitcher: 1, dir: "config", payload: cfg }, "*"); } catch (e) {}
  }

  function loadAndPush() {
    try {
      chrome.storage.local.get(DEFAULTS, function (items) {
        var cfg = {};
        for (var k in DEFAULTS) cfg[k] = items[k] === undefined ? DEFAULTS[k] : items[k];
        pushConfig(cfg);
      });
    } catch (e) {}
  }

  // MAIN world 拿不到 chrome.i18n（页面 context 无扩充 API），toast / debug 叠层要用的
  // 语系文案由这里（ISOLATED world）代查後推过去，作法与 cfg 相同（localStorage + postMessage）。
  // 开局推一次；使用者在 popup 切换语言（uiMsgs 变更）时会再推一次。
  var MSGS_KEY = "__CDN_SWITCHER_MSGS__";
  var MSG_KEYS = [
    "mhToastAutoSwitched", "mhToastAllFailed", "mhToastReloadBackup", "mhToastClose",
    "mhCdnTargetOriginal", "mhCdnTargetBackup", "mhToastLiveFallback", "mhToastSwitched",
    "liveRouteOv", "liveRouteOvB", "liveRouteCn", "liveRouteCnB"
  ];
  // 使用者在 popup 進階設定選了語言時，popup 會把該語系的整份文案存在 storage 的 uiMsgs，優先用它
  function localMsg(uiMsgs, k) { return (uiMsgs && uiMsgs[k]) || chrome.i18n.getMessage(k); }
  function pushMessages() {
    function push(uiMsgs) {
      var msgs = {};
      try { MSG_KEYS.forEach(function (k) { msgs[k] = localMsg(uiMsgs, k); }); } catch (e) {}
      try { window.localStorage.setItem(MSGS_KEY, JSON.stringify(msgs)); } catch (e) {}
      try { window.postMessage({ __cdnSwitcher: 1, dir: "messages", payload: msgs }, "*"); } catch (e) {}
    }
    try { chrome.storage.local.get({ uiMsgs: null }, function (items) { push(items.uiMsgs); }); } catch (e) { push(null); }
  }

  // 启动即同步一次
  loadAndPush();
  pushMessages();

  // 測速工具（CDNSpeedTest.exe）測完後會用瀏覽器開 https://www.bilibili.com/#cdnsw-import=1.<host>,<host>…，
  // 這裡把節點交給 background 接到「自訂節點列表」後面（background 只收 cdn-list.json 裡有的節點），
  // 拿掉網址上的 hash 免得重新整理又匯入一次，再在頁面上提示結果
  var IMPORT_RE = /^#cdnsw-import=1\.([a-z0-9.,-]+)$/i;
  function importFromHash() {
    if (window.top !== window) return;
    var m = IMPORT_RE.exec(location.hash || "");
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    var hosts = m[1].toLowerCase().split(",").filter(Boolean).slice(0, 50);
    try {
      chrome.runtime.sendMessage({ type: "CDN_SWITCHER_IMPORT_CUSTOM", hosts: hosts }, function (r) {
        void chrome.runtime.lastError;
        var key = !r || !r.ok ? "importToastFail" : r.added ? "importToastOk" : "importToastNone";
        try {
          chrome.storage.local.get({ uiMsgs: null }, function (items) {
            showImportToast(localMsg(items.uiMsgs, key).replace("{n}", r && r.added));
          });
        } catch (e) {}
      });
    } catch (e) {}
  }
  function showImportToast(text) {
    function show() {
      var el = document.createElement("div");
      el.textContent = text;
      el.style.cssText = "position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:2147483647;" +
        "max-width:min(560px,90vw);padding:14px 20px;border-radius:10px;background:#00AEEC;color:#fff;" +
        "font:600 15px/1.5 -apple-system,'Segoe UI','Microsoft JhengHei',sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer";
      el.addEventListener("click", function () { el.remove(); });
      document.documentElement.appendChild(el);
      setTimeout(function () { el.remove(); }, 15000);
    }
    if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  }
  importFromHash();

  // chrome.storage 变更 → 重新推送
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local") return;
      loadAndPush();
      if (changes.uiMsgs) pushMessages();
    });
  } catch (e) {}

  // 收 MAIN 的 debug 回报（自动回退是 MAIN world 内部的静默行为，不写回 storage）
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__cdnSwitcher !== 1) return;
    if (d.dir === "debug") { latestDebug = d.payload || null; return; }
    // 切换国家后的自动测速（main-hook 的 reason "country"）：进度给 popup 显示「优化中」；
    // 一开始就把旗标清掉，之后不论结果都不再测
    if (d.dir === "autotest-start" && d.payload) {
      latestAutoTest = { running: true, reason: d.payload.reason || "", total: d.payload.total || 0, done: 0 };
      if (d.payload.reason === "country") { try { chrome.storage.local.set({ autoTestPending: false }); } catch (e) {} }
      return;
    }
    if (d.dir === "autotest-progress" && d.payload) { if (latestAutoTest) latestAutoTest.done = d.payload.done || 0; return; }
    if (d.dir === "autotest-end") { if (latestAutoTest) latestAutoTest.running = false; return; }
    if (d.dir === "speedtest-meta" && d.payload) {
      speedTest.title = d.payload.title || "";
      speedTest.qn = d.payload.qn || "";
      return;
    }
    if (d.dir === "speedtest-avail" && d.payload) { speedTest.avail = d.payload.avail || null; return; }
    if (d.dir === "speedtest-progress" && d.payload) {
      // 直播测速一条线路会分几次回报（起播 → 持续），以 route 合并成同一笔；点播测速没有 route，照旧依序追加
      var idx = -1;
      if (d.payload.route) for (var i = 0; i < speedTest.results.length; i++) if (speedTest.results[i].route === d.payload.route) { idx = i; break; }
      if (idx >= 0) { for (var k in d.payload) speedTest.results[idx][k] = d.payload[k]; }
      else speedTest.results.push(d.payload);
      return;
    }
    // 自动测速测完：把最快的节点存成使用者选的节点（storage 变更会再推回 MAIN，由它做播放器内重载）。
    // 存之前再确认一次设定：期间使用者关掉了选项、或自己换了节点（cdnHost 已不是开测时的 from），就不覆盖。
    // 切换国家后的那一次（reason "country"）不看「影片自动测速」开关
    if (d.dir === "autotest-done" && d.payload && d.payload.host) {
      var p = d.payload;
      try {
        chrome.storage.local.get({ autoSpeedSwitch: false, cdnHost: DEFAULTS.cdnHost }, function (items) {
          if (items.cdnHost !== p.from) return;
          if (p.reason !== "country" && !items.autoSpeedSwitch) return;
          chrome.storage.local.set({ cdnHost: p.host, videoEnabled: true });
        });
      } catch (e) {}
      return;
    }
    if (d.dir === "speedtest-done") {
      speedTest.running = false;
      speedTest.error = (d.payload && d.payload.error) || null;
      return;
    }
  });

  // popup 的查询 / 测速指令只由最上层 frame 回应：iPad Safari 送讯息时不能指定 frameId: 0（见 popup.js 的 sendToTop），
  // 会送到所有 frame，iframe 里的 bridge 不能抢着回应
  var isTopFrame = window.top === window;

  // 回应 popup 查询 / 测速指令
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!isTopFrame) return;
      if (msg && msg.type === "CDN_SWITCHER_GET_DEBUG") {
        // 顺便通知 MAIN：popup 开着了，直播间可以开始探测各线路是否存在（懒探测，见 main-hook.js）
        try { window.postMessage({ __cdnSwitcher: 1, dir: "debug-poll" }, "*"); } catch (e) {}
        sendResponse({ debug: latestDebug, autoTest: latestAutoTest });
        return true;
      }
      if (msg && msg.type === "CDN_SWITCHER_RUN_SPEEDTEST") {
        // 一律直接开新一轮：MAIN world 若前一轮还在跑，runSpeedTest 自己会中断旧的再开始
        // （用 generation 计数器隔开新旧两轮的 continuation，见 main-hook.js）
        var hosts = Array.isArray(msg.hosts) ? msg.hosts : [];
        speedTest = { running: true, results: [], total: hosts.length, error: null, title: speedTest.title, qn: speedTest.qn, avail: null };
        try { window.postMessage({ __cdnSwitcher: 1, dir: "speedtest-run", payload: { hosts: hosts, limits: msg.limits || null } }, "*"); } catch (e) {}
        sendResponse({ ok: true });
        return true;
      }
      if (msg && msg.type === "CDN_SWITCHER_RUN_LIVE_SPEEDTEST") {
        speedTest = { running: true, results: [], total: 4, error: null, title: speedTest.title, qn: speedTest.qn, avail: null };
        try { window.postMessage({ __cdnSwitcher: 1, dir: "livetest-run", payload: { limits: msg.limits || null } }, "*"); } catch (e) {}
        sendResponse({ ok: true });
        return true;
      }
      if (msg && msg.type === "CDN_SWITCHER_STOP_AUTOTEST") {
        try { window.postMessage({ __cdnSwitcher: 1, dir: "autotest-stop" }, "*"); } catch (e) {}
        sendResponse({ ok: true });
        return true;
      }
      if (msg && msg.type === "CDN_SWITCHER_STOP_SPEEDTEST") {
        speedTest.running = false;
        try { window.postMessage({ __cdnSwitcher: 1, dir: "speedtest-stop" }, "*"); } catch (e) {}
        sendResponse({ ok: true });
        return true;
      }
      if (msg && msg.type === "CDN_SWITCHER_GET_SPEEDTEST") {
        sendResponse({ speedTest: speedTest });
        return true;
      }
    });
  } catch (e) {}

  // popup 开一条 "cdn-switcher-speedtest" 长连线来标记「测速页开着」；不论是按返回主动断线、
  // 还是直接关掉 popup（浏览器自动断线），content script 都会收到 onDisconnect → 立刻中止测速
  try {
    chrome.runtime.onConnect.addListener(function (port) {
      if (!isTopFrame || !port || port.name !== "cdn-switcher-speedtest") return;
      port.onDisconnect.addListener(function () {
        speedTest.running = false;
        try { window.postMessage({ __cdnSwitcher: 1, dir: "speedtest-stop" }, "*"); } catch (e) {}
      });
    });
  } catch (e) {}
})();
