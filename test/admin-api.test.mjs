import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkSession, hashPassword, makeSession, SESSION_TTL_MS, verifyPassword } from "../scripts/lib/admin-auth.mjs";
import { handleAdminApi } from "../scripts/lib/admin-api.mjs";
import { donationStatus, PROVIDERS } from "../scripts/lib/donations.mjs";

const KEY = "k".repeat(40);
const ORIGIN = "https://biboost.app";

function memLimiter() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) || 0, incr: async (k) => { m.set(k, (m.get(k) || 0) + 1); } };
}
async function makeCtx(over = {}) {
  return {
    local: false, ip: "1.2.3.4", limiter: memLimiter(),
    env: { ADMIN_USER: "me", ADMIN_PASS_HASH: await hashPassword("correct horse"), ADMIN_SESSION_KEY: KEY },
    ...over,
  };
}
function req(name, { args = [], cookie = "", origin = ORIGIN, method = "POST", headers = {} } = {}) {
  const h = { "Content-Type": "application/json", "X-BB-Admin": "1", ...headers };
  if (origin) h.Origin = origin;
  if (cookie) h.Cookie = cookie;
  return new Request(`${ORIGIN}/admin/api/${name}`, { method, headers: h, body: method === "POST" ? JSON.stringify({ args }) : undefined });
}
const cookieOf = (res) => (res.headers.get("Set-Cookie") || "").split(";")[0];

describe("admin auth", () => {
  test("password hash round trip", async () => {
    const h = await hashPassword("s3cret-pass");
    assert.match(h, /^pbkdf2-sha256\$\d+\$[\w-]+\$[\w-]+$/);
    assert.equal(await verifyPassword("s3cret-pass", h), true);
    assert.equal(await verifyPassword("s3cret-pasS", h), false);
    assert.equal(await verifyPassword("s3cret-pass", "plain-text"), false);
    assert.notEqual(await hashPassword("s3cret-pass"), h, "random salt");
  });

  test("session token: signed, expires, bound to the key", async () => {
    const now = Date.now();
    const t = await makeSession(KEY, now);
    assert.equal(await checkSession(KEY, t, now), true);
    assert.equal(await checkSession(KEY, t, now + SESSION_TTL_MS + 1), false, "expired");
    assert.equal(await checkSession("x".repeat(40), t, now), false, "other key");
    assert.equal(await checkSession("short", t, now), false, "too short a key counts as not configured");
    const [v, exp, nonce, sig] = t.split(".");
    assert.equal(await checkSession(KEY, [v, String(Number(exp) + 3600e3), nonce, sig].join("."), now), false, "extended expiry");
    assert.equal(await checkSession(KEY, "", now), false);
  });
});

