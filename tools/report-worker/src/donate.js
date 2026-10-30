/**
 * 贊助（擴充的 src/donate.html）：乾爹排行榜與 Stripe 結帳。資料表見 scripts/lib/donations.mjs（npm run donations:setup 建）。
 *  - GET  /v1/donors                 排行榜：同一個 pid 的已付款贊助合併、依美金累計排序，邊緣快取 CACHE_S 秒
 *  - GET  /v1/donors/<pid>/avatar    上傳的頭像圖片
 *  - POST /v1/donors/profile        已上榜的人事後改名稱／頭像
 *  - POST /v1/donate/checkout        建付款頁，回 { ok, url }；先記一筆 donation_intents（名稱、頭像、金額、語言、email…）。
 *                                    新台幣走綠界（ECPay 全方位金流 AIO，個人一般賣家：只收台幣、只收台灣發行的卡），其他幣別走 Stripe（新加坡帳戶）
 *  - GET  /v1/donate/ecpay/go/<id>   自動送出表單到綠界付款頁（綠界只收 form POST，擴充開的分頁先到這裡）
 *  - POST /v1/donate/webhook/ecpay   綠界付款結果通知（ReturnURL）：驗 CheckMacValue，RtnCode=1 記進 donations，回 1|OK
 *  - POST /v1/donate/webhook/stripe  Stripe webhook：付款成功記進 donations（含匯率、付款方式；手續費、實收有的話一起記，沒有就等 charge.updated 補），退款／爭議改狀態
 *  - GET  /v1/donate/thanks、/v1/donate/cancel   付款完成／取消後 Stripe 導回的頁面
 * secrets：ECPAY_MERCHANT_ID、ECPAY_HASH_KEY、ECPAY_HASH_IV（vars 的 ECPAY_STAGE = "1" 時打綠界測試環境）；STRIPE_SECRET_KEY、STRIPE_WEBHOOK_SECRET。
 * 沒設的那一邊結帳回 503 not_configured（擴充顯示「付款頁開啟失敗」）。
 * Stripe 新加坡帳戶的「捐款」只限註冊慈善團體，所以商品名稱一律寫成 tip／support，不用 donation（spec/donate.md 研究報告）。
 * 同一位贊助者換了 donorId（換電腦、沒開同步）但 email 相同時自動合併（recordDonation、donor_aliases）。
 * email：Stripe 付款頁會收；綠界的通知不給 email，所以選新台幣時擴充讓使用者選填（存在 donation_intents.email）。
 * 金額換算美金：付款當下用 open.er-api.com 的匯率（付款人付的幣別 → USD）；Stripe 的手續費、實收是結算幣別（SGD），一併換成美金存。
 */
