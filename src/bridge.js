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
  var CFG_KEY = "__ROGER_CDN_CFG__";
  var DEFAULTS = {
    enabled: true,
    cdnHost: "cn-jxnc-cmcc-bcache-06.bilivideo.com",
    showDebug: false
  };

  var latestDebug = null;
  var speedTest = { running: false, results: [], total: 0, error: null, title: "", qn: "" };

  function pushConfig(cfg) {
    try { window.localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
    try { window.postMessage({ __rogerCdn: 1, dir: "config", payload: cfg }, "*"); } catch (e) {}
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

  // 启动即同步一次
  loadAndPush();

  // chrome.storage 变更 → 重新推送
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local") return;
      loadAndPush();
    });
  } catch (e) {}

  // 收 MAIN 的 debug 回报 / 自动回退通知
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__rogerCdn !== 1) return;
    if (d.dir === "debug") { latestDebug = d.payload || null; return; }
    if (d.dir === "auto-fallback" && d.payload) {
      // MAIN world 侦测到目前 CDN 播不动、已自行切换节点，这里同步写回 storage
      // 让 popup 显示最新选择、并在下次载入时沿用
      try { chrome.storage.local.set({ cdnHost: d.payload.cdnHost }); } catch (e) {}
      return;
    }
    if (d.dir === "speedtest-meta" && d.payload) {
      speedTest.title = d.payload.title || "";
      speedTest.qn = d.payload.qn || "";
      return;
    }
    if (d.dir === "speedtest-progress" && d.payload) { speedTest.results.push(d.payload); return; }
    if (d.dir === "speedtest-done") {
      speedTest.running = false;
      speedTest.error = (d.payload && d.payload.error) || null;
      return;
    }
  });

  // 回应 popup 查询 / 测速指令
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === "ROGER_GET_DEBUG") {
        sendResponse({ debug: latestDebug });
        return true;
      }
      if (msg && msg.type === "ROGER_RUN_SPEEDTEST") {
        // 一律直接开新一轮：MAIN world 若前一轮还在跑，runSpeedTest 自己会中断旧的再开始
        // （用 generation 计数器隔开新旧两轮的 continuation，见 main-hook.js）
        var hosts = Array.isArray(msg.hosts) ? msg.hosts : [];
        speedTest = { running: true, results: [], total: hosts.length, error: null, title: "", qn: "" };
        try { window.postMessage({ __rogerCdn: 1, dir: "speedtest-run", payload: { hosts: hosts } }, "*"); } catch (e) {}
        sendResponse({ ok: true });
        return true;
      }
      if (msg && msg.type === "ROGER_GET_SPEEDTEST") {
        sendResponse({ speedTest: speedTest });
        return true;
      }
    });
  } catch (e) {}

  // popup 开一条 "roger-speedtest" 长连线来标记「测速页开着」；不论是按返回主动断线、
  // 还是直接关掉 popup（浏览器自动断线），content script 都会收到 onDisconnect → 立刻中止测速
  try {
    chrome.runtime.onConnect.addListener(function (port) {
      if (!port || port.name !== "roger-speedtest") return;
      port.onDisconnect.addListener(function () {
        speedTest.running = false;
        try { window.postMessage({ __rogerCdn: 1, dir: "speedtest-stop" }, "*"); } catch (e) {}
      });
    });
  } catch (e) {}
})();
