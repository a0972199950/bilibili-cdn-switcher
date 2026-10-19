import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createEnv, plain, closeAll } from "./helpers/load.mjs";

let env, lt;
before(() => {
  env = createEnv();
  env.load("lottery-text.js");
  lt = env.internals("lottery-text");
});
after(() => env.close());

const V1 = {
  title: "Big draw", country: "TW", prize: { amount: 200, currency: "TWD", giftCards: ["7-11 禮物卡", "全家"] },
  winners: 3, isps: [], drawDays: 7, startDate: "2026-10-01", endDate: "2026-10-30", drawBy: "2026-11-06"
};
const V2 = {
  title: { en: "Hello", "zh-TW": "你好" }, country: "HK", prize: { currency: "HKD", giftCards: [{ name: "A", amount: 100 }, { name: "B", amount: 150 }] },
  winners: 2, isps: ["HKBN", "PCCW"], startDate: "2026-11-01", endDate: "2026-11-15", drawBy: "2026-11-22"
};

describe("compose (v1 format)", () => {
  test("zh-TW", () => {
    const c = lt.compose(V1, "zh-TW");
    assert.equal(c.label, "NT$200 抽獎:");
    assert.equal(c.line, "Big draw");
    assert.equal(c.title, "台灣限定：NT$200 禮物卡 × 3 名");
    assert.equal(c.eligible, "參加資格：台灣的網路用戶");
    assert.equal(c.ispList, "");
    assert.equal(c.period, "活動期間：10/1 – 10/30");
    assert.equal(c.prize, "獎品價值：NT$200 的 7-11 禮物卡／全家（自選）");
    assert.equal(c.draw, "活動結束後 7 日內（11/6 前）抽出 3 名符合資格的參加者，以 email 通知");
  });
  test("en", () => {
    const c = lt.compose(V1, "en");
    assert.equal(c.label, "NT$200 draw:");
    assert.equal(c.title, "Taiwan only: NT$200 gift cards, winners: 3");
    assert.equal(c.eligible, "Who can join: anyone in Taiwan");
    assert.equal(c.prize, "Prize value: NT$200 — 7-11 禮物卡 / 全家 (your choice)");
  });
  test("unknown language falls back to en", () => {
    assert.equal(lt.compose(V1, "fr").label, "NT$200 draw:");
  });
  test("single gift card has no (your choice) suffix", () => {
    const c = lt.compose({ ...V1, prize: { amount: 200, currency: "TWD", giftCards: ["Only"] } }, "en");
    assert.equal(c.prize, "Prize value: NT$200 — Only");
  });
  test("no title → generated line", () => {
    const c = lt.compose({ ...V1, title: "" }, "en");
    assert.equal(c.line, "Users in Taiwan: finish the speed test by 10/30 to enter the draw for a gift card (7-11 禮物卡 or 全家), winners: 3");
  });
  test("drawDays defaults to 7", () => {
    const c = lt.compose({ ...V1, drawDays: undefined }, "en");
    assert.match(c.draw, /within 7 days/);
  });
});

describe("compose (v2 format: per-card amounts, localized title, ISP list)", () => {
  test("en", () => {
    const c = lt.compose(V2, "en");
    assert.equal(c.label, "HK$100–150 draw:");
    assert.equal(c.line, "Hello");
    assert.equal(c.title, "Hong Kong only: HK$100–150 gift cards, winners: 2");
    assert.equal(c.eligible, "Who can join: users of the following broadband providers");
    assert.equal(c.ispList, "HKBN, PCCW");
    assert.equal(c.prize, "Prize: A HK$100 / B HK$150 (your choice)");
  });
  test("zh-TW uses zh-TW title and ／ separators", () => {
    const c = lt.compose(V2, "zh-TW");
    assert.equal(c.line, "你好");
    assert.equal(c.ispList, "HKBN／PCCW");
    assert.equal(c.prize, "獎品：A HK$100／B HK$150（自選）");
  });
  test("title language fallback: ja → en", () => {
    assert.equal(lt.compose(V2, "ja").line, "Hello");
  });
  test("same amounts in v2 format collapse to a single amount", () => {
    const c = lt.compose({ ...V2, prize: { currency: "HKD", giftCards: [{ name: "A", amount: 100 }, { name: "B", amount: 100 }] } }, "en");
    assert.equal(c.label, "HK$100 draw:");
    assert.equal(c.prize, "Prize value: HK$100 — A / B (your choice)");
  });
});

describe("helpers", () => {
  test("pickText fallback order: lang → en → zh-TW → any", () => {
    assert.equal(lt.pickText({ en: "e", ja: "j" }, "ja"), "j");
    assert.equal(lt.pickText({ en: "e" }, "ja"), "e");
    assert.equal(lt.pickText({ "zh-TW": "t" }, "en"), "t");
    assert.equal(lt.pickText({ ko: "k" }, "en"), "k");
    assert.equal(lt.pickText("plain", "en"), "plain");
    assert.equal(lt.pickText(null, "en"), "");
    assert.equal(lt.pickText({ en: "" }, "en"), "");
  });
  test("countryName: table first, Intl fallback", () => {
    assert.equal(lt.countryName("TW", "ko"), "대만");
    assert.equal(lt.countryName("US", "en"), "United States");
    assert.equal(lt.countryName("FI", "en"), "Finland");
  });
  test("amountText", () => {
    assert.equal(lt.amountText(200, "TWD"), "NT$200");
    assert.equal(lt.amountText(100, "HKD", 150), "HK$100–150");
    assert.equal(lt.amountText(100, "HKD", 100), "HK$100");
    assert.equal(lt.amountText(5, "XYZ"), "5 XYZ");
    assert.equal(lt.amountText(1234.5, "USD"), "US$1,234.50");
    assert.equal(lt.amountText(1234, "usd"), "US$1,234");
  });
  test("cardList normalizes v1 strings and v2 objects", () => {
    assert.deepEqual(plain(lt.cardList({ amount: 5, giftCards: ["a", { name: "b", amount: 9 }, { amount: 1 }] })), [{ name: "a", amount: 5 }, { name: "b", amount: 9 }]);
    assert.deepEqual(plain(lt.cardList({})), []);
  });
  test("joinOr", () => {
    assert.equal(lt.joinOr(["A", "B", "C"], "en"), "A, B or C");
    assert.equal(lt.joinOr(["A"], "en"), "A");
    assert.equal(lt.joinOr([], "en"), "");
    assert.equal(lt.joinOr(["甲", "乙"], "zh-TW"), "甲或乙");
    assert.equal(lt.joinOr(["甲", "Apple"], "zh-TW"), "甲或 Apple");
  });
  test("monthDay / fill", () => {
    assert.equal(lt.monthDay("2026-10-01"), "10/1");
    assert.equal(lt.fill("{a}-{b}-{c}", { a: 1, b: "x" }), "1-x-{c}");
  });
});

after(closeAll);