const NAME_MAX = 20;
const AVATAR_STYLES = 10;
const AVATAR_MAX = 60 * 1024; // 上傳頭像 data URL 上限（擴充縮成 128×128，通常 5–15 KB）
const DONORS_LIMIT = 200;
const CHECKOUT_LIMIT = 10; // 同一個 IP 10 分鐘內最多建幾次結帳（擋盜刷測卡）
const CHECKOUT_WINDOW_S = 600;
const FRESH_LIMIT = 30; // 同一個 IP 10 分鐘內最多幾次略過快取讀排行榜（付款後確認上榜用），超過就回快取的版本
const MAX_USD = 2000;
// 與 src/donate.js 的 CURRENCIES 相同的最低金額（test/donate-worker.test.mjs 會比對兩邊）；stripe = Stripe API 的小數位（JPY、KRW、VND 是零位小數幣別，其他乘 100）；usd 只用來擋上限
const CURRENCIES = {
  USD: { min: 1, dec: 2, stripe: 2, usd: 1 }, TWD: { min: 50, dec: 0, stripe: 2, usd: 0.0308 }, HKD: { min: 10, dec: 0, stripe: 2, usd: 0.1275 },
  SGD: { min: 2, dec: 2, stripe: 2, usd: 0.78 }, MYR: { min: 5, dec: 2, stripe: 2, usd: 0.245 }, JPY: { min: 200, dec: 0, stripe: 0, usd: 0.00633 },
  KRW: { min: 1500, dec: 0, stripe: 0, usd: 0.000746 }, CNY: { min: 10, dec: 0, stripe: 2, usd: 0.1497 }, AUD: { min: 1.5, dec: 2, stripe: 2, usd: 0.704 },
  CAD: { min: 1.5, dec: 2, stripe: 2, usd: 0.713 }, EUR: { min: 1, dec: 2, stripe: 2, usd: 1.115 }, GBP: { min: 1, dec: 2, stripe: 2, usd: 1.33 },
  NZD: { min: 2, dec: 2, stripe: 2, usd: 0.5625 }, BRL: { min: 6, dec: 2, stripe: 2, usd: 0.1865 }, IDR: { min: 20000, dec: 0, stripe: 2, usd: 0.0000551 },
  VND: { min: 25000, dec: 0, stripe: 0, usd: 0.0000388 }, THB: { min: 35, dec: 0, stripe: 2, usd: 0.02964 }, PHP: { min: 65, dec: 0, stripe: 2, usd: 0.01567 },
  CHF: { min: 1, dec: 2, stripe: 2, usd: 1.21 }, SEK: { min: 10, dec: 0, stripe: 2, usd: 0.1014 }, MXN: { min: 20, dec: 0, stripe: 2, usd: 0.0531 }
};
// 擴充的語言 → Stripe Checkout 的 locale
const STRIPE_LOCALES = { "zh-TW": "zh-TW", "zh-CN": "zh", en: "en", ja: "ja", ko: "ko" };
const PRODUCT_NAME = "Tip for BiBoost (bilibili CDN Switcher)";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function pidOf(donorId) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bcs-donor:" + donorId));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
function randId() {
  const a = new Uint8Array(9); crypto.getRandomValues(a);
  return "di_" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleDonate(request, env, ctx, url, h) {
  const path = url.pathname, m = request.method;
  if (m === "GET" && path === "/v1/donors") return donors(request, env, ctx, h);
  const av = /^\/v1\/donors\/([0-9a-f]{16})\/avatar$/.exec(path);
  if (m === "GET" && av) return donorAvatar(env, av[1], h);
  if (m === "POST" && path === "/v1/donate/checkout") return checkout(request, env, h);
  if (m === "POST" && path === "/v1/donors/profile") return updateProfile(request, env, ctx, h);
  if (m === "POST" && path === "/v1/donate/webhook/stripe") return stripeWebhook(request, env, ctx, h);
  if (m === "POST" && path === "/v1/donate/webhook/ecpay") return ecpayWebhook(request, env, ctx, h);
  const go = /^\/v1\/donate\/ecpay\/go\/(di_[0-9a-f]{18})$/.exec(path);
  if (m === "GET" && go) return ecpayGo(request, env, go[1], h);
  if (m === "GET" && (path === "/v1/donate/thanks" || path === "/v1/donate/cancel")) return resultPage(path.endsWith("thanks"), url.searchParams.get("lang"), url.searchParams.get("back"));
  return h.fail(404, "not_found");
}

// ---------------- 排行榜 ----------------
// { ok, items: [{ pid, pids?（email 合併進來的其他 pid）, name, avatar: { style } | { url }, usd, count }], donors }；不上榜（hidden）的人不列但算進人數。總金額不公開。
// 同額時先達到的在前（擴充預估名次也是這樣算）。上傳的頭像給網址另外抓，?v= 是頭像更新時間，換頭像後網址跟著變
function donorsKey(request) { return new Request(new URL("/v1/donors", request.url).toString()); }
function clientIp(request) { return request.headers.get("CF-Connecting-IP") || "0.0.0.0"; }
// 同一個 IP 在 CHECKOUT_WINDOW_S 內的次數（KV）：沒超過 limit 就記一次、回 true。
// KV 出錯（同一個 key 一秒內寫兩次、超過每日寫入額度）就放行：限流壞掉不該擋住付款
export async function rateHit(env, key, limit) {
  if (!env.RATE_KV) return true;
  try {
    const n = Number((await env.RATE_KV.get(key)) || 0);
    if (n >= limit) return false;
    await env.RATE_KV.put(key, String(n + 1), { expirationTtl: CHECKOUT_WINDOW_S });
  } catch (e) { /* 放行 */ }
  return true;
}
// ?fresh=1：略過快取直接讀資料庫（擴充付款後確認自己上榜），結果照樣寫回這個節點的快取
async function donors(request, env, ctx, h) {
  const cache = caches.default;
  let fresh = new URL(request.url).searchParams.has("fresh");
  if (fresh && !(await rateHit(env, "df:" + clientIp(request), FRESH_LIMIT))) fresh = false;
  const hit = fresh ? null : await cache.match(donorsKey(request));
  if (hit) return hit;
  if (!env.DATABASE_URL) return h.fail(503, "not_configured");
  let rows, totals;
  try {
    [rows, totals] = await Promise.all([
      h.neonSql(env, `select d.pid, d.name, d.avatar_style, d.avatar_image is not null as has_image,
          (select array_agg(a.pid) from donor_aliases a where a.canonical = d.pid) as aliases,
          (extract(epoch from d.updated_at) * 1000)::float8 as updated_ms, sum(x.usd)::float8 as usd, count(*)::int as count
        from donations x join donors d using (pid)
        where x.status = 'paid' and not d.hidden
        group by d.pid order by usd desc, max(x.paid_at) limit ${DONORS_LIMIT}`),
      h.neonSql(env, "select count(distinct pid)::int as donors from donations where status = 'paid'")
    ]);
  } catch (e) {
    // 資料表還沒建（npm run donations:setup）就當作還沒有人贊助；其他錯誤（帳密錯、SQL 錯）照實回 502，不快取空的排行榜
    if (!/^neon_4\d\d [\s\S]*(42P01|does not exist)/.test(String(e.message))) return h.fail(502, "db");
    rows = []; totals = [{ donors: 0 }];
  }
  const origin = new URL(request.url).origin;
  const items = rows.map((r) => ({
    pid: r.pid, pids: r.aliases || undefined, name: r.name || "", usd: Math.round(r.usd * 100) / 100, count: r.count,
    avatar: r.has_image ? { url: `${origin}/v1/donors/${r.pid}/avatar?v=${Math.round(r.updated_ms)}` } : { style: r.avatar_style }
  }));
  const res = new Response(JSON.stringify({ ok: true, items, donors: totals[0].donors }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${h.CACHE_S}`, ...h.CORS }
  });
  ctx.waitUntil(cache.put(donorsKey(request), res.clone()));
  return res;
}
async function donorAvatar(env, pid, h) {
  if (!env.DATABASE_URL) return h.fail(503, "not_configured");
  let rows;
  try { rows = await h.neonSql(env, "select avatar_image from donors where pid = $1 and not hidden", [pid]); } catch (e) { return h.fail(502, "db"); }
  const m = rows.length && /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(rows[0].avatar_image || "");
  if (!m) return h.fail(404, "not_found");
  const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bin, { headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=31536000, immutable", ...h.CORS } });
}

// ---------------- 結帳 ----------------
// body（text/plain 的 JSON，避免 preflight）：{ v: 1, donorId, name, avatar: { style } | { image }, amount, currency, lang, browser, version }
export function checkInput(p) {
  const bad = checkProfile(p);
  if (bad) return bad;
  const c = CURRENCIES[p.currency];
  const amount = Number(p.amount);
  if (!c || !isFinite(amount) || amount < c.min || amount * c.usd > MAX_USD) return "bad_amount";
  if (Math.abs(Math.round(amount * 10 ** c.dec) - amount * 10 ** c.dec) > 1e-6) return "bad_amount";
  if (p.email != null && p.email !== "" && (typeof p.email !== "string" || p.email.length > 200 || !EMAIL_RE.test(p.email))) return "bad_email";
  if (p.back != null && p.back !== "" && !isBackUrl(p.back)) return "bad_back";
  return "";
}
// 贊助頁的網址：擴充（chrome-extension://<ID>/donate.html；Firefox 是 moz-extension://<UUID>/donate.html）或公開網站（https://biboost.app/donate）。
// 感謝頁、取消頁的「回到贊助頁」連過去。只收這兩種格式，不然就成了任意網址的轉址
const BACK_RE = /^(?:(?:chrome-extension|moz-extension):\/\/[a-z0-9-]{20,64}\/donate\.html|https:\/\/biboost\.app\/donate)$/;
export function isBackUrl(s) { return typeof s === "string" && BACK_RE.test(s); }
// 名稱與頭像（結帳與事後修改共用）
export function checkProfile(p) {
  if (!p || p.v !== 1 || !/^[0-9a-f]{32}$/.test(p.donorId || "")) return "bad_json";
  if (typeof p.name !== "string" || Array.from(p.name).length > NAME_MAX) return "bad_name";
  const av = p.avatar || {};
  if (av.image != null) {
    if (typeof av.image !== "string" || av.image.length > AVATAR_MAX || !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(av.image)) return "bad_avatar";
  } else if (!(Number.isInteger(av.style) && av.style >= 0 && av.style < AVATAR_STYLES)) return "bad_avatar";
  return "";
}
function form(obj, prefix, out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
async function stripe(env, method, path, params) {
  const r = await fetch("https://api.stripe.com/v1" + path, {
    method,
    headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body: params ? form(params).toString() : undefined
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("stripe_" + r.status + (j && j.error ? ":" + j.error.code : ""));
  return j;
}
async function checkout(request, env, h) {
  if (!env.DATABASE_URL) return h.fail(503, "not_configured");
  let p;
  try { p = JSON.parse(await request.text()); } catch (e) { return h.fail(400, "bad_json"); }
  const bad = checkInput(p);
  if (bad) return h.fail(400, bad);
  // 新台幣只有設好綠界 secrets 才走綠界（目前沒申請，spec/donate.md ⑧），否則跟其他幣別一樣走 Stripe；擴充端的 ECPAY_ON 要跟著改
  const provider = p.currency === "TWD" && ecpayReady(env) ? "ecpay" : "stripe";
  if (provider === "stripe" && !env.STRIPE_SECRET_KEY) return h.fail(503, "not_configured");
  if (!(await rateHit(env, "dn:" + clientIp(request), CHECKOUT_LIMIT))) return h.fail(429, "rate_limited");
  const pid = await pidOf(p.donorId);
  const id = randId();
  const lang = STRIPE_LOCALES[p.lang] ? p.lang : "en";
  const origin = new URL(request.url).origin;
  let session = null, url;
  if (provider === "stripe") {
    const c = CURRENCIES[p.currency];
    const back = isBackUrl(p.back) ? `&back=${encodeURIComponent(p.back)}` : "";
    try {
      session = await stripe(env, "POST", "/checkout/sessions", {
        mode: "payment",
        line_items: { 0: { quantity: 1, price_data: { currency: p.currency.toLowerCase(), unit_amount: Math.round(Number(p.amount) * 10 ** c.stripe), product_data: { name: PRODUCT_NAME } } } },
        client_reference_id: pid,
        metadata: { intent: id, pid },
        payment_intent_data: { description: PRODUCT_NAME, metadata: { intent: id, pid } },
        locale: STRIPE_LOCALES[lang],
        success_url: `${origin}/v1/donate/thanks?lang=${encodeURIComponent(lang)}${back}`,
        cancel_url: `${origin}/v1/donate/cancel?lang=${encodeURIComponent(lang)}${back}`
      });
    } catch (e) { console.error("checkout: " + e.message); return h.fail(502, "stripe"); } // 細節看 wrangler tail（只有狀態碼與錯誤代碼）
    url = session.url;
  } else {
    url = `${origin}/v1/donate/ecpay/go/${id}`; // 綠界的 MerchantTradeNo 就是 intent id 去掉底線（英數字 20 碼）
  }
  const avatar = p.avatar || {};
  try {
    await h.neonSql(env, `insert into donation_intents (id, pid, name, avatar_style, avatar_image, amount, currency, country, lang, browser, ext_version, provider, provider_session, email)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, pid, p.name.trim(), avatar.image ? null : avatar.style, avatar.image || null, Number(p.amount), p.currency,
        (request.cf && request.cf.country) || null, lang, String(p.browser || "").slice(0, 20), String(p.version || "").slice(0, 20),
        provider, session ? session.id : ecpayTradeNo(id), p.email ? p.email.trim().toLowerCase() : null]);
  } catch (e) { return h.fail(502, "db"); }
  return h.json(200, { ok: true, url });
}

