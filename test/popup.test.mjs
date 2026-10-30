import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createEnv, readSrcJson, plain, closeAll } from "./helpers/load.mjs";

const CDN = readSrcJson("cdn-list.json");
const DEFAULT_HOST = "upos-sz-mirror08ct.bilivideo.com";
const ZONE_API = "https://api.bilibili.com/x/web-interface/zone";
function nodesOf(code) { return CDN.countries.find((c) => c.code === code).nodes; }

// Boots popup.html with the given storage; `zone` is what the bilibili zone API answers (null = network error)
async function boot(storage = {}, { zone = null, uiLanguage } = {}) {
  const env = createEnv({ htmlFile: "popup.html", storage: { zoneCheckedAt: Date.now(), countryAutoDone: true, ...storage }, uiLanguage });
  env.fetchHandler = (url) => {
    if (url === ZONE_API && zone) return { ok: true, status: 200, json: () => Promise.resolve(zone) };
    throw new TypeError("Failed to fetch");
  };
  ["theme.js", "i18n.js", "common.js", "lottery-text.js", "popup.js"].forEach((f) => env.load(f));
  await env.settle(20);
  return env;
}
function zoneOf(dial) { return { code: 0, data: { addr: "1.2.3.4", isp: "ISP", province: "", country: "X", country_code: String(dial) } }; }

