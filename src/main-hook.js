/*
 * B 站网页版 CDN 线路重排 —— MAIN world 注入脚本
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
  if (window.__CDN_SWITCHER_INSTALLED__) return;
  window.__CDN_SWITCHER_INSTALLED__ = true;

  var CFG_KEY = "__CDN_SWITCHER_CFG__";
  var DEFAULTS = {
    enabled: true, // 预设开启
    cdnHost: "upos-sz-mirror08ct.bilivideo.com", // 默认：TW/SG 实测都是第一梯队；'base'=不覆写
    autoFallback: true, // 失败自动切换：预设开启；网络本身不稳（弱 WiFi 等）的用户可关掉，避免频繁黑屏重载
    showDebug: false, // debug 叠层预设关闭，避免新装用户被打扰
    videoEnabled: true, // 一般影片的「关闭」：false = 不介入影片 CDN 选线（enabled 是总开关，管影片与直播）
    liveEnabled: true, // 直播的「关闭」：false = 不介入直播 CDN 选线
    liveRoute: "ov", // 直播线路偏好：ov / ovb / cn / cnb（记的是线路种类，不是具体 host，集群号随房间而变）
    autoSpeedSwitch: false, // 影片自动测速并切换到最快节点（进阶设定，预设关闭）
    autoSpeedHosts: [], // 自动测速要测的节点（popup 依目前国家写入）
    stVideoMb: 8, // 测速门槛（与 popup 进阶设定共用）
    stVideoSec: 5
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

  function isActive(c) { return !!c.enabled && c.videoEnabled !== false && c.cdnHost !== "base"; }
  var ACTIVE = isActive(cfg); // 依「载入当下」设定决定是否安装 hook（只管一般影片；直播的开关随时动态判断，见 liveActive）

  // MAIN world 没有 chrome.i18n（页面 context 无扩充 API），toast / debug 叠层的文案由
  // bridge.js（ISOLATED world）代查後经 localStorage/postMessage 送过来，读法与 cfg 相同。
  // DEFAULT_MSGS 是 bridge 尚未推送前的保底文案（繁中，与 _locales/zh_TW 一致）。
  var MSGS_KEY = "__CDN_SWITCHER_MSGS__";
  var DEFAULT_MSGS = {
    mhToastAutoSwitched: "目前 CDN 速度不佳，已自動切換至備援節點 {host}",
    mhToastAllFailed: "目前 CDN 與備援節點皆無法順利播放",
    mhToastReloadBackup: "重載並切換至備用URL",
    mhToastClose: "關閉",
    mhDebugTitle: "CDN 線路",
    mhCdnTargetOriginal: "原始（不覆寫）",
    mhCdnTargetBackup: "備用URL（優先）",
    mhToastLiveFallback: "目前直播線路不佳，已自動切換至國際線路(ov)",
    mhToastSwitched: "切換到 {host}",
    liveRouteOv: "國際線路(ov)",
    liveRouteOvB: "國際備用線路(ov-b)",
    liveRouteCn: "中國線路(cn)",
    liveRouteCnB: "中國備用線路(cn-b)"
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
  var AUTO_KEY = "__CDN_SWITCHER_AUTO__";
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
    speedBps: 0, speedIdle: false, playInfoPinned: 0
  };
  // DASH 会把所有画质塞在同一次 playurl 回应，之后使用者切画质是「同一份清单里换 representation」、
  // 不再打 playurl —— 所以不能只信 d.quality（那是预设画质，切了不会变）。
  // 改成：记下每个 video representation 的路径→画质代码，再看「实际正在下载的分段」是哪一档，得出当前画质。
  var videoQnByPath = {}; // pathname -> qn（每次解析 playurl 重建）
  var lastVideoQn = null; // 最近实际下载过的 video 分段所属画质，比 d.quality 准

  var NATIVE_FETCH = window.fetch; // 存原生 fetch，供手动测速用，绕开下面装的 fetch hook

  // ---------------- helpers ----------------
  function asStr(v) { return typeof v === "string" ? v.trim() : ""; }
  function hostOf(url) { try { return new URL(url, location.href).host.toLowerCase(); } catch (e) { return ""; } }
  function pathOf(url) { try { return new URL(url, location.href).pathname; } catch (e) { return ""; } }
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
  // 当前实际画质：优先用「正在下载的分段」对应的画质（切画质会即时反映），
  // 还没下载过任何 video 分段时退回 playurl 的预设画质
  function currentQn() { return lastVideoQn != null ? lastVideoQn : debug.lastQn; }
  function qnText() {
    var q = currentQn();
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
  var lastSegReqAt = 0; // 最近一次「送出分段请求」的时间：请求持续在送却抓不到资料 = 线路死了（checkStall 用）

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
  // 分段判定必须同时验 host：data.bilibili.com 的打点上报会把分段 URL 塞在 query 里，
  // 只看路径会把上报误认成分段（污染 currentCdn / 速度样本 / 备用URL模式的失败判定）
  function isSegUrl(url) { return SEG_RE.test(url) && CDN_HOST_RE.test(hostOf(url)); }

  // ---------------- 播放器上的提示 toast（挂在播放器容器内，全屏时也看得到）----------------
  var TOAST_SEL = [".bpx-player-container", "#bilibili-player", ".bpx-player-video-area", ".bpx-player-primary-area", "#live-player"];
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
    toastEl.id = "cdn-switcher-toast";
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
  // 让用户自己按「重載並切換至備用URL」或「關閉」决定。可由 popup 的「失败自动切换」开关关闭
  // （cfg.autoFallback，预设开启）：关闭后不做任何自动切换，也不弹提示。
  var FALLBACK = { attempts: 0, lastSwitchAt: 0, tried: {} };
  var FALLBACK_MAX_ATTEMPTS = 2;
  // 冷却要盖过「换节点后播放器重建缓冲」的空窗：实测 4K 在 player.reload() 后
  // 可能超过 20 秒才恢复走针，冷却太短会在恢复前就误弹「皆无法播放」
  var FALLBACK_COOLDOWN_MS = 30000;
  var stallState = { lastTime: -1, stuckSince: null };
  var progressSince = null; // 连续顺畅播放的起点：顺播够久代表线路恢复，重置回退额度
  var askToastOn = false; // 「皆无法播放」询问弹窗显示中：播放一旦恢复就自动收掉
  var backupHosts = []; // 最近一次 playurl 解析到的候选 host（base + backupUrl），依出现顺序
  var pendingBackupHosts = null; // rewriteRoot 期间收集用；有解析到才整批取代 backupHosts

  // 测试用开关（无任何 UI 入口，不影响一般用户）：在 DevTools console（页面 context）执行
  //   __cdnSwitcherSimulateStall()       → 接下来 60 秒把影片当成卡住（连播放器状态检查都略过，
  //                                     时序确定），走真实回退流程：约 9 秒切备援节点＋toast、
  //                                     约 47 秒（8 秒判定＋30 秒冷却）弹「切备用URL」提示（不会自动消失）
  //   __cdnSwitcherSimulateStall(90000)  → 自订模拟时长（毫秒）；传 0 取消
  //   __cdnSwitcherSimulateStall("ask")  → 不等计时，立刻弹出询问 toast（按钮为真实行为，
  //                                     按下会真的切备用URL＋整页重载）
  // 每支影片 attempts 只有一轮，要重测完整流程请重新整理或换影片。
  var simulateStallUntil = 0;
  window.__cdnSwitcherSimulateStall = function (arg) {
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
    if (!ACTIVE || !cfg.autoFallback) return;
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
    askToastOn = true;
    showToast(MSGS.mhToastAllFailed, {
      persistent: true, // 不自动消失，让用户自己按「重載」或「關閉」
      actionText: MSGS.mhToastReloadBackup,
      onAction: function () { applyAutoHost("backup"); },
      cancelText: MSGS.mhToastClose
    });
  }

  // currentTime 前方是否还有已缓冲的资料：有＝随时能继续播（暂停是使用者主动的）；
  // 没有＝缓冲耗尽（播放器可能已自己停下）
  function hasForwardBuffer(v) {
    try {
      var bf = v.buffered;
      for (var i = 0; i < bf.length; i++) {
        if (v.currentTime >= bf.start(i) - 0.1 && v.currentTime < bf.end(i) - 0.5) return true;
      }
    } catch (e) {}
    return false;
  }

  // 持续侦测「真的播不动」：currentTime 不前进、且线路上也没有资料在动。
  // 不能拿「一段时间没流量」当依据：播放器缓冲抓满本来就会停抓分段，idle 是正常状态，
  // 之前把 idle 当卡住会在缓冲抓满约 18 秒后误判、把好好播放中的页面整页重载。
  // paused 不能无条件放行：实测（番剧页）卡死一阵子后播放器会自己把 video 设回 paused，
  // 若把这当成「使用者主动暂停」就永远判不到卡住 —— 用前向缓冲区分：还有缓冲的暂停
  // 才是使用者主动的；缓冲耗尽的暂停继续累计。
  function checkStall() {
    if (!(IS_LIVE_PAGE ? liveActive() : ACTIVE) || !cfg.autoFallback) { stallState.lastTime = -1; stallState.stuckSince = null; return; }
    // 模拟模式：连播放器状态检查也略过 —— 第一次回退的 player.reload() 会让影片短暂
    // 暂停/readyState 0，若照常重置计时器，第二段（询问）会一直等不到
    var simulating = Date.now() < simulateStallUntil;
    var limit = 8000;
    if (!simulating) {
      var v = getMainVideo();
      var now = Date.now();
      // 分段请求持续在送、却一直抓不到任何资料 → 线路死了。这是最强的讯号，
      // 连 readyState 0（初载就遇到死线路，影片从没拿到过资料）都盖得住
      var starving = (now - lastSegReqAt < 10000 && now - lastSampleAt > 5000 && lastSegReqAt > 0) || liveNoData(v, now);
      if (v && v.ended) { stallState.lastTime = -1; stallState.stuckSince = null; return; }
      if (!v || v.readyState === 0) {
        // 没有 video / 还没有任何媒体资料：通常是还没开始（或 player.reload() 过渡），
        // 不算卡；但 starving 时代表初载就遇到死线路，照样累计
        if (!starving) { stallState.lastTime = -1; stallState.stuckSince = null; return; }
      } else if (v.paused && hasForwardBuffer(v)) {
        // 还有前向缓冲的暂停 = 使用者主动暂停，不算卡
        stallState.lastTime = -1; stallState.stuckSince = null; return;
      } else {
        var t = v.currentTime;
        if (t !== stallState.lastTime) {
          stallState.lastTime = t; stallState.stuckSince = null;
          if (!v.paused) {
            // 播放恢复走针：收掉「皆无法播放」的询问弹窗（它是 persistent 的，不会自己消失）；
            // 连续顺播 30 秒代表线路已恢复，重置回退额度，之后再卡还能再自动回退
            if (askToastOn) { askToastOn = false; hideToast(); }
            if (progressSince == null) progressSince = Date.now();
            else if (now - progressSince > 30000 && FALLBACK.attempts) { FALLBACK.attempts = 0; FALLBACK.tried = {}; }
          }
          return;
        }
        progressSince = null;
        if (now - lastSampleAt < 5000) {
          // 线路还有资料在动：暂停中（缓冲耗尽但还在补）属正常，不算卡；
          // 播放中卡住但仍在下载 → 只是缓冲慢，宽限到 20 秒再判定，
          // 免得音轨还活着、视轨已死的情况永远判不到
          if (v.paused) { stallState.stuckSince = null; return; }
          limit = 20000;
        }
      }
    }
    if (stallState.stuckSince == null) stallState.stuckSince = Date.now();
    else if (Date.now() - stallState.stuckSince > limit) {
      stallState.stuckSince = null;
      triggerFallback(simulating ? "simulated" : "stalled");
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

  // ---------------- 直播（live.bilibili.com）----------------
  // 实测结论：
  //  - 直播流（FLV 长连线、m3u8、m4s）都由页面 fetch 发出，路径含 /live-bvc/，host 形如
  //    d1--{ov|cn}-gotcha{N}[b].bilivideo.com。token 绑「集群号 N」、在同号的 ov / ovb / cn / cnb 之间通用，
  //    所以「换线路」= 把 host 改成同号的另一种变体；点播那套 upos 节点对直播一律 403/959，不能用。
  //  - 候选是动态的：集群号随房间而变，部分 cn…b 根本不存在 → 要先探测，不存在就退回 ov。
  //  - 换线路后用 window.livePlayer.reload() 让播放器以新 host 重新拉流（不整页重载）。
  //  - 直播开关随时动态判断（liveActive），不像一般影片那样要靠「载入当下」决定是否安装 hook，
  //    所以改线路/开关都不需要整页重载。
  var IS_LIVE_PAGE = location.hostname === "live.bilibili.com";
  var LIVE_ROUTES = ["ov", "ovb", "cn", "cnb"];
  var LIVE_PATH_RE = /\/live-bvc\//i;
  var LIVE_HOST_RE = /^((?:[a-z0-9]+--)?)(ov|cn)-gotcha(\d+)(b?)(\.[a-z0-9.-]+)$/i;
  var LIVE_STREAM_RE = /\.(flv|m3u8)$/i; // 串流入口（相对于 m4s 分片）：探测/测速用它
  var LIVE_FALLBACK_COOLDOWN_MS = 30000;
  var LIVE_PROBE_TIMEOUT_MS = 8000;

  function liveActive() { return !!cfg.enabled && cfg.liveEnabled !== false; }
  function liveRouteOf(c) { return LIVE_ROUTES.indexOf(c.liveRoute) >= 0 ? c.liveRoute : "ov"; }
  function liveSig(c) { return (c.enabled && c.liveEnabled !== false) ? "on:" + liveRouteOf(c) : "off"; }

  function newLiveState(roomKey) {
    return {
      roomKey: roomKey, cluster: null, prefix: "", suffix: "", protocol: null,
      sampleUrl: "", // 最近一次「页面原本要请求」的串流入口 URL（还没被我们改 host），测速/探测用
      origRoute: null, // 页面原本用的线路（API 分配的）
      avail: { ov: null, ovb: null, cn: null, cnb: null }, // null = 未知；true/false = 探测或实际请求得知
      autoRoute: null, // 失败自动切换的静默覆写：只影响这个房间，不写入用户设定
      activeHost: null, probed: false, probing: false,
      firstStreamAt: 0 // 这个房间第一次请求串流的时间：用来判断「从头到尾都没拿到资料」
    };
  }
  var live = newLiveState("");
  var liveFb = { lastAt: 0 };

  function effLiveRoute() { return live.autoRoute || liveRouteOf(cfg); }

  function liveInfo(url) {
    try {
      var u = new URL(url, location.href);
      if (!LIVE_PATH_RE.test(u.pathname)) return null;
      var m = LIVE_HOST_RE.exec(u.hostname);
      if (!m) return null;
      return {
        u: u, prefix: m[1], cluster: m[3], suffix: m[5], isStream: LIVE_STREAM_RE.test(u.pathname),
        route: m[2].toLowerCase() + (m[4] === "b" ? "b" : ""), isFlv: /\.flv$/i.test(u.pathname)
      };
    } catch (e) { return null; }
  }
  function liveHostFor(prefix, cluster, suffix, route) {
    return prefix + (route.charAt(0) === "c" ? "cn" : "ov") + "-gotcha" + cluster + (route.slice(-1) === "b" ? "b" : "") + suffix;
  }
  function liveHostsMap() {
    var out = {};
    for (var i = 0; i < LIVE_ROUTES.length; i++) out[LIVE_ROUTES[i]] = liveHostFor(live.prefix, live.cluster, live.suffix, LIVE_ROUTES[i]);
    return out;
  }

  // 换房间（SPA 换路径）或集群号变了：之前探测/回退的结论都不再适用
  function noteLiveRequest(li, absUrl) {
    var rk = location.pathname;
    if (live.roomKey !== rk || (live.cluster && live.cluster !== li.cluster)) { live = newLiveState(rk); liveFb.lastAt = 0; }
    live.cluster = li.cluster; live.prefix = li.prefix; live.suffix = li.suffix;
    if (li.isStream) {
      if (!live.firstStreamAt) live.firstStreamAt = Date.now();
      live.sampleUrl = absUrl;
      live.protocol = li.isFlv ? "flv" : "fmp4";
      live.origRoute = li.route;
      live.avail[li.route] = true; // 页面本来就在用它
    }
  }

  // 请求串流已超过 8 秒、video 却还没拿到任何资料（readyState 0）：线路是通的但没有码流（checkStall 用）
  function liveNoData(v, now) {
    return IS_LIVE_PAGE && live.firstStreamAt > 0 && now - live.firstStreamAt > 8000 && (!v || v.readyState === 0);
  }

  // 目前是否「确定得到 CDN 网址」：popup 只有这时才显示各线路的具体 host
  function liveReady() {
    if (!IS_LIVE_PAGE || !live.sampleUrl || live.roomKey !== location.pathname) return false;
    var v = getMainVideo();
    return !!v && v.readyState >= 2;
  }

  function liveReload() {
    try {
      var p = window.livePlayer;
      if (p && typeof p.reload === "function") {
        var v = getMainVideo(), wasPlaying = !!v && !v.paused;
        p.reload();
        // 实测偶发：reload 后 video 停在 paused 不会自己继续（FLV 较常见）。原本在播放的话，稍后补一次 play()
        if (wasPlaying) {
          var tries = 0, iv = setInterval(function () {
            var cur = getMainVideo(); tries++;
            if (cur && cur.paused && cur.readyState >= 2) { try { var pr = cur.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
            if (tries >= 6) clearInterval(iv);
          }, 1000);
        }
        return true;
      }
    } catch (e) {}
    return false;
  }

  // 返回该请求应改成的 host；不需要改（功能关闭、本来就是目标）回 null
  function liveTargetHost(li) {
    if (!liveActive()) return null;
    var host = liveHostFor(li.prefix, li.cluster, li.suffix, effLiveRoute());
    return host === li.u.hostname ? null : host;
  }

  function liveFallbackToOv(failedRoute) {
    live.avail[failedRoute] = false;
    if (live.autoRoute === "ov" || liveRouteOf(cfg) === "ov") return;
    live.autoRoute = "ov";
    liveFb.lastAt = Date.now();
    showToast(MSGS.mhToastLiveFallback);
    renderOverlay(); postDebug();
  }

  // 失败自动切换（直播版）：目前线路播不动（持续一段时间没有码流）→ 切回国际线路(ov)。
  // 只针对「这个房间」，不动用户长期选的线路；已经是 ov 就没得退，不处理。
  function maybeLiveFallback(reason) {
    if (!IS_LIVE_PAGE || !liveActive() || !cfg.autoFallback) return;
    var route = effLiveRoute();
    if (route === "ov") return;
    if (Date.now() - liveFb.lastAt < LIVE_FALLBACK_COOLDOWN_MS) return;
    debug.lastError = "live-fallback(" + reason + "): " + route + " -> ov";
    liveFallbackToOv(route);
    if (!liveReload()) { try { location.reload(); } catch (e) {} }
  }

  // 统一入口：直播页走直播回退，其他页走一般影片回退
  function triggerFallback(reason) { if (IS_LIVE_PAGE) maybeLiveFallback(reason); else maybeFallback(reason); }

  // 直播 fetch：记录页面原始请求；需要时改 host；改过的请求若失败（线路不存在 → DNS 失败，或 403 等）
  // 且开着「失败自动切换」，就地改回页面原本的 host 重试，并让之后的请求都改走 ov。
  function liveFetch(_fetch, self, input, init, li) {
    var abs = li.u.href;
    noteLiveRequest(li, abs);
    var target = liveTargetHost(li);
    if (!target) {
      if (li.isStream) { live.activeHost = li.u.hostname; debug.currentCdn = li.u.hostname; }
      return _fetch.call(self, input, init);
    }
    var nu = replaceHost(abs, target), req = nu;
    if (typeof input !== "string") { try { req = new Request(nu, input); } catch (e) { return _fetch.call(self, input, init); } }
    var route = effLiveRoute();
    debug.segRewriteCount++;
    if (li.isStream) { live.activeHost = target; debug.currentCdn = target; }
    var p = _fetch.call(self, req, init);
    if (!cfg.autoFallback || route === "ov") return p;
    function retry() {
      return _fetch.call(self, input, init).then(function (r2) {
        if (r2.ok) {
          liveFallbackToOv(route);
          if (li.isStream) { live.activeHost = li.u.hostname; debug.currentCdn = li.u.hostname; }
        }
        return r2;
      });
    }
    return p.then(function (resp) {
      return resp.ok ? resp : retry();
    }, function (err) {
      if (err && err.name === "AbortError") throw err; // 播放器自己中止（换台/seek）不是线路问题
      return retry();
    });
  }

  // 探测某条线路在这个房间是否存在：拿目前的串流入口 URL 换 host 请求，拿到 2xx 就算存在（拿到 header 立刻中止）
  function probeLiveRoute(route) {
    return new Promise(function (resolve) {
      var url;
      try { url = replaceHost(live.sampleUrl, liveHostFor(live.prefix, live.cluster, live.suffix, route)); } catch (e) { resolve(false); return; }
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, LIVE_PROBE_TIMEOUT_MS);
      NATIVE_FETCH(url, { signal: ctrl.signal, cache: "no-store" }).then(function (resp) {
        clearTimeout(timer);
        var ok = resp.ok;
        try { ctrl.abort(); } catch (e) {} // 不用把整个串流拉下来
        resolve(ok);
      }, function () { clearTimeout(timer); resolve(false); });
    });
  }

  // popup 开着时才探测（懒探测：刷直播的人不会每进一个房间就多打三条连线）
  function probeLiveAvail() {
    if (!IS_LIVE_PAGE || live.probing || live.probed || !live.sampleUrl) return;
    live.probing = true;
    var st = live;
    Promise.all(LIVE_ROUTES.map(function (r) { return r === st.origRoute ? Promise.resolve(true) : probeLiveRoute(r); })).then(function (res) {
      st.probing = false;
      if (live !== st) return; // 探测期间换房间了
      for (var i = 0; i < LIVE_ROUTES.length; i++) st.avail[LIVE_ROUTES[i]] = res[i];
      st.probed = true;
      postDebug();
    });
  }

  // ---------------- 锁定同一批节点（直播 playurl 快取）----------------
  // 每次切线路都要 livePlayer.reload()，播放器会重打 getRoomPlayInfo，B 站可能回另一个集群号 →
  // 测的是 07、切过去播的却是 05（cn 是不同实体节点，甚至没有 cn-b）。
  // 做法：同一个直播间、同样参数的 getRoomPlayInfo，签名还没快过期就直接回上次那份，集群号与签名都不变；
  // 换线路只是在这份网址上改 host（同号的 ov/ovb/cn/cnb 共用签名）。
  //  - 进房第一份不是 API 打的，是页面 SSR 塞的 __NEPTUNE_IS_MY_WAIFU__.roomInitRes（格式与 API 回应相同），
  //    第一次 reload 时拿它当快取，进房后的集群号就一路固定。
  //  - 签名约 60 分钟过期：剩不到 2 分钟就放行、让 B 站给新的一份（这时才可能换号）。
  //  - 播放器出错自己重试时（req_reason 不是 0）、或 20 秒内已经连回 6 次快取（正常手动切线路不会这么密，
  //    多半是播放器在死循环重试），一律放行，免得整批节点挂掉时被快取卡住。
  //  - 「关闭」直播时完全不介入。
  var PLAYINFO_RE = /\/xlive\/web-room\/v2\/index\/getRoomPlayInfo/i;
  var PLAYINFO_MIN_LEFT_S = 120;
  var playInfoCache = {}; // key -> 回应 JSON 字串
  var playInfoServedAt = [];

  function playInfoKey(q) {
    return [q.get("room_id"), q.get("qn") || "0", q.get("protocol"), q.get("format"), q.get("codec")].join("|");
  }
  function playInfoExpires(obj) {
    var min = Infinity;
    try {
      obj.data.playurl_info.playurl.stream.forEach(function (s) {
        s.format.forEach(function (f) {
          f.codec.forEach(function (c) {
            c.url_info.forEach(function (u) { var m = /expires=(\d+)/.exec(u.extra || ""); if (m) min = Math.min(min, +m[1]); });
          });
        });
      });
    } catch (e) { return 0; }
    return min === Infinity ? 0 : min;
  }
  function usablePlayInfo(obj) {
    return !!obj && obj.code === 0 && !!obj.data && obj.data.live_status === 1 && !!obj.data.playurl_info &&
      playInfoExpires(obj) - Date.now() / 1000 > PLAYINFO_MIN_LEFT_S;
  }
  function ssrPlayInfo(roomId) {
    try {
      var w = window.__NEPTUNE_IS_MY_WAIFU__, r = w && w.roomInitRes;
      if (r && r.data && (String(r.data.room_id) === roomId || String(r.data.short_id) === roomId)) return JSON.stringify(r);
    } catch (e) {}
    return null;
  }
  function parseOrNull(txt) { try { return JSON.parse(txt); } catch (e) { return null; } }

  function playInfoFetch(_fetch, self, input, init, u) {
    var q = u.searchParams, key = playInfoKey(q), now = Date.now();
    var reason = q.get("req_reason");
    playInfoServedAt = playInfoServedAt.filter(function (t) { return now - t < 20000; });
    var txt = playInfoCache[key];
    if (!txt && (q.get("qn") || "0") === "0") txt = ssrPlayInfo(q.get("room_id") || "");
    if (txt && usablePlayInfo(parseOrNull(txt)) && (!reason || reason === "0") && playInfoServedAt.length < 6) {
      playInfoCache[key] = txt;
      playInfoServedAt.push(now);
      debug.playInfoPinned++;
      return Promise.resolve(new Response(txt, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }));
    }
    return _fetch.call(self, input, init).then(function (resp) {
      resp.clone().text().then(function (t2) { if (usablePlayInfo(parseOrNull(t2))) playInfoCache[key] = t2; }).catch(function () {});
      return resp;
    });
  }

  function liveSnapshot() {
    if (!IS_LIVE_PAGE) return null;
    var ready = liveReady();
    return {
      ready: ready, route: liveRouteOf(cfg), eff: effLiveRoute(), auto: live.autoRoute,
      cluster: ready ? live.cluster : null, protocol: ready ? live.protocol : null, origRoute: ready ? live.origRoute : null,
      hosts: ready ? liveHostsMap() : null, avail: ready ? live.avail : null, activeHost: ready ? live.activeHost : null,
      pinned: debug.playInfoPinned
    };
  }

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
      videoQnByPath = {}; // 这份 dash 的所有画质档，重建路径→画质对照
      eachTrack(dash.video, function (top, track) {
        changed = true; var h = hostOf(top);
        if (track && typeof track.id === "number") videoQnByPath[pathOf(top)] = track.id; // dash 的 id 即画质代码 qn
        if (!vHost) { vHost = h; noteEarlySample(top); }
      });
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
    for (var i = 0; i < arr.length; i++) { var top = applyTrack(arr[i]); if (top) onTop(top, arr[i]); }
  }
  function rewriteRoot(root, source) {
    try {
      if (!root || typeof root !== "object") return false;
      var d = root.data || root.result || root;
      // 番剧/课程（pgc v2、SSR playurlSSRData）把 dash/durl 多包一层在 result.video_info 下
      if (d && typeof d === "object" && d.video_info && typeof d.video_info === "object" &&
          (d.video_info.dash || d.video_info.durl)) d = d.video_info;
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
  // 各类型页面的 playurl 端点（实测自 player core bundle）：
  //  - 一般影片: x/player/wbi/playurl、x/player/playurl
  //  - 番剧:     pgc/player/web/v2/playurl（旧版无 v2）
  //  - 课程:     pugv/player/web/playurl
  var PLAYURL_RE = /(x\/player\/(wbi\/)?playurl|pgc\/player\/web\/(v2\/)?playurl|pugv\/player\/web\/playurl)/i;

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
        if (IS_LIVE_PAGE) {
          if (PLAYINFO_RE.test(url) && liveActive()) {
            try { return playInfoFetch(_fetch, this, input, init, new URL(url, location.href)); } catch (e) {}
          }
          var li = liveInfo(url);
          if (li) return liveFetch(_fetch, this, input, init, li);
        }
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
        if (isSegUrl(url)) {
          var t0 = Date.now();
          lastSegReqAt = t0;
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
          if (IS_LIVE_PAGE && typeof url === "string") {
            // XHR 没有就地重试的办法，只做 host 改写（直播流实测都走 fetch，这里是保险）
            var xli = liveInfo(url);
            if (xli) {
              noteLiveRequest(xli, xli.u.href);
              var xt = liveTargetHost(xli);
              if (xt) { url = replaceHost(xli.u.href, xt); debug.segRewriteCount++; }
            }
          }
          if (ACTIVE && typeof url === "string" && isSwappableSeg(url)) { url = swapSegHost(url); debug.segRewriteCount++; }
          this.__cdnSwitcherUrl = url;
          this.__cdnSwitcherIsSeg = typeof url === "string" && isSegUrl(url);
        } catch (e) {}
        return open.call(this, method, url, arguments.length > 2 ? arguments[2] : true, arguments[3], arguments[4]);
      };
      proto.send = function () {
        var self = this, url = self.__cdnSwitcherUrl || "";
        if (self.__cdnSwitcherIsSeg) {
          var t0 = Date.now();
          lastSegReqAt = t0;
          self.addEventListener("load", function () {
            try {
              var bytes = 0;
              if (self.response instanceof ArrayBuffer) bytes = self.response.byteLength;
              else { var cl = self.getResponseHeader("content-length"); if (cl) bytes = parseInt(cl, 10) || 0; }
              addSample(bytes, Date.now() - t0, true);
              if (shouldFallbackOnStatus(self.status, self.__cdnSwitcherUrl || "")) maybeFallback("http-" + self.status);
            } catch (e) {}
          });
          self.addEventListener("error", function () {
            if (isCurrentSegHost(hostOf(self.__cdnSwitcherUrl || ""))) maybeFallback("network-error");
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
      if (t && t.tagName === "VIDEO" && t === getMainVideo()) triggerFallback("video-error");
    } catch (err) {}
  }, true);

  // ---------------- 被动观测「当前 CDN」（不改变任何原生行为）----------------
  var lastSegUrl = ""; // 最近一个「已实际下载完」的分段 URL，最准确，但要等播放器真的抓过分段才有
  var earlySegUrl = ""; // playurl/playinfo 一解析完就有：当前画质第一个 video track 的 URL，不用等开始播放
  function noteEarlySample(url) { if (url) earlySegUrl = url; }
  function sampleUrl() { return lastSegUrl || earlySegUrl; } // 手动测速用：优先用真实下载过的，没有才退回 early

  function noteSegment(url) {
    lastSegUrl = url;
    maybeScheduleAutoTest();
    var q = videoQnByPath[pathOf(url)]; // 是 video 分段才会命中；audio 分段不动画质
    if (typeof q === "number") lastVideoQn = q;
    var h = hostOf(url);
    if (h && h !== debug.currentCdn) { debug.currentCdn = h; renderOverlay(); postDebug(); }
  }
  try {
    var po = new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (!e.name || !isSegUrl(e.name)) continue;
        noteSegment(e.name);
        if (e.transferSize > 0 && e.duration > 0) addSample(e.transferSize, e.duration, false);
      }
    });
    po.observe({ type: "resource", buffered: true });
  } catch (e) {}

  // ---------------- 手动测速：拿「当前影片＋当前画质」的分段，逐一实测各节点速度 ----------------
  // 只在 popup 按下按钮时执行一次；不影响使用者当下选择的 CDN，跑完只回报结果给 popup 显示。
  // popup 离开测速页或关闭时会送 speedtest-stop，中止目前请求、不再排下一个节点。
  // 每个节点下载到 N MB 或测满 N 秒先到者为准；预设 8MB / 5 秒，使用者可在 popup 进阶设定调整，
  // 每次开测由 popup 带进来（clampNum 挡掉不合理的值）
  var ST_DEFAULT_MB = 8, ST_DEFAULT_SEC = 5;
  var stMaxBytes = ST_DEFAULT_MB * 1024 * 1024;
  var stMaxMs = ST_DEFAULT_SEC * 1000;
  function clampNum(v, min, max, dflt) { v = Number(v); return isFinite(v) && v > 0 ? Math.min(max, Math.max(min, v)) : dflt; }
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
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, stMaxMs);
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
            if (received >= stMaxBytes) { try { reader.cancel(); } catch (e) {} finish(received, null); return; }
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
  function runSpeedTest(hosts, limits) {
    limits = limits || {};
    stMaxBytes = clampNum(limits.mb, 1, 100, ST_DEFAULT_MB) * 1024 * 1024;
    stMaxMs = clampNum(limits.sec, 1, 60, ST_DEFAULT_SEC) * 1000;
    if (!sampleUrl()) {
      try { window.postMessage({ __cdnSwitcher: 1, dir: "speedtest-done", payload: { error: "no-sample" } }, "*"); } catch (e) {}
      return;
    }
    if (speedTestAbort) { try { speedTestAbort.abort(); } catch (e) {} }
    abortLiveTestCtrls();
    var myGen = ++speedTestGen;
    speedTestRunning = true;
    try { window.postMessage({ __cdnSwitcher: 1, dir: "speedtest-meta", payload: { title: getVideoTitle(), qn: qnText() } }, "*"); } catch (e) {}
    var i = 0;
    (function next() {
      if (myGen !== speedTestGen) return; // 已被更新一轮取代，不再回报也不再继续
      if (i >= hosts.length) {
        speedTestRunning = false;
        speedTestAbort = null;
        try { window.postMessage({ __cdnSwitcher: 1, dir: "speedtest-done", payload: {} }, "*"); } catch (e) {}
        return;
      }
      var host = hosts[i++];
      measureHost(host).then(function (r) {
        if (myGen !== speedTestGen) return;
        try { window.postMessage({ __cdnSwitcher: 1, dir: "speedtest-progress", payload: r }, "*"); } catch (e) {}
        next();
      });
    })();
  }

  // ---------------- 影片自动测速并切换到最快节点（进阶设定，预设关闭）----------------
  // 每支影片先用目前选的节点播放，第一个分段下载完、过几秒（让起播先顺下来）后在背景逐一测速，
  // 测完把最快的节点回报给 bridge 写进 storage（等同用户自己换节点：播放器内重载、存起来下次沿用）。
  // 同一支影片（含切换节点或整页重载后）只测一次：测过的影片记在 sessionStorage。
  // 与手动测速共用 speedTestGen：popup 开始手动测速会让自动测速这一轮作废。
  var AUTO_TEST_KEY = "__CDN_SWITCHER_AUTOTEST__";
  var AUTO_TEST_DELAY_MS = 5000;
  var autoTestKey = null, autoTestTimer = null, autoTestRunning = false;
  function videoKey() {
    try { var u = new URL(location.href); return u.pathname + "|" + (u.searchParams.get("p") || "1"); } catch (e) { return location.pathname; }
  }
  function testedKeys() {
    try { return JSON.parse(window.sessionStorage.getItem(AUTO_TEST_KEY) || "[]"); } catch (e) { return []; }
  }
  function markTested(key) {
    var ks = testedKeys();
    if (ks.indexOf(key) < 0) ks.push(key);
    try { window.sessionStorage.setItem(AUTO_TEST_KEY, JSON.stringify(ks.slice(-50))); } catch (e) {}
  }
  function maybeScheduleAutoTest() {
    if (IS_LIVE_PAGE || !ACTIVE || !cfg.autoSpeedSwitch || !isActive(cfg)) return;
    if (!WATCH_RE.test(location.pathname)) return;
    var key = videoKey();
    if (key === autoTestKey) return;
    autoTestKey = key;
    if (testedKeys().indexOf(key) >= 0) return;
    markTested(key);
    clearTimeout(autoTestTimer);
    autoTestTimer = setTimeout(function () {
      if (videoKey() === key && cfg.autoSpeedSwitch && isActive(cfg)) runAutoSpeedTest(cfg.autoSpeedHosts || []);
    }, AUTO_TEST_DELAY_MS);
  }
  function runAutoSpeedTest(hosts) {
    if (speedTestRunning || autoTestRunning || !hosts.length || !sampleUrl()) return;
    stMaxBytes = clampNum(cfg.stVideoMb, 1, 100, ST_DEFAULT_MB) * 1024 * 1024;
    stMaxMs = clampNum(cfg.stVideoSec, 1, 60, ST_DEFAULT_SEC) * 1000;
    var myGen = ++speedTestGen;
    autoTestRunning = true;
    var best = null, i = 0;
    (function next() {
      if (myGen !== speedTestGen) { autoTestRunning = false; return; } // 被手动测速取代
      if (i >= hosts.length) {
        autoTestRunning = false;
        speedTestAbort = null;
        if (best && best.host !== cfg.cdnHost && cfg.autoSpeedSwitch) {
          try { window.postMessage({ __cdnSwitcher: 1, dir: "autotest-done", payload: { host: best.host, from: cfg.cdnHost } }, "*"); } catch (e) {}
        }
        return;
      }
      measureHost(hosts[i++]).then(function (r) {
        if (!r.error && r.bps > 0 && (!best || r.bps > best.bps)) best = r;
        next();
      });
    })();
  }

  // ---------------- 直播测速 ----------------
  // 直播不能照搬点播的「拉 8MB 量吞吐」：FLV 是按码率推送，吞吐≈码率，量不出余量（研究报告 0.1 节）。
  // 改量两个互相独立的指标，并列给用户看、不合成单一分数：
  //  - 切台卡顿：发出请求 → 拿到第一个可播放内容的时间。FLV = 第一个音/视频 tag；fMP4 = m3u8 + 起播所需分片。连测 3 次取平均。
  //  - 持续观看：拉 8 秒，用播放缓冲模型估算「会掉队几秒」。起播后播放头每秒走 1 秒，缓冲见底就停下来等；
  //    累计停下来等的秒数 = max(0, 牆上经过秒 − 已收到节目秒) 在整段期间的最大值（Skorokhod reflection）。
  //    FLV 以 tag 时间戳算节目秒；fMP4 以分片下载完成的时刻与 #EXTINF 算，起播前先缓冲 3 片（同 hls.js 预设）。
  // 一律用 NATIVE_FETCH 绕开上面装的 fetch hook，也不影响用户目前选的线路；测速会与正在播放的直播抢频宽。
  var LIVE_DEFAULT_RUNS = 3, LIVE_DEFAULT_SECS = 8; // 使用者可在 popup 进阶设定调整，每次开测带进来
  var liveStartupRuns = LIVE_DEFAULT_RUNS;
  var LIVE_STARTUP_TIMEOUT_MS = 6000; // 单次起播（或持续测试等到第一份资料）超过这个时间算失败
  var liveSustainSecs = LIVE_DEFAULT_SECS;
  var LIVE_HLS_START_SEGS = 3;
  var liveTestCtrls = [];

  function newLiveTestCtrl(timeoutMs) {
    var c = new AbortController();
    c.__timer = timeoutMs ? setTimeout(function () { try { c.abort(); } catch (e) {} }, timeoutMs) : null;
    liveTestCtrls.push(c);
    return c;
  }
  function releaseLiveTestCtrl(c) {
    clearTimeout(c.__timer);
    var i = liveTestCtrls.indexOf(c);
    if (i >= 0) liveTestCtrls.splice(i, 1);
    try { c.abort(); } catch (e) {}
  }
  function abortLiveTestCtrls() { liveTestCtrls.slice().forEach(releaseLiveTestCtrl); }

  function ltErr(code) { var e = new Error(code); e.code = code; return e; }
  function ltCode(e, ctrl) { return (e && e.code) || (ctrl && ctrl.signal.aborted ? "timeout" : "network-error"); }
  function sleepMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // 只解 FLV 的 tag 头（类型 + 时间戳），不碰内容
  function FlvParser() { this.buf = new Uint8Array(0); this.headerDone = false; this.bad = false; }
  FlvParser.prototype.push = function (chunk) {
    var b = this.buf, tags = [], pos = 0;
    if (b.length) { var n = new Uint8Array(b.length + chunk.length); n.set(b); n.set(chunk, b.length); b = n; } else b = chunk;
    if (!this.headerDone) {
      if (b.length < 13) { this.buf = b; return tags; }
      if (b[0] !== 0x46 || b[1] !== 0x4c || b[2] !== 0x56) { this.bad = true; return tags; } // 不是 "FLV"
      var off = ((b[5] << 24) | (b[6] << 16) | (b[7] << 8) | b[8]) >>> 0;
      if (b.length < off + 4) { this.buf = b; return tags; }
      pos = off + 4; this.headerDone = true;
    }
    while (b.length - pos >= 11) {
      var size = (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
      if (b.length - pos < 11 + size + 4) break;
      var ts = ((b[pos + 4] << 16) | (b[pos + 5] << 8) | b[pos + 6]) + b[pos + 7] * 16777216;
      tags.push({ type: b[pos] & 0x1f, ts: ts });
      pos += 11 + size + 4;
    }
    this.buf = b.subarray(pos);
    return tags;
  };
  function isAvTag(t) { return t.type === 8 || t.type === 9; } // 8 = 音频、9 = 视频（18 是 script/metadata，不算画面）

  function parseM3u8(text, baseUrl) {
    var segs = [], map = null, dur = 1, lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf("#EXTINF:") === 0) dur = parseFloat(line.slice(8)) || 1;
      else if (line.indexOf("#EXT-X-MAP:") === 0) { var m = /URI="([^"]+)"/.exec(line); if (m) map = new URL(m[1], baseUrl).href; }
      else if (line.charAt(0) !== "#") { segs.push({ url: new URL(line, baseUrl).href, dur: dur, key: line }); dur = 1; }
    }
    return { segs: segs, map: map };
  }
  async function liveHlsPlaylist(url, ctrl) {
    var resp = await NATIVE_FETCH(url, { signal: ctrl.signal, cache: "no-store" });
    if (!resp.ok) throw ltErr("http-" + resp.status);
    var text = await resp.text();
    if (text.indexOf("#EXTM3U") < 0) throw ltErr("no-stream");
    return parseM3u8(text, url);
  }
  async function liveHlsBytes(url, ctrl) {
    var resp = await NATIVE_FETCH(url, { signal: ctrl.signal, cache: "no-store" });
    if (!resp.ok) throw ltErr("http-" + resp.status);
    return (await resp.arrayBuffer()).byteLength;
  }

  async function liveFlvStartup(url) {
    var ctrl = newLiveTestCtrl(LIVE_STARTUP_TIMEOUT_MS), t0 = performance.now();
    try {
      var resp = await NATIVE_FETCH(url, { signal: ctrl.signal, cache: "no-store" });
      if (!resp.ok) throw ltErr("http-" + resp.status);
      if (!resp.body) throw ltErr("no-stream");
      var reader = resp.body.getReader(), parser = new FlvParser();
      for (;;) {
        var r = await reader.read();
        if (r.done) throw ltErr("no-data");
        var tags = parser.push(r.value);
        if (parser.bad) throw ltErr("no-stream");
        if (tags.some(isAvTag)) return performance.now() - t0;
      }
    } catch (e) { throw ltErr(ltCode(e, ctrl)); }
    finally { releaseLiveTestCtrl(ctrl); }
  }

  async function liveHlsStartup(url) {
    var ctrl = newLiveTestCtrl(LIVE_STARTUP_TIMEOUT_MS), t0 = performance.now();
    try {
      var pl = await liveHlsPlaylist(url, ctrl);
      if (!pl.segs.length) throw ltErr("no-data");
      var seg = pl.segs[Math.max(0, pl.segs.length - LIVE_HLS_START_SEGS)]; // 播放器从离直播边缘约 3 片处起播
      var jobs = [liveHlsBytes(seg.url, ctrl)];
      if (pl.map) jobs.push(liveHlsBytes(pl.map, ctrl));
      await Promise.all(jobs);
      return performance.now() - t0;
    } catch (e) { throw ltErr(ltCode(e, ctrl)); }
    finally { releaseLiveTestCtrl(ctrl); }
  }

  // 回传「掉队秒数」（>= 0）
  async function liveFlvSustain(url) {
    var ctrl = newLiveTestCtrl(LIVE_STARTUP_TIMEOUT_MS), endTimer = null;
    try {
      var resp = await NATIVE_FETCH(url, { signal: ctrl.signal, cache: "no-store" });
      if (!resp.ok) throw ltErr("http-" + resp.status);
      if (!resp.body) throw ltErr("no-stream");
      var reader = resp.body.getReader(), parser = new FlvParser();
      var w0 = null, baseTs = 0, media = 0, maxDef = 0;
      for (;;) {
        var r;
        try { r = await reader.read(); } catch (e) { if (w0 !== null) break; throw e; } // 8 秒到了被我们中止
        if (r.done) break;
        var now = performance.now();
        var tags = parser.push(r.value);
        if (parser.bad) throw ltErr("no-stream");
        tags = tags.filter(isAvTag);
        if (!tags.length) continue;
        if (w0 === null) {
          w0 = now; baseTs = tags[0].ts;
          clearTimeout(ctrl.__timer);
          endTimer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, liveSustainSecs * 1000);
        } else {
          // 这一批到达的时刻，播放头相对已收到节目秒的落差（批内各 tag 同时到达，只算一次）
          var def = (now - w0) / 1000 - media;
          if (def > maxDef) maxDef = def;
        }
        for (var i = 0; i < tags.length; i++) { var m = (tags[i].ts - baseTs) / 1000; if (m > media) media = m; }
      }
      if (w0 === null) throw ltErr("no-data");
      return Math.max(0, maxDef, liveSustainSecs - media);
    } catch (e) { throw ltErr(ltCode(e, ctrl)); }
    finally { clearTimeout(endTimer); releaseLiveTestCtrl(ctrl); }
  }

  async function liveHlsSustain(url, gen) {
    var ctrl = newLiveTestCtrl(LIVE_STARTUP_TIMEOUT_MS * 2), endTimer = null; // 起播缓冲阶段的总时限
    try {
      var pl = await liveHlsPlaylist(url, ctrl);
      if (!pl.segs.length) throw ltErr("no-data");
      var seen = {}, media = 0, maxDef = 0, i;
      var start = pl.segs.slice(-LIVE_HLS_START_SEGS);
      for (i = 0; i < pl.segs.length; i++) seen[pl.segs[i].key] = 1;
      if (pl.map) await liveHlsBytes(pl.map, ctrl);
      for (i = 0; i < start.length; i++) { await liveHlsBytes(start[i].url, ctrl); media += start[i].dur; }
      var w0 = performance.now();
      clearTimeout(ctrl.__timer);
      endTimer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, liveSustainSecs * 1000);
      while (gen === speedTestGen && performance.now() - w0 < liveSustainSecs * 1000) {
        var pl2;
        try { pl2 = await liveHlsPlaylist(url, ctrl); } catch (e) {
          if (ctrl.signal.aborted) break;
          await sleepMs(300); continue; // 偶发失败：下一轮再抓
        }
        var fresh = pl2.segs.filter(function (s) { return !seen[s.key]; });
        for (i = 0; i < fresh.length; i++) {
          seen[fresh[i].key] = 1;
          try { await liveHlsBytes(fresh[i].url, ctrl); } catch (e) { if (ctrl.signal.aborted) break; continue; }
          var def = (performance.now() - w0) / 1000 - media;
          if (def > maxDef) maxDef = def;
          media += fresh[i].dur;
        }
        if (ctrl.signal.aborted) break;
        await sleepMs(400);
      }
      return Math.max(0, maxDef, liveSustainSecs - media);
    } catch (e) {
      // 8 秒到时 abort 可能落在抓分片中途：起播已完成的话，这不算失败
      if (ctrl.signal.aborted && endTimer !== null) return Math.max(0, maxDef, liveSustainSecs - media);
      throw ltErr(ltCode(e, ctrl));
    }
    finally { clearTimeout(endTimer); releaseLiveTestCtrl(ctrl); }
  }

  function postSpeedtest(dir, payload) {
    try { window.postMessage({ __cdnSwitcher: 1, dir: dir, payload: payload || {} }, "*"); } catch (e) {}
  }

  async function runLiveSpeedTest(limits) {
    limits = limits || {};
    liveStartupRuns = Math.round(clampNum(limits.runs, 1, 10, LIVE_DEFAULT_RUNS));
    liveSustainSecs = clampNum(limits.sec, 3, 60, LIVE_DEFAULT_SECS);
    if (!liveReady()) { postSpeedtest("speedtest-done", { error: "no-sample" }); return; }
    if (speedTestAbort) { try { speedTestAbort.abort(); } catch (e) {} }
    abortLiveTestCtrls();
    var myGen = ++speedTestGen, st = live;
    speedTestRunning = true;
    var isFlv = st.protocol === "flv";
    postSpeedtest("speedtest-meta", { title: getVideoTitle(), qn: isFlv ? "FLV" : "HLS (fMP4)" });
    // 先确认四条线路在这个直播间是否都存在；不存在的不测、也不会出现在结果里
    var found = await Promise.all(LIVE_ROUTES.map(probeLiveRoute));
    if (myGen !== speedTestGen) return;
    var avail = {};
    for (var a = 0; a < LIVE_ROUTES.length; a++) { avail[LIVE_ROUTES[a]] = found[a]; if (live === st) st.avail[LIVE_ROUTES[a]] = found[a]; }
    if (live === st) st.probed = true;
    postSpeedtest("speedtest-avail", { avail: avail });
    if (!found.some(Boolean)) { speedTestRunning = false; postSpeedtest("speedtest-done", { error: "unavailable" }); return; }
    for (var i = 0; i < LIVE_ROUTES.length; i++) {
      var route = LIVE_ROUTES[i];
      if (!avail[route]) continue;
      var host = liveHostFor(st.prefix, st.cluster, st.suffix, route), url = replaceHost(st.sampleUrl, host);
      var samples = [], lastErr = null;
      for (var k = 0; k < liveStartupRuns; k++) {
        try { samples.push(await (isFlv ? liveFlvStartup(url) : liveHlsStartup(url))); } catch (e) { lastErr = e.code || "network-error"; }
        if (myGen !== speedTestGen) return;
        if (!samples.length && k >= 1) break; // 连续两次都连不上就不用再试了
        await sleepMs(200);
      }
      if (!samples.length) { postSpeedtest("speedtest-progress", { route: route, host: host, error: lastErr }); continue; }
      var avg = samples.reduce(function (s, v) { return s + v; }, 0) / samples.length;
      postSpeedtest("speedtest-progress", { route: route, host: host, startup: { avg: avg, samples: samples } });
      try {
        var lag = await (isFlv ? liveFlvSustain(url) : liveHlsSustain(url, myGen));
        if (myGen !== speedTestGen) return;
        postSpeedtest("speedtest-progress", { route: route, host: host, sustain: { lag: lag } });
      } catch (e) {
        if (myGen !== speedTestGen) return;
        postSpeedtest("speedtest-progress", { route: route, host: host, sustainError: e.code || "network-error" });
      }
    }
    if (myGen !== speedTestGen) return;
    speedTestRunning = false;
    postSpeedtest("speedtest-done", {});
  }

  function stopSpeedTest() {
    if (!speedTestRunning) return;
    speedTestGen++; // 让目前这一轮的 continuation 全部失效
    speedTestRunning = false;
    if (speedTestAbort) { try { speedTestAbort.abort(); } catch (e) {} }
    abortLiveTestCtrls();
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__cdnSwitcher !== 1) return;
    if (d.dir === "speedtest-run") { runSpeedTest((d.payload && d.payload.hosts) || [], d.payload && d.payload.limits); return; }
    if (d.dir === "speedtest-stop") { stopSpeedTest(); return; }
    if (d.dir === "livetest-run") { runLiveSpeedTest(d.payload && d.payload.limits); return; }
    if (d.dir === "debug-poll") { probeLiveAvail(); return; }
    if (d.dir === "messages" && d.payload) { for (var mk in DEFAULT_MSGS) if (d.payload[mk]) MSGS[mk] = d.payload[mk]; return; }
  });

  // ---------------- 切换 CDN 时的重载策略 ----------------
  function effSig(c) { return isActive(c) ? ("on:" + c.cdnHost) : "off"; }
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
    if (!d || d.__cdnSwitcher !== 1 || d.dir !== "config") return;
    if (!d.payload) return;
    var beforeSig = effSig(cfg), beforeActive = ACTIVE, beforeEffHost = effHost(), beforeLiveSig = liveSig(cfg);
    for (var k in DEFAULTS) if (d.payload[k] !== undefined) cfg[k] = d.payload[k];
    // 中途关掉「失败自动切换」：收掉正在显示的「皆无法播放」询问弹窗（persistent，不会自己消失）
    if (!cfg.autoFallback && askToastOn) { askToastOn = false; hideToast(); }
    renderOverlay();
    if (IS_LIVE_PAGE) {
      // 直播页只看直播设定：开关/线路变了 → 自动回退的覆写作废，播放器内重载让新线路生效（不整页重载）
      if (beforeLiveSig !== liveSig(cfg)) {
        live.autoRoute = null; liveFb.lastAt = 0;
        if (live.sampleUrl) {
          liveReload();
          // 換線路（不含開／關）跟影片換節點一樣弹 toast 告知换到哪条线路
          if (beforeLiveSig !== "off" && liveActive()) {
            var rk = { ov: "liveRouteOv", ovb: "liveRouteOvB", cn: "liveRouteCn", cnb: "liveRouteCnB" }[liveRouteOf(cfg)];
            showToast(MSGS.mhToastSwitched.replace("{host}", MSGS[rk] || liveRouteOf(cfg)));
          }
        }
        postDebug();
      }
      return;
    }
    if (beforeSig === effSig(cfg)) return; // 只改了 showDebug / autoFallback 之类 → 不动（保留 autoHost）
    autoHost = null; // 用户手动改了节点/开关：自动回退的静默覆写作废，以用户选择为准
    var afterActive = isActive(cfg);
    // 换节点（手动或自动测速）会闪一下黑画面：跟失败自动切换一样弹 toast 告知换到哪个节点；
    // 只开/关重排不算换节点，不弹
    var switchedText = (beforeActive && afterActive && WATCH_RE.test(location.pathname))
      ? MSGS.mhToastSwitched.replace("{host}", cfg.cdnHost === "backup" ? MSGS.mhCdnTargetBackup : cfg.cdnHost) : "";
    if (beforeActive !== afterActive) {
      fullReload(); // 需安装/移除 hook（开/关重排、切到/离开「原始」）
    } else if (cfg.cdnHost === "backup" || beforeEffHost === "backup") {
      toastAfterReload(switchedText);
      fullReload(); // 「备用」走 playurl 层，需重打 playurl 才生效 → 整页重载
    } else if (playerReload()) {
      if (switchedText) showToast(switchedText); // 具名节点：播放器内重载（分段层即时导向）
    } else {
      toastAfterReload(switchedText);
      fullReload();
    }
  });

  // 整页重载才生效的切换：toast 文字先放 sessionStorage，重载后等播放器出现再弹（读到就删）
  var SWITCH_TOAST_KEY = "__CDN_SWITCHER_SWITCH_TOAST__";
  function toastAfterReload(text) {
    if (!text) return;
    try { window.sessionStorage.setItem(SWITCH_TOAST_KEY, text); } catch (e) {}
  }
  (function showPendingSwitchToast() {
    var text = null;
    try { text = window.sessionStorage.getItem(SWITCH_TOAST_KEY); window.sessionStorage.removeItem(SWITCH_TOAST_KEY); } catch (e) {}
    if (!text) return;
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (getToastHost() !== document.body || tries > 40) { clearInterval(iv); showToast(text); }
    }, 500);
  })();

  // ---------------- Debug overlay（仅在有播放器时，显示于其左上角）----------------
  var overlayEl = null;
  var PLAYER_SEL = [".bpx-player-video-area", ".bpx-player-container", "#bilibili-player", ".bpx-player-primary-area", "#live-player"];
  function getPlayerEl() {
    for (var i = 0; i < PLAYER_SEL.length; i++) { var e = document.querySelector(PLAYER_SEL[i]); if (e) return e; }
    return null;
  }
  function cdnTargetLabel() {
    if (cfg.cdnHost === "base") return MSGS.mhCdnTargetOriginal;
    if (cfg.cdnHost === "backup") return MSGS.mhCdnTargetBackup;
    return cfg.cdnHost;
  }
  function buildLiveDebugText() {
    var lines = [
      MSGS.mhDebugTitle,
      "mode=" + (liveActive() ? "on" : "off") + "  target=" + liveRouteOf(cfg)
    ];
    if (live.autoRoute) lines.push("auto-fallback -> " + live.autoRoute);
    lines.push(
      "cdn=" + (live.activeHost || "-"),
      "proto=" + (live.protocol || "-") + "  cluster=" + (live.cluster || "-") + "  orig=" + (live.origRoute || "-") + "  seg=" + debug.segRewriteCount + "  pin=" + debug.playInfoPinned
    );
    return lines.join("\n");
  }
  function buildDebugText() {
    if (IS_LIVE_PAGE) return buildLiveDebugText();
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
      overlayEl.id = "bcs-debug-overlay";
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
      window.postMessage({ __cdnSwitcher: 1, dir: "debug", payload: {
        currentCdn: debug.currentCdn, pickVideoHost: debug.pickVideoHost, pickAudioHost: debug.pickAudioHost,
        lastSource: debug.lastSource, rewriteCount: debug.rewriteCount, segRewriteCount: debug.segRewriteCount,
        lastQn: currentQn(), enabled: cfg.enabled, cdnHost: cfg.cdnHost, cdnTarget: cdnTargetLabel(), autoHost: autoHost, lastError: debug.lastError,
        speedBps: debug.speedBps, speedIdle: debug.speedIdle, live: liveSnapshot()
      } }, "*");
    } catch (e) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderOverlay);
  else renderOverlay();
  setInterval(function () { updateSpeed(); checkStall(); renderOverlay(); postDebug(); }, 1000);
})();
