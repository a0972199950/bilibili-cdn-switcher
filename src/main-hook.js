/*
 * B 站网页版 CDN 线路重排 —— MAIN world 注入脚本
 *
 * 移植自 blblRogerMod 的 selectCdnUrlsFromTrack() 与 PiliNaraRogerMod 的 CDNService。
 *
 * 实测结论（av170001）：
 *  - player.reload() / reloadAccess() 不会重打 /x/player/wbi/playurl，只重新初始化 MSE、
 *    重新「请求分段」。因此只改 playurl 无法对正在播的影片生效（除非整页重载）。
 *  - 正解：直接改写「分段请求(.m4s)」的 host。搭配 player.reload() 让播放器重发分段，
 *    这些分段就会被导到指定节点 —— 不整页刷新、保留全屏与进度。
 *  - host 差替后仍回 206 且 CORS 通过（已实测），故此法成立。
 *
 * 设计：
 *  - 重排「关闭」(或选「原始」)时完全不碰原生行为：不 wrap fetch/XHR、不 defineProperty。
 *    debug 的「当前 CDN」用被动 PerformanceObserver 读取，不改变任何请求。
 *  - 换节点（仍启用）：player.reload() 在播放器内重载（保留全屏/进度），不整页刷新。
 *  - 开/关重排、切到/离开「原始」：需要安装/移除 hook，才整页重载。
 */
