"use strict";

var DEFAULTS = {
  enabled: true,
  cdnHost: "cn-jxnc-cmcc-bcache-06.bilivideo.com",
  showDebug: true
};

var CUSTOM = "__custom__";

var els = {
  enabled: document.getElementById("enabled"),
  cdnHost: document.getElementById("cdnHost"),
  customHost: document.getElementById("customHost"),
  customHint: document.getElementById("customHint"),
  showDebug: document.getElementById("showDebug"),
  debug: document.getElementById("debug")
};

var knownValues = {}; // 清单中所有非自订的 value（用来判断储存值是否为自订 host）

// 标签：具名节点显示 domain；特殊/自订只显示名称
function optLabel(o) {
  var base = o.name + (o.note ? "（" + o.note + "）" : "");
  var isHost = o.value && o.value !== "base" && o.value !== "backup" && o.value !== CUSTOM;
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
    if (o.value !== CUSTOM) knownValues[o.value] = true;
    var op = document.createElement("option");
    op.value = o.value;
    op.textContent = optLabel(o);
    els.cdnHost.appendChild(op);
  });
  // 还原目前选择
  if (current && !knownValues[current] && current !== "base" && current !== "backup") {
    // 储存值不在清单 → 视为自订 host
    els.cdnHost.value = CUSTOM;
    els.customHost.value = current;
  } else {
    els.cdnHost.value = current;
    if (!els.cdnHost.value) els.cdnHost.value = DEFAULTS.cdnHost;
  }
  syncCustomUI();
}

// 依目前下拉是否为「自订」显示/隐藏输入框
function syncCustomUI() {
  var isCustom = els.cdnHost.value === CUSTOM;
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
  var cfg = {};
  for (var k in DEFAULTS) cfg[k] = arr[1][k] === undefined ? DEFAULTS[k] : arr[1][k];
  els.enabled.checked = !!cfg.enabled;
  els.showDebug.checked = !!cfg.showDebug;
  buildOptions(list, cfg.cdnHost);
});

els.enabled.addEventListener("change", function () { save({ enabled: els.enabled.checked }); });
els.showDebug.addEventListener("change", function () { save({ showDebug: els.showDebug.checked }); });

els.cdnHost.addEventListener("change", function () {
  syncCustomUI();
  if (els.cdnHost.value === CUSTOM) {
    // 切到自订：若输入框已有有效 host 就存，否则等待输入
    var h = normHost(els.customHost.value);
    if (h) { save({ cdnHost: h }); markCustom(true); }
    else { els.customHost.focus(); markCustom(false); }
  } else {
    save({ cdnHost: els.cdnHost.value });
  }
});

// 自订输入：即时正规化并储存
function markCustom(ok) {
  els.customHint.textContent = ok ? "只填 host（网域），不含 http:// 与路径。"
    : "请输入有效的 host（含网域，如 xxx.bilivideo.com）。";
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
function renderDebug(d) {
  if (!d) { els.debug.textContent = "尚未取得资料。请在 B 站影片页播放後再开此视窗。"; return; }
  var lines = [
    "mode=" + (d.enabled ? "on" : "off") + "  target=" + esc(d.cdnTarget),
    "cdn=" + esc(d.currentCdn),
    "v=" + esc(d.pickVideoHost) + "  a=" + esc(d.pickAudioHost),
    "src=" + esc(d.lastSource) + "  rw=" + esc(d.rewriteCount) + "  seg=" + esc(d.segRewriteCount) + "  qn=" + esc(d.lastQn)
  ];
  if (d.lastError) lines.push("err=" + esc(d.lastError));
  els.debug.innerHTML = lines.map(function (l, i) { return i === 1 ? '<span class="cdnnow">' + l + "</span>" : l; }).join("\n");
}
function pollDebug() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "ROGER_GET_DEBUG" }, function (resp) {
      if (chrome.runtime.lastError) { renderDebug(null); return; }
      renderDebug(resp && resp.debug);
    });
  });
}
pollDebug();
setInterval(pollDebug, 1000);
