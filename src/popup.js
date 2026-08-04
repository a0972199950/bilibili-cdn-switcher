"use strict";

var DEFAULTS = {
  enabled: true,
  cdnHost: "cn-jxnc-cmcc-bcache-06.bilivideo.com",
  showDebug: false
};

var els = {
  enabled: document.getElementById("enabled"),
  modeList: document.getElementById("modeList"),
  modeCustom: document.getElementById("modeCustom"),
  cdnHost: document.getElementById("cdnHost"),
  customHost: document.getElementById("customHost"),
  customHint: document.getElementById("customHint"),
  showDebug: document.getElementById("showDebug"),
  debug: document.getElementById("debug"),
  mainView: document.getElementById("mainView"),
  speedtestView: document.getElementById("speedtestView"),
  speedtestBtn: document.getElementById("speedtestBtn"),
  stBackBtn: document.getElementById("stBackBtn"),
  stRetestBtn: document.getElementById("stRetestBtn"),
  stMeta: document.getElementById("stMeta"),
  stList: document.getElementById("stList")
};

// -------- i18n：套用 chrome.i18n 訊息到靜態文字節點 --------
function t(key) { return chrome.i18n.getMessage(key) || key; }
document.title = t("popupTitle");
document.documentElement.lang = chrome.i18n.getUILanguage();
[
  ["headerTitle", "headerTitle"], ["enabledLabel", "enabledLabel"], ["cdnHostRowLabel", "cdnHostRowLabel"],
  ["modeListLabel", "modeListLabel"], ["modeCustomLabel", "modeCustomLabel"], ["speedtestBtn", "speedtestBtnLabel"],
  ["showDebugLabel", "showDebugLabel"], ["debugSectionLabel", "debugSectionLabel"], ["stBackBtn", "stBackBtn"],
  ["stHeaderTitle", "stHeaderTitle"], ["stRetestBtn", "stRetestBtn"], ["stHintLeave", "stHintLeave"]
].forEach(function (pair) { document.getElementById(pair[0]).textContent = t(pair[1]); });
document.getElementById("stHintBandwidth").innerHTML = t("stHintBandwidth");
els.customHost.placeholder = t("customHostPlaceholder");
els.debug.textContent = t("debugInitial");

var knownValues = {}; // 清单中所有 value（用来判断储存值是否在清单内，不在的话视为自行输入）
var cdnList = []; // cdn-list.json 的 options，供测速时取节点清单与显示用的名称

// 具名节点：技术代号 + noteKey 註記；特殊选项（base/backup）用 nameKey + noteKey
function cdnDisplayName(o) {
  var name = o.nameKey ? t(o.nameKey) : o.name;
  var note = o.noteKey ? t(o.noteKey) : (o.note || "");
  return name + (note ? " (" + note + ")" : "");
}
// 标签：具名节点显示 domain；特殊选项只显示名称
function optLabel(o) {
  var base = cdnDisplayName(o);
  var isHost = o.value && o.value !== "base" && o.value !== "backup";
  return isHost ? base + " — " + o.value : base;
}

