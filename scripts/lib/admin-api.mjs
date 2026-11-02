// 後台的 API：本機後台（admin/server.mjs，http://127.0.0.1:3100/admin）與雲端後台（biboost.app/admin，tools/site/src/index.js）共用這一份。
// 後台畫面（admin/）是純前端、不做 SSR，只透過這裡讀寫；資料庫邏輯都在 scripts/lib/*.mjs（CLI 也用同一份）。
//   POST /admin/api/<動作>   body：{ args: [...] }   → { ok: true, result } ／ { ok: false, error }
//   登入：session（目前登入狀態）、login、logout；skip 只有本機後台有（localhost 的「跳過」按鈕，帳密或雲端出事時還進得來）
// 安全：
//   · 只收 POST、Content-Type: application/json、X-BB-Admin: 1（自訂標頭讓跨站請求一定要先 preflight，這裡不回 CORS，別的網站送不進來）；
//     有 Origin 時要跟後台同一個來源
//   · session cookie：HttpOnly、SameSite=Strict；雲端另外 Secure 加 __Host- 前綴。內容是 admin-auth.mjs 簽章的 token
//   · 登入限流（LOGIN_LIMITS）：同一個 IP 15 分鐘內錯 5 次、所有來源 1 小時內錯 30 次就先擋（雲端用 KV，本機用記憶體）
//   · LOCAL_ONLY 的動作要用到本機的檔案或程式（Python、Claude Code、Google 憑證、測速報告歸檔），雲端拒絕；
//     翻譯、寄信在雲端有設定時開放（localOnly(ctx)）
// ctx：{ local: 是不是本機後台, env: { ADMIN_USER, ADMIN_PASS_HASH, ADMIN_SESSION_KEY, GOOGLE_OAUTH? }, ip, limiter: { get(key), incr(key, ttl 秒) },
//        translate?: (from, targets, fields) => { 語言: { 欄位 } }（雲端的翻譯；沒給就用本機的 Claude Code） }
import * as A from "./announcements.mjs";
import * as D from "./donations.mjs";
import * as I from "./invites.mjs";
import * as L from "./lotteries.mjs";
import * as V from "./lotteries-v2.mjs";
import * as S from "./settings.mjs";
import * as T from "./translate.mjs";
import * as W from "./winners.mjs";
import { SESSION_KEY_MIN, SESSION_TTL_MS, checkSession, makeSession, safeEqual, verifyPassword } from "./admin-auth.mjs";

export const API_PREFIX = "/admin/api/";
const LOGIN_LIMITS = [{ key: (ip) => `adm:ip:${ip}`, max: 5, ttl: 900 }, { key: () => "adm:all", max: 30, ttl: 3600 }];
const FAIL_DELAY_MS = 500;

// 只能在本機後台用的動作 → 原因（雲端的畫面把按鈕停用，滑過去顯示這段）
const NO_GOOGLE = "雲端沒有設定 Google 憑證（GOOGLE_OAUTH，npm run admin:google）";
export const LOCAL_ONLY = {
  translate: "雲端沒有接上翻譯（biboost-translate worker）",
  drawWinnersV2: "抽出中獎人要讀本機的測速報告歸檔",
  winnerMailDraftV2: NO_GOOGLE,
  sendWinnerMailV2: NO_GOOGLE,
  inviteMailDraft: NO_GOOGLE,
  sendInviteMail: NO_GOOGLE,
};
const GOOGLE_ACTIONS = ["winnerMailDraftV2", "sendWinnerMailV2", "inviteMailDraft", "sendInviteMail"];

// 這個後台不能用的動作 → 原因：本機全開；雲端扣掉有設定的（翻譯：ctx.translate；寄信：GOOGLE_OAUTH）
export function localOnly(ctx) {
  if (ctx.local) return {};
  const out = { ...LOCAL_ONLY };
  if (ctx.translate) delete out.translate;
  if (ctx.env?.GOOGLE_OAUTH) for (const k of GOOGLE_ACTIONS) delete out[k];
  return out;
}
// 這些錯誤的訊息是寫給人看的（欄位檢查不過等），原樣顯示在畫面上；其他錯誤是程式或連線問題
const USER_ERRORS = new Set(["LotteryError", "AnnouncementError", "DonationError", "TranslateError"]);
const CLOUD_SHEET_NOTE = "雲端後台沒有設定 Google 憑證（GOOGLE_OAUTH）：讀不到測速報告的試算表，報告欄只有 Apps Script 記的份數";

// 清單欄位：表單給陣列（antd 的 tags 輸入），也接受一行一個的字串
const lines = (s) => (Array.isArray(s) ? s : String(s || "").split(/\r?\n/)).map((x) => String(x).trim()).filter(Boolean);
const done = async (p) => { await p; return {}; };

