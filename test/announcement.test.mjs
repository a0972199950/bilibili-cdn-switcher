import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createEnv, closeAll } from "./helpers/load.mjs";

const API = "https://bcs-report.bilibili-cdn-switcher-tools.workers.dev/v2/announcements";
const now = Date.now();
const ITEMS = [
  { id: 1, type: "lottery", lottery: { country: "TW", startsAt: now - 1000, endsAt: now + 1e6, title: { en: "Draw!" }, prize: { currency: "TWD", giftCards: [{ name: "A", amount: 100 }, { name: "B", amount: 200 }] }, winners: 2, isps: ["ISP1"], startDate: "2026-10-01", endDate: "2026-10-30", drawBy: "2026-11-06", note: { en: "<p>Note <b>here</b><script>x()</script></p>" } } },
  { id: 2, type: "html", title: { en: "Hello", "zh-TW": "你好" }, html: { en: '<h3>Hi</h3><a href="https://x.com/">link</a><img src="x">' } },
  { id: 3, type: "lottery", lottery: { country: "TW", startsAt: now - 2e6, endsAt: now - 1e6, prize: { amount: 1, currency: "TWD", giftCards: ["A"] }, winners: 1, startDate: "2026-01-01", endDate: "2026-01-02", drawBy: "2026-01-03" } }
];

async function boot(id, { feed = { v: 2, at: now, items: ITEMS }, api = null, uiLanguage } = {}) {
  const env = createEnv({ htmlFile: "announcement.html", url: "chrome-extension://bcs-test/announcement.html" + (id != null ? "?id=" + id : ""), storage: feed ? { announcementFeed: feed } : {}, uiLanguage });
  env.fetchHandler = (url) => {
    if (url === API && api) return { json: () => Promise.resolve(api) };
    throw new TypeError("Failed to fetch");
  };
  ["theme.js", "i18n.js", "lottery-text.js", "html-sanitize.js", "announcement.js"].forEach((f) => env.load(f));
  await env.settle(20);
  return env;
}

describe("announcement window", () => {
  test("html announcement renders title and sanitized body", async () => {
    const env = await boot(2);
    const d = env.document;
    assert.equal(d.title, "Hello");
    assert.equal(d.getElementById("title").textContent, "Hello");
    assert.equal(d.getElementById("body").innerHTML, '<h3>Hi</h3><a href="https://x.com/">link</a>');
    assert.equal(d.getElementById("giftIcon").style.display, "none");
    assert.equal(d.getElementById("ctaBtn").style.display, "none", "html announcements have no speed-test CTA");
    assert.equal(env.fetchCalls.some((c) => c.url === API), false, "served from cache");
    env.close();
  });
  test("interface language picks the localized title", async () => {
    const env = await boot(2, { uiLanguage: "zh-TW" });
    assert.equal(env.document.getElementById("title").textContent, "你好");
    assert.equal(env.document.documentElement.lang, "zh-TW");
    env.close();
  });
  test("lottery announcement composes the text and shows the sanitized note", async () => {
    const env = await boot(1);
    const d = env.document;
    const body = d.getElementById("body");
    assert.equal(d.getElementById("giftIcon").style.display, "");
    assert.equal(body.querySelector("h2").textContent, "Taiwan only: NT$100–200 gift cards, winners: 2");
    assert.equal(body.querySelector(".ispList").textContent, "ISP1");
    assert.equal(body.querySelector(".lotNote .rich").innerHTML, "<p>Note <b>here</b></p>");
    assert.equal(d.getElementById("ctaBtn").style.display, "");
    d.getElementById("ctaBtn").click();
    assert.ok(env.createdTabs[0].url.startsWith("https://lazy-cv.com/docs/bilibili-cdn-speedtest?utm_source=extension"));
    assert.ok(env.createdTabs[0].url.endsWith("utm_content=en"));
    env.close();
  });
  test("ended lottery → 'gone' message", async () => {
    const env = await boot(3);
    assert.equal(env.document.querySelector("#body .empty").textContent, env.chrome.i18n.getMessage("announceGone"));
    env.close();
  });
  test("id not in cache → refetch, cache updated", async () => {
    const env = await boot(9, { api: { ok: true, items: [{ id: 9, type: "html", title: { en: "Fresh" }, html: { en: "<p>x</p>" } }] } });
    assert.equal(env.document.getElementById("title").textContent, "Fresh");
    assert.equal(env.storage.announcementFeed.items[0].id, 9);
    env.close();
  });
  test("old cache format is ignored and refetched; fetch failure falls back to 'gone'", async () => {
    const env = await boot(2, { feed: { v: 1, at: now, items: ITEMS } });
    assert.ok(env.fetchCalls.some((c) => c.url === API));
    assert.ok(env.document.querySelector("#body .empty"));
    env.close();
  });
  test("no / invalid id → gone", async () => {
    const env = await boot("abc");
    assert.equal(env.internals("announcement").ID, null);
    assert.ok(env.document.querySelector("#body .empty"));
    env.close();
  });
  test("pickLang fallback order", async () => {
    const env = await boot(2);
    const a = env.internals("announcement");
    assert.equal(a.pickLang({ ja: "j", en: "e" }), "e");
    assert.equal(a.pickLang({ "zh-TW": "t" }), "t");
    assert.equal(a.pickLang({ ko: "k" }), "k");
    assert.equal(a.pickLang(null), "");
    env.close();
  });
});

after(closeAll);
