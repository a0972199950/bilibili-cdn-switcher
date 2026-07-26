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
    showDebug: true
  };

  var latestDebug = null;

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

  // 收 MAIN 的 debug 回报
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__rogerCdn !== 1 || d.dir !== "debug") return;
    latestDebug = d.payload || null;
  });

  // 回应 popup 查询
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === "ROGER_GET_DEBUG") {
        sendResponse({ debug: latestDebug });
        return true;
      }
    });
  } catch (e) {}
})();
