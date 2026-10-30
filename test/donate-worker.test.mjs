import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { checkInput, verifyStripe, pidOf, ecpayCheckMac, isBackUrl, handleDonate, rateHit, usdRates, recordDonation } from "../tools/report-worker/src/donate.js";
import { createEnv } from "./helpers/load.mjs";

const ok = { v: 1, donorId: "0123456789abcdef0123456789abcdef", name: "老王", avatar: { style: 3 }, amount: 100, currency: "TWD" };

describe("report worker: donate", () => {
  test("checkout input", () => {
    assert.equal(checkInput(ok), "");
    assert.equal(checkInput({ ...ok, donorId: "x" }), "bad_json");
    assert.equal(checkInput({ ...ok, amount: 49 }), "bad_amount", "under the TWD minimum");
    assert.equal(checkInput({ ...ok, amount: 100.5 }), "bad_amount", "TWD has no decimals");
    assert.equal(checkInput({ ...ok, currency: "XYZ" }), "bad_amount");
    assert.equal(checkInput({ ...ok, name: "x".repeat(21) }), "bad_name");
    assert.equal(checkInput({ ...ok, avatar: { style: 10 } }), "bad_avatar");
    assert.equal(checkInput({ ...ok, avatar: { image: "data:image/webp;base64,AAAA" } }), "");
    assert.equal(checkInput({ ...ok, avatar: { image: "data:text/html;base64,AAAA" } }), "bad_avatar");
  });

  test("minimums match the extension", async () => {
    const env = createEnv({ htmlFile: "donate.html", url: "chrome-extension://bcs-test/donate.html" });
    ["i18n.js", "common.js", "donate.js"].forEach((f) => env.load(f));
    await env.settle(30);
    const ext = env.internals("donate").CURRENCIES;
    for (const [code, c] of Object.entries(ext)) {
      assert.equal(checkInput({ ...ok, currency: code, amount: c.min }), "", code);
      assert.equal(checkInput({ ...ok, currency: code, amount: c.min - (c.dec ? 0.01 : 1) }), "bad_amount", code);
    }
    env.close();
  });

  test("Stripe signature", async () => {
    const env = { STRIPE_WEBHOOK_SECRET: "whsec_test" };
    const body = '{"id":"evt_1"}';
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex");
    assert.equal(await verifyStripe(env, `t=${t},v1=${sig}`, body), true);
    assert.equal(await verifyStripe(env, `t=${t},v1=${sig}`, body + " "), false, "tampered body");
    assert.equal(await verifyStripe(env, `t=${t - 600},v1=${sig}`, body), false, "too old");
    assert.equal(await verifyStripe(env, "", body), false);
  });

  test("ECPay CheckMacValue matches the official example (developers.ecpay.com.tw/?p=2902)", async () => {
    const p = { ChoosePayment: "ALL", EncryptType: "1", ItemName: "Apple iphone 15", MerchantID: "3002607", MerchantTradeDate: "2023/03/12 15:30:23",
      MerchantTradeNo: "ecpay20230312153023", PaymentType: "aio", ReturnURL: "https://www.ecpay.com.tw/receive.php", TotalAmount: "30000", TradeDesc: "促銷方案" };
    assert.equal(await ecpayCheckMac(p, "pwFHCqoQZGmho4w6", "EkRm7iFT261dpevs"), "6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840");
    assert.equal(await ecpayCheckMac({ ...p, CheckMacValue: "x" }, "pwFHCqoQZGmho4w6", "EkRm7iFT261dpevs"), "6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840", "ignores CheckMacValue itself");
  });

  test("optional email", () => {
    assert.equal(checkInput({ ...ok, email: "" }), "");
    assert.equal(checkInput({ ...ok, email: "a@b.co" }), "");
    assert.equal(checkInput({ ...ok, email: "nope" }), "bad_email");
  });

  test("pid is the same hash the extension uses", async () => {
    const expected = crypto.createHash("sha256").update("bcs-donor:" + ok.donorId).digest("hex").slice(0, 16);
    assert.equal(await pidOf(ok.donorId), expected);
  });

  test("back link only accepts the extension donate page (no open redirect)", () => {
    const chrome = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/donate.html";
    const firefox = "moz-extension://944cfddf-7a95-3c47-bd9a-663b3ce8d699/donate.html";
    assert.ok(isBackUrl(chrome) && isBackUrl(firefox) && isBackUrl("https://biboost.app/donate"));
    for (const bad of ["https://evil.example/donate.html", "https://biboost.app.evil.example/donate", "https://biboost.app/donate?x=1", chrome + "?x=1", "chrome-extension://abc/donate.html", "javascript:alert(1)//donate.html", chrome.replace("donate", "popup")]) {
      assert.ok(!isBackUrl(bad), bad);
    }
    assert.equal(checkInput({ ...ok, back: chrome }), "");
    assert.equal(checkInput({ ...ok, back: "https://evil.example/" }), "bad_back");
  });

  test("thanks page links (and auto-returns after a countdown) to ?fresh=1; cancel page only links; a bad back is ignored", async () => {
    const page = async (q) => {
      const url = new URL("https://w.dev" + q);
      return (await handleDonate(new Request(url), {}, {}, url, {})).text();
    };
    const back = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/donate.html";
    const thanks = await page("/v1/donate/thanks?lang=zh-TW&back=" + encodeURIComponent(back));
    assert.ok(thanks.includes(`href="${back}?fresh=1"`));
    assert.ok(thanks.includes(`location.href="${back}?fresh=1"`) && thanks.includes(`id="auto"`), "counts down and goes back by itself");
    const cancel = await page("/v1/donate/cancel?lang=en&back=" + encodeURIComponent(back));
    assert.ok(cancel.includes(`href="${back}?cancel=1"`) && !cancel.includes(`id="auto"`));
    assert.ok(!(await page("/v1/donate/thanks?lang=zh-TW&back=" + encodeURIComponent("https://evil.example/"))).includes(`class="back"`));
  });

  test("rate limiter counts per key and lets requests through when KV fails", async () => {
    const store = new Map();
    const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
    assert.equal(await rateHit({ RATE_KV: kv }, "t:1", 2), true);
    assert.equal(await rateHit({ RATE_KV: kv }, "t:1", 2), true);
    assert.equal(await rateHit({ RATE_KV: kv }, "t:1", 2), false);
    const broken = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); } };
    assert.equal(await rateHit({ RATE_KV: broken }, "t:2", 1), true);
    assert.equal(await rateHit({}, "t:3", 0), true, "no KV bound");
  });

  test("FX API down: falls back to the fixed rates instead of losing a paid donation", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("offline"); };
    try {
      const r = await usdRates();
      assert.ok(Math.abs(r.TWD - 1 / 0.0308) < 1e-9 && Math.abs(r.SGD - 1 / 0.78) < 1e-9 && r.USD === 1);
    } finally { globalThis.fetch = real; }
  });

  // 假的 Neon：只認 recordDonation 會下的幾種 SQL，記下每一句
  function fakeDb({ donors = {}, aliases = {}, donations = new Set() } = {}) {
    const log = [];
    const neonSql = async (env, q, p = []) => {
      log.push({ q: q.replace(/\s+/g, " ").trim(), p });
      if (/^select canonical from donor_aliases/.test(q)) return aliases[p[0]] ? [{ canonical: aliases[p[0]] }] : [];
      if (/^select pid from donors where email/.test(q)) return Object.entries(donors).filter(([pid, d]) => d.email === p[0] && pid !== p[1]).map(([pid]) => ({ pid }));
      if (/^insert into donors/.test(q)) { if (donors[p[0]]) return []; donors[p[0]] = { name: p[1], email: p[4] }; return [{ pid: p[0] }]; }
      if (/^insert into donations/.test(q)) { if (donations.has(p[3])) return []; donations.add(p[3]); return [{ id: 1 }]; }
      if (/^update donors set name/.test(q)) { if (donors[p[0]]) donors[p[0]].name = p[1]; return []; }
      if (/^delete from donors/.test(q)) { delete donors[p[0]]; return []; }
      return [];
    };
    return { h: { neonSql }, log, donors, donations };
  }
  const paid = (over) => ({ pid: "newpid", intent: { name: "attacker", avatar_style: 1, created_at: "2026-10-30T00:00:00Z" }, provider: "stripe", ref: "pi_1",
    amount: 2, currency: "SGD", usd: 1.5, paidAt: 1793360000, ...over });

  test("email merge adds the amount to the existing donor but never takes over their name or avatar", async () => {
    const db = fakeDb({ donors: { victim: { name: "Top donor", email: "v@example.com" } } });
    await recordDonation({}, db.h, paid({ email: "V@example.com" }));
    assert.equal(db.donors.victim.name, "Top donor");
    assert.ok(!db.log.some((l) => /^update donors set name/.test(l.q)), "no profile overwrite after a merge");
    const don = db.log.find((l) => /^insert into donations/.test(l.q));
    assert.equal(don.p[0], "victim", "the tip is counted for the existing donor");
  });

  test("a redelivered payment notification does not touch the profile again", async () => {
    const db = fakeDb({ donors: { me: { name: "Renamed later" } }, donations: new Set(["pi_old"]) });
    await recordDonation({}, db.h, paid({ pid: "me", ref: "pi_old" }));
    assert.equal(db.donors.me.name, "Renamed later");
    assert.ok(!db.log.some((l) => /^update donors set name/.test(l.q)));
  });

  test("a refund recorded before the payment keeps the refunded status", async () => {
    const db = fakeDb();
    await recordDonation({}, db.h, paid({ pid: "p2", ref: "pi_2", status: "refunded" }));
    const don = db.log.find((l) => /^insert into donations/.test(l.q));
    assert.equal(don.p[4], "refunded");
  });
});
