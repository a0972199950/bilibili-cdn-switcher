import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createEnv, plain, closeAll } from "./helpers/load.mjs";

const A = "upos-sz-mirror08ct.bilivideo.com";
const B = "upos-sz-mirrorcos.bilivideo.com";
function boot(storage, url = "https://www.bilibili.com/video/BV1xx") {
  const env = createEnv({ url, storage: { cdnHost: A, autoSpeedSwitch: false, autoSpeedHosts: [A, B], ...storage } });
  env.load("bridge.js");
  return env;
}
function autotestDone(env, payload) {
  env.postMessage({ __cdnSwitcher: 1, dir: "autotest-done", payload });
}

describe("config sync to MAIN world", () => {
  test("startup writes the merged config into page localStorage", () => {
    const env = boot({});
    const cfg = JSON.parse(env.window.localStorage.getItem("__CDN_SWITCHER_CFG__"));
    assert.equal(cfg.cdnHost, A);
    assert.equal(cfg.enabled, true, "default filled in");
    assert.equal(cfg.stVideoMb, 8);
    assert.equal("uiLang" in cfg, false, "only DEFAULTS keys are pushed");
    env.close();
  });
  test("storage changes are pushed again", () => {
    const env = boot({});
    env.chrome.storage.local.set({ cdnHost: B });
    assert.equal(JSON.parse(env.window.localStorage.getItem("__CDN_SWITCHER_CFG__")).cdnHost, B);
    env.close();
  });
});

describe("autotest-done → storage", () => {
  test("per-video auto test with the switch off is ignored", () => {
    const env = boot({});
    autotestDone(env, { host: B, from: A, reason: "video" });
    assert.equal(env.storage.cdnHost, A);
    env.close();
  });
  test("per-video auto test with the switch on applies", () => {
    const env = boot({ autoSpeedSwitch: true });
    autotestDone(env, { host: B, from: A, reason: "video" });
    assert.equal(env.storage.cdnHost, B);
    assert.equal(env.storage.videoEnabled, true);
    env.close();
  });
  test("country test applies regardless of the switch", () => {
    const env = boot({});
    autotestDone(env, { host: B, from: A, reason: "country" });
    assert.equal(env.storage.cdnHost, B);
    env.close();
  });
  test("user changed the node meanwhile (from mismatch) → not overwritten", () => {
    const env = boot({ autoSpeedSwitch: true });
    autotestDone(env, { host: B, from: "something.else", reason: "country" });
    assert.equal(env.storage.cdnHost, A);
    env.close();
  });
  test("missing host is ignored", () => {
    const env = boot({ autoSpeedSwitch: true });
    autotestDone(env, { from: A, reason: "country" });
    assert.equal(env.storage.cdnHost, A);
    env.close();
  });
  test("result is journaled to background", () => {
    const env = boot({ autoSpeedSwitch: true });
    autotestDone(env, { host: B, from: A, reason: "video" });
    const j = env.runtimeMessages.find((m) => m.type === "CDN_SWITCHER_JOURNAL" && m.entry.k === "ui.speedtest");
    assert.equal(j.entry.d.phase, "apply");
    assert.equal(j.entry.d.host, B);
    env.close();
  });
  test("autotest-start for a country test clears the pending flag", () => {
    const env = boot({ autoTestPending: true });
    env.postMessage({ __cdnSwitcher: 1, dir: "autotest-start", payload: { reason: "country", total: 3 } });
    assert.equal(env.storage.autoTestPending, false);
    assert.deepEqual(plain(env.internals("bridge").latestAutoTest()), { running: true, reason: "country", total: 3, done: 0 });
    env.postMessage({ __cdnSwitcher: 1, dir: "autotest-progress", payload: { done: 2 } });
    assert.equal(env.internals("bridge").latestAutoTest().done, 2);
    env.postMessage({ __cdnSwitcher: 1, dir: "autotest-end" });
    assert.equal(env.internals("bridge").latestAutoTest().running, false);
    env.close();
  });
});

