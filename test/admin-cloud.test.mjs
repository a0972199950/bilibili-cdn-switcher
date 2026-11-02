// 雲端後台多出來的功能：Gemini 翻譯（scripts/lib/translate.mjs、tools/translate-worker）、雲端的 Google 憑證寄信（speedtest-reports.mjs）、
// 依設定開放的動作（admin-api.mjs 的 localOnly）。Gemini、Google、Cloudflare 的 trace 都換成假的 fetch
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { TranslateError, translateWithGemini } from "../scripts/lib/translate.mjs";
import { extName, money, sendGmail, useCurrencyTable } from "../scripts/lib/speedtest-reports.mjs";
import { handleAdminApi, localOnly } from "../scripts/lib/admin-api.mjs";
import { makeSession } from "../scripts/lib/admin-auth.mjs";
import translateWorker from "../tools/translate-worker/src/index.js";

const realFetch = globalThis.fetch;
let calls = [];
let geminiReply;   // (body) => Response
after(() => { globalThis.fetch = realFetch; delete process.env.GOOGLE_OAUTH; });
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    calls.push({ url, init });
    if (url.includes("generativelanguage.googleapis.com")) return geminiReply(JSON.parse(init.body));
    if (url.includes("cdn-cgi/trace")) return new Response("fl=1\ncolo=SIN\nloc=SG\n");
    if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "at-1", expires_in: 3600 });
    if (url.includes("gmail/v1/users/me/messages/send")) return Response.json({ id: "m1", threadId: "t1" });
    throw new Error("unexpected fetch " + url);
  };
});

const gemini = (obj, status = 200) => () => Response.json(status === 200
  ? { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }] }
  : { error: { message: obj } }, { status });

describe("Gemini translation", () => {
  test("sends the shared prompt as JSON-only and returns the same shape as the Claude path", async () => {
    let sent;
    geminiReply = (body) => { sent = body; return gemini({ en: { title: "Hello", html: "<p>Hi</p>" }, ja: { title: "こんにちは", html: "<p>やあ</p>" } })(); };
    const out = await translateWithGemini({ apiKey: "k", model: "gemini-x" }, "zh-TW", ["zh-TW", "en", "ja"], { title: "你好", html: "<p>嗨</p>", prefix: "" });
    assert.deepEqual(out, { en: { title: "Hello", html: "<p>Hi</p>" }, ja: { title: "こんにちは", html: "<p>やあ</p>" } });
    assert.match(calls[0].url, /models\/gemini-x:generateContent$/);
    assert.equal(calls[0].init.headers["x-goog-api-key"], "k");
    assert.equal(sent.generationConfig.responseMimeType, "application/json");
    assert.match(sent.contents[0].parts[0].text, /keep every tag and attribute exactly/);
    assert.ok(!/"prefix"/.test(sent.contents[0].parts[0].text.split("Source")[1]), "empty fields are not sent");
  });

  test("a missing language or field fails instead of filling half the form", async () => {
    geminiReply = gemini({ en: { title: "Hello" } });
    await assert.rejects(translateWithGemini({ apiKey: "k", model: "m" }, "zh-TW", ["en", "ja"], { title: "你好" }), /少了 Japanese/);
    geminiReply = gemini({ en: { title: "Hello" } });
    await assert.rejects(translateWithGemini({ apiKey: "k", model: "m" }, "zh-TW", ["en"], { title: "你好", html: "<p>x</p>" }), /少了 html/);
  });

  test("API errors become readable messages (unsupported region points to the local admin)", async () => {
    geminiReply = gemini("User location is not supported for the API use.", 400);
    await assert.rejects(translateWithGemini({ apiKey: "k", model: "m" }, "en", ["ja"], { title: "Hi" }), /不支援這次執行的地區/);
    await assert.rejects(translateWithGemini({ apiKey: "", model: "m" }, "en", ["ja"], { title: "Hi" }), TranslateError);
  });

  test("translate worker: POST /translate only, reports model and colo", async () => {
    geminiReply = gemini({ ja: { title: "やあ" } });
    const env = { GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-y" };
    const post = (body) => translateWorker.fetch(new Request("https://biboost-translate/translate", { method: "POST", body: JSON.stringify(body) }), env);
    const ok = await (await post({ from: "en", targets: ["ja"], fields: { title: "Hi" } })).json();
    assert.deepEqual(ok, { ok: true, result: { ja: { title: "やあ" } }, model: "gemini-y", colo: "SIN" });
    const bad = await post({ from: "xx", targets: ["ja"], fields: { title: "Hi" } });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /不認得的語言/);
    assert.equal((await translateWorker.fetch(new Request("https://biboost-translate/translate"), env)).status, 404);
  });
});

