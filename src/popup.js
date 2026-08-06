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
  cdnSelect: document.getElementById("cdnSelect"),
  cdnSelectTrigger: document.getElementById("cdnSelectTrigger"),
  cdnSelectName: document.getElementById("cdnSelectName"),
  cdnSelectHost: document.getElementById("cdnSelectHost"),
  cdnSelectList: document.getElementById("cdnSelectList"),
  customHost: document.getElementById("customHost"),
  customHint: document.getElementById("customHint"),
  showDebug: document.getElementById("showDebug"),
  debug: document.getElementById("debug"),
  mainView: document.getElementById("mainView"),
  speedtestView: document.getElementById("speedtestView"),
  speedtestBtn: document.getElementById("speedtestBtn"),
  rateBtn: document.getElementById("rateBtn"),
  feedbackBtn: document.getElementById("feedbackBtn"),
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
  ["rateBtn", "rateBtnLabel"], ["feedbackBtn", "feedbackBtnLabel"],
  ["showDebugLabel", "showDebugLabel"], ["debugSectionLabel", "debugSectionLabel"], ["stBackBtn", "stBackBtn"],
  ["stHeaderTitle", "stHeaderTitle"], ["stRetestBtn", "stRetestBtn"], ["stHintLeave", "stHintLeave"]
].forEach(function (pair) { document.getElementById(pair[0]).textContent = t(pair[1]); });
// 逐段解析 <b>…</b> 建 DOM 节点，避免用 innerHTML 塞入语系字串（addons-linter 会挡动态 innerHTML）
function setRichText(el, str) {
  el.textContent = "";
  var re = /<b>(.*?)<\/b>/g;
  var lastIndex = 0, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > lastIndex) el.appendChild(document.createTextNode(str.slice(lastIndex, m.index)));
    var b = document.createElement("b");
    b.textContent = m[1];
    el.appendChild(b);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < str.length) el.appendChild(document.createTextNode(str.slice(lastIndex)));
}
setRichText(document.getElementById("stHintBandwidth"), t("stHintBandwidth"));
els.customHost.placeholder = t("customHostPlaceholder");
els.debug.textContent = t("debugInitial");

// -------- 評分按鈕：Chrome / Edge 共用同一份 popup.js，只能靠 UA 分辨；Edge 尚未上架，沒有網址就不顯示 --------
// 意見回饋表單：依語言分開的 Google 表單連結。zh_CN / en 專用表單還沒建，先共用 zh_TW 那份頂著。
var FEEDBACK_FORM_URLS = {
  zh_TW: "https://forms.gle/HoSRGTyp3UEejave7",
  zh_CN: "https://forms.gle/HoSRGTyp3UEejave7", // TODO: 簡體中文表單好了再換
  en: "https://forms.gle/HoSRGTyp3UEejave7" // TODO: 英文表單好了再換
};
function pickFeedbackFormUrl() {
  var lang = (chrome.i18n.getUILanguage() || "").toLowerCase();
  if (lang.indexOf("zh") !== 0) return FEEDBACK_FORM_URLS.en;
  return lang.indexOf("cn") !== -1 ? FEEDBACK_FORM_URLS.zh_CN : FEEDBACK_FORM_URLS.zh_TW;
}
var STORE_REVIEW_URLS = {
  chrome: "https://chromewebstore.google.com/detail/twsg-%E8%A7%86%E9%A2%91%E5%8A%A0%E9%80%9F-for-bilibili-%E9%9D%9E%E5%AE%98/dfaddcffoondcendifiljhdbdagebgch/reviews",
  firefox: "https://addons.mozilla.org/zh-TW/firefox/addon/tw-sg-%E8%A7%86%E9%A2%91%E5%8A%A0%E9%80%9F-for-bilibili-%E9%9D%9E%E5%AE%98%E6%96%B9/reviews/"
  // edge: 尚未上架 Edge Add-ons，補上後再加
};
function detectBrowser() {
  var ua = navigator.userAgent;
  if (ua.indexOf("Firefox/") !== -1) return "firefox";
  if (ua.indexOf("Edg/") !== -1) return "edge";
  return "chrome";
}
function openTab(url) { try { chrome.tabs.create({ url: url }); } catch (e) { window.open(url, "_blank"); } }

var reviewUrl = STORE_REVIEW_URLS[detectBrowser()];
if (reviewUrl) {
  els.rateBtn.style.display = "";
  els.rateBtn.addEventListener("click", function () { openTab(reviewUrl); });
}
var feedbackUrl = pickFeedbackFormUrl();
if (feedbackUrl) {
  els.feedbackBtn.style.display = "";
  els.feedbackBtn.addEventListener("click", function () { openTab(feedbackUrl); });
}

var knownValues = {}; // 清单中所有 value（用来判断储存值是否在清单内，不在的话视为自行输入）
var cdnList = []; // cdn-list.json 的 options，供测速时取节点清单与显示用的名称
var currentCdnHost = null; // 目前生效的 cdnHost，供测速页标示「目前使用」＋点击切换比对