describe("import from URL hash (speed test tool)", () => {
  test("valid hash → hosts handed to background, hash removed, lowercased, capped at 50", () => {
    const env = boot({});
    const br = env.internals("bridge");
    const many = Array.from({ length: 60 }, (_, i) => `h${i}.bilivideo.com`);
    env.window.history.replaceState(null, "", "/video/BV1xx#cdnsw-import=1." + ["UPOS-SZ-MIRROR08CT.bilivideo.com"].concat(many).join(","));
    br.importFromHash();
    const msg = env.runtimeMessages.find((m) => m.type === "CDN_SWITCHER_IMPORT_CUSTOM");
    assert.equal(msg.hosts.length, 50);
    assert.equal(msg.hosts[0], "upos-sz-mirror08ct.bilivideo.com");
    assert.equal(env.window.location.hash, "");
    env.close();
  });
  test("IMPORT_RE rejects other versions and unsafe characters", () => {
    const env = boot({});
    const re = env.internals("bridge").IMPORT_RE;
    assert.equal(re.test("#cdnsw-import=1.a.bilivideo.com,b.bilivideo.com"), true);
    assert.equal(re.test("#cdnsw-import=2.a.bilivideo.com"), false);
    assert.equal(re.test("#cdnsw-import=1.<script>"), false);
    assert.equal(re.test("#cdnsw-import=1.a.com/b"), false);
    assert.equal(re.test("#cdnsw-import=1."), false);
    assert.equal(re.test("#other"), false);
    env.close();
  });
  test("no matching hash → nothing sent", () => {
    const env = boot({});
    env.window.history.replaceState(null, "", "/video/BV1xx#t=12");
    env.internals("bridge").importFromHash();
    assert.equal(env.runtimeMessages.some((m) => m.type === "CDN_SWITCHER_IMPORT_CUSTOM"), false);
    assert.equal(env.window.location.hash, "#t=12", "unrelated hash is kept");
    env.close();
  });
});

describe("speed test state for the popup", () => {
  test("live progress merges by route; video progress appends", () => {
    const env = boot({});
    let resp;
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_RUN_LIVE_SPEEDTEST", limits: { runs: 2, sec: 5 } }, (r) => { resp = r; });
    assert.deepEqual(plain(resp), { ok: true });
    env.postMessage({ __cdnSwitcher: 1, dir: "speedtest-progress", payload: { route: "ov", host: "x", startup: { avg: 100 } } });
    env.postMessage({ __cdnSwitcher: 1, dir: "speedtest-progress", payload: { route: "ov", host: "x", sustain: { lag: 0 } } });
    env.postMessage({ __cdnSwitcher: 1, dir: "speedtest-progress", payload: { route: "cn", host: "y", error: "timeout" } });
    let st = env.internals("bridge").speedTest();
    assert.equal(st.running, true);
    assert.equal(st.total, 4);
    assert.deepEqual(plain(st.results), [{ route: "ov", host: "x", startup: { avg: 100 }, sustain: { lag: 0 } }, { route: "cn", host: "y", error: "timeout" }]);

    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_RUN_SPEEDTEST", hosts: [A, B] }, () => {});
    env.postMessage({ __cdnSwitcher: 1, dir: "speedtest-progress", payload: { host: A, bps: 1 } });
    env.postMessage({ __cdnSwitcher: 1, dir: "speedtest-progress", payload: { host: A, bps: 2 } });
    env.postMessage({ __cdnSwitcher: 1, dir: "speedtest-done", payload: {} });
    st = env.internals("bridge").speedTest();
    assert.equal(st.total, 2);
    assert.equal(st.results.length, 2, "no route → appended, not merged");
    assert.equal(st.running, false);
    let got;
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_GET_SPEEDTEST" }, (r) => { got = r; });
    assert.equal(got.speedTest.results.length, 2);
    env.close();
  });
  test("GET_DEBUG returns the latest MAIN snapshot and pokes MAIN to probe live routes", () => {
    const env = boot({});
    env.postMessage({ __cdnSwitcher: 1, dir: "debug", payload: { currentCdn: A } });
    let got;
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_GET_DEBUG" }, (r) => { got = r; });
    assert.equal(got.debug.currentCdn, A);
    assert.ok(env.runtimeMessages.some((m) => m.type === "CDN_SWITCHER_SNAPSHOT"), "top frame snapshot forwarded to background");
    env.close();
  });
  test("journal / sample from MAIN are forwarded to background", () => {
    const env = boot({});
    env.postMessage({ __cdnSwitcher: 1, dir: "journal", payload: { t: 1, k: "x", d: {} } });
    env.postMessage({ __cdnSwitcher: 1, dir: "sample", payload: { t: 1, spd: 5 } });
    assert.ok(env.runtimeMessages.some((m) => m.type === "CDN_SWITCHER_JOURNAL" && m.entry.k === "x"));
    assert.ok(env.runtimeMessages.some((m) => m.type === "CDN_SWITCHER_SAMPLE" && m.row.spd === 5));
    env.close();
  });
  test("messages from other windows are ignored", () => {
    const env = boot({});
    env.window.dispatchEvent(new env.window.MessageEvent("message", { data: { __cdnSwitcher: 1, dir: "debug", payload: { currentCdn: "evil" } }, source: null }));
    assert.equal(env.internals("bridge").latestDebug(), null);
    env.close();
  });
});

after(closeAll);