// 把使用者输入正规化成 host（去掉 http://、路径等）；无效回 ""
function normHost(s) {
  s = (s || "").trim();
  if (!s) return "";
  try { if (/^https?:\/\//i.test(s)) return new URL(s).host.toLowerCase(); } catch (e) {}
  s = s.replace(/^\/+/, "").split("/")[0].split("?")[0].split("#")[0].toLowerCase();
  return (/^[a-z0-9.-]+(:\d+)?$/.test(s) && s.indexOf(".") >= 0) ? s : "";
}

function buildOptions(options, current) {
  els.cdnHost.innerHTML = "";
  options.forEach(function (o) {
    knownValues[o.value] = true;
    var op = document.createElement("option");
    op.value = o.value;
    op.textContent = optLabel(o);
    els.cdnHost.appendChild(op);
  });
  // 还原目前选择：储存值在清单内 → 清单模式；不在 → 视为自行输入的 host
  if (current && knownValues[current]) {
    els.modeList.checked = true;
    els.cdnHost.value = current;
  } else {
    els.modeCustom.checked = true;
    els.cdnHost.value = DEFAULTS.cdnHost; // 保底，切回清单模式时有值可用
    els.customHost.value = current || "";
  }
  syncModeUI();
}

// 依目前是「清单选择」还是「自行输入」互斥显示对应的输入元件
function syncModeUI() {
  var isCustom = els.modeCustom.checked;
  els.cdnHost.style.display = isCustom ? "none" : "block";
  els.customHost.style.display = isCustom ? "block" : "none";
  els.customHint.style.display = isCustom ? "block" : "none";
}

function save(patch) { chrome.storage.local.set(patch); }

// 读清单 + 目前设定 → 建立下拉
Promise.all([
  fetch(chrome.runtime.getURL("cdn-list.json")).then(function (r) { return r.json(); }).catch(function () { return { options: [] }; }),
  new Promise(function (res) { chrome.storage.local.get(DEFAULTS, res); })
]).then(function (arr) {
  var list = (arr[0] && arr[0].options) || [];
  cdnList = list;
  var cfg = {};
  for (var k in DEFAULTS) cfg[k] = arr[1][k] === undefined ? DEFAULTS[k] : arr[1][k];
  els.enabled.checked = !!cfg.enabled;
  els.showDebug.checked = !!cfg.showDebug;
  buildOptions(list, cfg.cdnHost);
});

els.enabled.addEventListener("change", function () { save({ enabled: els.enabled.checked }); });
els.showDebug.addEventListener("change", function () { save({ showDebug: els.showDebug.checked }); });

els.modeList.addEventListener("change", function () {
  if (!els.modeList.checked) return;
  syncModeUI();
  save({ cdnHost: els.cdnHost.value || DEFAULTS.cdnHost });
});
els.modeCustom.addEventListener("change", function () {
  if (!els.modeCustom.checked) return;
  syncModeUI();
  var h = normHost(els.customHost.value);
  if (h) { save({ cdnHost: h }); markCustom(true); }
  else { els.customHost.focus(); markCustom(false); }
});

els.cdnHost.addEventListener("change", function () { save({ cdnHost: els.cdnHost.value }); });

// 自订输入：即时正规化并储存
function markCustom(ok) {
  els.customHint.textContent = ok ? t("customHintDefault") : t("customHintInvalid");
  els.customHint.style.color = ok ? "#888" : "#e00";
}
els.customHost.addEventListener("input", function () {
  var h = normHost(els.customHost.value);
  if (h) { save({ cdnHost: h }); markCustom(true); }
  else { markCustom(false); }
});

// -------- Debug 读取 --------
function esc(s) {
  return String(s == null ? "-" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; });
}
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
function spdText(bps, idle) {
  if (!bps) return "-";
  var s = bps >= 1048576 ? (bps / 1048576).toFixed(1) + " MB/s" : Math.round(bps / 1024) + " kB/s";
  return idle ? s + " (idle)" : s;
}
function renderDebug(d) {
  if (!d) { els.debug.textContent = t("debugNoDataAfterOpen"); return; }
  var lines = [
    "mode=" + (d.enabled ? "on" : "off") + "  target=" + esc(d.cdnTarget)
  ];
  if (d.autoHost) lines.push("auto-fallback -> " + esc(d.autoHost));
  var cdnLineIdx = lines.length; // "cdn=" 这行的高亮不能写死 index：前面可能多插了 auto-fallback 那行
  lines.push(
    "cdn=" + esc(d.currentCdn),
    "v=" + esc(d.pickVideoHost) + "  a=" + esc(d.pickAudioHost),
    "src=" + esc(d.lastSource) + "  rw=" + esc(d.rewriteCount) + "  seg=" + esc(d.segRewriteCount) + "  qn=" + esc(qnText(d.lastQn)) + "  spd=" + esc(spdText(d.speedBps, d.speedIdle))
  );
  if (d.lastError) lines.push("err=" + esc(d.lastError));
  els.debug.innerHTML = lines.map(function (l, i) { return i === cdnLineIdx ? '<span class="cdnnow">' + l + "</span>" : l; }).join("\n");
}
// 都固定打「顶层 frame」（frameId: 0）：content script 是 all_frames 注入，若不锁定 frame，
// Chrome 会把讯息广播给分页内所有 frame、取最先回应的那个 —— 万一先回应的是没有播放器的
// iframe（广告/元件），debug 会拿不到资料、测速甚至会卡在该 iframe 的残留状态而一直报错。
var TOP_FRAME = { frameId: 0 };

function pollDebug() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "ROGER_GET_DEBUG" }, TOP_FRAME, function (resp) {
      if (chrome.runtime.lastError) { renderDebug(null); return; }
      renderDebug(resp && resp.debug);
    });
  });
}
pollDebug();

