// 後台登入的密碼雜湊與 session token（admin-api.mjs 用；本機後台 admin/server.mjs 與雲端 biboost.app/admin 共用）。
// 只用 Web Crypto，Node 與 Cloudflare Workers 都能跑。
//   · 只有一組帳密：ADMIN_USER、ADMIN_PASS_HASH（npm run admin:hash 產生）。雲端放 biboost-site 的 Worker secret，本機放 .env.local
//   · 密碼雜湊是 PBKDF2-SHA256。Workers 免費方案每個請求只有 10ms CPU，次數不能拉太高（ITERATIONS）；
//     雜湊只存在 secret 裡，外洩才有離線猜密碼的問題，線上猜由 admin-api.mjs 的登入限流擋
//   · 登入成功發一個用 ADMIN_SESSION_KEY 簽 HMAC-SHA256 的 token（放 cookie，SESSION_TTL_MS 後過期），伺服器端不存：
//     要讓所有已登入的瀏覽器失效，換一把 ADMIN_SESSION_KEY 就好
const enc = new TextEncoder();
const ITERATIONS = 20000;
export const SESSION_TTL_MS = 12 * 3600 * 1000;
export const SESSION_KEY_MIN = 32; // ADMIN_SESSION_KEY 至少幾個字元（太短當作沒設）

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// 長度不同也逐字比完，不因為前面就對不上而提早結束
export function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

// → "pbkdf2-sha256$<次數>$<salt>$<雜湊>"（base64url）
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${b64url(salt)}$${b64url(await pbkdf2(String(password), salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const m = /^pbkdf2-sha256\$(\d+)\$([\w-]+)\$([\w-]+)$/.exec(stored || "");
  if (!m) return false;
  const iterations = Number(m[1]);
  if (iterations < 1000 || iterations > 100000) return false; // Workers 的 PBKDF2 上限是 100000 次
  return safeEqual(b64url(await pbkdf2(String(password ?? ""), unb64url(m[2]), iterations)), m[3]);
}

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg))));
}

// token：v1.<到期時間（毫秒）>.<隨機 12 bytes>.<HMAC>
export async function makeSession(key, now = Date.now()) {
  const body = `v1.${now + SESSION_TTL_MS}.${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
  return `${body}.${await hmac(key, body)}`;
}

export async function checkSession(key, token, now = Date.now()) {
  if (!key || key.length < SESSION_KEY_MIN || typeof token !== "string") return false;
  const m = /^(v1\.(\d{13})\.[\w-]{16})\.([\w-]{43})$/.exec(token);
  if (!m || Number(m[2]) <= now || Number(m[2]) > now + SESSION_TTL_MS) return false;
  return safeEqual(await hmac(key, m[1]), m[3]);
}