describe("cloud mail helpers", () => {
  test("extension names and currency symbols work without local files or Python", () => {
    assert.match(extName("zh-TW"), /\p{Script=Han}/u);
    assert.equal(extName("zh-HK"), extName("zh-TW"));
    assert.equal(extName("xx"), extName("en"));
    useCurrencyTable({ HKD: "HK$" });
    assert.equal(money(1500, "HKD"), "HK$1,500");
    assert.equal(money(200, "XYZ"), "200 XYZ");
  });

  test("GOOGLE_OAUTH: refresh token from the secret, test mail goes to the stored email without reading the profile", async () => {
    process.env.GOOGLE_OAUTH = JSON.stringify({ client_id: "c", client_secret: "s", refresh_token: "r", email: "me@example.com" });
    const sent = await sendGmail({ to: "winner@example.com", subject: "主旨", body: "內文", toSelf: true });
    assert.equal(sent.to, "me@example.com");
    assert.ok(!calls.some((c) => c.url.includes("/profile")));
    const tokenCall = calls.find((c) => c.url.includes("oauth2"));
    assert.equal(new URLSearchParams(tokenCall.init.body).get("refresh_token"), "r");
    const raw = Buffer.from(JSON.parse(calls.find((c) => c.url.includes("/send")).init.body).raw, "base64url").toString("utf8");
    assert.match(raw, /^To: me@example\.com\r\nSubject: =\?UTF-8\?B\?/);
    await sendGmail({ to: "winner@example.com", subject: "s", body: "b" });
    assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1, "access token is reused until it expires");
  });
});

describe("cloud actions follow what is configured", () => {
  const KEY = "k".repeat(40);
  const base = { local: false, ip: "1.2.3.4", limiter: { get: async () => 0, incr: async () => {} } };
  const env = { ADMIN_USER: "me", ADMIN_PASS_HASH: "x", ADMIN_SESSION_KEY: KEY };
  const req = async (name, args = []) => new Request(`https://biboost.app/admin/api/${name}`, {
    method: "POST", body: JSON.stringify({ args }),
    headers: { "Content-Type": "application/json", "X-BB-Admin": "1", Origin: "https://biboost.app", Cookie: `__Host-bb_admin=${await makeSession(KEY)}` },
  });

  test("nothing configured: translate and mail stay local-only; local admin has everything", () => {
    const off = localOnly({ ...base, env });
    for (const k of ["translate", "winnerMailDraftV2", "sendWinnerMailV2", "inviteMailDraft", "sendInviteMail", "drawWinnersV2"]) assert.ok(off[k], k);
    assert.deepEqual(localOnly({ ...base, local: true, env }), {});
  });

  test("translator and GOOGLE_OAUTH unlock translate and mail, but not the draw or v1 save", async () => {
    let got;
    const ctx = { ...base, env: { ...env, GOOGLE_OAUTH: "{}" }, translate: async (...a) => { got = a; return { ja: { title: "やあ" } }; } };
    const off = localOnly(ctx);
    assert.deepEqual(Object.keys(off).sort(), ["drawWinnersV2"]);
    const s = await (await handleAdminApi(await req("session"), ctx)).json();
    assert.deepEqual(Object.keys(s.result.localOnly).sort(), ["drawWinnersV2"]);
    const r = await (await handleAdminApi(await req("translate", ["en", ["ja"], { title: "Hi" }]), ctx)).json();
    assert.deepEqual(r, { ok: true, result: { translations: { ja: { title: "やあ" } } } });
    assert.deepEqual(got, ["en", ["ja"], { title: "Hi" }]);
  });

  test("a translator error is shown to the user as 400", async () => {
    const ctx = { ...base, env, translate: async () => { throw new TranslateError("Gemini 回報錯誤（429）：quota"); } };
    const res = await handleAdminApi(await req("translate", ["en", ["ja"], { title: "Hi" }]), ctx);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /quota/);
  });
});