describe("pure helpers", () => {
  let env, p;
  before(async () => { env = await boot(); p = env.internals("popup"); });
  after(() => env.close());

  test("normHost", () => {
    assert.equal(p.normHost("https://a.b.com/path?x=1#f"), "a.b.com");
    assert.equal(p.normHost("HTTP://A.B.COM:8080/"), "a.b.com:8080");
    assert.equal(p.normHost("  A.B.COM  "), "a.b.com");
    assert.equal(p.normHost("a.b.com/path"), "a.b.com");
    assert.equal(p.normHost("//a.b.com?x"), "a.b.com");
    assert.equal(p.normHost("nodot"), "");
    assert.equal(p.normHost(""), "");
    assert.equal(p.normHost(null), "");
    assert.equal(p.normHost("bad host.com"), "");
    assert.equal(p.normHost("a.b.com:x"), "");
  });
  test("parseVer / cmpVer", () => {
    assert.deepEqual(plain(p.parseVer("1.2.3")), [1, 2, 3]);
    assert.equal(p.parseVer("1.2"), null);
    assert.equal(p.parseVer(undefined), null);
    assert.ok(p.cmpVer("1.2.3", "1.2.10") < 0, "numeric, not lexicographic");
    assert.ok(p.cmpVer("2.0.0", "1.9.9") > 0);
    assert.equal(p.cmpVer("1.2.3", "1.2.3"), 0);
    assert.ok(Number.isNaN(p.cmpVer("x", "1.0.0")));
  });
  test("localized / changelogText fall back to en then zh_TW", () => {
    assert.equal(p.uiLangCode(), "en");
    assert.equal(p.localized({ en: "E", zh_TW: "T" }), "E");
    assert.equal(p.localized({ zh_TW: "T" }), "T");
    assert.equal(p.localized(null), "");
    assert.equal(p.changelogText({ text: { ja: "J", en: "E" } }), "E");
    assert.equal(p.changelogText({}), "");
  });
  test("clampLimit", () => {
    const f = { key: "stVideoMb", min: 1, max: 100 };
    assert.equal(p.clampLimit(f, "abc"), p.DEFAULTS.stVideoMb);
    assert.equal(p.clampLimit(f, 0), p.DEFAULTS.stVideoMb);
    assert.equal(p.clampLimit(f, 500), 100);
    assert.equal(p.clampLimit(f, 0.4), p.DEFAULTS.stVideoMb, "rounds to 0 → default");
    assert.equal(p.clampLimit(f, 3.7), 4);
    assert.equal(p.clampLimit(f, "50"), 50);
  });
  test("inferPreset matches the preset table, otherwise custom", () => {
    p.setState({ limits: { stVideoMb: 4, stVideoSec: 3, stLiveRuns: 3, stLiveSec: 8 } });
    assert.equal(p.inferPreset("video"), "fast");
    assert.equal(p.inferPreset("live"), "medium");
    p.setState({ limits: { stVideoMb: 9, stVideoSec: 5, stLiveRuns: 5, stLiveSec: 15 } });
    assert.equal(p.inferPreset("video"), "custom");
    assert.equal(p.inferPreset("live"), "accurate");
  });
  test("country lookups", () => {
    assert.equal(p.findCountry("TW").dial, 886);
    assert.equal(p.findCountry("ZZ"), null);
    assert.equal(p.validCountry("ALL"), true);
    assert.equal(p.validCountry("TW"), true);
    assert.equal(p.validCountry("XX"), false);
    assert.deepEqual(plain(p.countryHosts("TW")), nodesOf("TW"));
    assert.deepEqual(plain(p.countryHosts("ZZ")), []);
    const all = p.countryHosts("ALL");
    assert.equal(all.length, CDN.options.length - 1);
    assert.equal(all.includes("backup"), false);
  });
  test("visibleCdnOptions: list mode appends backup, custom mode marks unknown hosts", () => {
    p.setState({ cdnMode: "list", countrySel: "SG" });
    const list = p.visibleCdnOptions();
    assert.equal(list[list.length - 1].value, "backup");
    assert.deepEqual(plain(list.slice(0, -1).map((o) => o.value)), nodesOf("SG"));
    p.setState({ cdnMode: "custom", customHosts: [DEFAULT_HOST, "my.own.host"] });
    const custom = p.visibleCdnOptions();
    assert.equal(custom.length, 2);
    assert.equal(custom[0].unknown, undefined);
    assert.equal(custom[1].unknown, true);
    assert.equal(custom[1].name, "my.own.host");
    assert.deepEqual(plain(p.activeHosts()), [DEFAULT_HOST, "my.own.host"]);
    p.setState({ cdnMode: "list", countrySel: "TW", customHosts: [] });
  });
  test("cdnDisplayName", () => {
    assert.equal(p.cdnDisplayName({ name: "08ct", pool: "hw-biliv6" }), "08ct (" + CDN.pools["hw-biliv6"].en + ")");
    assert.equal(p.cdnDisplayName({ name: "x", note: "n" }), "x (n)");
    assert.equal(p.cdnDisplayName({ name: "x" }), "x");
  });
  test("withSaved / sortedKeys", () => {
    p.setState({ sortOn: false, speedOrder: { video: ["b", "a"], live: [] } });
    assert.deepEqual(plain(p.sortedKeys("video", ["a", "b", "c"], () => 1)), ["a", "b", "c"], "sorting off → untouched copy");
    assert.deepEqual(plain(p.withSaved("video", ["a", "b", "c"])), ["b", "a", "c"], "saved order first, new keys appended");
    p.setState({ sortOn: true });
    const score = { a: 10, b: 5, c: null, d: -Infinity, e: 7 };
    assert.deepEqual(plain(p.sortedKeys("video", ["a", "b", "c", "d", "e"], (k) => score[k])), ["a", "e", "b", "c", "d"]);
    p.setState({ sortOn: false, speedOrder: { video: [], live: [] } });
  });
  test("qualityTier thresholds", () => {
    assert.equal(p.qualityTier(13e6).key, "stQuality8k");
    assert.equal(p.qualityTier(100e6 / 8).key, "stQuality8k");
    assert.equal(p.qualityTier(4e6).key, "stQuality4k");
    assert.equal(p.qualityTier(1e6).key, "stQuality1080");
    assert.equal(p.qualityTier(0.5e6).key, "stQuality720");
    assert.equal(p.qualityTier(1e5).key, "stQualityLow");
  });
  test("durationText / withUtm", () => {
    assert.equal(p.durationText(3725), "1 h 2 min 5 s");
    assert.equal(p.withUtm("https://x/", "rate"), "https://x/?utm_source=extension&utm_medium=referral&utm_campaign=rate&utm_content=en");
    assert.equal(p.withUtm("https://x/?a=1", "rate"), "https://x/?a=1&utm_source=extension&utm_medium=referral&utm_campaign=rate&utm_content=en");
  });
  test("setRichText builds <b> nodes without innerHTML", () => {
    const el = env.document.createElement("p");
    p.setRichText(el, "a <b>b</b> c <b>d</b>");
    assert.equal(el.innerHTML, "a <b>b</b> c <b>d</b>");
    p.setRichText(el, "<script>x</script>");
    assert.equal(el.innerHTML, "&lt;script&gt;x&lt;/script&gt;");
  });
  test("countryByDial: shared dial codes resolve to the first listed country (+7 → RU, +1 → US)", () => {
    assert.equal(p.countryByDial(886), "TW");
    assert.equal(p.countryByDial(7), "RU");
    assert.equal(p.countryByDial(1), "US");
    assert.equal(p.countryByDial(999), "");
    assert.equal(p.countryByDial(NaN), "");
  });
  test("shared helpers from common.js", () => {
    assert.equal(p.t("popupTitle"), env.chrome.i18n.getMessage("popupTitle"));
    assert.equal(p.t("no-such-key"), "no-such-key");
    assert.equal(env.window.uiLangTag(), "en");
    assert.equal(env.window.shortHost("upos-sz-mirror08ct.bilivideo.com"), "upos-sz-mirror08ct");
    assert.equal(env.window.shortHost("d1--ov-gotcha07.bilivideo.cn"), "d1--ov-gotcha07");
    assert.equal(env.window.shortHost(undefined), "");
    assert.equal(env.window.spdText(0), "-");
    assert.equal(env.window.spdText(1048576 * 1.5), "1.5 MB/s");
    assert.equal(env.window.spdText(1024 * 300, true), "300 kB/s (idle)");
    assert.equal(env.window.qnText(null), "-");
    assert.equal(env.window.qnText(120), "4K (120)");
    assert.equal(env.window.qnText(7), "7");
    assert.equal(env.window.pickLang({ ja: "j", en: "e" }, "ja"), "j");
    assert.equal(env.window.pickLang({ ja: "j", en: "e" }), "e");
    assert.equal(env.window.pickLang({ "zh-TW": "t" }), "t");
    assert.equal(env.window.pickLang(null), "");
  });
  test("detectCountry maps the zone dial code onto the country list", async () => {
    for (const [dial, code] of [[886, "TW"], [65, "SG"], [1, "US"], [7, "RU"], [999, ""]]) {
      env.fetchHandler = () => ({ json: () => Promise.resolve(zoneOf(dial)) });
      assert.equal(await p.detectCountry(), code, "dial " + dial);
    }
    assert.equal(env.storage.detectedIp, "1.2.3.4");
    assert.equal(env.storage.detectedIsp, "ISP");
    env.fetchHandler = () => ({ json: () => Promise.resolve({ code: -1 }) });
    assert.equal(await p.detectCountry(), null, "API error → null (retry next time)");
    env.fetchHandler = () => { throw new TypeError("Failed to fetch"); };
    assert.equal(await p.detectCountry(), null);
  });
});

