import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createEnv, closeAll } from "./helpers/load.mjs";

const DONORS_API = "https://api.biboost.app/v1/donors";
// Boots donate.html; `board` is what GET /v1/donors answers (null = network error, 404 = not deployed yet)
async function boot({ storage = {}, board = { ok: true, items: [] }, query = "" } = {}) {
  const env = createEnv({ htmlFile: "donate.html", url: "chrome-extension://bcs-test/donate.html" + query, storage });
  // jsdom 沒有 crypto.subtle／TextEncoder：換成 Node 的，贊助者的 pid 才算得出來
  Object.defineProperty(env.window, "crypto", { value: globalThis.crypto, configurable: true });
  env.window.TextEncoder = TextEncoder;
  env.fetchHandler = (url) => {
    if (url !== DONORS_API || board === null) throw new TypeError("Failed to fetch");
    if (board === 404) return { ok: false, status: 404, json: () => Promise.resolve({}) };
    return { ok: true, status: 200, json: () => Promise.resolve(board) };
  };
  ["i18n.js", "common.js", "donate.js"].forEach((f) => env.load(f));
  await env.settle(30);
  return env;
}
const item = (pid, usd, extra) => ({ pid, name: pid.toUpperCase(), avatar: { style: 1 }, usd, count: 1, ...extra });

describe("amounts", () => {
  let env, d;
  before(async () => { env = await boot({ storage: { detectedCountry: "TW" } }); d = env.internals("donate"); });
  after(() => env.close());

  test("the detected country picks the currency and one cup by default", () => {
    assert.equal(env.document.getElementById("currency").value, "TWD");
    assert.equal(env.document.getElementById("amount").value, String(d.CURRENCIES.TWD.cup));
  });
  test("minimum, maximum and decimals", () => {
    d.setAmount(d.CURRENCIES.TWD.min - 1);
    assert.equal(d.amountError(), "donateAmountMin");
    d.setAmount(d.CURRENCIES.TWD.min);
    assert.equal(d.amountError(), "");
    d.setAmount(1000000);
    assert.equal(d.amountError(), "donateAmountMax");
    d.setAmount(100.5);
    assert.equal(d.amountError(), "donateAmountDecimals", "TWD has no decimals");
    assert.equal(env.document.getElementById("payBtn").disabled, true);
  });
  test("fromUsd rounds up to the currency unit and never goes under the minimum", () => {
    assert.equal(d.fromUsd(10, "USD"), 10);
    assert.equal(d.fromUsd(0.1, "USD"), d.CURRENCIES.USD.min);
    assert.equal(d.fromUsd(10, "TWD"), Math.ceil(10 / d.CURRENCIES.TWD.usd));
    assert.equal(d.fromUsd(10.001, "SGD"), Math.ceil(10.001 / d.CURRENCIES.SGD.usd * 100) / 100);
  });
  test("switching currency keeps the number of cups", () => {
    d.setAmount(d.CURRENCIES.TWD.cup * 3, 3);
    d.setCurrency("JPY", true);
    assert.equal(env.document.getElementById("amount").value, String(d.CURRENCIES.JPY.cup * 3));
    d.setCurrency("TWD", true);
  });
  test("every currency's minimum still leaves about US$0.5 after the worst-case Stripe fee (5.9% + S$0.50)", () => {
    const fixedUsd = 0.5 * d.CURRENCIES.SGD.usd;
    for (const [code, c] of Object.entries(d.CURRENCIES)) assert.ok(c.min * c.usd * (1 - 0.059) - fixedUsd >= 0.5, code);
  });
  test("money format uses unambiguous symbols", () => {
    assert.equal(d.fmtMoney(100, "TWD"), "NT$100");
    assert.equal(d.fmtMoney(3.5, "USD"), "US$3.50");
    assert.equal(d.fmtMoney(5, "SGD"), "S$5");
  });
});

