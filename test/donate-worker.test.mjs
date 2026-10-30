import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { checkInput, verifyStripe, pidOf, ecpayCheckMac, isBackUrl, handleDonate } from "../tools/report-worker/src/donate.js";
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
    ["i18n.js", "common.js", "lottery-text.js", "donate.js"].forEach((f) => env.load(f));
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
});