// 具名节点：技术代号 + noteKey 註記；特殊选项（base/backup）用 nameKey + noteKey
function cdnDisplayName(o) {
  var name = o.nameKey ? t(o.nameKey) : o.name;
  var note = o.noteKey ? t(o.noteKey) : (o.note || "");
  return name + (note ? " (" + note + ")" : "");
}

// -------- CDN 清单：自制下拉（原生 select 的 option 不能分两行、不能弱化网域字重，改用 div 清单模拟）--------
var cdnSelectValue = ""; // 目前下拉「显示/选取」的 value；跟 currentCdnHost 的差别：自订模式时这里仍保留一个清单内的保底值，方便切回清单模式

function findCdnOpt(value) {
  for (var i = 0; i < cdnList.length; i++) if (cdnList[i].value === value) return cdnList[i];
  return null;
}
function renderCdnSelectTrigger() {
  var o = findCdnOpt(cdnSelectValue);
  els.cdnSelectName.textContent = o ? cdnDisplayName(o) : cdnSelectValue;
  var isHost = !!o && o.value !== "base" && o.value !== "backup";
  els.cdnSelectHost.textContent = isHost ? o.value : "";
  els.cdnSelectHost.style.display = isHost ? "" : "none";
}
function closeCdnSelect() { els.cdnSelect.classList.remove("open"); }
function selectCdnValue(value) {
  cdnSelectValue = value;
  renderCdnSelectTrigger();
  var rows = els.cdnSelectList.children;
  for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("selected", rows[i].dataset.value === value);
}
function buildCdnSelectList(options) {
  els.cdnSelectList.textContent = "";
  options.forEach(function (o) {
    knownValues[o.value] = true;
    var isHost = o.value !== "base" && o.value !== "backup";
    var row = document.createElement("div");
    row.className = "cdnOptRow";
    row.dataset.value = o.value;
    var nameEl = document.createElement("span");
    nameEl.className = "cdnOptName";
    nameEl.textContent = cdnDisplayName(o);
    row.appendChild(nameEl);
    if (isHost) {
      var hostEl = document.createElement("span");
      hostEl.className = "cdnOptHost";
      hostEl.textContent = o.value;
      row.appendChild(hostEl);
    }
    row.addEventListener("click", function () {
      closeCdnSelect();
      if (o.value === cdnSelectValue) return;
      selectCdnValue(o.value);
      currentCdnHost = o.value;
      save({ cdnHost: o.value });
    });
    els.cdnSelectList.appendChild(row);
  });
}
els.cdnSelectTrigger.addEventListener("click", function (ev) {
  ev.stopPropagation();
  els.cdnSelect.classList.toggle("open");
});
document.addEventListener("click", function (ev) {
  if (!els.cdnSelect.contains(ev.target)) closeCdnSelect();
});

// 把使用者输入正规化成 host（去掉 http://、路径等）；无效回 ""
function normHost(s) {
  s = (s || "").trim();
  if (!s) return "";
  try { if (/^https?:\/\//i.test(s)) return new URL(s).host.toLowerCase(); } catch (e) {}
  s = s.replace(/^\/+/, "").split("/")[0].split("?")[0].split("#")[0].toLowerCase();
  return (/^[a-z0-9.-]+(:\d+)?$/.test(s) && s.indexOf(".") >= 0) ? s : "";
}

function buildOptions(options, current) {
  buildCdnSelectList(options);
  // 还原目前选择：储存值在清单内 → 清单模式；不在 → 视为自行输入的 host
  if (current && knownValues[current]) {
    els.modeList.checked = true;
    selectCdnValue(current);
  } else {
    els.modeCustom.checked = true;
    selectCdnValue(DEFAULTS.cdnHost); // 保底，切回清单模式时有值可用
    els.customHost.value = current || "";
  }
  syncModeUI();
}

// 依目前是「清单选择」还是「自行输入」互斥显示对应的输入元件
function syncModeUI() {
  var isCustom = els.modeCustom.checked;
  els.cdnSelect.style.display = isCustom ? "none" : "block";
  els.customHost.style.display = isCustom ? "block" : "none";
  els.customHint.style.display = isCustom ? "block" : "none";
  if (isCustom) closeCdnSelect();
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
  currentCdnHost = cfg.cdnHost;
  buildOptions(list, cfg.cdnHost);
});

els.enabled.addEventListener("change", function () { save({ enabled: els.enabled.checked }); });
els.showDebug.addEventListener("change", function () { save({ showDebug: els.showDebug.checked }); });

els.modeList.addEventListener("change", function () {
  if (!els.modeList.checked) return;
  syncModeUI();
  currentCdnHost = cdnSelectValue || DEFAULTS.cdnHost;
  save({ cdnHost: currentCdnHost });
});
els.modeCustom.addEventListener("change", function () {
  if (!els.modeCustom.checked) return;
  syncModeUI();
  var h = normHost(els.customHost.value);
  if (h) { currentCdnHost = h; save({ cdnHost: h }); markCustom(true); }
  else { els.customHost.focus(); markCustom(false); }
});

// 自订输入：即时正规化并储存
function markCustom(ok) {
  els.customHint.textContent = ok ? t("customHintDefault") : t("customHintInvalid");
  els.customHint.style.color = ok ? "#888" : "#e00";
}
els.customHost.addEventListener("input", function () {
  var h = normHost(els.customHost.value);
  if (h) { currentCdnHost = h; save({ cdnHost: h }); markCustom(true); }
  else { markCustom(false); }
});

// -------- Debug 读取 --------
function disp(s) { return s == null ? "-" : String(s); }
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
    "mode=" + (d.enabled ? "on" : "off") + "  target=" + disp(d.cdnTarget)
  ];
  if (d.autoHost) lines.push("auto-fallback -> " + disp(d.autoHost));
  var cdnLineIdx = lines.length; // "cdn=" 这行的高亮不能写死 index：前面可能多插了 auto-fallback 那行
  lines.push(
    "cdn=" + disp(d.currentCdn),
    "v=" + disp(d.pickVideoHost) + "  a=" + disp(d.pickAudioHost),
    "src=" + disp(d.lastSource) + "  rw=" + disp(d.rewriteCount) + "  seg=" + disp(d.segRewriteCount) + "  qn=" + qnText(d.lastQn) + "  spd=" + spdText(d.speedBps, d.speedIdle)
  );
  if (d.lastError) lines.push("err=" + disp(d.lastError));
  els.debug.textContent = "";
  var frag = document.createDocumentFragment();
  lines.forEach(function (l, i) {
    if (i > 0) frag.appendChild(document.createTextNode("\n"));
    if (i === cdnLineIdx) {
      var span = document.createElement("span");
      span.className = "cdnnow";
      span.textContent = l;
      frag.appendChild(span);
    } else {
      frag.appendChild(document.createTextNode(l));
    }
  });
  els.debug.appendChild(frag);
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
var lastSpeedtestState = null; // 最近一次 renderSpeedtest 的资料，点击切换节点后立即重绘打勾标示用

