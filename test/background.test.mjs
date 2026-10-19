import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createEnv, plain, closeAll } from "./helpers/load.mjs";

const A = "upos-sz-mirror08ct.bilivideo.com";
const C = "upos-sz-estgcos.bilivideo.com";
function boot(storage, extra) {
  const env = createEnv({ url: "chrome-extension://bcs-test/background.js", storage, ...extra });
  env.load("background.js");
  return env;
}

describe("onInstalled", () => {
  test("update without a recorded version backfills installedVersion from previousVersion", () => {
    const env = boot({});
    env.onInstalledListeners[0]({ reason: "update", previousVersion: "1.4.0" });
    assert.equal(env.storage.installedVersion, "1.4.0");
    assert.ok(env.storage.updatedAt > 0);
    assert.equal("installedAt" in env.storage, false);
    env.close();
  });
  test("existing installedVersion is kept", () => {
    const env = boot({ installedVersion: "2.0.0" });
    env.onInstalledListeners[0]({ reason: "update", previousVersion: "1.4.0" });
    assert.equal(env.storage.installedVersion, "2.0.0");
    env.close();
  });
  test("fresh install only records installedAt", () => {
    const env = boot({});
    env.onInstalledListeners[0]({ reason: "install" });
    assert.ok(env.storage.installedAt > 0);
    assert.equal("installedVersion" in env.storage, false);
    env.close();
  });
});

describe("importCustomHosts", () => {
  test("only known cdn-list hosts, deduplicated, appended in order", async () => {
    const env = boot({ customHosts: ["x.custom.host"], cdnMode: "list", cdnHost: "x.custom.host" });
    const r = await env.internals("background").importCustomHosts([A, "evil.example", A, "backup", C, 42, "x.custom.host"]);
    assert.deepEqual(plain(r), { ok: true, added: 2, total: 3 });
    assert.deepEqual(env.storage.customHosts, ["x.custom.host", A, C]);
    assert.equal(env.storage.cdnHost, "x.custom.host", "list mode: current node untouched");
    env.close();
  });
  test("custom mode with an empty list switches to the first imported host", async () => {
    const env = boot({ customHosts: [], cdnMode: "custom", cdnHost: A });
    await env.internals("background").importCustomHosts([C]);
    assert.equal(env.storage.cdnHost, C);
    env.close();
  });
  test("custom mode with the current host still in the list keeps it", async () => {
    const env = boot({ customHosts: [A], cdnMode: "custom", cdnHost: A });
    await env.internals("background").importCustomHosts([C]);
    assert.equal(env.storage.cdnHost, A);
    env.close();
  });
  test("non-array input adds nothing", async () => {
    const env = boot({});
    const r = await env.internals("background").importCustomHosts("nope");
    assert.deepEqual(plain(r), { ok: true, added: 0, total: 0 });
    env.close();
  });
  test("reachable through the runtime message", async () => {
    const env = boot({});
    let resp;
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_IMPORT_CUSTOM", hosts: [A] }, (r) => { resp = r; });
    await env.settle();
    assert.equal(env.storage.customHosts.length, 1);
    env.close();
  });
});