describe("uiLangCode", () => {
  for (const [lang, code] of [["zh-TW", "zhtw"], ["zh-CN", "zhcn"], ["zh", "zhtw"], ["ja", "ja"], ["ko-KR", "ko"], ["en-US", "en"], ["fr", "en"]]) {
    test(lang + " → " + code, async () => {
      const env = await boot({}, { uiLanguage: lang });
      assert.equal(env.internals("popup").uiLangCode(), code);
      env.close();
    });
  }
});

describe("settings migration on load", () => {
  test("legacy cdnHost 'base' becomes videoEnabled=false", async () => {
    const env = await boot({ cdnHost: "base", cdnMode: "list" });
    assert.equal(env.storage.videoEnabled, false);
    assert.equal(env.storage.cdnHost, DEFAULT_HOST);
    assert.equal(env.internals("popup").state().videoOn, false);
    assert.equal(env.internals("popup").els.modeOff.checked, true);
    env.close();
  });
  test("removed hosts fall back to the default", async () => {
    const env = await boot({ cdnHost: "upos-sz-mirrorhwov.bilivideo.com", cdnMode: "list" });
    assert.equal(env.storage.cdnHost, DEFAULT_HOST);
    env.close();
  });
  test("pre-1.6 settings: a hand-typed host moves into the custom list", async () => {
    const env = await boot({ cdnHost: "my.custom.host" });
    assert.equal(env.storage.cdnMode, "custom");
    assert.deepEqual(env.storage.customHosts, ["my.custom.host"]);
    assert.equal(env.internals("popup").state().cdnMode, "custom");
    assert.equal(env.internals("popup").els.modeCustom.checked, true);
    env.close();
  });
  test("pre-1.6 settings: a known host stays in list mode", async () => {
    const env = await boot({ cdnHost: DEFAULT_HOST });
    assert.equal(env.storage.cdnMode, "list");
    assert.deepEqual(env.storage.customHosts, []);
    env.close();
  });
  test("custom mode whose current host is no longer in the list uses the first entry", async () => {
    const env = await boot({ cdnMode: "custom", customHosts: ["x.y.com"], cdnHost: "gone.host" });
    assert.equal(env.storage.cdnHost, "x.y.com");
    env.close();
  });
  test("unknown cdnCountry falls back to TW", async () => {
    const env = await boot({ cdnCountry: "XX", cdnMode: "list", cdnHost: DEFAULT_HOST });
    assert.equal(env.internals("popup").state().countrySel, "TW");
    env.close();
  });
});