// 抽獎 v2 表單的值 → lotteries-v2.mjs 的 metadata（禮物卡沒填名稱的列略過；面額沒填交給檢查擋；標題、備註是 { 語言: 文字 }）
function toMetaV2(v) {
  return {
    title: v.title || {},
    country: String(v.country || "").trim().toUpperCase(),
    start: v.start, end: v.end,
    currency: String(v.currency || "").trim().toUpperCase(),
    giftCards: (v.giftCards || []).filter((c) => c && String(c.name || "").trim())
      .map((c) => ({ name: String(c.name), amount: c.amount == null || c.amount === "" ? NaN : Number(c.amount) })),
    note: v.note || {},
    winners: Number(v.winners),
    isps: lines(v.isps),
    drawDays: v.drawDays === "" || v.drawDays == null ? 7 : Number(v.drawDays),
  };
}

// 動作：(args 陣列, ctx) → 結果（可以 JSON 化）。預覽回 { preview: { api（API 格式的 metadata）, exe（exe 的 HTML，本機才有，要跑 Python）} }，
// 擴充的文字由畫面直接跑擴充的 src/lottery-text.js 組
const ACTIONS = {
  // ── 公告 ──
  listAnnouncements: () => A.listAnnouncements(),
  getAnnouncement: ([id]) => A.getAnnouncement(Number(id)),
  saveAnnouncement: async ([id, values]) => {
    if (!id) return { id: await A.addHtmlAnnouncement(values) };
    if (!(await A.updateHtmlAnnouncement(Number(id), values))) throw new A.AnnouncementError(`找不到第 ${id} 則一般公告`);
    return { id: Number(id) };
  },
  deleteAnnouncement: ([id]) => done(A.deleteHtmlAnnouncement(Number(id))),
  // 翻譯（公告、抽獎 v2 共用）：本機用 Claude Code，雲端用 ctx.translate（Gemini）→ { translations: { 語言: { 欄位: 文字 } } }
  translate: async ([from, targets, fields], ctx) => ({ translations: await (ctx.translate || T.translateFields)(from, targets, fields) }),

  // ── 抽獎（lotteries-v2.mjs；舊版客戶端讀的 v1 抽獎已經不在後台管理）──
  listLotteriesV2: async () => ({ rows: await V.listLotteriesV2() }),
  getLotteryV2: async ([id]) => ({ lottery: await V.getLotteryV2(Number(id)), reasons: V.EXCLUDE_REASONS }),
  previewLotteryV2: ([values], ctx) => {
    const m = V.validateMetaV2(toMetaV2(values));
    const api = V.apiMetaV2(m);
    return { preview: { api, note: m.note, exe: ctx.local ? L.htmlFromApi(api) : null } };
  },
  saveLotteryV2: async ([id, values]) => {
    if (!id) return { id: await V.addLotteryV2(toMetaV2(values)) };
    if (!(await V.updateLotteryV2(Number(id), toMetaV2(values)))) throw new L.LotteryError(`找不到第 ${id} 個抽獎`);
    return { id: Number(id) };
  },
  endLotteryV2: ([id]) => done(V.endLotteryV2(Number(id))),
  drawWinnersV2: async ([id]) => ({ draw: await V.drawWinners(Number(id)) }),
  winnerMailDraftV2: async ([id, rid, opts]) => ({ draft: await V.winnerMailDraft(Number(id), rid, opts) }),
  sendWinnerMailV2: async ([id, rid, mail]) => ({ draw: await V.sendWinnerMail(Number(id), rid, mail) }),

  // ── 中獎人（抽獎中獎人＋必中獎參加人，winners.mjs）──
  //（雲端沒設 Google 憑證就讀不到試算表：必中獎的報告欄退回只有資料庫的欄位；歸檔狀態用本機同步的快照）
  listWinners: async (_, ctx) => {
    const r = await W.listWinners();
    const noSheet = !ctx.local && !ctx.env?.GOOGLE_OAUTH;
    return { ...r, sheetError: noSheet ? CLOUD_SHEET_NOTE : r.sheetError && `讀不到測速報告的試算表：${r.sheetError}` };
  },
  // 記錄／修改禮物卡已寄出（prize：{ date, cost, currency, note }，null＝取消標記；opts.revoke：必中獎同時作廢邀請碼）
  setPrize: ([key, prize, opts]) => done(W.setPrize(key, prize, opts || {})),
  // 刪除中獎人（必中獎同時作廢邀請碼）
  deleteWinner: ([key]) => done(W.deleteWinner(key)),
  // ── 必中獎 ──
  createInvite: async ([email, lotteryId]) => ({ code: await I.createInvite(email, lotteryId) }),
  setReview: ([code, review, note]) => done(I.setReview(code, review, note)),
  revokeInvite: ([code]) => done(I.revokeInvite(code)),
  // 信件草稿：{ draft: { to, lang, subject, body, fields: { currency } } }（opts.cards：[{ name, amount }]）
  inviteMailDraft: async ([code, opts]) => {
    const d = await I.inviteMailDraft(code, opts);
    return { draft: { ...d, fields: { currency: d.currency } } };
  },
  sendInviteMail: ([code, mail]) => done(I.sendInviteMail(code, mail)),

  // ── 贊助管理 ──
  listDonations: async ([range]) => {
    const [rows, enabled] = await Promise.all([D.listDonations(range || {}), S.donateEnabled()]);
    return { rows, enabled };
  },
  setDonateEnabled: async ([on]) => {
    await S.setSetting(S.DONATE_ENABLED, on === true);
    return { enabled: on === true };
  },
};