describe("currencies", () => {
  test("currencyOf maps EU members and unknown countries", async () => {
    const env = await boot();
    const d = env.internals("donate");
    assert.equal(d.currencyOf("SG"), "SGD");
    assert.equal(d.currencyOf("MO"), "HKD");
    assert.equal(d.currencyOf("DE"), "EUR");
    assert.equal(d.currencyOf("BR"), "BRL");
    assert.equal(d.currencyOf("ZA"), "USD");
    assert.equal(d.currencyOf(""), "USD");
    assert.equal(env.document.getElementById("currency").value, "USD");
    env.close();
  });
  test("TWD goes through Stripe like every other currency while ECPay is off", async () => {
    const env = await boot({ storage: { detectedCountry: "TW" } });
    const doc = env.document;
    assert.equal(doc.getElementById("currency").value, "TWD");
    assert.ok(doc.getElementById("emailBox").classList.contains("hidden"));
    assert.match(doc.getElementById("methods").textContent, /Google Pay/);
    env.close();
  });
  test("currency picker: ordered by current users, the rest A-Z, searchable by code / name / symbol", async () => {
    const env = await boot({ storage: { detectedCountry: "TW" } });
    const d = env.internals("donate");
    const codes = Array.from(d.currencyCodes());
    assert.deepEqual(codes.slice(0, 4), ["TWD", "HKD", "JPY", "USD"]);
    const rest = codes.filter((c) => d.CURRENCY_ORDER.indexOf(c) < 0);
    assert.deepEqual(rest, [...rest].sort());
    assert.equal(codes.length, Object.keys(d.CURRENCIES).length);
    assert.deepEqual(Array.from(d.currencyMatches("chf")), ["CHF"]);
    assert.ok(d.currencyMatches("NT$").includes("TWD"));
    assert.ok(d.currencyMatches("yen").includes("JPY"), "English names work in any UI language");
    assert.equal(d.currencyMatches("zzz").length, 0);
    const doc = env.document;
    doc.getElementById("curBtn").click();
    const search = doc.getElementById("curSearch");
    search.value = "sgd";
    search.dispatchEvent(new env.window.Event("input"));
    search.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Enter" }));
    assert.equal(doc.getElementById("currency").value, "SGD");
    assert.ok(doc.getElementById("curPanel").classList.contains("hidden"));
    env.close();
  });
  test("payment methods follow the currency (PayNow only for SGD)", async () => {
    const env = await boot({ storage: { detectedCountry: "SG" } });
    const text = () => env.document.getElementById("methods").textContent;
    assert.match(text(), /PayNow/);
    env.internals("donate").setCurrency("TWD");
    assert.doesNotMatch(text(), /PayNow/);
    env.close();
  });
});

