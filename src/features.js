// 功能開關（feature toggle）：後台「功能管理」可以隨時開關的功能，不用發版。popup、擴充內頁共用（在頁面的 script 之前載入）。
//   GET <API>/v1/features → { ok, jws }（report worker，邊緣快取 1 分鐘）。jws 是 ES256 簽章的 compact JWS，
//   payload = { iat（秒）, features: { <key>: { enabled, ...其他屬性 } } }，只列後台存過的功能，沒列的用 DEFAULTS。
//   擴充用內建的公鑰（PUBLIC_KEYS）驗章：storage 或 API 回應被改過、驗不過，就當作沒有這份資料。
// storage.local.featureFlags = { api, jws }：只存簽章原文，每次讀出來都重新驗章。
// 讀不到時（離線、API 故障、驗章失敗）沿用上次驗過章的快取；完全沒有快取就用 DEFAULTS（現有功能＝開啟）。
// 商店版問正式的 api.biboost.app，本機載入的開發版問測試環境（同 donate.js）。management.getSelf 不需要 management 權限。
// 開關關閉＝所有人都不能用。關閉時：入口收起來；有專屬內頁的用 guardPage 整頁換成「找不到這個頁面」（擴充內頁是本機檔案，回不了 HTTP 404）。
var BBFeatures = (function () {
  var API = { prod: "https://api.biboost.app", dev: "https://api-staging.biboost.app" };
  // kid → 公鑰（P-256）。換金鑰時先在這裡加新的 kid、發版，再換 report worker 的 FEATURES_SIGNING_KEY
  var PUBLIC_KEYS = {
    f1: { kty: "EC", crv: "P-256", x: "UQMcBk_Bck5s3VFGPLBnNBnEg_dzz6q0Pm2k3RKcN0I", y: "YPwo2Nlyf1gp1vRwzYt3UjQ2iyjN1zoY7gkISL1MWt0" }
  };
  // 預設值（同 scripts/lib/features.mjs 的 FEATURES，測試會比對）
  var DEFAULTS = {
    donate: { enabled: true }
  };
  var STORE_KEY = "featureFlags";
  // guardPage 的預設文字，key 是 common.js 的 uiLangCode()
  var NOT_FOUND = {
    zhtw: { title: "找不到這個頁面", body: "這個功能目前沒有開放。" },
    zhhk: { title: "搵唔到呢個頁面", body: "呢個功能暫時未開放。" },
    zhcn: { title: "找不到这个页面", body: "这个功能目前没有开放。" },
    en: { title: "Page not found", body: "This feature is not available right now." },
    ja: { title: "ページが見つかりません", body: "この機能は現在ご利用いただけません。" },
    ko: { title: "페이지를 찾을 수 없습니다", body: "이 기능은 현재 이용할 수 없습니다." }
  };

  function b64urlBytes(s) {
    var bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64urlJson(s) {
    return JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
  }
  var keyCache = {};
  function importKey(jwk) {
    var id = jwk.x + "." + jwk.y;
    keyCache[id] = keyCache[id] || crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return keyCache[id];
  }
  // compact JWS（ES256）→ 驗過的 payload，或 null。keys：{ kid: jwk }
  function verifyJws(jws, keys) {
    return Promise.resolve().then(function () {
      var parts = typeof jws === "string" ? jws.split(".") : [];
      if (parts.length !== 3) return null;
      var header = b64urlJson(parts[0]);
      var jwk = header && header.alg === "ES256" && Object.prototype.hasOwnProperty.call(keys, header.kid) ? keys[header.kid] : null;
      if (!jwk) return null;
      var sig = b64urlBytes(parts[2]);
      if (sig.length !== 64) return null;
      return importKey(jwk).then(function (key) {
        return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, new TextEncoder().encode(parts[0] + "." + parts[1]));
      }).then(function (ok) {
        if (!ok) return null;
        var payload = b64urlJson(parts[1]);
        return payload && typeof payload === "object" ? payload : null;
      });
    }).catch(function () { return null; });
  }

  var apiPromise = null;
  function apiBase() {
    apiPromise = apiPromise || new Promise(function (resolve) {
      try { chrome.management.getSelf(function (self) { resolve(self && self.installType === "development" ? API.dev : API.prod); }); }
      catch (e) { resolve(API.prod); }
    });
    return apiPromise;
  }

  // 驗過章的 payload.features → 每個功能的值（預設值＋後台存過的）
  function resolve(features) {
    var out = {}, k;
    for (k in DEFAULTS) out[k] = Object.assign({}, DEFAULTS[k]);
    if (features && typeof features === "object") {
      for (k in features) {
        if (features[k] && typeof features[k] === "object") out[k] = Object.assign({ enabled: true }, out[k] || {}, features[k]);
      }
    }
    return out;
  }
  function validPayload(p) {
    return p && typeof p.iat === "number" && p.features && typeof p.features === "object" ? p : null;
  }

  // storage 裡的快取（重新驗章）→ payload 或 null
  function stored(api) {
    return new Promise(function (r) { chrome.storage.local.get(STORE_KEY, function (s) { r(s && s[STORE_KEY]); }); })
      .then(function (c) { return c && c.api === api ? verifyJws(c.jws, PUBLIC_KEYS).then(validPayload) : null; });
  }

  // 目前的開關：先看驗過章的快取，沒有就用預設值
  function load() {
    return apiBase().then(stored).then(function (p) { return resolve(p && p.features); });
  }

  // 問 API；驗章通過才存。回傳新的開關，失敗回 null
  function refresh() {
    return apiBase().then(function (api) {
      return fetch(api + "/v1/features", { credentials: "omit", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (j) { return j && j.ok ? verifyJws(j.jws, PUBLIC_KEYS).then(validPayload).then(function (p) { return p && { p: p, jws: j.jws }; }) : null; })
        .then(function (v) {
          if (!v) return null;
          return new Promise(function (r) {
            var o = {}; o[STORE_KEY] = { api: api, jws: v.jws };
            chrome.storage.local.set(o, r);
          }).then(function () { return resolve(v.p.features); });
        })
        .catch(function () { return null; });
    });
  }

  // popup 用：先用快取（或預設值）呼叫 cb，再問 API，結果不一樣就再呼叫一次
  function watch(cb) {
    return load().then(function (cur) {
      cb(cur);
      return refresh().then(function (next) {
        if (next && JSON.stringify(next) !== JSON.stringify(cur)) cb(next);
        return next || cur;
      });
    });
  }

  function enabled(flags, key) {
    var f = flags && flags[key];
    return !f || f.enabled !== false;
  }

  // 擴充內頁用：功能關閉時整頁換成「找不到這個頁面」。text：{ title, body }（省略＝NOT_FOUND 依介面語言），回傳 Promise<是否開啟>
  function guardPage(key, text) {
    return watch(function () {}).then(function (flags) {
      if (enabled(flags, key)) return true;
      var lang = typeof uiLangCode === "function" ? uiLangCode() : "en";
      var t = text || NOT_FOUND[lang] || NOT_FOUND.en;
      document.title = t.title || "404";
      var body = document.body || document.documentElement.appendChild(document.createElement("body"));
      body.textContent = "";
      var box = document.createElement("main");
      box.className = "bb-not-found";
      box.style.cssText = "max-width:480px;margin:80px auto;padding:0 16px;text-align:center;font:15px/1.6 system-ui,sans-serif";
      var h = document.createElement("h1");
      h.textContent = t.title || "404";
      var p = document.createElement("p");
      p.textContent = t.body || "";
      box.appendChild(h);
      box.appendChild(p);
      body.appendChild(box);
      return false;
    });
  }

  var api = { load: load, refresh: refresh, watch: watch, enabled: enabled, guardPage: guardPage, verifyJws: verifyJws, DEFAULTS: DEFAULTS, PUBLIC_KEYS: PUBLIC_KEYS, STORE_KEY: STORE_KEY, NOT_FOUND: NOT_FOUND };
  // Test seam: only the unit-test harness (test/helpers/load.mjs) defines __BCS_TEST__.
  if (globalThis.__BCS_TEST__ && typeof globalThis.__BCS_TEST__.register === "function") globalThis.__BCS_TEST__.register("features", api);
  return api;
})();