describe("automatic country selection (first run)", () => {
  test("picks the detected country's first node", async () => {
    const env = await boot({ countryAutoDone: false, cdnMode: "list", cdnHost: DEFAULT_HOST }, { zone: zoneOf(65) });
    assert.equal(env.storage.countryAutoDone, true);
    assert.equal(env.storage.cdnCountry, "SG");
    assert.equal(env.storage.detectedCountry, "SG");
    assert.equal(env.storage.cdnHost, nodesOf("SG")[0]);
    assert.deepEqual(env.storage.autoSpeedHosts, nodesOf("SG"));
    assert.equal(env.storage.autoTestPending, false, "feature flag is off");
    const s = env.internals("popup").state();
    assert.equal(s.countrySel, "SG");
    assert.equal(s.detectedCountry, "SG");
    assert.equal(s.currentCdnHost, nodesOf("SG")[0]);
    env.close();
  });
  test("unknown dial → TW with no 'you are here' country", async () => {
    const env = await boot({ countryAutoDone: false, cdnMode: "list", cdnHost: DEFAULT_HOST }, { zone: zoneOf(999) });
    assert.equal(env.storage.cdnCountry, "TW");
    assert.equal(env.storage.detectedCountry, "");
    assert.equal(env.storage.countryAutoDone, true);
    env.close();
  });
  test("API failure leaves everything untouched so it retries next time", async () => {
    const env = await boot({ countryAutoDone: false, cdnMode: "list", cdnHost: DEFAULT_HOST });
    assert.equal(env.storage.countryAutoDone, false);
    assert.equal("cdnCountry" in env.storage, false);
    env.close();
  });
  test("custom-list users keep their node", async () => {
    const env = await boot({ countryAutoDone: false, cdnMode: "custom", customHosts: ["x.y.com"], cdnHost: "x.y.com" }, { zone: zoneOf(65) });
    assert.equal(env.storage.cdnCountry, "SG");
    assert.equal(env.storage.cdnHost, "x.y.com");
    env.close();
  });
  test("already done → no zone lookup", async () => {
    const env = await boot({ countryAutoDone: true, cdnCountry: "JP", cdnMode: "list", cdnHost: DEFAULT_HOST }, { zone: zoneOf(65) });
    assert.equal(env.storage.cdnCountry, "JP");
    assert.equal(env.fetchCalls.some((c) => c.url === ZONE_API), false);
    env.close();
  });
  test("stale zone info refreshes only the 'you are here' marker", async () => {
    const env = await boot({ countryAutoDone: true, cdnCountry: "JP", detectedCountry: "JP", zoneCheckedAt: 0, cdnMode: "list", cdnHost: DEFAULT_HOST }, { zone: zoneOf(65) });
    assert.equal(env.storage.cdnCountry, "JP");
    assert.equal(env.storage.detectedCountry, "SG");
    assert.equal(env.internals("popup").state().detectedCountry, "SG");
    env.close();
  });
});

