// biboost-site worker（tools/site/src/index.js）：後台頁面的路由與安全標頭、/donate 的開關。
// 資料庫（Neon 的 HTTP API）與 Cloudflare 的 caches、靜態檔案（ASSETS）都換成假的
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

let worker, flag = true, neonCalls = 0;
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;

before(async () => {
  process.env.DATABASE_URL = "postgres://u:p@ep-test.ap-southeast-1.aws.neon.tech/db";
  globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => {} } };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("neon.tech/sql")) {
      neonCalls++;
      const { query } = JSON.parse(init.body);
      const rows = /from settings/.test(query) ? [{ value: flag }] : [];
      return new Response(JSON.stringify({ rows }), { status: 200 });
    }
    throw new Error("unexpected fetch " + url);
  };
  worker = (await import("../tools/site/src/index.js")).default;
});
after(() => { globalThis.fetch = realFetch; globalThis.caches = realCaches; });

// 靜態檔案：/admin（後台首頁）、/admin/assets/app.js、/donate 有，其他 404
const ASSETS = {
  async fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/admin") return new Response("<!doctype html>admin", { headers: { "Content-Type": "text/html" } });
    if (p === "/admin/assets/app.js") return new Response("js", { headers: { "Content-Type": "text/javascript" } });
    if (p === "/donate") return new Response("<!doctype html>donate", { headers: { "Content-Type": "text/html" } });
    return new Response("nf", { status: 404 });
  },
};
const env = { ASSETS, RATE_KV: null, ADMIN_USER: "", ADMIN_PASS_HASH: "", ADMIN_SESSION_KEY: "" };
const ctx = { waitUntil() {} };
const get = (path) => worker.fetch(new Request("https://biboost.app" + path), env, ctx);

describe("biboost-site worker", () => {
  test("admin routes fall back to the SPA page with security headers, not cached", async () => {
    const res = await get("/admin/lotteries-v2/3");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "<!doctype html>admin");
    assert.match(res.headers.get("Content-Security-Policy"), /script-src 'self'/);
    assert.match(res.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
    assert.equal(res.headers.get("X-Frame-Options"), "DENY");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.match(res.headers.get("X-Robots-Tag"), /noindex/);
  });

  test("missing admin files stay 404 (no HTML served as JS)", async () => {
    assert.equal((await get("/admin/assets/missing.js")).status, 404);
    assert.equal((await get("/admin/assets/app.js")).status, 200);
  });

  test("admin API is answered by the shared handler (not configured → no login)", async () => {
    const res = await worker.fetch(new Request("https://biboost.app/admin/api/login", {
      method: "POST", headers: { "Content-Type": "application/json", "X-BB-Admin": "1", Origin: "https://biboost.app" },
      body: JSON.stringify({ args: [{ user: "a", pass: "b" }] }),
    }), env, ctx);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  });

  test("/donate follows the admin's donate switch", async () => {
    flag = true;
    assert.equal((await get("/donate")).status, 200);
    flag = false;
    assert.equal((await get("/donate")).status, 404);
    assert.equal((await get("/donate.html")).status, 404);
    flag = true;
    assert.ok(neonCalls >= 3);
  });
});
