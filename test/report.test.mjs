import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createEnv, closeAll } from "./helpers/load.mjs";

const ZONE_API = "https://api.bilibili.com/x/web-interface/zone";
async function boot(storage = {}, opts = {}) {
  const env = createEnv({ htmlFile: "report.html", url: "chrome-extension://bcs-test/report.html" + (opts.query || ""), storage: { detectedIp: "1.1.1.1", detectedIsp: "ISP", zoneCheckedAt: Date.now(), ...storage }, ...opts });
  env.fetchHandler = (url) => {
    if (url === ZONE_API && opts.zone) return { json: () => Promise.resolve(opts.zone) };
    throw new TypeError("Failed to fetch");
  };
  ["theme.js", "i18n.js", "common.js", "report.js"].forEach((f) => env.load(f));
  await env.settle(20);
  return env;
}
const base = { cfg: { cdnCountry: "TW", detectedCountry: "TW", cdnHost: "upos-sz-mirror08ct.bilivideo.com" }, journal: [], samples: [], snap: null, zone: {} };

describe("detectPattern", () => {
  let env, r;
  before(async () => { env = await boot(); r = env.internals("report"); });
  after(() => env.close());
  const snap = (diag, payload) => ({ payload: { rewriteCount: 0, segRewriteCount: 0, ...payload, diag: diag || {} } });

  test("vpn suspect wins", () => assert.equal(r.detectPattern(null, [], [], { vpnSuspect: true }, {}), "vpn"));
  test("hook too late", () => assert.equal(r.detectPattern(snap({ playurlBeforeHook: true }), [], [], {}, {}), "hook-too-late"));
  test("hard HTTP errors need 3 hits (merged counter counts)", () => {
    assert.equal(r.detectPattern(null, [{ k: "net.http", n: 3, d: { status: 403 } }], [], {}, {}), "hard-403");
    assert.equal(r.detectPattern(null, [{ k: "net.http", d: { status: 403 } }, { k: "net.http", d: { status: 503 } }], [], {}, {}), "none");
    assert.equal(r.detectPattern(null, [{ k: "net.http", n: 5, d: { status: 403, expired: 1 } }], [], {}, {}), "none", "expired signatures are not CDN failures");
  });
  test("player made no segment request", () => assert.equal(r.detectPattern(snap({ active: true }, { rewriteCount: 2, segRewriteCount: 0 }), [], [], {}, {}), "player-no-request"));
  test("stall without fallback / fallback exhausted", () => {
    assert.equal(r.detectPattern(null, [{ k: "fb.stall", d: { phase: "hit" } }], [], {}, {}), "stall-no-fallback");
    assert.equal(r.detectPattern(null, [{ k: "fb.stall", d: { phase: "hit" } }, { k: "fb.switch" }, { k: "fb.switch" }], [], {}, {}), "fallback-exhausted");
    assert.equal(r.detectPattern(null, [{ k: "fb.stall", d: { phase: "hit" } }, { k: "fb.switch" }], [], {}, {}), "none");
  });
  test("slow decay in the last samples", () => {
    const samples = [100, 90, 80, 70, 20, 10].map((spd) => ({ spd }));
    assert.equal(r.detectPattern(null, [], samples, {}, {}), "slow-decay");
    assert.equal(r.detectPattern(null, [], [100, 10, 100, 10].map((spd) => ({ spd })), {}, {}), "none", "bouncing is not decay");
    assert.equal(r.detectPattern(null, [], [100, 50, 10].map((spd) => ({ spd })), {}, {}), "none", "needs 4 samples");
  });
  test("media error / none", () => {
    assert.equal(r.detectPattern(null, [{ k: "play.error" }], [], {}, {}), "media-error");
    assert.equal(r.detectPattern(null, [], [], {}, {}), "none");
  });
});

describe("buildDiag", () => {
  let env, r;
  before(async () => { env = await boot(); r = env.internals("report"); });
  after(() => env.close());

  test("vpnSuspect when the chosen country differs from the detected one", () => {
    const d = r.buildDiag({ ...base, cfg: { ...base.cfg, cdnCountry: "SG" } });
    assert.equal(d.summary.vpnSuspect, true);
    assert.equal(d.summary.pattern, "vpn");
    assert.ok(d.text.includes("vpnSuspect=1"));
    assert.equal(d.summary.country, "SG/TW");
  });
  test("ALL or matching country is not suspicious", () => {
    assert.equal(r.buildDiag({ ...base, cfg: { ...base.cfg, cdnCountry: "ALL" } }).summary.vpnSuspect, false);
    assert.equal(r.buildDiag(base).summary.vpnSuspect, false);
    assert.equal(r.buildDiag({ ...base, cfg: { ...base.cfg, detectedCountry: "" } }).summary.vpnSuspect, false);
  });
  test("text layout: header, sections, no-snapshot note, journal rows", () => {
    const now = Date.now();
    const d = r.buildDiag({ ...base, journal: [{ t: now - 5000, k: "net.http", n: 3, until: now - 1000, d: { status: 403, host: "x" } }], samples: [{ t: now - 1000, spd: 2048, buf: 3, qn: 80, rs: 4, paused: 0, lat: 50, host: "x" }] });
    assert.ok(d.text.startsWith("# bilibili-cdn-switcher diagnostics  v"));
    assert.ok(d.text.includes("[page] snapshot=none"));
    assert.ok(/net\.http\s+status=403 host=x\s+x3 over 4s/.test(d.text));
    assert.ok(d.text.includes("## samples"));
    assert.equal(d.summary.configured, "upos-sz-mirror08ct");
    assert.deepEqual(d.summary.recentKinds, ["net.http"]);
  });
  test("video off is reported as off", () => {
    const d = r.buildDiag({ ...base, cfg: { ...base.cfg, videoEnabled: false } });
    assert.equal(d.summary.configured, "off");
  });
});