describe("user actions", () => {
  test("changing the country switches to its first node and resets speed order", async () => {
    const env = await boot({ cdnMode: "list", cdnHost: DEFAULT_HOST, cdnCountry: "TW", sortBySpeed: true, speedOrder: { video: ["a"], live: [] } });
    const p = env.internals("popup");
    p.els.countrySelect.value = "HK";
    p.els.countrySelect.dispatchEvent(new env.window.Event("change"));
    assert.equal(env.storage.cdnCountry, "HK");
    assert.equal(env.storage.cdnHost, nodesOf("HK")[0]);
    assert.equal(env.storage.countryAutoDone, true);
    assert.deepEqual(env.storage.autoSpeedHosts, nodesOf("HK"));
    assert.deepEqual(env.storage.speedOrder, { video: [], live: [] });
    assert.equal(p.state().countrySel, "HK");
    assert.ok(env.runtimeMessages.some((m) => m.type === "CDN_SWITCHER_JOURNAL" && m.entry.k === "ui.country"));
    env.close();
  });
  test("picking a node in the dropdown saves it", async () => {
    const env = await boot({ cdnMode: "list", cdnHost: DEFAULT_HOST, cdnCountry: "TW" });
    const p = env.internals("popup");
    const target = nodesOf("TW")[1];
    const row = Array.from(p.els.cdnSelectList.children).find((r) => r.dataset.value === target);
    row.click();
    assert.equal(env.storage.cdnHost, target);
    assert.equal(env.storage.videoEnabled, true);
    assert.equal(p.state().currentCdnHost, target);
    env.close();
  });
  test("adding custom hosts: normalization, duplicates, multi-paste, first one becomes current", async () => {
    const env = await boot({ cdnMode: "custom", customHosts: [], cdnHost: DEFAULT_HOST });
    const p = env.internals("popup");
    // a single-line input swallows newlines, so multi-line text arrives through the paste handler
    const paste = new env.window.Event("paste", { cancelable: true });
    paste.clipboardData = { getData: () => "https://A.example.com/x, b.example.com\nbad, a.example.com" };
    p.els.customHost.dispatchEvent(paste);
    assert.equal(paste.defaultPrevented, true);
    assert.deepEqual(env.storage.customHosts, ["a.example.com", "b.example.com"]);
    assert.equal(env.storage.cdnHost, "a.example.com", "list was empty → first added host is used");
    assert.equal(p.els.customHost.value, "");
    p.els.customHost.value = "a.example.com";
    p.els.customAddBtn.click();
    assert.equal(p.els.customHint.textContent, p.t("customHintDup"));
    p.els.customHost.value = "nodot";
    p.els.customAddBtn.click();
    assert.equal(p.els.customHint.textContent, p.t("customHintInvalid"));
    env.close();
  });
  test("removing the current custom host moves to the next; removing the last one returns to the country list", async () => {
    const env = await boot({ cdnMode: "custom", customHosts: ["a.example.com", "b.example.com"], cdnHost: "a.example.com", cdnCountry: "TW" });
    const p = env.internals("popup");
    p.els.cdnSelectList.querySelector('[data-value="a.example.com"] .cdnOptDel').click();
    assert.deepEqual(env.storage.customHosts, ["b.example.com"]);
    assert.equal(env.storage.cdnHost, "b.example.com");
    p.els.cdnSelectList.querySelector('[data-value="b.example.com"] .cdnOptDel').click();
    assert.deepEqual(env.storage.customHosts, []);
    assert.equal(env.storage.cdnMode, "list");
    assert.equal(env.storage.cdnHost, nodesOf("TW")[0]);
    assert.equal(p.state().cdnMode, "list");
    env.close();
  });
  test("mode radio: off → videoEnabled false; back to list keeps the node", async () => {
    const env = await boot({ cdnMode: "list", cdnHost: nodesOf("TW")[1], cdnCountry: "TW" });
    const p = env.internals("popup");
    p.els.modeOff.checked = true;
    p.els.modeOff.dispatchEvent(new env.window.Event("change"));
    assert.equal(env.storage.videoEnabled, false);
    assert.equal(p.state().videoOn, false);
    p.els.modeList.checked = true;
    p.els.modeList.dispatchEvent(new env.window.Event("change"));
    assert.equal(env.storage.videoEnabled, true);
    assert.equal(env.storage.cdnHost, nodesOf("TW")[1]);
    env.close();
  });
  test("live route selection", async () => {
    const env = await boot({});
    const p = env.internals("popup");
    p.els.liveSelectList.children[2].click(); // cn
    assert.equal(env.storage.liveRoute, "cn");
    assert.equal(env.storage.liveEnabled, true);
    assert.equal(p.state().liveRouteSel, "cn");
    p.els.liveModeOff.checked = true;
    p.els.liveModeOff.dispatchEvent(new env.window.Event("change"));
    assert.equal(env.storage.liveEnabled, false);
    env.close();
  });
  test("speed-test limits clamp on input and presets fill the numbers", async () => {
    const env = await boot({});
    const p = env.internals("popup");
    const sel = env.document.getElementById("stVideoPreset");
    sel.value = "custom";
    sel.dispatchEvent(new env.window.Event("change"));
    const mb = env.document.getElementById("stVideoMb");
    mb.value = "500";
    mb.dispatchEvent(new env.window.Event("input"));
    assert.equal(env.storage.stVideoMb, 100);
    mb.dispatchEvent(new env.window.Event("change"));
    assert.equal(mb.value, "100");
    sel.value = "accurate";
    sel.dispatchEvent(new env.window.Event("change"));
    assert.equal(env.storage.stVideoMb, 25);
    assert.equal(env.storage.stVideoSec, 10);
    assert.equal(env.storage.stVideoPreset, "accurate");
    assert.equal(mb.disabled, true);
    assert.equal(p.state().presets.video, "accurate");
    env.close();
  });
  test("storage changes from elsewhere (speed test import) update the custom list", async () => {
    const env = await boot({ cdnMode: "custom", customHosts: ["a.example.com"], cdnHost: "a.example.com" });
    const p = env.internals("popup");
    env.chrome.storage.local.set({ customHosts: ["b.example.com", "c.example.com"] });
    assert.deepEqual(plain(p.state().customHosts), ["b.example.com", "c.example.com"]);
    assert.equal(env.storage.cdnHost, "b.example.com", "old current host vanished → first in the new list");
    env.close();
  });
});