// -------- 手动测速：切到独立页面，逐节点显示等待中/测试中/结果；离开页面就中止 --------
var SPEEDTEST_ERR_KEYS = {
  "no-data": "errNoData", "no-stream": "errNoStream", "timeout": "errTimeout",
  "network-error": "errNetworkError", "read-error": "errReadError", "no-sample": "errNoSample"
};
function speedtestErrText(err) { var k = SPEEDTEST_ERR_KEYS[err]; return k ? t(k) : err; }

var speedtestHosts = []; // 本次送出测试的 host 顺序，index 对应 speedTest.results 的顺序
var speedtestTabId = null;
var speedtestPort = null; // 只用来让 content script 侦测「离开测速页 / popup 关闭」→ 立即中止

function speedtestHostList() {
  return cdnList.filter(function (o) { return o.value && o.value !== "base" && o.value !== "backup"; });
}

function renderSpeedtestMeta(st) {
  if (!st || !st.title) { els.stMeta.innerHTML = ""; return; }
  els.stMeta.innerHTML = '<span class="stTitle">' + esc(st.title) + "</span>" +
    (st.qn ? '<span class="stQn">' + esc(st.qn) + "</span>" : "");
}

function renderSpeedtest(st) {
  if (!st) return;
  renderSpeedtestMeta(st);
  if (st.error === "no-sample") {
    els.stList.textContent = t("speedtestNoSampleHint");
    return;
  }
  var bestHost = null, bestBps = 0;
  st.results.forEach(function (r) { if (!r.error && r.bps > bestBps) { bestBps = r.bps; bestHost = r.host; } });

  els.stList.innerHTML = speedtestHosts.map(function (host, i) {
    var o = null;
    for (var j = 0; j < cdnList.length; j++) if (cdnList[j].value === host) { o = cdnList[j]; break; }
    var label = o ? cdnDisplayName(o) : host;
    var r = st.results[i];
    var text, cls = "stRow";
    if (r) {
      text = r.error ? t("speedtestFailedTemplate").replace("{err}", speedtestErrText(r.error)) : spdText(r.bps, false);
      cls += r.error ? " stErr" : (r.host === bestHost ? " stBest" : "");
    } else if (st.running && i === st.results.length) {
      text = t("speedtestStatusTesting"); cls += " stTesting";
    } else if (!st.running) {
      text = t("speedtestStatusCanceled");
    } else {
      text = t("speedtestStatusWaiting");
    }
    return '<div class="' + cls + '"><span>' + esc(label) + "</span><span class=\"stSpeed\">" + esc(text) + "</span></div>";
  }).join("");
}

function pollSpeedtest() {
  if (speedtestTabId == null) return;
  chrome.tabs.sendMessage(speedtestTabId, { type: "ROGER_GET_SPEEDTEST" }, TOP_FRAME, function (resp) {
    if (chrome.runtime.lastError) return;
    var st = resp && resp.speedTest;
    if (!st) return;
    renderSpeedtest(st);
  });
}

function showSpeedtestView(tabId) {
  speedtestTabId = tabId;
  els.mainView.style.display = "none";
  els.speedtestView.style.display = "block";
  // 开一个长连线：popup 关闭或按返回时会自动/主动断线，content script 收到 onDisconnect 就中止测速
  try { speedtestPort = chrome.tabs.connect(tabId, { name: "roger-speedtest", frameId: 0 }); } catch (e) { speedtestPort = null; }
}

function showMainView() {
  els.speedtestView.style.display = "none";
  els.mainView.style.display = "block";
  if (speedtestPort) { try { speedtestPort.disconnect(); } catch (e) {} speedtestPort = null; }
  speedtestTabId = null;
  speedtestHosts = [];
}

function startSpeedtest(tabId) {
  els.stList.innerHTML = "";
  els.stMeta.innerHTML = "";
  chrome.tabs.sendMessage(tabId, { type: "ROGER_RUN_SPEEDTEST", hosts: speedtestHosts }, TOP_FRAME, function (resp) {
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      els.stList.textContent = t("speedtestCannotStart");
    }
  });
}

els.speedtestBtn.addEventListener("click", function () {
  speedtestHosts = speedtestHostList().map(function (o) { return o.value; });
  if (!speedtestHosts.length) return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    var tabId = tabs[0].id;
    showSpeedtestView(tabId);
    startSpeedtest(tabId);
  });
});

els.stBackBtn.addEventListener("click", showMainView);

els.stRetestBtn.addEventListener("click", function () {
  // 测速中也能按：main-hook.js 的 runSpeedTest 会自己中断上一轮、直接开新的
  if (speedtestTabId == null) return;
  startSpeedtest(speedtestTabId);
});

setInterval(function () { pollDebug(); pollSpeedtest(); }, 1000);