function speedtestHostList() {
  return cdnList.filter(function (o) { return o.value && o.value !== "base" && o.value !== "backup"; });
}

function renderSpeedtestMeta(st) {
  els.stMeta.textContent = "";
  if (!st || !st.title) return;
  var titleEl = document.createElement("span");
  titleEl.className = "stTitle";
  titleEl.textContent = st.title;
  els.stMeta.appendChild(titleEl);
  if (st.qn) {
    var qnEl = document.createElement("span");
    qnEl.className = "stQn";
    qnEl.textContent = st.qn;
    els.stMeta.appendChild(qnEl);
  }
}

function renderSpeedtest(st) {
  if (!st) return;
  lastSpeedtestState = st;
  renderSpeedtestMeta(st);
  if (st.error === "no-sample") {
    els.stList.textContent = t("speedtestNoSampleHint");
    return;
  }
  var bestHost = null, bestBps = 0;
  st.results.forEach(function (r) { if (!r.error && r.bps > bestBps) { bestBps = r.bps; bestHost = r.host; } });

  els.stList.textContent = "";
  var frag = document.createDocumentFragment();
  speedtestHosts.forEach(function (host, i) {
    var o = null;
    for (var j = 0; j < cdnList.length; j++) if (cdnList[j].value === host) { o = cdnList[j]; break; }
    var title = o ? cdnDisplayName(o) : host;
    if (host === currentCdnHost) title = "✓ " + title; // 打勾标示目前生效的节点
    var r = st.results[i];
    var text, cls = "stRow stClickable";
    if (host === currentCdnHost) cls += " stCurrent";
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

    var row = document.createElement("div");
    row.className = cls;
    row.dataset.host = host;

    var main = document.createElement("span");
    main.className = "stRowMain";
    var titleSpan = document.createElement("span");
    titleSpan.className = "stRowTitle";
    titleSpan.textContent = title;
    var hostSpan = document.createElement("span");
    hostSpan.className = "stRowHost";
    hostSpan.textContent = host;
    main.appendChild(titleSpan);
    main.appendChild(hostSpan);

    var speedSpan = document.createElement("span");
    speedSpan.className = "stSpeed";
    speedSpan.textContent = text;

    row.appendChild(main);
    row.appendChild(speedSpan);
    frag.appendChild(row);
  });
  els.stList.appendChild(frag);
}

// 测速页点一下节点列即直接切换：写回清单模式的选择并存档，主画面下次打开会同步显示
function applySpeedtestHost(host) {
  if (!knownValues[host] || host === currentCdnHost) return;
  currentCdnHost = host;
  els.modeList.checked = true;
  selectCdnValue(host);
  syncModeUI();
  save({ cdnHost: host });
  renderSpeedtest(lastSpeedtestState); // 立即重绘打勾标示，不用等下次 poll
}
els.stList.addEventListener("click", function (ev) {
  var row = ev.target.closest(".stRow");
  if (row && row.dataset.host) applySpeedtestHost(row.dataset.host);
});

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
  els.stList.textContent = "";
  els.stMeta.textContent = "";
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