function json(status, obj, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
const fail = (status, error, headers) => json(status, { ok: false, error }, headers);

const cookieName = (ctx) => (ctx.local ? "bb_admin" : "__Host-bb_admin");
function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}
function setCookie(ctx, value, maxAge) {
  return `${cookieName(ctx)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${ctx.local ? "" : "; Secure"}`;
}
const sessionKey = (ctx) => (ctx.env.ADMIN_SESSION_KEY && ctx.env.ADMIN_SESSION_KEY.length >= SESSION_KEY_MIN ? ctx.env.ADMIN_SESSION_KEY : "");
const sessionInfo = (ctx) => ({ local: !!ctx.local, localOnly: localOnly(ctx) });

async function startSession(ctx) {
  const token = await makeSession(sessionKey(ctx));
  return json(200, { ok: true, result: sessionInfo(ctx) }, { "Set-Cookie": setCookie(ctx, token, Math.floor(SESSION_TTL_MS / 1000)) });
}

async function login(ctx, cred) {
  if (!ctx.env.ADMIN_USER || !ctx.env.ADMIN_PASS_HASH || !sessionKey(ctx)) return fail(503, "not_configured");
  const ip = ctx.ip || "unknown";
  const counts = await Promise.all(LOGIN_LIMITS.map((l) => ctx.limiter.get(l.key(ip))));
  if (counts.some((n, i) => n >= LOGIN_LIMITS[i].max)) return fail(429, "rate_limited");
  const c = cred && typeof cred === "object" ? cred : {};
  // 帳號錯也照樣算一次雜湊，回應時間不洩漏帳號對不對
  const userOk = safeEqual(String(c.user ?? ""), ctx.env.ADMIN_USER);
  const passOk = await verifyPassword(String(c.pass ?? ""), ctx.env.ADMIN_PASS_HASH);
  if (!userOk || !passOk) {
    await Promise.all(LOGIN_LIMITS.map((l) => ctx.limiter.incr(l.key(ip), l.ttl)));
    console.warn(`admin login failed from ${ip}`);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return fail(401, "bad_credentials");
  }
  return startSession(ctx);
}

export async function handleAdminApi(request, ctx) {
  const url = new URL(request.url);
  const name = url.pathname.slice(API_PREFIX.length);
  if (request.method !== "POST") return fail(405, "method_not_allowed", { Allow: "POST" });
  if (request.headers.get("X-BB-Admin") !== "1" || !/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return fail(400, "bad_request");
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return fail(403, "bad_origin");
  let body;
  try { body = await request.json(); } catch { return fail(400, "bad_json"); }
  const args = Array.isArray(body?.args) ? body.args : [];

  const authed = await checkSession(sessionKey(ctx), readCookie(request, cookieName(ctx)));
  if (name === "session") return authed ? json(200, { ok: true, result: sessionInfo(ctx) }) : json(401, { ok: false, error: "unauthorized", local: !!ctx.local });
  if (name === "login") return login(ctx, args[0]);
  if (name === "skip") return ctx.local ? startSession(ctx) : fail(404, "not_found");
  if (name === "logout") return json(200, { ok: true, result: null }, { "Set-Cookie": setCookie(ctx, "", 0) });
  if (!authed) return fail(401, "unauthorized");

  if (!Object.hasOwn(ACTIONS, name)) return fail(404, "not_found");
  const off = localOnly(ctx);
  if (Object.hasOwn(off, name)) return fail(400, `${off[name]}，只能在本機後台（npm run admin）使用`);
  try {
    return json(200, { ok: true, result: (await ACTIONS[name](args, ctx)) ?? null });
  } catch (e) {
    if (USER_ERRORS.has(e?.constructor?.name)) return fail(400, e.message);
    console.error(`admin ${name}:`, e);
    return fail(500, `伺服器錯誤：${e?.message || e}`);
  }
}