(function () {
  "use strict";
  if (window.__ROGER_CDN_INSTALLED__) return;
  window.__ROGER_CDN_INSTALLED__ = true;

  var CFG_KEY = "__ROGER_CDN_CFG__";
  var DEFAULTS = {
    enabled: true, // 预设开启
    cdnHost: "cn-jxnc-cmcc-bcache-06.bilivideo.com", // 默认 TW/SG 最快；'base'=不覆写
    showDebug: false // debug 叠层预设关闭，避免新装用户被打扰
  };

  var cfg = readCfg();
  function readCfg() {
    var c = {};
    for (var k in DEFAULTS) c[k] = DEFAULTS[k];
    try {
      var raw = window.localStorage.getItem(CFG_KEY);
      if (raw) { var p = JSON.parse(raw); for (var k2 in DEFAULTS) if (p[k2] !== undefined) c[k2] = p[k2]; }
    } catch (e) {}
    return c;
  }

  function isActive(c) { return !!c.enabled && c.cdnHost !== "base"; }
  var ACTIVE = isActive(cfg); // 依「载入当下」设定决定是否安装 hook

  // MAIN world 没有 chrome.i18n（页面 context 无扩充 API），toast / debug 叠层的文案由
  // bridge.js（ISOLATED world）代查後经 localStorage/postMessage 送过来，读法与 cfg 相同。
  // DEFAULT_MSGS 是 bridge 尚未推送前的保底文案（繁中，与 _locales/zh_TW 一致）。
  var MSGS_KEY = "__ROGER_CDN_MSGS__";
  var DEFAULT_MSGS = {
    mhToastAutoSwitched: "目前 CDN 速度不佳，已自動切換至備援節點 {host}",
    mhToastAllFailed: "目前 CDN 與備援節點皆無法順利播放",
    mhToastReloadBackup: "重載並切換至備用URL",
    mhToastClose: "關閉",
    mhDebugTitle: "CDN 線路",
    mhCdnTargetOriginal: "原始（不覆寫）",
    mhCdnTargetBackup: "備用URL（優先）"
  };
  var MSGS = readMsgs();
  function readMsgs() {
    var m = {};
    for (var k in DEFAULT_MSGS) m[k] = DEFAULT_MSGS[k];
    try {
      var raw = window.localStorage.getItem(MSGS_KEY);
      if (raw) { var p = JSON.parse(raw); for (var k2 in DEFAULT_MSGS) if (p[k2]) m[k2] = p[k2]; }
    } catch (e) {}
    return m;
  }

  // 自动回退的「静默覆写」：只影响本分页实际使用的节点，不写入用户设定 ——
  // popup 显示、下次手动重整仍以用户自选节点为准。备用URL 需整页重载才生效，
  // 重载前把覆写放进 sessionStorage 一次性带过去（读到就删，手动重整不会沿用）。
  var AUTO_KEY = "__ROGER_CDN_AUTO__";
  var autoHost = null; // null = 没有覆写；否则为具名备援 host 或 "backup"
  try {
    var rawAuto = window.sessionStorage.getItem(AUTO_KEY);
    if (rawAuto) {
      window.sessionStorage.removeItem(AUTO_KEY);
      if (ACTIVE) { var pa = JSON.parse(rawAuto); if (pa && typeof pa.host === "string" && pa.host) autoHost = pa.host; }
    }
  } catch (e) {}

  // 本页实际生效的目标：自动回退覆写优先，否则用户自选
  function effHost() { return autoHost || cfg.cdnHost; }
  // 具名节点模式（可做分段层即时差替）；'backup' 走 playurl 层、不做分段差替
  function isHostMode() { var h = effHost(); return h !== "base" && h !== "backup"; }

  var debug = {
    currentCdn: null, pickVideoHost: null, pickAudioHost: null,
    lastSource: null, rewriteCount: 0, segRewriteCount: 0, lastQn: null, lastError: null,
    speedBps: 0, speedIdle: false
  };

  var NATIVE_FETCH = window.fetch; // 存原生 fetch，供手动测速用，绕开下面装的 fetch hook

  // ---------------- helpers ----------------
  function asStr(v) { return typeof v === "string" ? v.trim() : ""; }
  function hostOf(url) { try { return new URL(url, location.href).host.toLowerCase(); } catch (e) { return ""; } }
  function replaceHost(url, host) { try { var x = new URL(url, location.href); x.host = host; return x.toString(); } catch (e) { return url; } }
  function distinct(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) { var u = arr[i]; if (u && !seen[u]) { seen[u] = 1; out.push(u); } }
    return out;
  }

  // 主播放器的 video：页面上还有 hover 预览、迷你卡片等其他 video，不能一概用 querySelector
  function getMainVideo() {
    var p = getPlayerEl();
    return (p && p.querySelector("video")) || document.querySelector("video");
  }

  // ---------------- 画质代码 → 可读名称 ----------------
  var QN_LABELS = {
    6: "240P", 16: "360P", 32: "480P", 64: "720P", 74: "720P60",
    80: "1080P", 100: "1080P AI", 112: "1080P+", 116: "1080P60",
    120: "4K", 125: "HDR", 126: "Dolby Vision", 127: "8K"
  };
  function qnText() {
    var q = debug.lastQn;
    if (q == null) return "-";
    var name = QN_LABELS[q];
    return name ? name + " (" + q + ")" : String(q);
  }

  // ---------------- 分段下载速度（滚动视窗）----------------
  // 取样来源优先序：fetch/XHR 直接量测 > resource timing（跨网域需 Timing-Allow-Origin，
  // 拿不到 transferSize 时会是 0）。有直接量测就忽略 resource timing，避免同一段重复计入。
  var SPEED_WINDOW_MS = 10000;
  var speedSamples = []; // {at, bytes, ms}
  var lastDirectAt = 0;
  var lastSampleAt = 0; // 最近一次计入样本的时间：当作「线路仍有资料在动」的讯号（checkStall 用）

  function addSample(bytes, ms, direct) {
    if (!(bytes > 0) || !(ms > 0)) return;
    var now = Date.now();
    if (direct) lastDirectAt = now;
    else if (now - lastDirectAt < 30000) return;
    speedSamples.push({ at: now, bytes: bytes, ms: ms });
    lastSampleAt = now;
  }

  // 用「每段 bytes / 每段耗时」而非挂钟平均：播放器缓冲满就停抓，
  // 挂钟平均只会等于影片码率，量不到线路实际吞吐。
  function updateSpeed() {
    var cut = Date.now() - SPEED_WINDOW_MS, kept = [], b = 0, t = 0;
    for (var i = 0; i < speedSamples.length; i++) if (speedSamples[i].at >= cut) kept.push(speedSamples[i]);
    speedSamples = kept;
    for (var j = 0; j < kept.length; j++) { b += kept[j].bytes; t += kept[j].ms; }
    if (t > 0) { debug.speedBps = (b / t) * 1000; debug.speedIdle = false; }
    else debug.speedIdle = debug.speedBps > 0; // 视窗内没流量 → 保留上次数值并标记 idle
  }

  function speedText() {
    if (!debug.speedBps) return "-";
    var s = debug.speedBps >= 1048576
      ? (debug.speedBps / 1048576).toFixed(1) + " MB/s"
      : Math.round(debug.speedBps / 1024) + " kB/s";
    return debug.speedIdle ? s + " (idle)" : s;
  }

  var SEG_RE = /\/upgcxcode\/.*\.m4s|\/upgcxcode\//i;
  var CDN_HOST_RE = /(bilivideo\.(com|cn)|akamaized\.net|hdslb\.com)$/i;

  // ---------------- 播放器上的提示 toast（挂在播放器容器内，全屏时也看得到）----------------
  var TOAST_SEL = [".bpx-player-container", "#bilibili-player", ".bpx-player-video-area", ".bpx-player-primary-area"];
  var toastEl = null, toastTimer = null, toastFadeTimer = null;

  function getToastHost() {
    // 优先挂外层容器：player.reload() 会重建内层 video 区域，挂太内层会连 toast 一起清掉
    for (var i = 0; i < TOAST_SEL.length; i++) { var el = document.querySelector(TOAST_SEL[i]); if (el) return el; }
    return document.body;
  }

  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (toastFadeTimer) { clearTimeout(toastFadeTimer); toastFadeTimer = null; }
    if (toastEl && toastEl.parentElement) toastEl.parentElement.removeChild(toastEl);
    toastEl = null;
  }

  var TOAST_FONT = "-apple-system,'Microsoft JhengHei','Microsoft YaHei',sans-serif";
  // opts: { duration, actionText, onAction, cancelText, onCancel, persistent }
  //  - persistent=true：不设定时器，不会自动消失，只能靠 actionText/cancelText 按钮关掉
  //  - 有任一按钮时 toast 才接收滑鼠事件，否则不挡播放器操作
  function showToast(text, opts) {
    opts = opts || {};
    hideToast();
    var host = getToastHost();
    if (!host) return;
    var fixed = host === document.body;
    var hasButton = !!(opts.actionText || opts.cancelText);
    toastEl = document.createElement("div");
    toastEl.id = "roger-cdn-toast";
    toastEl.style.cssText = [
      fixed ? "position:fixed" : "position:absolute",
      fixed ? "top:15%" : "top:24px",
      "left:50%", "transform:translateX(-50%)", "z-index:999999",
      "display:flex", "align-items:center", "gap:10px", "max-width:85%", "box-sizing:border-box",
      "font:13px/1.6 " + TOAST_FONT, "color:#fff",
      "background:rgba(0,0,0,.78)", "padding:8px 14px", "border-radius:8px",
      "box-shadow:0 2px 10px rgba(0,0,0,.35)", "opacity:1", "transition:opacity .4s",
      (hasButton ? "pointer-events:auto" : "pointer-events:none")
    ].join(";");
    var span = document.createElement("span");
    span.textContent = text;
    toastEl.appendChild(span);
    if (opts.actionText && opts.onAction) {
      var btn = document.createElement("button");
      btn.textContent = opts.actionText;
      btn.style.cssText = "cursor:pointer;border:0;border-radius:6px;padding:5px 12px;font:13px " + TOAST_FONT + ";background:#00aeec;color:#fff;white-space:nowrap";
      btn.addEventListener("click", function () { var fn = opts.onAction; hideToast(); try { fn(); } catch (e) {} });
      toastEl.appendChild(btn);
    }
    if (opts.cancelText) {
      var cancelBtn = document.createElement("button");
      cancelBtn.textContent = opts.cancelText;
      cancelBtn.style.cssText = "cursor:pointer;border:1px solid rgba(255,255,255,.45);border-radius:6px;padding:5px 12px;font:13px " + TOAST_FONT + ";background:transparent;color:#fff;white-space:nowrap";
      cancelBtn.addEventListener("click", function () { var fn = opts.onCancel; hideToast(); if (fn) try { fn(); } catch (e) {} });
      toastEl.appendChild(cancelBtn);
    }
    try { if (!fixed && getComputedStyle(host).position === "static") host.style.position = "relative"; } catch (e) {}
    host.appendChild(toastEl);
    if (!opts.persistent) {
      var dur = opts.duration || 3000;
      toastFadeTimer = setTimeout(function () { if (toastEl) toastEl.style.opacity = "0"; }, Math.max(0, dur - 400));
      toastTimer = setTimeout(hideToast, dur);
    }
  }

  // ---------------- 自动回退：目前 CDN 播不动时，切到 B 站给的备援节点 ----------------
  // 备援 host 取自 playurl 里的 baseUrl/backupUrl（B 站原生备援），解析 playurl 时顺手记下。
  // 第一次回退切「具名备援 host」：分段层即时差替 + player.reload()，不整页刷新，闪 toast 告知；
  // 备援 host 也播不动（或没记到可用 host）时不再自动整页重载，改弹一个不会自动消失的提示，
  // 让用户自己按「重載並切換至備用URL」或「關閉」决定。内建功能，不提供开关。
  var FALLBACK = { attempts: 0, lastSwitchAt: 0, tried: {} };
  var FALLBACK_MAX_ATTEMPTS = 2;
  var FALLBACK_COOLDOWN_MS = 12000;
  var stallState = { lastTime: -1, stuckSince: null };
  var backupHosts = []; // 最近一次 playurl 解析到的候选 host（base + backupUrl），依出现顺序
  var pendingBackupHosts = null; // rewriteRoot 期间收集用；有解析到才整批取代 backupHosts

  // 测试用开关（无任何 UI 入口，不影响一般用户）：在 DevTools console（页面 context）执行
  //   __rogerCdnSimulateStall()       → 接下来 60 秒把影片当成卡住（连播放器状态检查都略过，
  //                                     时序确定），走真实回退流程：约 9 秒切备援节点＋toast、
  //                                     约 27 秒（8 秒判定＋12 秒冷却）弹「切备用URL」提示（不会自动消失）
  //   __rogerCdnSimulateStall(90000)  → 自订模拟时长（毫秒）；传 0 取消
  //   __rogerCdnSimulateStall("ask")  → 不等计时，立刻弹出询问 toast（按钮为真实行为，
  //                                     按下会真的切备用URL＋整页重载）
  // 每支影片 attempts 只有一轮，要重测完整流程请重新整理或换影片。
  var simulateStallUntil = 0;
  window.__rogerCdnSimulateStall = function (arg) {
    if (arg === "ask") { askBackupSwitch("simulated"); return "ask toast shown"; }
    simulateStallUntil = Date.now() + (typeof arg === "number" ? arg : 60000);
    return simulateStallUntil > Date.now()
      ? "simulating stall for " + Math.round((simulateStallUntil - Date.now()) / 1000) + "s"
      : "canceled";
  };

  function isFailureStatus(status) {
    return status === 403 || status === 404 || status === 451 || (status >= 500 && status < 600);
  }

  // 分段 URL 的 deadline（unix 秒）已过：整份 playurl 签名失效，换 host 也一样 403，
  // 该交给播放器自己重打 playurl，不算目前 CDN 坏掉
  function isExpiredUrl(url) {
    try {
      var dl = new URL(url, location.href).searchParams.get("deadline");
      return !!dl && parseInt(dl, 10) * 1000 < Date.now();
    } catch (e) { return false; }
  }

  // 具名节点模式下只认目前节点的分段；备用URL模式没有做 host 差替，任何分段失败都算数
  function isCurrentSegHost(host) { return isHostMode() ? host === effHost() : !!host; }

  function shouldFallbackOnStatus(status, url) {
    if (!isFailureStatus(status)) return false;
    if (status === 403 && isExpiredUrl(url)) return false;
    return isCurrentSegHost(hostOf(url));
  }

  function resetFallbackState() {
    FALLBACK.attempts = 0; FALLBACK.tried = {};
    stallState.lastTime = -1; stallState.stuckSince = null;
  }

  // 记下 playurl 给的候选 host：滤掉 PCDN（mcdn，品质不稳）；带端口的 host 过不了
  // CDN_HOST_RE 的 $ 锚定，顺带被排除（分段差替也不适用带端口的节点）
  function noteBackupHost(url) {
    if (pendingBackupHosts == null || !url) return;
    var h = hostOf(url);
    if (!h || !CDN_HOST_RE.test(h) || h.indexOf(".mcdn.") >= 0) return;
    if (pendingBackupHosts.indexOf(h) < 0) pendingBackupHosts.push(h);
  }

  function pickFallbackHost() {
    for (var i = 0; i < backupHosts.length; i++) {
      var h = backupHosts[i];
      if (h !== effHost() && !FALLBACK.tried[h]) return h;
    }
    return null;
  }

  // 静默套用自动回退：只动 autoHost，不碰 cfg 与 chrome.storage（用户设定不变）
  function applyAutoHost(next) {
    autoHost = next;
    renderOverlay(); postDebug();
    if (next === "backup") {
      // 备用URL 走 playurl 层，需重打 playurl 才生效 → 整页重载，覆写用 sessionStorage 一次性带过去
      try { window.sessionStorage.setItem(AUTO_KEY, JSON.stringify({ host: next })); } catch (e) {}
      fullReload();
    } else if (!playerReload()) {
      // 具名备援本走播放器内重载；player.reload 不可用时退整页重载，同样一次性带覆写
      try { window.sessionStorage.setItem(AUTO_KEY, JSON.stringify({ host: next })); } catch (e) {}
      fullReload();
    }
  }

  function maybeFallback(reason) {
    if (!ACTIVE) return;
    if (!WATCH_RE.test(location.pathname)) return; // 非观看页（如首页 hover 预览）不回退
    if (effHost() === "backup" || FALLBACK.attempts >= FALLBACK_MAX_ATTEMPTS) return;
    var now = Date.now();
    if (now - FALLBACK.lastSwitchAt < FALLBACK_COOLDOWN_MS) return;
    FALLBACK.attempts++;
    FALLBACK.lastSwitchAt = now;
    FALLBACK.tried[effHost()] = true;
    var next = FALLBACK.attempts === 1 ? pickFallbackHost() : null;
    if (next) {
      debug.lastError = "auto-fallback(" + reason + "): " + effHost() + " -> " + next;
      showToast(MSGS.mhToastAutoSwitched.replace("{host}", next));
      applyAutoHost(next);
      return;
    }
    // 具名备援也播不动（或没记到可用 host）：整页重载感知太大，不自动做，
    // 弹提示让用户自己决定；本支影片只问这一次（attempts 直接封顶）
    FALLBACK.attempts = FALLBACK_MAX_ATTEMPTS;
    askBackupSwitch(reason);
  }

  function askBackupSwitch(reason) {
    debug.lastError = "auto-fallback(" + reason + "): " + effHost() + " -> ask-user";
    showToast(MSGS.mhToastAllFailed, {
      persistent: true, // 不自动消失，让用户自己按「重載」或「關閉」
      actionText: MSGS.mhToastReloadBackup,
      onAction: function () { applyAutoHost("backup"); },
      cancelText: MSGS.mhToastClose
    });
  }

  // 持续侦测「真的播不动」：未暂停但 currentTime 不前进、且线路上也没有资料在动。
  // 不能拿「一段时间没流量」当依据：播放器缓冲抓满本来就会停抓分段，idle 是正常状态，
  // 之前把 idle 当卡住会在缓冲抓满约 18 秒后误判、把好好播放中的页面整页重载。
  function checkStall() {
    if (!ACTIVE) { stallState.lastTime = -1; stallState.stuckSince = null; return; }
    // 模拟模式：连播放器状态检查也略过 —— 第一次回退的 player.reload() 会让影片短暂
    // 暂停/readyState 0，若照常重置计时器，第二段（询问）会一直等不到
    var simulating = Date.now() < simulateStallUntil;
    if (!simulating) {
      var v = getMainVideo();
      if (!v || v.paused || v.ended || v.readyState === 0) { stallState.lastTime = -1; stallState.stuckSince = null; return; }
      var t = v.currentTime;
      if (t !== stallState.lastTime) { stallState.lastTime = t; stallState.stuckSince = null; return; }
      if (Date.now() - lastSampleAt < 5000) { stallState.stuckSince = null; return; } // 还在下载 → 只是缓冲慢，再等
    }
    if (stallState.stuckSince == null) stallState.stuckSince = Date.now();
    else if (Date.now() - stallState.stuckSince > 8000) {
      stallState.stuckSince = null;
      maybeFallback(simulating ? "simulated" : "stalled");
    }
  }
  // 是否为「该被差替的分段请求」：具名节点模式、是分段、host 是 CDN、且尚未等于目标
  function isSwappableSeg(url) {
    if (!isHostMode()) return false;
    if (!SEG_RE.test(url)) return false;
    var h = hostOf(url);
    return !!h && CDN_HOST_RE.test(h) && h !== effHost();
  }
  function swapSegHost(url) { return replaceHost(url, effHost()); }

  // ---------------- playurl / playinfo 改写（让 baseUrl 也一致，次要）----------------
  function applyTrack(track) {
    var base = asStr(track.baseUrl) || asStr(track.base_url) || asStr(track.url);
    var backups = track.backupUrl || track.backup_url || [];
    if (!Array.isArray(backups)) backups = [];
    backups = backups.map(asStr).filter(Boolean);
    if (!base && !backups.length) return null;
    noteBackupHost(base);
    for (var bi = 0; bi < backups.length; bi++) noteBackupHost(backups[bi]);
    var ordered;
    if (effHost() === "backup") {
      ordered = distinct(backups.concat([base])).filter(Boolean); // 优先 B 站给的备援节点
    } else {
      var swapped = base ? replaceHost(base, effHost()) : "";
      ordered = distinct([swapped, base].concat(backups)).filter(Boolean);
    }
    if (!ordered.length) return null;
    var top = ordered[0], rest = ordered.slice(1);
    if ("baseUrl" in track || "base_url" in track || !("url" in track)) {
      track.baseUrl = top; if ("base_url" in track) track.base_url = top;
    } else { track.url = top; }
    track.backupUrl = rest; if ("backup_url" in track) track.backup_url = rest;
    return top; // 回传完整 URL（不只 host），让呼叫端自行取用
  }
  function rewriteContainer(d) {
    if (!d || typeof d !== "object") return false;
    var changed = false, vHost = null, aHost = null;
    var dash = d.dash;
    if (dash && typeof dash === "object") {
      eachTrack(dash.video, function (top) { changed = true; var h = hostOf(top); if (!vHost) { vHost = h; noteEarlySample(top); } });
      eachTrack(dash.audio, function (top) { changed = true; if (!aHost) aHost = hostOf(top); });
      if (dash.dolby && Array.isArray(dash.dolby.audio)) eachTrack(dash.dolby.audio, function (top) { changed = true; if (!aHost) aHost = hostOf(top); });
      if (dash.flac && dash.flac.audio) { var top1 = applyTrack(dash.flac.audio); if (top1) { changed = true; if (!aHost) aHost = hostOf(top1); } }
    }
    if (Array.isArray(d.durl)) eachTrack(d.durl, function (top) { changed = true; var h = hostOf(top); if (!vHost) { vHost = h; noteEarlySample(top); } });
    if (changed) {
      debug.pickVideoHost = vHost || debug.pickVideoHost;
      debug.pickAudioHost = aHost || debug.pickAudioHost;
      if (typeof d.quality === "number") debug.lastQn = d.quality;
    }
    return changed;
  }
  function eachTrack(arr, onTop) {
    if (!Array.isArray(arr)) return;
    for (var i = 0; i < arr.length; i++) { var top = applyTrack(arr[i]); if (top) onTop(top); }
  }
  function rewriteRoot(root, source) {
    try {
      if (!root || typeof root !== "object") return false;
      var d = root.data || root.result || root;
      pendingBackupHosts = [];
      var changed = rewriteContainer(d);
      if (changed) {
        if (pendingBackupHosts.length) backupHosts = pendingBackupHosts;
        debug.lastSource = source; debug.rewriteCount++; resetFallbackState(); renderOverlay(); postDebug();
      }
      pendingBackupHosts = null;
      return changed;
    } catch (e) { debug.lastError = String(e); pendingBackupHosts = null; return false; }
  }
  function tryRewriteText(txt, source) {
    if (typeof txt !== "string" || !txt) return null;
    if (txt.indexOf("dash") < 0 && txt.indexOf("durl") < 0 && txt.indexOf("backupUrl") < 0 && txt.indexOf("backup_url") < 0) return null;
    var obj; try { obj = JSON.parse(txt); } catch (e) { return null; }
    if (!rewriteRoot(obj, source)) return null;
    try { return JSON.stringify(obj); } catch (e) { return null; }
  }

  // ---------------- 安装 hook（仅 ACTIVE 时）----------------
  var PLAYURL_RE = /(x\/player\/wbi\/playurl|x\/player\/playurl|pgc\/player\/web\/playurl)/i;

  function installHooks() {
    // __playinfo__（SSR 首个分 P）— CDN 重排启用时才需要
    if (ACTIVE) {
      try {
        if (window.__playinfo__) rewriteRoot(window.__playinfo__, "playinfo");
        else {
          var store;
          Object.defineProperty(window, "__playinfo__", {
            configurable: true,
            get: function () { return store; },
            set: function (v) { try { rewriteRoot(v, "playinfo"); } catch (e) {} store = v; }
          });
        }
      } catch (e) { debug.lastError = "playinfo hook: " + e; }
    }

    // fetch：速度量测（永远启用）+ 分段 host 差替 / playurl 改写（CDN 启用时）
    var _fetch = window.fetch;
    if (typeof _fetch === "function") {
      window.fetch = function (input, init) {
        var url = "";
        try { url = typeof input === "string" ? input : (input && input.url) || ""; } catch (e) {}
        if (ACTIVE) {
          if (isSwappableSeg(url)) {
            var nu = swapSegHost(url);
            if (nu !== url) {
              debug.segRewriteCount++;
              if (typeof input === "string") input = nu;
              else { try { input = new Request(nu, input); } catch (e) {} }
            }
          }
          if (PLAYURL_RE.test(url)) {
            return _fetch.call(this, input, init).then(function (resp) {
              return resp.clone().text().then(function (txt) {
                var out = tryRewriteText(txt, "playurl");
                if (out == null) return resp;
                return new Response(out, { status: resp.status, statusText: resp.statusText, headers: new Headers(resp.headers) });
              }).catch(function () { return resp; });
            });
          }
        }
        if (SEG_RE.test(url)) {
          var t0 = Date.now();
          var reqUrl = typeof input === "string" ? input : (input && input.url) || url;
          return _fetch.call(this, input, init).then(function (resp) {
            resp.clone().arrayBuffer().then(function (buf) { addSample(buf.byteLength, Date.now() - t0, true); }).catch(function () {});
            if (!resp.ok && shouldFallbackOnStatus(resp.status, reqUrl)) maybeFallback("http-" + resp.status);
            return resp;
          }, function (err) {
            // 播放器 seek / 切画质会主动 abort 在飞的分段请求，不是线路问题
            if (!(err && err.name === "AbortError") && isCurrentSegHost(hostOf(reqUrl))) maybeFallback("network-error");
            throw err;
          });
        }
        return _fetch.call(this, input, init);
      };
    }

    // XHR：分段 host 差替 +（次要）playurl 改写
    var XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      var proto = XHR.prototype;
      var open = proto.open, send = proto.send;
      var textDesc = Object.getOwnPropertyDescriptor(proto, "responseText");
      var respDesc = Object.getOwnPropertyDescriptor(proto, "response");
      proto.open = function (method, url) {
        try {
          if (ACTIVE && typeof url === "string" && isSwappableSeg(url)) { url = swapSegHost(url); debug.segRewriteCount++; }
          this.__rogerUrl = url;
          this.__rogerIsSeg = typeof url === "string" && SEG_RE.test(url);
        } catch (e) {}
        return open.call(this, method, url, arguments.length > 2 ? arguments[2] : true, arguments[3], arguments[4]);
      };
      proto.send = function () {
        var self = this, url = self.__rogerUrl || "";
        if (self.__rogerIsSeg) {
          var t0 = Date.now();
          self.addEventListener("load", function () {
            try {
              var bytes = 0;
              if (self.response instanceof ArrayBuffer) bytes = self.response.byteLength;
              else { var cl = self.getResponseHeader("content-length"); if (cl) bytes = parseInt(cl, 10) || 0; }
              addSample(bytes, Date.now() - t0, true);
              if (shouldFallbackOnStatus(self.status, self.__rogerUrl || "")) maybeFallback("http-" + self.status);
            } catch (e) {}
          });
          self.addEventListener("error", function () {
            if (isCurrentSegHost(hostOf(self.__rogerUrl || ""))) maybeFallback("network-error");
          });
        }
        if (ACTIVE && PLAYURL_RE.test(url) && textDesc && respDesc) {
          var cachedText = null, cachedObj = null, computed = false;
          var compute = function () {
            if (computed) return; computed = true;
            try {
              var rt = self.responseType;
              if (rt === "json") { var obj = respDesc.get.call(self); rewriteRoot(obj, "playurl"); cachedObj = obj; }
              else cachedText = tryRewriteText(textDesc.get.call(self), "playurl");
            } catch (e) { debug.lastError = "xhr compute: " + e; }
          };
          try {
            Object.defineProperty(self, "responseText", {
              configurable: true,
              get: function () { if (self.readyState === 4) { compute(); if (cachedText != null) return cachedText; } return textDesc.get.call(self); }
            });
            Object.defineProperty(self, "response", {
              configurable: true,
              get: function () {
                var rt = self.responseType;
                if (self.readyState === 4) {
                  if (rt === "json") { compute(); return cachedObj; }
                  if (rt === "" || rt === "text") { compute(); if (cachedText != null) return cachedText; }
                }
                return respDesc.get.call(self);
              }
            });
          } catch (e) { debug.lastError = "xhr defineProperty: " + e; }
        }
        return send.apply(this, arguments);
      };
    }
  }

  installHooks(); // 速度量测永远启用；CDN 改写只在 ACTIVE 时生效

  // 主播放器 video 的播放错误（如解码/来源错误）也视为目前 CDN 播不动的讯号；
  // 页面上 hover 预览等其他 video 的错误与线路无关，不理会
  window.addEventListener("error", function (e) {
    try {
      var t = e && e.target;
      if (t && t.tagName === "VIDEO" && t === getMainVideo()) maybeFallback("video-error");
    } catch (err) {}
  }, true);

  // ---------------- 被动观测「当前 CDN」（不改变任何原生行为）----------------
  var lastSegUrl = ""; // 最近一个「已实际下载完」的分段 URL，最准确，但要等播放器真的抓过分段才有
  var earlySegUrl = ""; // playurl/playinfo 一解析完就有：当前画质第一个 video track 的 URL，不用等开始播放
  function noteEarlySample(url) { if (url) earlySegUrl = url; }
  function sampleUrl() { return lastSegUrl || earlySegUrl; } // 手动测速用：优先用真实下载过的，没有才退回 early

  function noteSegment(url) {
    lastSegUrl = url;
    var h = hostOf(url);
    if (h && h !== debug.currentCdn) { debug.currentCdn = h; renderOverlay(); postDebug(); }
  }
  try {
    var po = new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (!e.name || !SEG_RE.test(e.name)) continue;
        noteSegment(e.name);
        if (e.transferSize > 0 && e.duration > 0) addSample(e.transferSize, e.duration, false);
      }
    });
    po.observe({ type: "resource", buffered: true });
  } catch (e) {}

  // ---------------- 手动测速：拿「当前影片＋当前画质」的分段，逐一实测各节点速度 ----------------
  // 只在 popup 按下按钮时执行一次；不影响使用者当下选择的 CDN，跑完只回报结果给 popup 显示。
  // popup 离开测速页或关闭时会送 speedtest-stop，中止目前请求、不再排下一个节点。
  var SPEEDTEST_MAX_BYTES = 8 * 1024 * 1024; // 8MB 或 5s，先到者为准
  var SPEEDTEST_MAX_MS = 5000;
  var speedTestRunning = false;
  var speedTestGen = 0; // 每次 runSpeedTest 递增一代；旧一轮尚未 resolve 的 continuation 比对到
                         // 不是目前这代就自行停手，避免「重新测速」把旗标重置後、旧的那轮又复活续跑
  var speedTestAbort = null; // 目前这一个节点的 AbortController，供外部中止用

  function measureHost(host) {
    var testUrl = replaceHost(sampleUrl(), host);
    return new Promise(function (resolve) {
      var t0 = Date.now();
      var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
      speedTestAbort = ctrl;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, SPEEDTEST_MAX_MS);
      var done = false;
      function finish(bytes, error) {
        if (done) return; done = true;
        clearTimeout(timer);
        var ms = Date.now() - t0;
        resolve({ host: host, bytes: bytes, ms: ms, bps: ms > 0 ? (bytes / ms) * 1000 : 0, error: error || null });
      }
      NATIVE_FETCH(testUrl, { signal: ctrl ? ctrl.signal : undefined, cache: "no-store" }).then(function (resp) {
        if (!resp.ok) { finish(0, "http-" + resp.status); return; }
        if (!resp.body || !resp.body.getReader) { finish(0, "no-stream"); return; }
        var reader = resp.body.getReader();
        var received = 0;
        (function pump() {
          reader.read().then(function (r) {
            if (r.done) { finish(received, received > 0 ? null : "no-data"); return; }
            received += (r.value && r.value.length) || 0;
            if (received >= SPEEDTEST_MAX_BYTES) { try { reader.cancel(); } catch (e) {} finish(received, null); return; }
            pump();
          }).catch(function () {
            // 5 秒到、AbortController 中止读取：期间有收到资料就当成实测速度回报，
            // 完全没收到任何 byte 才算超时
            if (ctrl && ctrl.signal.aborted) { finish(received, received > 0 ? null : "timeout"); return; }
            finish(received, received > 0 ? null : "read-error");
          });
        })();
      }).catch(function () {
        finish(0, (ctrl && ctrl.signal.aborted) ? "timeout" : "network-error");
      });
    });
  }

  // 取影片标题：og:title / document.title 在 B 站都会带「_哔哩哔哩_bilibili」这类站名後缀，统一去掉
  var TITLE_SUFFIX_RE = /[-_]\s*(哔哩哔哩|bilibili)[\s\S]*$/i;
  function cleanTitle(s) { s = asStr(s); var t = s.replace(TITLE_SUFFIX_RE, "").trim(); return t || s; }
  function getVideoTitle() {
    try {
      var og = document.querySelector('meta[property="og:title"]');
      if (og && asStr(og.content)) return cleanTitle(og.content);
      var mt = document.querySelector('meta[name="title"]');
      if (mt && asStr(mt.content)) return cleanTitle(mt.content);
      return cleanTitle(document.title);
    } catch (e) { return ""; }
  }

  // 重新测速：不管前一轮跑到哪，直接中断、开新的一代；旧一轮的 continuation 靠 gen 比对自行退出
  function runSpeedTest(hosts) {
    if (!sampleUrl()) {
      try { window.postMessage({ __rogerCdn: 1, dir: "speedtest-done", payload: { error: "no-sample" } }, "*"); } catch (e) {}
      return;
    }
    if (speedTestAbort) { try { speedTestAbort.abort(); } catch (e) {} }
    var myGen = ++speedTestGen;
    speedTestRunning = true;
    try { window.postMessage({ __rogerCdn: 1, dir: "speedtest-meta", payload: { title: getVideoTitle(), qn: qnText() } }, "*"); } catch (e) {}
    var i = 0;
    (function next() {
      if (myGen !== speedTestGen) return; // 已被更新一轮取代，不再回报也不再继续
      if (i >= hosts.length) {
        speedTestRunning = false;
        speedTestAbort = null;
        try { window.postMessage({ __rogerCdn: 1, dir: "speedtest-done", payload: {} }, "*"); } catch (e) {}
        return;
      }
      var host = hosts[i++];
      measureHost(host).then(function (r) {
        if (myGen !== speedTestGen) return;
        try { window.postMessage({ __rogerCdn: 1, dir: "speedtest-progress", payload: r }, "*"); } catch (e) {}
        next();
      });
    })();
  }

  function stopSpeedTest() {
    if (!speedTestRunning) return;
    speedTestGen++; // 让目前这一轮的 continuation 全部失效
    speedTestRunning = false;
    if (speedTestAbort) { try { speedTestAbort.abort(); } catch (e) {} }
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__rogerCdn !== 1) return;
    if (d.dir === "speedtest-run") { runSpeedTest((d.payload && d.payload.hosts) || []); return; }
    if (d.dir === "speedtest-stop") { stopSpeedTest(); return; }
    if (d.dir === "messages" && d.payload) { for (var mk in DEFAULT_MSGS) if (d.payload[mk]) MSGS[mk] = d.payload[mk]; return; }
  });

  // ---------------- 切换 CDN 时的重载策略 ----------------
  function effSig(c) { return c.enabled ? ("on:" + c.cdnHost) : "off"; }
  var WATCH_RE = /\/(video|bangumi|list|festival|medialist|cheese|blackboard)\//i;

  // 播放器内重载：重新请求分段（会被分段 hook 导到新节点），保留全屏；并回到原进度
  function playerReload() {
    try {
      var p = window.player;
      if (!p || typeof p.reload !== "function") return false;
      var t = 0;
      try { t = (typeof p.getCurrentTime === "function" ? p.getCurrentTime() : (document.querySelector("video") || {}).currentTime) || 0; } catch (e) {}
      p.reload();
      if (t > 1 && typeof p.seek === "function") {
        var tries = 0;
        var iv = setInterval(function () {
          tries++;
          var cur = 0; try { cur = p.getCurrentTime(); } catch (e) {}
          if (cur && Math.abs(cur - t) < 2) { clearInterval(iv); return; }
          try { p.seek(t); } catch (e) {}
          if (tries > 20) clearInterval(iv);
        }, 300);
      }
      return true;
    } catch (e) { return false; }
  }

  // 整页重载（保留进度）：用于需要安装/移除 hook 的切换
  function fullReload() {
    try {
      if (!WATCH_RE.test(location.pathname) && !document.querySelector("video")) return;
      var url = new URL(location.href);
      var v = getMainVideo();
      if (v && isFinite(v.currentTime) && v.currentTime > 1) url.searchParams.set("t", String(Math.floor(v.currentTime)));
      location.replace(url.toString());
    } catch (e) { try { location.reload(); } catch (_) {} }
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__rogerCdn !== 1 || d.dir !== "config") return;
    if (!d.payload) return;
    var beforeSig = effSig(cfg), beforeActive = ACTIVE, beforeEffHost = effHost();
    for (var k in DEFAULTS) if (d.payload[k] !== undefined) cfg[k] = d.payload[k];
    renderOverlay();
    if (beforeSig === effSig(cfg)) return; // 只改了 showDebug 之类 → 不动（保留 autoHost）
    autoHost = null; // 用户手动改了节点/开关：自动回退的静默覆写作废，以用户选择为准
    var afterActive = isActive(cfg);
    if (beforeActive !== afterActive) {
      fullReload(); // 需安装/移除 hook（开/关重排、切到/离开「原始」）
    } else if (cfg.cdnHost === "backup" || beforeEffHost === "backup") {
      fullReload(); // 「备用」走 playurl 层，需重打 playurl 才生效 → 整页重载
    } else if (!playerReload()) {
      fullReload(); // 具名节点：播放器内重载（分段层即时导向）
    }
  });

  // ---------------- Debug overlay（仅在有播放器时，显示于其左上角）----------------
  var overlayEl = null;
  var PLAYER_SEL = [".bpx-player-video-area", ".bpx-player-container", "#bilibili-player", ".bpx-player-primary-area"];
  function getPlayerEl() {
    for (var i = 0; i < PLAYER_SEL.length; i++) { var e = document.querySelector(PLAYER_SEL[i]); if (e) return e; }
    return null;
  }
  function cdnTargetLabel() {
    if (cfg.cdnHost === "base") return MSGS.mhCdnTargetOriginal;
    if (cfg.cdnHost === "backup") return MSGS.mhCdnTargetBackup;
    return cfg.cdnHost;
  }
  function buildDebugText() {
    var lines = [
      MSGS.mhDebugTitle,
      "mode=" + (cfg.enabled ? "on" : "off") + "  target=" + cdnTargetLabel()
    ];
    if (autoHost) lines.push("auto-fallback -> " + autoHost); // 静默覆写：独立一行、纯英文，避免跟上面的使用者设定混在一起
    lines.push(
      "cdn=" + (debug.currentCdn || "-"),
      "v=" + (debug.pickVideoHost || "-") + "  a=" + (debug.pickAudioHost || "-"),
      "src=" + (debug.lastSource || "-") + "  rw=" + debug.rewriteCount + "  seg=" + debug.segRewriteCount + "  qn=" + qnText() + "  spd=" + speedText()
    );
    return lines.join("\n");
  }
  function renderOverlay() {
    if (window.top !== window) return;
    var player = getPlayerEl();
    if (!cfg.showDebug || !player) { if (overlayEl) overlayEl.style.display = "none"; return; }
    if (!overlayEl) {
      if (!document.documentElement) return;
      overlayEl = document.createElement("div");
      overlayEl.id = "roger-cdn-debug";
      overlayEl.style.cssText = [
        "position:absolute", "top:8px", "left:8px", "z-index:100",
        "font:12px/1.5 Consolas,Menlo,monospace", "color:#7CFC7C",
        "background:rgba(0,0,0,.72)", "padding:6px 9px", "border-radius:6px",
        "white-space:pre", "pointer-events:none", "max-width:70%", "text-shadow:0 1px 2px #000"
      ].join(";");
    }
    if (overlayEl.parentElement !== player) player.appendChild(overlayEl);
    try { if (getComputedStyle(player).position === "static") player.style.position = "relative"; } catch (e) {}
    overlayEl.style.display = "block";
    overlayEl.textContent = buildDebugText();
  }

  function postDebug() {
    try {
      window.postMessage({ __rogerCdn: 1, dir: "debug", payload: {
        currentCdn: debug.currentCdn, pickVideoHost: debug.pickVideoHost, pickAudioHost: debug.pickAudioHost,
        lastSource: debug.lastSource, rewriteCount: debug.rewriteCount, segRewriteCount: debug.segRewriteCount,
        lastQn: debug.lastQn, enabled: cfg.enabled, cdnHost: cfg.cdnHost, cdnTarget: cdnTargetLabel(), autoHost: autoHost, lastError: debug.lastError,
        speedBps: debug.speedBps, speedIdle: debug.speedIdle
      } }, "*");
    } catch (e) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderOverlay);
  else renderOverlay();
  setInterval(function () { updateSpeed(); checkStall(); renderOverlay(); postDebug(); }, 1000);
})();
