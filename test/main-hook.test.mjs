import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createEnv, fakeResponse, plain, closeAll } from "./helpers/load.mjs";

const VIDEO_URL = "https://www.bilibili.com/video/BV1xx411c7mD?p=2";
const HOST = "upos-sz-mirror08ct.bilivideo.com";
const COS = "upos-sz-mirrorcos.bilivideo.com";
const ALI = "upos-sz-mirrorali.bilivideo.com";
const MCDN = "xy1.mcdn.bilivideo.cn";
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 3600;

// Boots main-hook.js on a bilibili page with the given config already in localStorage
function boot(cfg, url = VIDEO_URL) {
  const env = createEnv({ url });
  env.window.localStorage.setItem("__CDN_SWITCHER_CFG__", JSON.stringify({ cdnHost: HOST, ...cfg }));
  env.load("main-hook.js");
  return env;
}
function playurl(extra) {
  return {
    code: 0, data: {
      quality: 80,
      dash: {
        video: [{ id: 80, baseUrl: `https://${COS}/upgcxcode/1/2/3/v80.m4s?deadline=${FUTURE}&x=1`, backupUrl: [`https://${ALI}/upgcxcode/1/2/3/v80.m4s`, `https://${MCDN}:4483/upgcxcode/1/2/3/v80.m4s`] },
          { id: 64, baseUrl: `https://${COS}/upgcxcode/1/2/3/v64.m4s`, backupUrl: [] }],
        audio: [{ id: 30280, baseUrl: `https://${COS}/upgcxcode/1/2/3/a.m4s`, backupUrl: [] }]
      }, ...extra
    }
  };
}