describe("diagnostic journal (storage.session)", () => {
  test("identical consecutive events merge into one row with a counter", async () => {
    const env = boot({});
    const bg = env.internals("background");
    const t = Date.now();
    await bg.appendJournal({ t, k: "net.http", tab: 1, d: { status: 403 } });
    await bg.appendJournal({ t: t + 10, k: "net.http", tab: 1, d: { status: 403 } });
    await bg.appendJournal({ t: t + 20, k: "net.http", tab: 2, d: { status: 403 } });
    await bg.appendJournal({ t: t + 30, k: "net.http", tab: 2, d: { status: 404 } });
    const j = env.sessionStorage.journal;
    assert.equal(j.length, 3);
    assert.equal(j[0].n, 2);
    assert.equal(j[0].until, t + 10);
    assert.equal(j[1].tab, 2);
    assert.equal(j[2].d.status, 404);
    env.close();
  });
  test("same event outside the merge window is a new row", async () => {
    const env = boot({});
    const bg = env.internals("background");
    const t = Date.now();
    await bg.appendJournal({ t: t - bg.MERGE_WINDOW_MS - 1000, k: "x", tab: 1, d: {} });
    await bg.appendJournal({ t, k: "x", tab: 1, d: {} });
    assert.equal(env.sessionStorage.journal.length, 2);
    env.close();
  });
  test("journal is capped and old rows pruned", async () => {
    const env = boot({});
    const bg = env.internals("background");
    const now = Date.now();
    await bg.appendJournal({ t: now - bg.DIAG_KEEP_MS - 1, k: "old", tab: 1, d: {} });
    for (let i = 0; i < bg.JOURNAL_MAX + 5; i++) await bg.appendJournal({ t: now + i, k: "k" + i, tab: 1, d: {} });
    const j = env.sessionStorage.journal;
    assert.equal(j.length, bg.JOURNAL_MAX);
    assert.equal(j.some((e) => e.k === "old"), false);
    assert.equal(j[j.length - 1].k, "k" + (bg.JOURNAL_MAX + 4));
    env.close();
  });
  test("samples are capped", async () => {
    const env = boot({});
    const bg = env.internals("background");
    for (let i = 0; i < bg.SAMPLES_MAX + 3; i++) await bg.appendSample({ t: Date.now(), spd: i });
    assert.equal(env.sessionStorage.samples.length, bg.SAMPLES_MAX);
    env.close();
  });
  test("snapshots are keyed by tab and expired ones dropped", async () => {
    const env = boot({});
    const bg = env.internals("background");
    await bg.putSnapshot(1, { t: Date.now() - bg.DIAG_KEEP_MS - 1, payload: {} });
    await bg.putSnapshot(2, { t: Date.now(), payload: {} });
    await bg.putSnapshot(3, { t: Date.now(), payload: {} });
    assert.deepEqual(Object.keys(env.sessionStorage.snaps).sort(), ["2", "3"]);
    env.close();
  });
  test("pruneOld uses `until` for merged rows", () => {
    const env = boot({});
    const bg = env.internals("background");
    const now = Date.now();
    const kept = bg.pruneOld([{ t: now - bg.DIAG_KEEP_MS - 5, until: now }, { t: now - bg.DIAG_KEEP_MS - 5 }, null], now);
    assert.equal(kept.length, 1);
    env.close();
  });
  test("runtime messages from a tab carry the sender's tab id", async () => {
    const env = boot({}, { senderTab: { id: 7 } });
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_JOURNAL", entry: { t: 1, k: "x", d: {} } }, () => {});
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_SAMPLE", row: { t: 1, spd: 1 } }, () => {});
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_SNAPSHOT", payload: { a: 1 }, url: "u" }, () => {});
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_JOURNAL", entry: { t: 1 } }, () => {}); // no k → ignored
    await env.settle();
    assert.equal(env.sessionStorage.journal.length, 1);
    assert.equal(env.sessionStorage.journal[0].tab, 7);
    assert.equal(env.sessionStorage.samples[0].tab, 7);
    assert.equal(env.sessionStorage.snaps["7"].url, "u");
    env.close();
  });
  test("opening windows falls back to tabs.create when chrome.windows is missing", () => {
    const env = boot({});
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_OPEN_ANNOUNCEMENT_WINDOW", id: 12 }, () => {});
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_OPEN_ANNOUNCEMENT_WINDOW", id: "x<script>" }, () => {});
    env.chrome.runtime.sendMessage({ type: "CDN_SWITCHER_OPEN_REPORT_WINDOW", tab: 3 }, () => {});
    assert.deepEqual(env.createdTabs.map((t) => t.url), [
      "chrome-extension://bcs-test/announcement.html?id=12",
      "chrome-extension://bcs-test/announcement.html",
      "chrome-extension://bcs-test/report.html?tab=3"
    ]);
    env.close();
  });
});

after(closeAll);
