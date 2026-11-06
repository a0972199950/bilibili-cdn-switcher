/**
 * 功能開關（Neon 的 features：key → data jsonb，後台「功能管理」改，格式見 scripts/lib/features.mjs）。
 *  - GET /v1/features → { ok, jws }：jws 是 compact JWS（ES256，header { alg, typ: "JWT", kid }），
 *    payload = { iat（秒）, features: { <key>: data } }，資料庫裡的每一列原樣放進去；沒有的功能由擴充用自己的預設值。
 *    擴充內建公鑰驗章（src/features.js），storage 或回應被改過就不採用。結果在 Cloudflare 邊緣快取 CACHE_S 秒。
 *    簽章私鑰：secret FEATURES_SIGNING_KEY（P-256 私鑰的 JWK JSON；值在 .env.local）。沒設回 503 not_configured。
 *  - featureData(env, h, key)：其他 API 用（例如贊助的 /v1/donate/config、結帳），沒有這一列＝{ enabled: true }
 * 還沒有 features 表時（後台還沒打開過「功能管理」），贊助沿用舊的 settings.donate_enabled。
 */
export const KID = "f1";
const MISSING_TABLE = /^neon_4\d\d [\s\S]*(42P01|does not exist)/;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

let keyCache = null; // { jwk 字串, CryptoKey }
async function signingKey(jwkText) {
  if (keyCache && keyCache.jwk === jwkText) return keyCache.key;
  const jwk = JSON.parse(jwkText);
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  keyCache = { jwk: jwkText, key };
  return key;
}

export async function signJws(payload, jwkText, kid = KID) {
  const input = b64urlText(JSON.stringify({ alg: "ES256", typ: "JWT", kid })) + "." + b64urlText(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(jwkText), new TextEncoder().encode(input));
  return input + "." + b64url(new Uint8Array(sig));
}

// { <key>: data }
export async function featureRows(env, h) {
  try {
    const rows = await h.neonSql(env, "select key, data from features");
    const out = {};
    for (const r of rows) out[r.key] = r.data && typeof r.data === "object" ? r.data : {};
    return out;
  } catch (e) {
    if (!MISSING_TABLE.test(String(e.message))) throw e;
  }
  try {
    const rows = await h.neonSql(env, "select value from settings where key = 'donate_enabled'");
    return rows.length ? { donate: { enabled: rows[0].value !== false } } : {};
  } catch (e) {
    if (MISSING_TABLE.test(String(e.message))) return {};
    throw e;
  }
}

export async function featureData(env, h, key) {
  const rows = await featureRows(env, h);
  return { enabled: true, ...(rows[key] || {}) };
}

export async function handleFeatures(request, env, ctx, h) {
  const key = new Request(new URL("/v1/features", request.url).toString());
  const hit = await caches.default.match(key);
  if (hit) return hit;
  if (!env.DATABASE_URL || !env.FEATURES_SIGNING_KEY) return h.fail(503, "not_configured");
  let features;
  try { features = await featureRows(env, h); } catch (e) { return h.fail(502, "db"); }
  let jws;
  try { jws = await signJws({ iat: Math.floor(Date.now() / 1000), features }, env.FEATURES_SIGNING_KEY); } catch (e) { return h.fail(503, "not_configured"); }
  const res = new Response(JSON.stringify({ ok: true, jws }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${h.CACHE_S}`, ...h.CORS }
  });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