describe("admin api", () => {
  test("only same-origin JSON POSTs with the custom header get through", async () => {
    const ctx = await makeCtx();
    assert.equal((await handleAdminApi(req("session", { method: "GET" }), ctx)).status, 405);
    assert.equal((await handleAdminApi(req("session", { headers: { "X-BB-Admin": "" } }), ctx)).status, 400);
    assert.equal((await handleAdminApi(req("session", { headers: { "Content-Type": "text/plain" } }), ctx)).status, 400);
    assert.equal((await handleAdminApi(req("session", { origin: "https://evil.example" }), ctx)).status, 403);
    assert.equal((await handleAdminApi(req("session"), ctx)).status, 401);
    assert.equal((await handleAdminApi(req("listDonations"), ctx)).status, 401, "actions need a session");
  });

  test("login sets a hardened cookie; the cookie unlocks actions; logout clears it", async () => {
    const ctx = await makeCtx();
    const res = await handleAdminApi(req("login", { args: [{ user: "me", pass: "correct horse" }] }), ctx);
    assert.equal(res.status, 200);
    const set = res.headers.get("Set-Cookie");
    assert.match(set, /^__Host-bb_admin=/);
    for (const flag of ["HttpOnly", "SameSite=Strict", "Secure", "Path=/"]) assert.ok(set.includes(flag), flag);
    const cookie = cookieOf(res);
    const s = await handleAdminApi(req("session", { cookie }), ctx);
    assert.equal(s.status, 200);
    assert.equal((await s.json()).result.local, false);
    assert.equal((await handleAdminApi(req("noSuchAction", { cookie }), ctx)).status, 404);
    const out = await handleAdminApi(req("logout", { cookie }), ctx);
    assert.match(out.headers.get("Set-Cookie"), /Max-Age=0/);
  });

  test("wrong password: 401, counted, and blocked after 5 tries from one IP", async () => {
    const ctx = await makeCtx();
    for (let i = 0; i < 5; i++) {
      const r = await handleAdminApi(req("login", { args: [{ user: "me", pass: "nope" + i }] }), ctx);
      assert.equal(r.status, 401);
    }
    const blocked = await handleAdminApi(req("login", { args: [{ user: "me", pass: "correct horse" }] }), ctx);
    assert.equal(blocked.status, 429, "even the right password waits once the IP is blocked");
    assert.equal(ctx.limiter.m.get("adm:all"), 5);
  });

  test("wrong user name is rejected like a wrong password", async () => {
    const ctx = await makeCtx();
    assert.equal((await handleAdminApi(req("login", { args: [{ user: "you", pass: "correct horse" }] }), ctx)).status, 401);
  });

  test("not configured: no login at all", async () => {
    const ctx = await makeCtx({ env: { ADMIN_USER: "", ADMIN_PASS_HASH: "", ADMIN_SESSION_KEY: "" } });
    assert.equal((await handleAdminApi(req("login", { args: [{ user: "", pass: "" }] }), ctx)).status, 503);
  });

  test("skip only exists on the local server; local cookies are not Secure (http://127.0.0.1)", async () => {
    const cloud = await makeCtx();
    assert.equal((await handleAdminApi(req("skip"), cloud)).status, 404);
    const local = await makeCtx({ local: true });
    const r = new Request("http://127.0.0.1:3100/admin/api/skip", {
      method: "POST", headers: { "Content-Type": "application/json", "X-BB-Admin": "1", Origin: "http://127.0.0.1:3100" }, body: "{}",
    });
    const res = await handleAdminApi(r, local);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Set-Cookie"), /^bb_admin=/);
    assert.ok(!res.headers.get("Set-Cookie").includes("Secure"));
    assert.equal((await res.json()).result.local, true);
  });

  test("the cloud refuses local-only actions before touching anything", async () => {
    const ctx = await makeCtx();
    const cookie = `__Host-bb_admin=${await makeSession(KEY)}`;
    const session = await (await handleAdminApi(req("session", { cookie }), ctx)).json();
    assert.ok(session.result.localOnly.translate, "the UI learns which buttons to disable");
    const r = await handleAdminApi(req("drawWinnersV2", { cookie, args: [1] }), ctx);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /只能在本機後台/);
  });
});

describe("donations admin helpers", () => {
  test("status: refunded / disputed / available (past available_on) / paid", () => {
    const now = 1_800_000_000_000;
    assert.equal(donationStatus({ status: "refunded", raw: { available_on: 1 } }, now), "refunded");
    assert.equal(donationStatus({ status: "disputed", raw: {} }, now), "disputed");
    assert.equal(donationStatus({ status: "paid", raw: { available_on: now / 1000 - 1 } }, now), "available");
    assert.equal(donationStatus({ status: "paid", raw: { available_on: now / 1000 + 86400 } }, now), "paid");
    assert.equal(donationStatus({ status: "paid", raw: {} }, now), "paid");
  });
  test("provider links: Stripe live vs test mode", () => {
    assert.equal(PROVIDERS.stripe.url({ ref: "pi_123", raw: { livemode: true } }), "https://dashboard.stripe.com/payments/pi_123");
    assert.equal(PROVIDERS.stripe.url({ ref: "pi_123", raw: { livemode: false } }), "https://dashboard.stripe.com/test/payments/pi_123");
    assert.equal(PROVIDERS.stripe.url({ ref: "pi_123", raw: {} }), "https://dashboard.stripe.com/payments/pi_123", "older rows are live");
  });
});