describe("page", () => {
  test("collects diagnostics on open and renders them", async () => {
    const env = await boot();
    const r = env.internals("report");
    assert.ok(r.diag().text.includes("ip=1.1.1.1"));
    assert.equal(env.document.getElementById("diagPre").textContent, r.diag().text);
    assert.equal(r.includeDiag(), true);
    env.close();
  });
  test("stale zone info is refreshed from the API and stored", async () => {
    const env = await boot({ zoneCheckedAt: 0 }, { zone: { code: 0, data: { addr: "9.9.9.9", isp: "New", country: "C", country_code: "65" } } });
    assert.ok(env.internals("report").diag().text.includes("ip=9.9.9.9"));
    assert.equal(env.storage.detectedIp, "9.9.9.9");
    assert.equal(env.storage.detectedDial, 65);
    env.close();
  });
  test("feature requests do not include diagnostics", async () => {
    const env = await boot();
    const r = env.internals("report");
    const radio = env.document.querySelector('#types input[value="feature"]');
    radio.checked = true;
    radio.dispatchEvent(new env.window.Event("change"));
    assert.equal(r.includeDiag(), false);
    assert.equal(env.document.getElementById("diagBox").style.display, "none");
    env.close();
  });
  test("submit validates description and contact before sending", async () => {
    const env = await boot();
    const r = env.internals("report");
    const form = env.document.getElementById("form");
    form.dispatchEvent(new env.window.Event("submit", { cancelable: true }));
    assert.equal(env.document.getElementById("descErr").textContent, r.t ? r.t("reportDescRequired") : env.document.getElementById("descErr").textContent);
    assert.notEqual(env.document.getElementById("descErr").textContent, "");
    env.document.getElementById("desc").value = "it broke";
    env.document.getElementById("contact").value = "not-an-email";
    form.dispatchEvent(new env.window.Event("submit", { cancelable: true }));
    assert.notEqual(env.document.getElementById("contactErr").textContent, "");
    assert.equal(env.fetchCalls.some((c) => c.url.endsWith("/v1/report")), false);
    env.close();
  });
  test("submit posts the report and records the issue", async () => {
    const env = await boot();
    env.fetchHandler = (url, init) => {
      if (url.endsWith("/v1/report")) {
        const body = JSON.parse(init.body);
        assert.equal(body.type, "bug");
        assert.equal(body.includeDiag, true);
        assert.equal(init.headers["X-BCS-Token"].length > 0, true);
        return { status: 200, json: () => Promise.resolve({ ok: true, issueUrl: "https://gh/issues/12", issueNumber: 12 }) };
      }
      throw new TypeError("Failed to fetch");
    };
    env.document.getElementById("desc").value = "it broke";
    env.document.getElementById("form").dispatchEvent(new env.window.Event("submit", { cancelable: true }));
    await env.settle(20);
    assert.equal(env.storage.reportHistory.length, 1);
    assert.equal(env.storage.reportHistory[0].n, 12);
    assert.equal(env.document.getElementById("result").style.display, "block");
    assert.equal(env.document.getElementById("resultLink").textContent, "https://gh/issues/12");
    env.close();
  });
  test("network failure shows the copy fallback", async () => {
    const env = await boot();
    env.document.getElementById("desc").value = "it broke";
    env.document.getElementById("form").dispatchEvent(new env.window.Event("submit", { cancelable: true }));
    await env.settle(20);
    assert.equal(env.document.getElementById("result").className, "result fail");
    assert.equal(env.document.getElementById("copyBtn").style.display, "");
    assert.equal(env.internals("report").errText("rate_limited"), env.chrome.i18n.getMessage("reportErrRateLimited"));
    env.close();
  });
  test("detectBrowser from UA", async () => {
    const env = await boot();
    assert.equal(env.internals("report").detectBrowser(), "safari", "jsdom UA has none of the markers");
    env.close();
  });
});

after(closeAll);
