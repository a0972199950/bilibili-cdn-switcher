// 功能開關：後台的 scripts/lib/features.mjs、report worker 的 GET /v1/features（簽章）、擴充的 src/features.js（驗章、快取、內頁 404）
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createEnv, closeAll, testKey, plain } from "./helpers/load.mjs";
import { signJws, handleFeatures, featureData } from "../tools/report-worker/src/features.js";

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const noCache = { default: { match: async () => undefined, put: async () => {}, delete: async () => {} } };

// Neon 的 HTTP API 換成記憶體裡的 features／settings
function fakeNeon(db) {
  return async (url, init) => {
    if (!String(url).includes("neon.tech/sql")) throw new Error("unexpected fetch " + url);
    const { query, params } = JSON.parse(init.body);
    db.log.push(query);
    let rows = [];
    if (/^create table/.test(query)) rows = [];
    else if (/to_regclass\('settings'\)/.test(query)) rows = [{ t: db.settings ? "settings" : null }];
    else if (/insert into features \(key, data\)\s+select 'donate'/.test(query)) {
      if (db.settings && "donate_enabled" in db.settings && !db.features.donate) db.features.donate = { data: { enabled: db.settings.donate_enabled !== false }, updated_at: "t0" };
    } else if (/^select key, data, updated_at from features/.test(query)) rows = Object.entries(db.features).sort().map(([key, r]) => ({ key, data: r.data, updated_at: r.updated_at }));
    else if (/^select data from features where key = \$1/.test(query)) rows = db.features[params[0]] ? [{ data: db.features[params[0]].data }] : [];
    else if (/^insert into features \(key, data\) values/.test(query)) db.features[params[0]] = { data: JSON.parse(params[1]), updated_at: "t1" };
    else throw new Error("unexpected query " + query);
    return new Response(JSON.stringify({ rows }), { status: 200 });
  };
}

describe("scripts/lib/features.mjs（後台）", () => {
  let F, db;
  before(async () => {
    process.env.DATABASE_URL = "postgres://u:p@ep-test.ap-southeast-1.aws.neon.tech/db";
    db = { features: {}, settings: { donate_enabled: false }, log: [] };
    globalThis.fetch = fakeNeon(db);
    F = await import("../scripts/lib/features.mjs");
  });
  after(() => { globalThis.fetch = realFetch; });

  test("the extension's defaults match the catalog", () => {
    const env = createEnv();
    env.load("features.js");
    const ext = plain(env.internals("features").DEFAULTS);
    env.close();
    assert.deepEqual(ext, Object.fromEntries(F.FEATURES.map((f) => [f.key, { enabled: true, ...f.defaults }])));
  });

  test("first use moves the old settings.donate_enabled over, then lists catalog + extra rows", async () => {
    db.features.other = { data: { enabled: false }, updated_at: "t0" };
    const rows = await F.listFeatures();
    assert.deepEqual(rows.map((r) => [r.key, r.data.enabled, r.known]), [["donate", false, true], ["other", false, false]]);
    assert.equal(rows[0].name, "贊助");
  });

  test("setFeature merges, deletes null fields and keeps enabled boolean", async () => {
    assert.deepEqual(await F.setFeature("donate", { enabled: true }), { enabled: true });
    assert.deepEqual(await F.setFeature("donate", { group: "a", pinned: true }), { enabled: true, group: "a", pinned: true });
    assert.deepEqual(await F.setFeature("donate", { pinned: null }), { enabled: true, group: "a" });
    assert.equal(await F.featureEnabled("donate"), true);
    assert.equal(await F.featureEnabled("unknown_thing"), true, "no row = on");
  });

  test("validatePatch rejects anything that is not a small flat record", () => {
    assert.throws(() => F.validatePatch("Bad-Key", { enabled: true }), F.FeatureError);
    assert.throws(() => F.validatePatch("donate", null), F.FeatureError);
    assert.throws(() => F.validatePatch("donate", { enabled: "yes" }), F.FeatureError);
    assert.throws(() => F.validatePatch("donate", { group: "Bad!" }), F.FeatureError);
    assert.throws(() => F.validatePatch("donate", { group: { x: 1 } }), F.FeatureError);
    assert.throws(() => F.validatePatch("donate", { "bad key": "x" }), F.FeatureError);
    assert.deepEqual(F.validatePatch("donate", { enabled: false, group: "a" }), { enabled: false, group: "a" });
  });
});

describe("report worker: GET /v1/features", () => {
  let key;
  const h = {
    CACHE_S: 60, CORS: { "Access-Control-Allow-Origin": "*" },
    fail: (status, error) => new Response(JSON.stringify({ ok: false, error }), { status }),
  };
  const dbWith = (rows) => ({ ...h, neonSql: async (env, q) => (/from features/.test(q) ? rows : []) });
  const call = (env, hh) => handleFeatures(new Request("https://api.biboost.app/v1/features"), env, { waitUntil() {} }, hh);
  before(async () => { key = await testKey(); globalThis.caches = noCache; });
  after(() => { globalThis.caches = realCaches; });

  test("signs every row; the extension's verifier accepts it", async () => {
    const res = await call({ DATABASE_URL: "x", FEATURES_SIGNING_KEY: key.priv }, dbWith([{ key: "donate", data: { enabled: false } }]));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Cache-Control"), /max-age=60/);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    const { ok, jws } = await res.json();
    assert.equal(ok, true);
    const env = createEnv();
    env.load("features.js");
    const fx = env.internals("features");
    const payload = plain(await fx.verifyJws(jws, { f1: key.pub }));
    env.close();
    assert.deepEqual(payload.features, { donate: { enabled: false } });
    assert.ok(Math.abs(payload.iat - Date.now() / 1000) < 5);
  });

  test("503 without the signing key or the database", async () => {
    assert.equal((await call({ DATABASE_URL: "x" }, dbWith([]))).status, 503);
    assert.equal((await call({ FEATURES_SIGNING_KEY: key.priv }, dbWith([]))).status, 503);
  });

  test("featureData: no row = on", async () => {
    assert.deepEqual(await featureData({}, dbWith([]), "donate"), { enabled: true });
    assert.deepEqual(await featureData({}, dbWith([{ key: "donate", data: { enabled: false } }]), "donate"), { enabled: false });
  });
});

