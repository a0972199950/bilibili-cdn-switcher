// Test harness: runs the extension's browser scripts (src/*.js) inside a jsdom window with a
// fake `chrome.*` API, and collects the internals each script registers through the
// `globalThis.__BCS_TEST__` seam at the end of its IIFE.
//
// Usage:
//   const env = createEnv({ url: "https://www.bilibili.com/video/BV1xx" });
//   env.load("main-hook.js");               // evaluates src/main-hook.js in the window
//   const mh = env.internals("main-hook");  // whatever the file registered
//   ...
//   env.close();                             // clears jsdom timers
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..", "..");
export const SRC = path.join(ROOT, "src");
export const EXT_URL = "chrome-extension://bcs-test/";

// Objects created inside the jsdom window have a different Object prototype, which makes
// assert.deepStrictEqual fail; compare them through JSON instead.
export function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

export function readSrc(file) {
  return fs.readFileSync(path.join(SRC, file), "utf8");
}
export function readSrcJson(file) {
  return JSON.parse(readSrc(file));
}

const enMessages = readSrcJson(path.join("_locales", "en", "messages.json"));

// chrome.storage.* semantics (sync callbacks are good enough for tests)
function makeStorageArea(initial, areaName, onChangedListeners) {
  const data = { ...(initial || {}) };
  function resolveKeys(keys) {
    if (keys == null) return { ...data };
    if (typeof keys === "string") return keys in data ? { [keys]: data[keys] } : {};
    if (Array.isArray(keys)) {
      const out = {};
      for (const k of keys) if (k in data) out[k] = data[k];
      return out;
    }
    const out = {};
    for (const k of Object.keys(keys)) out[k] = k in data ? data[k] : keys[k];
    return out;
  }
  function fireChanges(changes) {
    if (!Object.keys(changes).length) return;
    for (const fn of onChangedListeners.slice()) fn(changes, areaName);
  }
  return {
    data,
    get(keys, cb) {
      const out = resolveKeys(keys);
      if (cb) cb(out);
      return Promise.resolve(out);
    },
    set(obj, cb) {
      const changes = {};
      for (const k of Object.keys(obj)) {
        if (obj[k] === undefined) continue;
        if (JSON.stringify(data[k]) === JSON.stringify(obj[k])) continue;
        // structured-clone like the real API does; this also moves values out of the jsdom realm
        const next = JSON.parse(JSON.stringify(obj[k]));
        changes[k] = { oldValue: data[k], newValue: next };
        data[k] = next;
      }
      if (cb) cb();
      fireChanges(changes);
      return Promise.resolve();
    },
    remove(keys, cb) {
      const changes = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (k in data) { changes[k] = { oldValue: data[k] }; delete data[k]; }
      }
      if (cb) cb();
      fireChanges(changes);
      return Promise.resolve();
    }
  };
}

export function fakeResponse({ status = 200, body = "", headers = {} } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const resp = {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Map(Object.entries(headers)),
    body: null,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(text).buffer),
    clone: () => fakeResponse({ status, body, headers })
  };
  return resp;
}

// Every env created in a test file; `after(closeAll)` keeps a failed test from leaving a window
// (and its setInterval timers) alive, which would stop `node --test` from exiting.
const openEnvs = new Set();
export function closeAll() {
  for (const env of openEnvs) env.close();
}