// ---------------- 綠界（新台幣） ----------------
// 個人一般賣家：信用卡（限台灣發行）、Apple Pay、超商條碼／代碼；ATM、WebATM 是銀行轉帳，不開。
// 超商的手續費是固定的（條碼 16 元、代碼 31 元＋5% 稅），金額小時幾乎全被吃掉，ECPAY_CVS_MIN 以下不開超商。
const ECPAY_CVS_MIN = 150;
const ECPAY_LANG = { "zh-CN": "CHI", en: "ENG", ja: "JPN", ko: "KOR" }; // 繁中不用帶
const ECPAY_ITEM = "嗶速 BiBoost 贊助";
function ecpayReady(env) { return !!(env.ECPAY_MERCHANT_ID && env.ECPAY_HASH_KEY && env.ECPAY_HASH_IV); }
function ecpayTradeNo(intentId) { return intentId.replace("_", ""); } // di_ + 18 碼 → 20 碼英數字
function ecpayHost(env) { return env.ECPAY_STAGE === "1" ? "https://payment-stage.ecpay.com.tw" : "https://payment.ecpay.com.tw"; }
// CheckMacValue（https://developers.ecpay.com.tw/?p=2902）：參數依名稱排序 → 前後加 HashKey／HashIV → 照 .NET 的 UrlEncode 編碼 → 轉小寫 → SHA256 → 轉大寫
export async function ecpayCheckMac(params, hashKey, hashIV) {
  const keys = Object.keys(params).filter((k) => k !== "CheckMacValue").sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  const raw = `HashKey=${hashKey}&` + keys.map((k) => `${k}=${params[k]}`).join("&") + `&HashIV=${hashIV}`;
  // .NET 的 UrlEncode：空白變 +，- _ . ! * ( ) 不編碼，其餘 %xx；encodeURIComponent 另外不編碼 ~ '，補編
  const enc = encodeURIComponent(raw).replace(/%20/g, "+").replace(/~/g, "%7e").replace(/'/g, "%27").toLowerCase();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(enc));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function taipeiNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000), pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function htmlEsc(s) { return String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";"); }
// 擴充開的分頁先到這裡：組好參數、算好 CheckMacValue，自動 POST 到綠界付款頁
async function ecpayGo(request, env, intentId, h) {
  if (!ecpayReady(env) || !env.DATABASE_URL) return h.fail(503, "not_configured");
  let rows;
  try { rows = await h.neonSql(env, "select amount::float8 as amount, lang from donation_intents where id = $1 and provider = 'ecpay'", [intentId]); } catch (e) { return h.fail(502, "db"); }
  if (!rows.length) return h.fail(404, "not_found");
  const it = rows[0], origin = new URL(request.url).origin, lang = it.lang || "zh-TW";
  const amount = Math.round(it.amount);
  const params = {
    MerchantID: env.ECPAY_MERCHANT_ID, MerchantTradeNo: ecpayTradeNo(intentId), MerchantTradeDate: taipeiNow(), PaymentType: "aio",
    TotalAmount: String(amount), TradeDesc: ECPAY_ITEM, ItemName: ECPAY_ITEM, ChoosePayment: "ALL",
    IgnorePayment: ["ATM", "WebATM"].concat(amount < ECPAY_CVS_MIN ? ["CVS", "BARCODE"] : []).join("#"),
    ReturnURL: `${origin}/v1/donate/webhook/ecpay`, ClientBackURL: `${origin}/v1/donate/thanks?lang=${encodeURIComponent(lang)}`,
    CustomField1: intentId, EncryptType: "1"
  };
  if (ECPAY_LANG[lang]) params.Language = ECPAY_LANG[lang];
  params.CheckMacValue = await ecpayCheckMac(params, env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV);
  const inputs = Object.entries(params).map(([k, v]) => `<input type="hidden" name="${k}" value="${htmlEsc(v)}">`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ECPay</title></head>
<body style="font:16px sans-serif;text-align:center;padding:40px">…<form id="f" method="post" action="${ecpayHost(env)}/Cashier/AioCheckOut/V5">${inputs}<noscript><button>Continue</button></noscript></form>
<script>document.getElementById("f").submit()</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
// 付款結果通知（form-urlencoded）。一定要回純文字 1|OK，否則綠界會重送（當天最多 4 次）；超商條碼約兩天後才通知
async function ecpayWebhook(request, env, ctx, h) {
  const text = (body) => new Response(body, { headers: { "Content-Type": "text/plain" } });
  if (!ecpayReady(env) || !env.DATABASE_URL) return text("0|not_configured");
  const f = Object.fromEntries(new URLSearchParams(await request.text()));
  if (!f.CheckMacValue || (await ecpayCheckMac(f, env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV)) !== f.CheckMacValue) return text("0|CheckMacValue Error");
  if (f.MerchantID !== env.ECPAY_MERCHANT_ID) return text("0|MerchantID Error");
  // RtnCode=1 才是付款成功（超商取號等其他通知回 1|OK 就好）；SimulatePaid=1 是後台模擬付款，不會撥款
  if (f.RtnCode !== "1" || f.SimulatePaid === "1") return text("1|OK");
  try {
    const intentId = /^di_[0-9a-f]{18}$/.test(f.CustomField1 || "") ? f.CustomField1 : null;
    const intents = intentId ? await h.neonSql(env, "select * from donation_intents where id = $1", [intentId]) : [];
    const it = intents[0];
    if (!it) throw new Error("no_intent");
    const amount = Number(f.TradeAmt), fee = Number(f.PaymentTypeChargeFee) || 0;
    const rates = await usdRates();
    const twd = rates.TWD;
    // PaymentDate 是台灣時間 yyyy/MM/dd HH:mm:ss
    const paid = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(f.PaymentDate || "");
    const paidAt = paid ? Date.UTC(+paid[1], +paid[2] - 1, +paid[3], +paid[4] - 8, +paid[5], +paid[6]) / 1000 : Math.floor(Date.now() / 1000);
    await recordDonation(env, h, {
      pid: it.pid, intent: it, provider: "ecpay", ref: f.TradeNo, amount, currency: "TWD", usd: amount / twd,
      feeUsd: fee / twd, netUsd: (amount - fee) / twd, fxRate: twd, method: f.PaymentType || null, country: it.country || null,
      email: it.email || null, paidAt, raw: f
    });
  } catch (e) {
    return text("0|" + String(e.message || e)); // 綠界會重送
  }
  ctx.waitUntil(caches.default.delete(donorsKey(request)));
  return text("1|OK");
}

// ---------------- Stripe webhook ----------------
// Stripe-Signature: t=<秒>,v1=<hex>；簽的是 `${t}.${原始 body}`（HMAC-SHA256，STRIPE_WEBHOOK_SECRET），容許 5 分鐘誤差
export async function verifyStripe(env, header, body) {
  const parts = Object.fromEntries((header || "").split(",").map((x) => x.split("=")).filter((x) => x.length === 2 && x[0] !== "v1"));
  const sigs = (header || "").split(",").filter((x) => x.startsWith("v1=")).map((x) => x.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}
// 1 USD = rates[幣別]。匯率 API 掛了就用 CURRENCIES 的固定匯率：付款已經完成，一定要記下來（誤差只影響排名用的美金換算）
export async function usdRates() {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { cf: { cacheTtl: 3600 } });
    const j = r.ok ? await r.json() : null;
    if (j && j.result === "success" && j.rates) return j.rates;
  } catch (e) { /* 用固定匯率 */ }
  const fixed = {};
  for (const [code, c] of Object.entries(CURRENCIES)) fixed[code] = 1 / c.usd;
  return fixed;
}
async function stripeWebhook(request, env, ctx, h) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY || !env.DATABASE_URL) return h.fail(503, "not_configured");
  const body = await request.text();
  if (!(await verifyStripe(env, request.headers.get("Stripe-Signature"), body))) return h.fail(400, "bad_signature");
  const ev = JSON.parse(body);
  const obj = ev.data && ev.data.object;
  try {
    if ((ev.type === "checkout.session.completed" && obj.payment_status === "paid") || ev.type === "checkout.session.async_payment_succeeded") {
      if (!(await recordPaid(env, obj, h))) return h.json(200, { ok: true, ignored: "other_env" });
    } else if ((ev.type === "charge.refunded" && obj.refunded) || ev.type === "charge.dispute.created") {
      // Stripe 不保證事件順序：這筆付款還沒記進來（付款通知晚到或還在重試）就回 500 讓 Stripe 稍後重送，
      // 不然狀態改不到，之後付款記進來會一直是 paid。recordPaid 也會看 charge 的退款／拒付狀態
      const status = ev.type === "charge.refunded" ? "refunded" : "disputed";
      const rows = await h.neonSql(env, "update donations set status = $2 where provider = 'stripe' and provider_ref = $1 returning id", [obj.payment_intent, status]);
      if (!rows.length) {
        // 別的環境（同一個 Stripe 帳戶接了兩個 worker）的付款：這邊沒有它的結帳紀錄，不用等
        if (!(await intentIsMine(env, h, obj.payment_intent))) return h.json(200, { ok: true, ignored: "other_env" });
        throw new Error("not_recorded_yet");
      }
    } else if (ev.type === "charge.updated") {
      // 手續費：付款通知當下 Stripe 常常還沒產生 balance transaction（非同步入帳），手續費、實收先是空的；
      // 之後 Stripe 送 charge.updated 帶上它，這時補記。charge.updated 很常見（例如寄收據），沒有要補的就略過
      if (!obj.balance_transaction) return h.json(200, { ok: true, ignored: "no_balance_transaction" });
      const pending = await h.neonSql(env, "select fee_usd is null as missing from donations where provider = 'stripe' and provider_ref = $1", [obj.payment_intent]);
      if (!pending.length) {
        if (!(await intentIsMine(env, h, obj.payment_intent))) return h.json(200, { ok: true, ignored: "other_env" });
        throw new Error("not_recorded_yet"); // 付款還沒記進來：讓 Stripe 稍後重送
      }
      if (!pending[0].missing) return h.json(200, { ok: true, ignored: "fee_already_recorded" });
      const btId = typeof obj.balance_transaction === "string" ? obj.balance_transaction : obj.balance_transaction.id;
      await recordFee(env, h, obj.payment_intent, await stripe(env, "GET", `/balance_transactions/${btId}`));
    } else return h.json(200, { ok: true, ignored: ev.type });
  } catch (e) {
    return h.fail(500, String(e.message || e)); // Stripe 會重送
  }
  ctx.waitUntil(caches.default.delete(donorsKey(request))); // 這個邊緣節點的排行榜快取先清掉，其他節點最慢 CACHE_S 秒
  return h.json(200, { ok: true });
}
// 這筆 PaymentIntent 是不是這個環境建的結帳（metadata.intent 在這邊的 donation_intents 裡）
async function intentIsMine(env, h, paymentIntentId) {
  const pi = await stripe(env, "GET", `/payment_intents/${paymentIntentId}`);
  const intentId = pi.metadata && pi.metadata.intent;
  return !!intentId && (await h.neonSql(env, "select 1 from donation_intents where id = $1", [intentId])).length > 0;
}
// 手續費、實收換成美金補進那筆贊助（balance transaction 是結算幣別的最小單位，新加坡帳戶是 SGD）
export async function recordFee(env, h, paymentIntentId, bt) {
  const rates = await usdRates();
  const cur = String(bt.currency || "sgd").toUpperCase();
  if (!rates[cur]) throw new Error("fx_" + cur);
  await h.neonSql(env, `update donations set fee_usd = $2, net_usd = $3,
      raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('balance_transaction', $4::text, 'settlement', $5::text, 'exchange_rate', $6::numeric)
    where provider = 'stripe' and provider_ref = $1 and fee_usd is null`,
    [paymentIntentId, bt.fee / 100 / rates[cur], bt.net / 100 / rates[cur], bt.id || null, cur, bt.exchange_rate == null ? null : bt.exchange_rate]);
}
// 回 false＝不是這個環境建的結帳（查不到 intent）：正式與測試環境的 worker 可能接到同一個 Stripe 帳戶的通知，只記自己的
async function recordPaid(env, session, h) {
  const intentId = session.metadata && session.metadata.intent;
  const intents = intentId ? await h.neonSql(env, "select * from donation_intents where id = $1", [intentId]) : [];
  const it = intents[0];
  if (!it) return false;
  const pid = it.pid;
  // 手續費、實收、匯率在 balance transaction（結算幣別，新加坡帳戶是 SGD）；付款方式在 charge
  const pi = await stripe(env, "GET", `/payment_intents/${session.payment_intent}?expand[]=latest_charge.balance_transaction`);
  const charge = pi.latest_charge || {};
  const bt = charge.balance_transaction || {};
  const cur = String(session.currency || "").toUpperCase();
  const stripeDec = CURRENCIES[cur] ? CURRENCIES[cur].stripe : 2;
  const amount = session.amount_total / 10 ** stripeDec;
  const rates = await usdRates();
  if (!rates[cur]) throw new Error("fx_" + cur);
  const btCur = String(bt.currency || "sgd").toUpperCase();
  const toUsd = (minor) => (minor == null || !rates[btCur] ? null : minor / 100 / rates[btCur]);
  await recordDonation(env, h, {
    pid, intent: it, provider: "stripe", ref: session.payment_intent, amount, currency: cur, usd: amount / rates[cur],
    feeUsd: toUsd(bt.fee), netUsd: toUsd(bt.net), fxRate: rates[cur],
    method: (charge.payment_method_details && charge.payment_method_details.type) || null,
    country: (charge.billing_details && charge.billing_details.address && charge.billing_details.address.country) || it.country || null,
    email: (session.customer_details && session.customer_details.email) || null, paidAt: session.created || Math.floor(Date.now() / 1000),
    status: charge.disputed ? "disputed" : charge.refunded ? "refunded" : "paid",
    raw: { session: session.id, balance_transaction: bt.id || null, settlement: btCur, exchange_rate: bt.exchange_rate || null }
  });
  return true;
}

// 同一位贊助者：donorId 換了（換電腦、沒開同步）但付款 email 相同 → 自動合併成一個人。
// donor_aliases 記「這個 pid 其實是哪一位」（canonical）；排行榜加總、擴充認「你」都看 canonical。
// 付款 email 沒有驗證過（誰都能填別人的 email），所以合併只把金額算到那位身上，不改那位的名稱頭像，
// 改名稱頭像（updateProfile）也只認本人的 pid，不認別名
async function canonicalPid(env, h, pid) {
  const rows = await h.neonSql(env, "select canonical from donor_aliases where pid = $1", [pid]);
  return rows.length ? rows[0].canonical : pid;
}
// 金流無關的記帳：d = { pid, intent, provider, ref, amount, currency, usd, feeUsd, netUsd, fxRate, method, country, email, paidAt（秒）, status?, raw }
export async function recordDonation(env, h, d) {
  const it = d.intent || {};
  const email = d.email ? String(d.email).trim().toLowerCase() : null;
  let pid = await canonicalPid(env, h, d.pid);
  let merged = false;
  if (email) {
    const same = await h.neonSql(env, "select pid from donors where email = $1 and pid <> $2 order by created_at limit 1", [email, pid]);
    if (same.length) {
      // 已經有一位用這個 email 的贊助者：這個 pid（與它底下的別名、贊助紀錄）併過去，名稱頭像維持那位原本的
      const target = same[0].pid;
      await h.neonSql(env, "update donations set pid = $2 where pid = $1", [pid, target]);
      await h.neonSql(env, "update donor_aliases set canonical = $2 where canonical = $1", [pid, target]);
      await h.neonSql(env, "insert into donor_aliases (pid, canonical) values ($1, $2) on conflict (pid) do update set canonical = excluded.canonical", [pid, target]);
      if (d.pid !== pid) await h.neonSql(env, "insert into donor_aliases (pid, canonical) values ($1, $2) on conflict (pid) do update set canonical = excluded.canonical", [d.pid, target]);
      await h.neonSql(env, "delete from donors where pid = $1", [pid]);
      pid = target;
      merged = true;
    }
  }
  const style = it.avatar_style == null && !it.avatar_image ? 0 : it.avatar_style;
  // 第一次贊助：用這筆的名稱頭像建立（已經有的不動，下面再決定要不要更新）
  const created = await h.neonSql(env, `insert into donors (pid, name, avatar_style, avatar_image, email) values ($1, $2, $3, $4, $5)
    on conflict (pid) do nothing returning pid`, [pid, it.name || "", style, it.avatar_image || null, email]);
  const inserted = await h.neonSql(env, `insert into donations (pid, intent_id, provider, provider_ref, status, amount, currency, usd, fee_usd, net_usd, fx_rate, method,
      country, lang, browser, ext_version, payer_email, paid_at, raw)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, to_timestamp($18), $19)
    on conflict (provider, provider_ref) do nothing returning id`,
    [pid, it.id || null, d.provider, d.ref, d.status || "paid", d.amount, d.currency, d.usd, d.feeUsd, d.netUsd, d.fxRate, d.method, d.country,
      it.lang || null, it.browser || null, it.ext_version || null, email, d.paidAt, JSON.stringify(d.raw || {})]);
  if (created.length || !inserted.length || merged) return;
  // 已經在榜上的人又贊助一次：名稱頭像換成這次的。重送的通知在上面就被擋掉（inserted 是空的）；
  // 晚到的通知（非同步付款、超商約兩天後）不能蓋掉之後在贊助頁改過的名稱頭像：只在這筆 intent 比上次更新還新時才換
  await h.neonSql(env, `update donors set name = $2, avatar_style = $3, avatar_image = $4, email = coalesce(email, $5), updated_at = now()
    where pid = $1 and ($6::timestamptz is null or updated_at <= $6::timestamptz)`,
    [pid, it.name || "", style, it.avatar_image || null, email, it.created_at || null]);
}

// ---------------- 事後改名稱／頭像 ----------------
// body：{ v: 1, donorId, name, avatar: { style } | { image } }；只有已經在榜上（贊助過）的人能改
const PROFILE_LIMIT = 20;
async function updateProfile(request, env, ctx, h) {
  if (!env.DATABASE_URL) return h.fail(503, "not_configured");
  let p;
  try { p = JSON.parse(await request.text()); } catch (e) { return h.fail(400, "bad_json"); }
  const bad = checkProfile(p);
  if (bad) return h.fail(400, bad);
  if (!(await rateHit(env, "dp:" + clientIp(request), PROFILE_LIMIT))) return h.fail(429, "rate_limited");
  const av = p.avatar || {};
  let rows;
  try {
    // 只認本人的 pid：email 合併進來的別名不能改那位的名稱頭像（付款 email 沒驗證過，見 recordDonation）
    const pid = await pidOf(p.donorId);
    rows = await h.neonSql(env, "update donors set name = $2, avatar_style = $3, avatar_image = $4, updated_at = now() where pid = $1 returning pid",
      [pid, p.name.trim(), av.image ? null : av.style, av.image || null]);
  } catch (e) { return h.fail(502, "db"); }
  if (!rows.length) return h.fail(404, "not_donor");
  ctx.waitUntil(caches.default.delete(donorsKey(request)));
  return h.json(200, { ok: true });
}

// ---------------- 付款完成／取消頁 ----------------
// 「回到贊助頁」按鈕（感謝頁、取消頁共用）
const BACK_TEXT = { "zh-TW": "回到贊助頁", "zh-CN": "回到赞助页", en: "Back to the support page", ja: "支援ページに戻る", ko: "후원 페이지로 돌아가기" };
// 付款完成頁：倒數 BACK_AUTO_S 秒後自動回到贊助頁（{n} 換成剩下的秒數）
const BACK_AUTO_S = 5;
const AUTO_TEXT = { "zh-TW": "{n} 秒後自動回到贊助頁", "zh-CN": "{n} 秒后自动回到赞助页", en: "Going back automatically in {n}s", ja: "{n} 秒後に自動で戻ります", ko: "{n}초 후 자동으로 돌아가요" };
// [完成標題, 完成說明（沒有回贊助頁的連結時：舊版擴充或網址被改過）, 取消標題, 取消說明, 完成說明（會自動回贊助頁時）]
const RESULT_TEXT = {
  "zh-TW": ["謝謝你的贊助！", "回到嗶速的贊助頁，幾秒內就會在排行榜上看到自己。這個分頁可以關掉了。", "已取消付款", "沒有扣款。回到嗶速的贊助頁隨時可以再試一次。", "你的名字幾秒內就會出現在排行榜上。"],
  "zh-CN": ["谢谢你的赞助！", "回到哔速的赞助页，几秒内就会在排行榜上看到自己。这个标签页可以关掉了。", "已取消付款", "没有扣款。回到哔速的赞助页随时可以再试一次。", "你的名字几秒内就会出现在排行榜上。"],
  en: ["Thank you for your support!", "Head back to the BiBoost support page and you'll show up on the board within a few seconds. You can close this tab.", "Payment cancelled", "You weren't charged. You can try again from the BiBoost support page anytime.", "Your name will show up on the board in a few seconds."],
  ja: ["ご支援ありがとうございます！", "BiBoost の支援ページに戻ると、数秒でランキングに反映されます。このタブは閉じて大丈夫です。", "支払いをキャンセルしました", "請求は発生していません。BiBoost の支援ページからいつでもやり直せます。", "数秒でランキングにあなたの名前が載ります。"],
  ko: ["후원해 주셔서 감사합니다!", "BiBoost 후원 페이지로 돌아가면 몇 초 안에 랭킹에서 확인할 수 있어요. 이 탭은 닫아도 돼요.", "결제를 취소했어요", "결제되지 않았어요. BiBoost 후원 페이지에서 언제든 다시 시도할 수 있어요.", "몇 초 안에 랭킹에 이름이 올라가요."]
};
// 擴充圖示（同 scripts/gen-icons.mjs 的正式版：粉色圓角底＋白色雙向箭頭），內嵌成 SVG 就不用另外放圖檔
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="logo" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff8ab0"/><stop offset="1" stop-color="#eb5a8c"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#lg)"/><g transform="translate(0,9)" fill="#781437" fill-opacity=".18"><polygon points="92,140 320,140 320,82 420,166 320,250 320,192 92,192"/><polygon points="420,320 192,320 192,262 92,346 192,430 192,372 420,372"/></g><g fill="#fff"><polygon points="92,140 320,140 320,82 420,166 320,250 320,192 92,192"/><polygon points="420,320 192,320 192,262 92,346 192,430 192,372 420,372"/></g></svg>`;
// 配色跟擴充的贊助頁（src/donate.html）淺色版的橫幅一致：整頁鋪 B 站粉→藍的淡色漸層，中間一張白卡片（下方多留 12vh，讓卡片落在視覺上的正中間，比幾何中心略高）。固定淺色，不跟系統深色模式
function resultPage(ok, lang, back) {
  const tx = RESULT_TEXT[lang] || RESULT_TEXT.en;
  // 連回贊助頁：完成帶 ?fresh=1（略過快取確認這筆有沒有進來），取消帶 ?cancel=1（不用再等這筆）。
  // 擴充那邊會切回付款前開著的贊助頁分頁、關掉這個分頁，所以會自動回去時不用再叫人關分頁
  const backHref = isBackUrl(back) ? back + (ok ? "?fresh=1" : "?cancel=1") : "";
  const title = ok ? tx[0] : tx[2];
  const text = ok ? (backHref ? tx[4] : tx[1]) : tx[3];
  const autoText = AUTO_TEXT[lang] || AUTO_TEXT.en;
  const backLink = !backHref ? "" : `<a class="back" href="${backHref}">${BACK_TEXT[lang] || BACK_TEXT.en}</a>` + (!ok ? "" :
    `<div class="auto" id="auto">${autoText.replace("{n}", `<b id="n">${BACK_AUTO_S}</b>`)}</div>
<script>(function(){var n=${BACK_AUTO_S},el=document.getElementById("n");var t=setInterval(function(){n--;if(n>0){el.textContent=n;return;}clearInterval(t);location.href=${JSON.stringify(backHref)};},1000);})();</script>`);
  const html = `<!doctype html><html lang="${RESULT_TEXT[lang] ? lang : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
:root{color-scheme:light;--bg:#f4f5f7;--text:#18191c;--muted:#61666d;--raised:#fff;--line:#e3e5e7;--ok:#2ba471;--hero:linear-gradient(120deg,#ffe3ec 0%,#fff0f4 45%,#e3f5fc 100%);--hero-line:#f6d3de}
html,body{margin:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box;font:16px/1.7 -apple-system,"Segoe UI","Microsoft JhengHei","Microsoft YaHei","Hiragino Sans","Apple SD Gothic Neo",sans-serif;color:var(--text);background:var(--bg) var(--hero) fixed}
.card{width:100%;max-width:560px;margin-bottom:12vh;padding:48px 44px 44px;background:var(--raised);border:1px solid var(--hero-line);border-radius:16px;box-shadow:0 12px 40px rgba(235,90,140,.12);text-align:center;box-sizing:border-box}
@media (max-width:500px){.card{padding:36px 22px 32px}}
.mark{position:relative;width:88px;height:88px;margin:0 auto 20px}
.logo{width:88px;height:88px;display:block}
.badge{position:absolute;right:-10px;bottom:-8px;width:34px;height:34px;border-radius:50%;background:var(--ok);border:4px solid var(--raised);box-sizing:border-box;display:flex;align-items:center;justify-content:center}
.badge svg{width:15px;height:15px}
h1{font-size:28px;margin:0 0 12px}
.back{display:inline-block;margin-top:28px;padding:11px 28px;border-radius:8px;background:#fb7299;color:#fff;font-weight:600;text-decoration:none}
.back:hover{background:#e85c86}
.auto{margin-top:12px;font-size:13px;color:var(--muted)}.auto b{color:#fb7299;font-variant-numeric:tabular-nums}
p{margin:0 auto;max-width:420px;color:var(--muted)}
:lang(ja) p{word-break:auto-phrase;line-break:strict}:lang(ko) p{word-break:keep-all}
</style></head>
<body><div class="card"><div class="mark">${LOGO_SVG}${ok ? `<span class="badge"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : ""}</div><h1>${title}</h1><p>${text}</p>${backLink}</div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