describe("avatars and tiers", () => {
  let env, d;
  before(async () => { env = await boot(); d = env.internals("donate"); });
  after(() => env.close());

  test("10 distinct, well-formed SVGs per name", () => {
    const urls = Array.from({ length: 10 }, (_, i) => d.avatarSvg("阿貓", i));
    assert.equal(new Set(urls).size, 10);
    const parser = new env.window.DOMParser();
    for (const u of urls) {
      const svg = decodeURIComponent(u.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
      const doc = parser.parseFromString(svg, "image/svg+xml");
      assert.equal(doc.getElementsByTagName("parsererror").length, 0, svg.slice(0, 80));
    }
  });
  test("names are escaped inside the SVG", () => {
    const svg = decodeURIComponent(d.avatarSvg("<script>", 9));
    assert.ok(!svg.includes("<script>"));
  });
  test("same name, same avatar; different name, different colors", () => {
    assert.equal(d.avatarSvg("Kevin", 3), d.avatarSvg("Kevin", 3));
    assert.notEqual(d.avatarSvg("Kevin", 3), d.avatarSvg("Kelly", 3));
  });
  test("tiers", () => {
    assert.equal(d.tierOf(0).cls, "t0");
    assert.equal(d.tierOf(5).cls, "t1");
    assert.equal(d.tierOf(49.99).cls, "t2");
    assert.equal(d.tierOf(100).cls, "t4");
  });
});

describe("leaderboard", () => {
  test("podium, list and projected rank", async () => {
    const env = await boot({ board: { ok: true, items: [item("a", 100), item("b", 50), item("c", 20), item("d", 10), item("e", 5)], donors: 5 } });
    const d = env.internals("donate");
    const doc = env.document;
    assert.equal(doc.querySelectorAll("#podium .pod:not(.empty)").length, 3);
    assert.equal(doc.querySelectorAll("#list .row").length, 2);
    assert.equal(doc.querySelector("#list .row .rk").textContent, "4");
    assert.equal(doc.getElementById("statDonors").textContent, "5");
    assert.equal(d.projectedRank(10), 5, "ties go to whoever was there first");
    assert.equal(d.projectedRank(10.01), 4);
    assert.equal(d.projectedRank(1000), 1);
    env.close();
  });
  test("motivation card: lead with the minimum, then the podium; overtaking shows the local amount", async () => {
    let env = await boot({ storage: { detectedCountry: "TW" }, board: { ok: true, items: [item("a", 100), item("b", 50), item("c", 20), item("d", 10)] } });
    const text = env.document.getElementById("meText").textContent;
    assert.ok(text.indexOf("NT$50") >= 0 && text.indexOf("NT$50") < text.indexOf("US$20"), text);
    env.close();
  });
  test("empty and failed boards", async () => {
    let env = await boot({ board: 404 });
    assert.equal(env.document.querySelectorAll("#podium .pod.empty").length, 3, "not deployed yet = nobody yet");
    assert.ok(!env.document.getElementById("meCard").classList.contains("hidden"));
    env.close();
    env = await boot({ board: null });
    assert.ok(!env.document.getElementById("boardState").classList.contains("hidden"));
    assert.ok(env.document.querySelector("#boardState button"), "retry button");
    env.close();
  });
});

describe("mock board and merged donors", () => {
  test("?mock shows 30 fake donors without calling the API; ?mock=me7 puts you at #7", async () => {
    const env = await boot({ query: "?mock=me7", storage: { donateProfile: { name: "老王", style: 2, image: "" } } });
    const doc = env.document;
    assert.equal(doc.querySelectorAll("#list .row").length, 27);
    assert.ok(!env.fetchCalls.some((c) => /\/v1\/donors/.test(c.url)));
    const mine = doc.querySelector("#list .row.me");
    assert.equal(mine.querySelector(".rk").textContent, "7");
    assert.match(mine.textContent, /老王/);
    assert.ok(!doc.getElementById("profileSave").classList.contains("hidden"), "on the board: can update name and avatar");
    env.close();
  });
  test("an item merged by email (pids) counts as mine", async () => {
    let env = await boot();
    const pid = env.internals("donate").me.pid;
    env.close();
    env = await boot({ storage: { donorId: env.internals("donate").me.donorId }, board: { ok: true, items: [item("a", 100), item("canon", 50, { pids: [pid] })] } });
    assert.ok(env.document.querySelector("#podium .pod.r2").classList.contains("me"));
    env.close();
  });
});

describe("profile", () => {
  test("saved name and avatar are restored and a donor id is created once", async () => {
    const env = await boot({ storage: { donateProfile: { name: "老王", style: 4, image: "" } } });
    const d = env.internals("donate");
    assert.equal(env.document.getElementById("name").value, "老王");
    assert.equal(d.me.style, 4);
    assert.match(d.me.donorId, /^[0-9a-f]{32}$/);
    const local = await new Promise((r) => env.window.chrome.storage.local.get({ donorId: "" }, r));
    assert.equal(local.donorId, d.me.donorId, "falls back to storage.local without storage.sync");
    env.close();
  });
  test("?lang= switches the page language", async () => {
    const env = await boot({ query: "?mock&lang=ja" });
    // jsdom 讀不到 _locales（同步 XHR），只驗語言偏好被換掉
    assert.equal(env.window.uiLangPref, "ja");
    assert.equal(env.window.uiLangTag(), "ja");
    env.close();
  });

  test("pay button posts the checkout and says so when it fails", async () => {
    const env = await boot({ storage: { detectedCountry: "SG" } });
    env.document.getElementById("payBtn").click();
    await env.settle(10);
    const call = env.fetchCalls.find((c) => /\/v1\/donate\/checkout$/.test(c.url));
    assert.ok(call);
    const body = JSON.parse(call.init.body);
    assert.equal(body.currency, "SGD");
    assert.ok(body.amount > 0 && body.donorId);
    assert.equal(env.document.getElementById("payNotice").className, "notice");
    assert.ok(!env.document.getElementById("payBtn").disabled);
    env.close();
  });
});

after(() => closeAll());