describe("pure helpers", () => {
  let env, mh;
  before(() => { env = boot({}); mh = env.internals("main-hook"); });
  after(() => env.close());

  test("boot picks config up from localStorage", () => {
    assert.equal(mh.cfg().cdnHost, HOST);
    assert.equal(mh.cfg().enabled, true);
    assert.equal(mh.effHost(), HOST);
    assert.equal(mh.isHostMode(), true);
    assert.equal(mh.pageTypeOf(), "video");
  });
  test("isExpiredUrl", () => {
    assert.equal(mh.isExpiredUrl(`https://${COS}/a.m4s?deadline=${PAST}`), true);
    assert.equal(mh.isExpiredUrl(`https://${COS}/a.m4s?deadline=${FUTURE}`), false);
    assert.equal(mh.isExpiredUrl(`https://${COS}/a.m4s`), false);
    assert.equal(mh.isExpiredUrl("not a url"), false);
  });
  test("isSegUrl needs both the upgcxcode path and a CDN host", () => {
    assert.equal(mh.isSegUrl("https://upos-hz-mirrorakam.akamaized.net/upgcxcode/1/2/3/x.m4s"), true);
    assert.equal(mh.isSegUrl(`https://${MCDN}:4483/upgcxcode/1/x.m4s`), false, "port breaks the $ anchor on purpose");
    assert.equal(mh.isSegUrl("https://data.bilibili.com/log?u=https://x/upgcxcode/a.m4s"), false, "tracking beacon that embeds a segment URL");
    assert.equal(mh.isSegUrl(`https://${COS}/other/x.m4s`), false);
    assert.equal(mh.isSegUrl("https://attacker-bilivideo.com/upgcxcode/1/x.m4s"), false, "label boundary");
  });
  test("isSwappableSeg / swapSegHost", () => {
    const akam = `https://upos-hz-mirrorakam.akamaized.net/upgcxcode/1/x.m4s?deadline=${FUTURE}`;
    assert.equal(mh.isSwappableSeg(akam), true);
    assert.equal(mh.isSwappableSeg(`https://${HOST}/upgcxcode/1/x.m4s`), false, "already on the target host");
    assert.equal(mh.isSwappableSeg("https://cdn.example.com/upgcxcode/1/x.m4s"), false, "not a bilibili CDN host");
    assert.equal(mh.swapSegHost(akam), `https://${HOST}/upgcxcode/1/x.m4s?deadline=${FUTURE}`);
  });
  test("replaceHost keeps path/query and returns input on garbage", () => {
    assert.equal(mh.replaceHost(`https://${COS}/p/q.m4s?a=1#f`, HOST), `https://${HOST}/p/q.m4s?a=1#f`);
    assert.equal(mh.replaceHost("https://[", HOST), "https://[");
    assert.equal(mh.hostOf(`HTTPS://${COS.toUpperCase()}/x`), COS);
  });
  test("isFailureStatus / shouldFallbackOnStatus", () => {
    assert.equal(mh.isFailureStatus(403), true);
    assert.equal(mh.isFailureStatus(451), true);
    assert.equal(mh.isFailureStatus(503), true);
    assert.equal(mh.isFailureStatus(206), false);
    assert.equal(mh.isFailureStatus(600), false);
    const cur = `https://${HOST}/upgcxcode/1/x.m4s?deadline=${FUTURE}`;
    assert.equal(mh.shouldFallbackOnStatus(403, cur), true);
    assert.equal(mh.shouldFallbackOnStatus(403, `https://${HOST}/upgcxcode/1/x.m4s?deadline=${PAST}`), false, "expired signature is not a CDN failure");
    assert.equal(mh.shouldFallbackOnStatus(500, cur), true);
    assert.equal(mh.shouldFallbackOnStatus(403, `https://${COS}/upgcxcode/1/x.m4s?deadline=${FUTURE}`), false, "other host's failure is not ours");
    assert.equal(mh.shouldFallbackOnStatus(200, cur), false);
  });
  test("clampNum", () => {
    assert.equal(mh.clampNum("50", 1, 100, 8), 50);
    assert.equal(mh.clampNum("abc", 1, 100, 8), 8);
    assert.equal(mh.clampNum(0, 1, 100, 8), 8);
    assert.equal(mh.clampNum(-3, 1, 100, 8), 8);
    assert.equal(mh.clampNum(500, 1, 100, 8), 100);
    assert.equal(mh.clampNum(0.5, 1, 100, 8), 1);
  });
  test("cleanTitle strips the site suffix", () => {
    assert.equal(mh.cleanTitle("Foo_哔哩哔哩_bilibili"), "Foo");
    assert.equal(mh.cleanTitle("Bar - bilibili"), "Bar");
    assert.equal(mh.cleanTitle("  Baz  "), "Baz");
    assert.equal(mh.cleanTitle("_bilibili"), "_bilibili", "never returns empty when input was not empty");
    assert.equal(mh.cleanTitle(42), "");
  });
  test("qnText", () => {
    assert.equal(mh.qnText(), "-");
    mh.debug.lastQn = 80;
    assert.equal(mh.qnText(), "1080P (80)");
    mh.debug.lastQn = 999;
    assert.equal(mh.qnText(), "999");
    mh.debug.lastQn = null;
  });
  test("speed window: direct samples win over resource-timing samples", () => {
    mh.addSample(1024 * 1024, 1000, true);
    mh.addSample(50 * 1024 * 1024, 1000, false); // ignored: a direct sample arrived < 30s ago
    mh.updateSpeed();
    assert.equal(Math.round(mh.debug.speedBps), 1024 * 1024);
    assert.equal(mh.debug.speedIdle, false);
    mh.addSample(0, 1000, true); // no-op
    mh.addSample(10, 0, true); // no-op
  });
});