describe("src/features.js（擴充）", () => {
  const API = "https://api.biboost.app/v1/features";
  let key, other;
  before(async () => { key = await testKey(); other = await testKey(); });

  // answer：fetch /v1/features 的回應內容（null＝連不上）
  function boot({ answer = null, storage = {}, html } = {}) {
    const env = createEnv({ storage, html });
    env.fetchHandler = (url) => {
      if (url === API && answer) return { ok: true, status: 200, json: () => Promise.resolve(answer) };
      throw new TypeError("Failed to fetch");
    };
    env.load("features.js");
    const fx = env.internals("features");
    fx.PUBLIC_KEYS.t1 = key.pub;
    return { env, fx };
  }
  const sign = (features, k = key, kid = "t1") => signJws({ iat: 100, features }, k.priv, kid);

  test("verifyJws: only a valid ES256 signature from a known kid", async () => {
    const { env, fx } = boot();
    const jws = await sign({ donate: { enabled: false } });
    const [h, p, s] = jws.split(".");
    assert.deepEqual(plain(await fx.verifyJws(jws, fx.PUBLIC_KEYS)).features, { donate: { enabled: false } });
    const forged = Buffer.from(JSON.stringify({ iat: 100, features: { donate: { enabled: true } } })).toString("base64url");
    assert.equal(await fx.verifyJws([h, forged, s].join("."), fx.PUBLIC_KEYS), null, "payload changed");
    assert.equal(await fx.verifyJws(await sign({}, other), fx.PUBLIC_KEYS), null, "someone else's key");
    assert.equal(await fx.verifyJws(await sign({}, key, "nope"), fx.PUBLIC_KEYS), null, "unknown kid");
    const none = Buffer.from(JSON.stringify({ alg: "none", kid: "t1" })).toString("base64url");
    assert.equal(await fx.verifyJws([none, p, ""].join("."), fx.PUBLIC_KEYS), null, "alg none");
    assert.equal(await fx.verifyJws("garbage", fx.PUBLIC_KEYS), null);
    assert.equal(await fx.verifyJws(null, fx.PUBLIC_KEYS), null);
    env.close();
  });

  test("refresh stores the signed answer; load re-verifies it every time", async () => {
    const { env, fx } = boot({ answer: { ok: true, jws: await sign({ donate: { enabled: false }, extra: { enabled: false, group: "x" } }) } });
    const flags = plain(await fx.refresh());
    assert.deepEqual(flags, { donate: { enabled: false }, extra: { enabled: false, group: "x" } });
    assert.equal(env.storage.featureFlags.api, "https://api.biboost.app");
    assert.equal(fx.enabled(await fx.load(), "donate"), false);
    // 有人改了 storage 裡的 payload：驗不過 → 回到預設值
    const [h, , s] = env.storage.featureFlags.jws.split(".");
    env.storage.featureFlags.jws = [h, Buffer.from(JSON.stringify({ iat: 1, features: { donate: { enabled: true, group: "x" } } })).toString("base64url"), s].join(".");
    assert.deepEqual(plain(await fx.load()), { donate: { enabled: true } });
    env.close();
  });

  test("a bad answer from the API is not stored; the last good one stays", async () => {
    const good = await sign({ donate: { enabled: false } });
    const { env, fx } = boot({ answer: { ok: true, jws: (await sign({ donate: { enabled: true } }, other)) }, storage: { featureFlags: { api: "https://api.biboost.app", jws: good } } });
    assert.equal(await fx.refresh(), null);
    assert.equal(env.storage.featureFlags.jws, good);
    assert.equal(fx.enabled(await fx.load(), "donate"), false);
    env.close();
  });

  test("watch: cached first, then the fresh answer only when it differs", async () => {
    const { env, fx } = boot({ answer: { ok: true, jws: await sign({ donate: { enabled: false } }) } });
    const seen = [];
    await fx.watch((f) => seen.push(fx.enabled(f, "donate")));
    assert.deepEqual(seen, [true, false]);
    env.close();
  });

  test("offline with no cache: defaults (everything on); unknown keys are on", async () => {
    const { env, fx } = boot();
    const flags = await fx.load();
    assert.equal(await fx.refresh(), null);
    assert.equal(fx.enabled(flags, "donate"), true);
    assert.equal(fx.enabled(flags, "not_a_feature"), true);
    env.close();
  });

  test("guardPage: a switched-off feature's own page becomes 'not found'", async () => {
    const html = "<!doctype html><html><head><title>Thing</title></head><body><div id=app>secret UI</div></body></html>";
    const off = boot({ html, answer: { ok: true, jws: await sign({ thing: { enabled: false } }) } });
    assert.equal(await off.fx.guardPage("thing"), false);
    assert.equal(off.env.document.getElementById("app"), null);
    assert.equal(off.env.document.title, "Page not found");
    assert.match(off.env.document.body.textContent, /not available/);
    off.env.close();
    const on = boot({ html, answer: { ok: true, jws: await sign({ thing: { enabled: true } }) } });
    assert.equal(await on.fx.guardPage("thing"), true);
    assert.ok(on.env.document.getElementById("app"));
    on.env.close();
  });
});

after(closeAll);