describe("announcement bar filtering", () => {
  let env, a, now;
  const lottery = (over) => ({ id: 1, type: "lottery", lottery: { country: "TW", startsAt: now - 1000, endsAt: now + 1e6, title: "T", prize: { amount: 200, currency: "TWD", giftCards: ["A"] }, winners: 1, startDate: "2026-10-01", endDate: "2026-10-30", drawBy: "2026-11-06", ...over } });
  before(async () => { env = await boot(); a = env.internals("popup-announcement"); now = Date.now(); });
  after(() => env.close());

  function ids(state) {
    a.setState({ items: [lottery(), { id: 2, type: "html", title: { en: "Hello" }, countries: ["SG"] }, { id: 3, type: "html", title: { en: "Global" }, prefix: { en: "P" }, countries: [] }, { id: 4, type: "html", title: {}, countries: [] }], country: "", dismissed: {}, showAll: false, ...state });
    return plain(a.visibleAnnouncements().map((x) => x.id));
  }
  test("by country", () => {
    assert.deepEqual(ids({ country: "TW" }), [1, 3]);
    assert.deepEqual(ids({ country: "SG" }), [2, 3]);
    assert.deepEqual(ids({ country: "" }), [3], "unknown country sees only global announcements");
  });
  test("showAll ignores the country", () => {
    assert.deepEqual(ids({ showAll: true }), [1, 2, 3]);
  });
  test("dismissed until a future time hides; expired dismissal shows again", () => {
    assert.deepEqual(ids({ country: "TW", dismissed: { 3: now + 1000 } }), [1]);
    assert.deepEqual(ids({ country: "TW", dismissed: { 3: now - 1000 } }), [1, 3]);
  });
  test("lottery outside its period is hidden", () => {
    a.setState({ items: [lottery({ endsAt: now - 1 })], country: "TW", dismissed: {}, showAll: false });
    assert.equal(a.visibleAnnouncements().length, 0);
    a.setState({ items: [lottery({ startsAt: now + 1e6 })], country: "TW" });
    assert.equal(a.visibleAnnouncements().length, 0);
  });
  test("lottery text comes from LotteryText; html uses prefix + title", () => {
    ids({ country: "TW" });
    const out = a.visibleAnnouncements();
    assert.equal(out[0].label, "NT$200 draw:");
    assert.equal(out[0].text, "T");
    assert.equal(out[1].label, "P");
    assert.equal(out[1].text, "Global");
  });
  test("storage detectedCountry change re-filters", () => {
    ids({ country: "" });
    a.render();
    assert.equal(a.shown().length, 1);
    env.chrome.storage.local.set({ detectedCountry: "SG" });
    assert.equal(a.shown().length, 2);
  });
});

describe("donate button", () => {
  // jsdom 的 User-Agent 會被 detectBrowser 當成 Safari；這裡先換成指定瀏覽器的再載入 popup
  async function bootAs(ua) {
    const env = createEnv({ htmlFile: "popup.html", storage: { zoneCheckedAt: Date.now(), countryAutoDone: true } });
    Object.defineProperty(env.window.navigator, "userAgent", { value: ua, configurable: true });
    env.fetchHandler = () => { throw new TypeError("Failed to fetch"); };
    ["theme.js", "i18n.js", "common.js", "lottery-text.js", "popup.js"].forEach((f) => env.load(f));
    await env.settle(20);
    return env;
  }
  test("shown next to the 5-star button in Chrome", async () => {
    const env = await bootAs("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36");
    const btn = env.document.getElementById("donateBtn");
    assert.equal(btn.style.display, "");
    assert.notEqual(btn.parentNode.style.display, "none");
    env.close();
  });
  test("hidden in Safari (App Store rules: no external payment)", async () => {
    const env = await bootAs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
    assert.equal(env.document.getElementById("donateBtn").style.display, "none");
    env.close();
  });
});

after(closeAll);
