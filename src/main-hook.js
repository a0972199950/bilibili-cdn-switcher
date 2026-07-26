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
    showDebug: true
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
  // 具名节点模式（可做分段层即时差替）；'backup' 走 playurl 层、不做分段差替
  function isHostMode() { return cfg.cdnHost !== "base" && cfg.cdnHost !== "backup"; }
  var ACTIVE = isActive(cfg); // 依「载入当下」设定决定是否安装 hook

  var debug = {
    currentCdn: null, pickVideoHost: null, pickAudioHost: null,
    lastSource: null, rewriteCount: 0, segRewriteCount: 0, lastQn: null, lastError: null
  };

  // ---------------- helpers ----------------
  function asStr(v) { return typeof v === "string" ? v.trim() : ""; }
  function hostOf(url) { try { return new URL(url, location.href).host.toLowerCase(); } catch (e) { return ""; } }
  function replaceHost(url, host) { try { var x = new URL(url, location.href); x.host = host; return x.toString(); } catch (e) { return url; } }
  function distinct(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) { var u = arr[i]; if (u && !seen[u]) { seen[u] = 1; out.push(u); } }
    return out;
  }

  var SEG_RE = /\/upgcxcode\/.*\.m4s|\/upgcxcode\//i;
  var CDN_HOST_RE = /(bilivideo\.(com|cn)|akamaized\.net|hdslb\.com)$/i;
  // 是否为「该被差替的分段请求」：具名节点模式、是分段、host 是 CDN、且尚未等于目标
  function isSwappableSeg(url) {
    if (!isHostMode()) return false;
    if (!SEG_RE.test(url)) return false;
    var h = hostOf(url);
    return !!h && CDN_HOST_RE.test(h) && h !== cfg.cdnHost;
  }
  function swapSegHost(url) { return replaceHost(url, cfg.cdnHost); }

  // ---------------- playurl / playinfo 改写（让 baseUrl 也一致，次要）----------------
  function applyTrack(track) {
    var base = asStr(track.baseUrl) || asStr(track.base_url) || asStr(track.url);
    var backups = track.backupUrl || track.backup_url || [];
    if (!Array.isArray(backups)) backups = [];
    backups = backups.map(asStr).filter(Boolean);
    if (!base && !backups.length) return null;
    var ordered;
    if (cfg.cdnHost === "backup") {
      ordered = distinct(backups.concat([base])).filter(Boolean); // 优先 B 站给的备援节点
    } else {
      var swapped = base ? replaceHost(base, cfg.cdnHost) : "";
      ordered = distinct([swapped, base].concat(backups)).filter(Boolean);
    }
    if (!ordered.length) return null;
    var top = ordered[0], rest = ordered.slice(1);
    if ("baseUrl" in track || "base_url" in track || !("url" in track)) {
      track.baseUrl = top; if ("base_url" in track) track.base_url = top;
    } else { track.url = top; }
    track.backupUrl = rest; if ("backup_url" in track) track.backup_url = rest;
    return hostOf(top);
  }
  function rewriteContainer(d) {
    if (!d || typeof d !== "object") return false;
    var changed = false, vHost = null, aHost = null;
    var dash = d.dash;
    if (dash && typeof dash === "object") {
      eachTrack(dash.video, function (h) { changed = true; if (!vHost) vHost = h; });
      eachTrack(dash.audio, function (h) { changed = true; if (!aHost) aHost = h; });
      if (dash.dolby && Array.isArray(dash.dolby.audio)) eachTrack(dash.dolby.audio, function (h) { changed = true; if (!aHost) aHost = h; });
      if (dash.flac && dash.flac.audio) { var h = applyTrack(dash.flac.audio); if (h) { changed = true; if (!aHost) aHost = h; } }
    }
    if (Array.isArray(d.durl)) eachTrack(d.durl, function (h) { changed = true; if (!vHost) vHost = h; });
    if (changed) {
      debug.pickVideoHost = vHost || debug.pickVideoHost;
      debug.pickAudioHost = aHost || debug.pickAudioHost;
      if (typeof d.quality === "number") debug.lastQn = d.quality;
    }
    return changed;
  }
  function eachTrack(arr, onHost) {
    if (!Array.isArray(arr)) return;
    for (var i = 0; i < arr.length; i++) { var h = applyTrack(arr[i]); if (h) onHost(h); }
  }
  function rewriteRoot(root, source) {
    try {
      if (!root || typeof root !== "object") return false;
      var d = root.data || root.result || root;
      var changed = rewriteContainer(d);
      if (changed) { debug.lastSource = source; debug.rewriteCount++; renderOverlay(); postDebug(); }
      return changed;
    } catch (e) { debug.lastError = String(e); return false; }
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
    // __playinfo__（SSR 首个分 P）
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

    // fetch：分段 host 差替 +（次要）playurl 改写
    var _fetch = window.fetch;
    if (typeof _fetch === "function") {
      window.fetch = function (input, init) {
        var url = "";
        try { url = typeof input === "string" ? input : (input && input.url) || ""; } catch (e) {}
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
          if (typeof url === "string" && isSwappableSeg(url)) { url = swapSegHost(url); debug.segRewriteCount++; }
          this.__rogerUrl = url;
        } catch (e) {}
        return open.call(this, method, url, arguments.length > 2 ? arguments[2] : true, arguments[3], arguments[4]);
      };
      proto.send = function () {
        var self = this, url = self.__rogerUrl || "";
        if (PLAYURL_RE.test(url) && textDesc && respDesc) {
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

  if (ACTIVE) installHooks();

  // ---------------- 被动观测「当前 CDN」（不改变任何原生行为）----------------
  function noteSegment(url) {
    var h = hostOf(url);
    if (h && h !== debug.currentCdn) { debug.currentCdn = h; renderOverlay(); postDebug(); }
  }
  try {
    var po = new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) if (es[i].name && SEG_RE.test(es[i].name)) noteSegment(es[i].name);
    });
    po.observe({ type: "resource", buffered: true });
  } catch (e) {}

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
      var v = document.querySelector("video");
      if (v && isFinite(v.currentTime) && v.currentTime > 1) url.searchParams.set("t", String(Math.floor(v.currentTime)));
      location.replace(url.toString());
    } catch (e) { try { location.reload(); } catch (_) {} }
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__rogerCdn !== 1 || d.dir !== "config") return;
    if (!d.payload) return;
    var beforeSig = effSig(cfg), beforeActive = ACTIVE, beforeHost = cfg.cdnHost;
    for (var k in DEFAULTS) if (d.payload[k] !== undefined) cfg[k] = d.payload[k];
    renderOverlay();
    if (beforeSig === effSig(cfg)) return; // 只改了 showDebug 之类 → 不动
    var afterActive = isActive(cfg);
    if (beforeActive !== afterActive) {
      fullReload(); // 需安装/移除 hook（开/关重排、切到/离开「原始」）
    } else if (cfg.cdnHost === "backup" || beforeHost === "backup") {
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
    if (cfg.cdnHost === "base") return "原始（不覆写）";
    if (cfg.cdnHost === "backup") return "备用URL（优先）";
    return cfg.cdnHost;
  }
  function buildDebugText() {
    return [
      "CDN 线路",
      "mode=" + (cfg.enabled ? "on" : "off") + "  target=" + cdnTargetLabel(),
      "cdn=" + (debug.currentCdn || "-"),
      "v=" + (debug.pickVideoHost || "-") + "  a=" + (debug.pickAudioHost || "-"),
      "src=" + (debug.lastSource || "-") + "  rw=" + debug.rewriteCount + "  seg=" + debug.segRewriteCount + "  qn=" + (debug.lastQn || "-")
    ].join("\n");
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
        lastQn: debug.lastQn, enabled: cfg.enabled, cdnHost: cfg.cdnHost, cdnTarget: cdnTargetLabel(), lastError: debug.lastError
      } }, "*");
    } catch (e) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderOverlay);
  else renderOverlay();
  setInterval(function () { renderOverlay(); postDebug(); }, 1000);
})();