export function createEnv(opts = {}) {
  const url = opts.url || EXT_URL + "popup.html";
  const html = opts.html != null ? opts.html : (opts.htmlFile ? readSrc(opts.htmlFile) : "<!doctype html><html><head></head><body></body></html>");
  // jsdom reports "Not implemented: navigation" as a jsdomError when a script calls location.replace();
  // the scripts under test do that on purpose (full page reload), so keep those out of the test output.
  const virtualConsole = new VirtualConsole();
  virtualConsole.forwardTo(console, { jsdomErrors: "none" });
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const window = dom.window;
  // jsdom has no fetch API at all; the scripts build Response/Request/Headers objects in their fetch hooks
  window.Response = Response;
  window.Request = Request;
  window.Headers = Headers;

  const registry = {};
  const onChangedListeners = [];
  const runtimeMessages = []; // every chrome.runtime.sendMessage call
  const tabMessages = [];     // every chrome.tabs.sendMessage call
  const onMessageListeners = [];
  const onInstalledListeners = [];
  const onConnectListeners = [];
  const createdTabs = [];

  const local = makeStorageArea(opts.storage, "local", onChangedListeners);
  const session = makeStorageArea(opts.session, "session", onChangedListeners);

  const chrome = {
    runtime: {
      lastError: undefined,
      getURL: (p) => EXT_URL + p,
      getManifest: () => readSrcJson("manifest.json"),
      sendMessage(msg, cb) {
        runtimeMessages.push(msg);
        let resp;
        for (const fn of onMessageListeners) {
          const r = fn(msg, { tab: opts.senderTab || null }, (x) => { resp = x; });
          if (r === true) break;
        }
        if (cb) cb(resp);
      },
      onMessage: { addListener: (fn) => onMessageListeners.push(fn) },
      onInstalled: { addListener: (fn) => onInstalledListeners.push(fn) },
      onConnect: { addListener: (fn) => onConnectListeners.push(fn) }
    },
    storage: {
      local,
      session,
      onChanged: { addListener: (fn) => onChangedListeners.push(fn) }
    },
    i18n: {
      getMessage: (k) => (enMessages[k] && enMessages[k].message) || "",
      getUILanguage: () => opts.uiLanguage || "en"
    },
    tabs: {
      query: (q, cb) => cb(opts.tabs || []),
      sendMessage(tabId, msg, optsOrCb, cb) {
        tabMessages.push({ tabId, msg });
        const fn = typeof optsOrCb === "function" ? optsOrCb : cb;
        if (fn) fn(opts.tabResponder ? opts.tabResponder(msg) : undefined);
      },
      create: (o) => createdTabs.push(o),
      reload: () => {},
      connect: () => ({ disconnect() {}, onDisconnect: { addListener() {} } })
    }
  };

  // fetch: chrome-extension:// URLs read from src/, everything else goes to opts.fetch (default: network error)
  const fetchCalls = [];
  const nativeFetch = function (input, init) {
    const u = typeof input === "string" ? input : input && input.url;
    fetchCalls.push({ url: u, init });
    if (typeof u === "string" && u.startsWith(EXT_URL)) {
      const rel = u.slice(EXT_URL.length).split(/[?#]/)[0];
      return Promise.resolve(fakeResponse({ body: readSrc(rel) }));
    }
    if (env.fetchHandler) {
      try { return Promise.resolve(env.fetchHandler(u, init)); } catch (e) { return Promise.reject(e); }
    }
    return Promise.reject(new TypeError("Failed to fetch"));
  };

  window.chrome = chrome;
  window.fetch = nativeFetch;
  window.__BCS_TEST__ = { register: (name, api) => { registry[name] = api; } };
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });

  const env = {
    window,
    document: window.document,
    chrome,
    storage: local.data,
    sessionStorage: session.data,
    runtimeMessages,
    tabMessages,
    createdTabs,
    fetchCalls,
    fetchHandler: opts.fetch || null,
    nativeFetch,
    onInstalledListeners,
    onConnectListeners,
    load(file) {
      // Run as a classic script in the window's realm: top-level function/var declarations become
      // window globals even under "use strict" (window.eval would keep them local to the eval).
      vm.runInContext(readSrc(file), dom.getInternalVMContext(), { filename: file });
      return env;
    },
    internals(name) {
      if (!registry[name]) throw new Error("nothing registered as " + name + " (loaded: " + Object.keys(registry).join(",") + ")");
      return registry[name];
    },
    // Dispatch a same-window postMessage synchronously (jsdom's postMessage is async and
    // does not set `source`, which bridge.js / main-hook.js check).
    postMessage(data) {
      window.dispatchEvent(new window.MessageEvent("message", { data, source: window }));
    },
    // Let pending promises / zero-delay timers settle
    settle(ms = 10) {
      return new Promise((r) => setTimeout(r, ms));
    },
    close() {
      openEnvs.delete(env);
      window.close();
    }
  };
  openEnvs.add(env);
  return env;
}