describe("live helpers", () => {
  let env, mh;
  before(() => { env = boot({}, "https://live.bilibili.com/12345"); mh = env.internals("main-hook"); });
  after(() => env.close());

  test("liveInfo parses gotcha hosts", () => {
    const li = mh.liveInfo("https://d1--ov-gotcha07.bilivideo.com/live-bvc/123/live_123.flv?x=1");
    assert.equal(li.cluster, "07");
    assert.equal(li.route, "ov");
    assert.equal(li.prefix, "d1--");
    assert.equal(li.suffix, ".bilivideo.com");
    assert.equal(li.isStream, true);
    assert.equal(li.isFlv, true);
    const m4s = mh.liveInfo("https://d1--cn-gotcha07b.bilivideo.com/live-bvc/123/x.m4s");
    assert.equal(m4s.route, "cnb");
    assert.equal(m4s.isStream, false);
    assert.equal(mh.liveInfo("https://cn-gotcha07.bilivideo.com/live-bvc/123/x.m3u8").route, "cn");
    assert.equal(mh.liveInfo("https://d1--ov-gotcha07.bilivideo.com/other/x.flv"), null);
    assert.equal(mh.liveInfo("https://upos-sz-mirror08ct.bilivideo.com/live-bvc/x.flv"), null);
    assert.equal(mh.liveInfo("::"), null);
  });
  test("liveHostFor builds every route variant", () => {
    assert.equal(mh.liveHostFor("d1--", "07", ".bilivideo.com", "ov"), "d1--ov-gotcha07.bilivideo.com");
    assert.equal(mh.liveHostFor("d1--", "07", ".bilivideo.com", "ovb"), "d1--ov-gotcha07b.bilivideo.com");
    assert.equal(mh.liveHostFor("d1--", "07", ".bilivideo.com", "cn"), "d1--cn-gotcha07.bilivideo.com");
    assert.equal(mh.liveHostFor("", "05", ".bilivideo.com", "cnb"), "cn-gotcha05b.bilivideo.com");
  });
  test("parseM3u8 resolves segment URLs and the init map", () => {
    const base = "https://d1--ov-gotcha07.bilivideo.com/live-bvc/123/index.m3u8?sig=1";
    const pl = mh.parseM3u8('#EXTM3U\n#EXT-X-MAP:URI="h.m4s"\n#EXTINF:1.5,\n1.m4s\n#EXTINF:2,\nhttps://other/2.m4s\n\n#EXT-X-ENDLIST\n', base);
    assert.equal(pl.map, "https://d1--ov-gotcha07.bilivideo.com/live-bvc/123/h.m4s");
    assert.deepEqual(plain(pl.segs), [
      { url: "https://d1--ov-gotcha07.bilivideo.com/live-bvc/123/1.m4s", dur: 1.5, key: "1.m4s" },
      { url: "https://other/2.m4s", dur: 2, key: "https://other/2.m4s" }
    ]);
    assert.equal(mh.parseM3u8("#EXTM3U\n", base).segs.length, 0);
  });
  test("FlvParser yields tag types/timestamps across chunk boundaries", () => {
    function tag(type, ts, size) {
      const b = new Uint8Array(11 + size + 4);
      b[0] = type; b[1] = (size >> 16) & 255; b[2] = (size >> 8) & 255; b[3] = size & 255;
      b[4] = (ts >> 16) & 255; b[5] = (ts >> 8) & 255; b[6] = ts & 255; b[7] = (ts >> 24) & 255;
      return b;
    }
    const header = new Uint8Array([0x46, 0x4c, 0x56, 1, 5, 0, 0, 0, 9, 0, 0, 0, 0]);
    const stream = new Uint8Array([...header, ...tag(18, 0, 3), ...tag(9, 40, 2), ...tag(8, 41, 1)]);
    const p = new mh.FlvParser();
    let tags = [];
    for (let i = 0; i < stream.length; i += 7) tags = tags.concat(p.push(stream.subarray(i, i + 7)));
    assert.deepEqual(plain(tags), [{ type: 18, ts: 0 }, { type: 9, ts: 40 }, { type: 8, ts: 41 }]);
    assert.equal(p.bad, false);
    assert.deepEqual(tags.map(mh.isAvTag), [false, true, true]);
    const bad = new mh.FlvParser();
    bad.push(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
    assert.equal(bad.bad, true);
  });
  test("playInfoExpires / usablePlayInfo / playInfoKey", () => {
    function info(expires, live = 1, code = 0) {
      return { code, data: { live_status: live, playurl_info: { playurl: { stream: [{ format: [{ codec: [{ url_info: [{ extra: `a=1&expires=${expires}&b=2` }, { extra: `expires=${expires + 100}` }] }] }] }] } } } };
    }
    const now = Math.floor(Date.now() / 1000);
    assert.equal(mh.playInfoExpires(info(1700000000)), 1700000000, "minimum across url_info");
    assert.equal(mh.playInfoExpires({ data: {} }), 0);
    assert.equal(mh.playInfoExpires(info("x")), 0);
    assert.equal(mh.usablePlayInfo(info(now + 3600)), true);
    assert.equal(mh.usablePlayInfo(info(now + 60)), false, "less than 2 minutes left");
    assert.equal(mh.usablePlayInfo(info(now + 3600, 0)), false, "not live");
    assert.equal(mh.usablePlayInfo(info(now + 3600, 1, -400)), false);
    assert.equal(mh.usablePlayInfo(null), false);
    assert.equal(mh.playInfoKey(new URLSearchParams("room_id=1&protocol=0,1&format=0,1,2&codec=0,1")), "1|0|0,1|0,1,2|0,1");
    assert.equal(mh.playInfoKey(new URLSearchParams("room_id=1&qn=10000&protocol=0&format=0&codec=0")), "1|10000|0|0|0");
  });
});

describe("playurl rewriting", () => {
  let env, mh;
  before(() => { env = boot({}); mh = env.internals("main-hook"); });
  after(() => env.close());

  test("dash: base goes to the chosen host, originals become backups, mcdn is not a fallback candidate", () => {
    const root = playurl();
    assert.equal(mh.rewriteRoot(root, "playurl"), true);
    const v = root.data.dash.video[0];
    assert.equal(mh.hostOf(v.baseUrl), HOST);
    assert.equal(new URL(v.baseUrl).search, `?deadline=${FUTURE}&x=1`, "query kept");
    assert.deepEqual(plain(v.backupUrl.map(mh.hostOf)), [COS, ALI, `${MCDN}:4483`]);
    assert.equal(mh.hostOf(root.data.dash.audio[0].baseUrl), HOST);
    assert.deepEqual(plain(mh.backupHosts()), [COS, ALI], "mcdn filtered, order of first appearance");
    assert.equal(mh.debug.playurlGiven, COS);
    assert.equal(mh.debug.lastQn, 80);
    assert.equal(mh.debug.pickVideoHost, HOST);
    assert.equal(mh.debug.pickAudioHost, HOST);
    assert.deepEqual(plain(mh.videoQnByPath()), { "/upgcxcode/1/2/3/v80.m4s": 80, "/upgcxcode/1/2/3/v64.m4s": 64 });
  });
  test("pickFallbackHost skips the current host and already-tried hosts", () => {
    mh.FALLBACK.tried = {};
    assert.equal(mh.pickFallbackHost(), COS);
    mh.FALLBACK.tried[COS] = true;
    assert.equal(mh.pickFallbackHost(), ALI);
    mh.FALLBACK.tried[ALI] = true;
    assert.equal(mh.pickFallbackHost(), null);
    mh.FALLBACK.tried = {};
  });
  test("durl (flv) and snake_case keys", () => {
    const root = { data: { quality: 64, durl: [{ url: `https://${COS}/upgcxcode/1/c.flv`, backup_url: [`https://${ALI}/upgcxcode/1/c.flv`] }] } };
    assert.equal(mh.rewriteRoot(root, "playinfo"), true);
    assert.equal(mh.hostOf(root.data.durl[0].url), HOST);
    assert.deepEqual(plain(root.data.durl[0].backup_url.map(mh.hostOf)), [COS, ALI]);
    assert.equal(mh.debug.lastQn, 64);
  });
  test("pgc / cheese wrap dash under result.video_info", () => {
    const root = { result: { video_info: playurl().data } };
    assert.equal(mh.rewriteRoot(root, "playurl"), true);
    assert.equal(mh.hostOf(root.result.video_info.dash.video[0].baseUrl), HOST);
  });
  test("objects without media are left alone", () => {
    assert.equal(mh.rewriteRoot({ data: { foo: 1 } }, "x"), false);
    assert.equal(mh.rewriteRoot(null, "x"), false);
    assert.equal(mh.rewriteRoot("str", "x"), false);
    assert.equal(mh.applyTrack({}), null);
  });
  test("tryRewriteText only parses texts that look like a playurl", () => {
    assert.equal(mh.tryRewriteText("", "x"), null);
    assert.equal(mh.tryRewriteText("{not json dash", "x"), null);
    assert.equal(mh.tryRewriteText('{"foo":1}', "x"), null);
    const out = mh.tryRewriteText(JSON.stringify(playurl()), "x");
    assert.ok(out.includes(HOST));
    assert.equal(JSON.parse(out).data.dash.video[0].baseUrl.includes(COS), false);
  });
  test("noteBackupHost ignores non-CDN hosts, ports and pcdn", () => {
    mh.setPendingBackupHosts([]);
    mh.noteBackupHost(`https://${COS}/a`);
    mh.noteBackupHost(`https://${COS}/b`);
    mh.noteBackupHost("https://cdn.example.com/a");
    mh.noteBackupHost(`https://${MCDN}/a`);
    mh.noteBackupHost(`https://${ALI}:8080/a`);
    mh.noteBackupHost("");
    assert.deepEqual(plain(mh.getPendingBackupHosts()), [COS]);
    mh.setPendingBackupHosts(null);
    mh.noteBackupHost(`https://${ALI}/a`); // no-op outside a rewrite
    assert.equal(mh.getPendingBackupHosts(), null);
  });
});

describe("backup mode", () => {
  let env, mh;
  before(() => { env = boot({ cdnHost: "backup" }); mh = env.internals("main-hook"); });
  after(() => env.close());

  test("prefers bilibili's own backups and does not swap segments", () => {
    assert.equal(mh.isHostMode(), false);
    assert.equal(mh.isSwappableSeg("https://upos-hz-mirrorakam.akamaized.net/upgcxcode/1/x.m4s"), false);
    const root = playurl();
    mh.rewriteRoot(root, "playurl");
    const v = root.data.dash.video[0];
    assert.equal(mh.hostOf(v.baseUrl), ALI);
    assert.equal(mh.hostOf(v.backupUrl[v.backupUrl.length - 1]), COS);
  });
});

describe("fetch hook", () => {
  test("rewrites segment requests to the configured host and samples the download", async () => {
    const env = boot({});
    const mh = env.internals("main-hook");
    env.fetchHandler = () => fakeResponse({ status: 206, body: "x".repeat(2048) });
    const url = `https://upos-hz-mirrorakam.akamaized.net/upgcxcode/1/2/3/v80.m4s?deadline=${FUTURE}`;
    const resp = await env.window.fetch(url);
    assert.equal(resp.status, 206);
    assert.equal(env.fetchCalls.length, 1);
    assert.equal(new URL(env.fetchCalls[0].url).host, HOST);
    assert.equal(mh.debug.segRewriteCount, 1);
    await env.settle();
    assert.equal(mh.debug.lastSegMs >= 0, true);
    // Request objects are rewritten too
    await env.window.fetch(new env.window.Request(url));
    assert.equal(new URL(env.fetchCalls[1].url).host, HOST);
    env.close();
  });
  test("non-segment requests pass through untouched", async () => {
    const env = boot({});
    env.fetchHandler = () => fakeResponse({ body: "ok" });
    await env.window.fetch("https://api.bilibili.com/x/web-interface/nav");
    assert.equal(env.fetchCalls[0].url, "https://api.bilibili.com/x/web-interface/nav");
    assert.equal(env.internals("main-hook").debug.segRewriteCount, 0);
    env.close();
  });
  test("playurl responses are rewritten in flight", async () => {
    const env = boot({});
    env.fetchHandler = () => fakeResponse({ body: playurl() });
    const resp = await env.window.fetch("https://api.bilibili.com/x/player/wbi/playurl?bvid=1&cid=2");
    const j = JSON.parse(await resp.text());
    assert.equal(new URL(j.data.dash.video[0].baseUrl).host, HOST);
    assert.equal(env.internals("main-hook").debug.rewriteCount, 1);
    env.close();
  });
  test("disabled: nothing is rewritten", async () => {
    const env = boot({ enabled: false });
    const mh = env.internals("main-hook");
    assert.equal(mh.isActive(mh.cfg()), false);
    env.fetchHandler = () => fakeResponse({ body: playurl() });
    await env.window.fetch(`https://upos-hz-mirrorakam.akamaized.net/upgcxcode/1/x.m4s?deadline=${FUTURE}`);
    assert.equal(new URL(env.fetchCalls[0].url).host, "upos-hz-mirrorakam.akamaized.net");
    const resp = await env.window.fetch("https://api.bilibili.com/x/player/playurl?x=1");
    assert.equal(JSON.parse(await resp.text()).data.dash.video[0].baseUrl.includes(COS), true);
    env.close();
  });
  test("videoEnabled=false also disables rewriting", () => {
    const env = boot({ videoEnabled: false });
    const mh = env.internals("main-hook");
    assert.equal(mh.isActive(mh.cfg()), false);
    env.close();
  });
});

describe("config messages from bridge", () => {
  test("only messages from the same window with the marker are accepted", () => {
    const env = boot({});
    const mh = env.internals("main-hook");
    env.window.dispatchEvent(new env.window.MessageEvent("message", { data: { __cdnSwitcher: 1, dir: "config", payload: { showDebug: true } }, source: null }));
    env.postMessage({ dir: "config", payload: { showDebug: true } });
    assert.equal(mh.cfg().showDebug, false);
    env.close();
  });
  test("changing only showDebug updates cfg without a reload", () => {
    const env = boot({});
    const mh = env.internals("main-hook");
    env.postMessage({ __cdnSwitcher: 1, dir: "config", payload: { showDebug: true, autoFallback: false } });
    assert.equal(mh.cfg().showDebug, true);
    assert.equal(mh.cfg().autoFallback, false);
    assert.equal(mh.cfg().cdnHost, HOST);
    assert.equal(env.window.sessionStorage.getItem("__CDN_SWITCHER_SWITCH_TOAST__"), null);
    env.close();
  });
  test("switching to another named host queues a toast for after the reload (no player API in tests)", () => {
    const env = boot({});
    const mh = env.internals("main-hook");
    env.postMessage({ __cdnSwitcher: 1, dir: "config", payload: { cdnHost: COS } });
    assert.equal(mh.cfg().cdnHost, COS);
    assert.equal(mh.effHost(), COS);
    assert.ok(env.window.sessionStorage.getItem("__CDN_SWITCHER_SWITCH_TOAST__").includes(COS));
    env.close();
  });
  test("a forged cdnHost that is neither a CDN host nor one of the user's nodes is rejected", () => {
    const env = boot({});
    const mh = env.internals("main-hook");
    env.postMessage({ __cdnSwitcher: 1, dir: "config", payload: { cdnHost: "attacker.example", showDebug: true } });
    assert.equal(mh.cfg().cdnHost, HOST);
    assert.equal(mh.cfg().showDebug, false, "the whole message is dropped");
    env.postMessage({ __cdnSwitcher: 1, dir: "config", payload: { cdnHost: "my.own.host", autoSpeedHosts: ["my.own.host"] } });
    assert.equal(mh.cfg().cdnHost, "my.own.host", "custom hosts arrive together with the list they are in");
    env.postMessage({ __cdnSwitcher: 1, dir: "config", payload: { cdnHost: "backup" } });
    assert.equal(mh.cfg().cdnHost, "backup");
    env.close();
  });
  test("isAllowedCdnHost", () => {
    const env = boot({});
    const ok = env.internals("main-hook").isAllowedCdnHost;
    assert.equal(ok(HOST), true);
    assert.equal(ok("upos-hz-mirrorakam.akamaized.net"), true);
    assert.equal(ok("base"), true);
    assert.equal(ok("backup"), true);
    assert.equal(ok("my.own.host", ["my.own.host"]), true);
    assert.equal(ok("my.own.host", []), false);
    assert.equal(ok("my.own.host", "nope"), false);
    assert.equal(ok("evil.bilivideo.com.attacker.example"), false);
    assert.equal(ok("attacker-bilivideo.com"), false, "suffix match must sit on a label boundary");
    assert.equal(ok("bilivideo.com"), true);
    assert.equal(ok(""), false);
    assert.equal(ok(42), false);
    env.close();
  });
  test("unknown keys in the payload are ignored", () => {
    const env = boot({});
    const mh = env.internals("main-hook");
    env.postMessage({ __cdnSwitcher: 1, dir: "config", payload: { bogus: 1 } });
    assert.equal("bogus" in mh.cfg(), false);
    env.close();
  });
  test("messages pushed by bridge replace the toast strings", () => {
    const env = boot({});
    env.postMessage({ __cdnSwitcher: 1, dir: "messages", payload: { mhToastClose: "Close" } });
    // no direct getter for MSGS; exercising the path is enough to catch a thrown error
    env.close();
  });
});

after(closeAll);
