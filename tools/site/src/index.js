/**
 * 公開網站 https://biboost.app（biboost-site worker）：大部分是 public/ 的靜態檔案（scripts/build-site.mjs 產生），
 * 只有 wrangler.toml 的 run_worker_first 列的路徑先經過這裡：
 *  - /admin、/admin/*        雲端後台（admin/ 打包好的純前端頁面，沒有 SSR）：找不到的路徑都回 /admin（前端自己的路由），加上安全標頭
 *  - /admin/api/*            後台 API（scripts/lib/admin-api.mjs，跟本機後台同一份）：登入、讀寫 Neon
 *  - /donate、/donate.html   贊助頁：後台「功能管理」關掉贊助時回 404（scripts/lib/features.mjs 的 donate）
 * secrets（npx wrangler secret put <NAME> --config tools/site/wrangler.toml）：
 *   DATABASE_URL       Neon 正式環境的連線字串（同 .env.local）
 *   ADMIN_USER         後台帳號
 *   ADMIN_PASS_HASH    後台密碼的雜湊（npm run admin:hash 產生，不存明碼）
 *   ADMIN_SESSION_KEY  簽 session cookie 的金鑰（32 字元以上的亂數；換掉＝所有登入失效）
 *   GOOGLE_OAUTH       選填：寄信與讀測速報告試算表用的 Google 憑證（npm run admin:google 產生並直接設好）；沒設的話雲端不能寄信
 * 登入失敗的限流記在 RATE_KV（跟 report worker 共用同一個 namespace，key 開頭 adm:）。
 * 翻譯走 service binding TRANSLATE（tools/translate-worker，Gemini；固定在新加坡執行）；沒綁的話雲端不能翻譯。
 * scripts/lib 讀連線字串用 process.env.DATABASE_URL：compatibility_flags 開 nodejs_compat，Worker 的 secrets 會放進 process.env。
 */
import "./ext-window.js";
import "../../../src/lottery-text.js";
import { API_PREFIX, handleAdminApi } from "../../../scripts/lib/admin-api.mjs";
import { featureEnabled } from "../../../scripts/lib/features.mjs";
import { useCurrencyTable } from "../../../scripts/lib/speedtest-reports.mjs";
import { TranslateError } from "../../../scripts/lib/translate.mjs";

// 寫信的金額符號用擴充的同一張表（本機是 exe 的 Python，這裡跑不了）
useCurrencyTable(globalThis.window.LotteryText.currencies);
delete globalThis.window;

const FLAG_CACHE_S = 60;

// 後台頁面：只載入自己網域的程式；antd 的樣式是執行時插入的 <style>，所以 style-src 要 'unsafe-inline'
const ADMIN_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; " +
    "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

function withHeaders(res, extra) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  return out;
}

// 登入失敗次數（admin-api.mjs 的 limiter）。KV 出錯時當作 0 次：限流壞掉不該讓自己登不進去（密碼還是要對）
function kvLimiter(env) {
  return {
    async get(key) {
      try { return Number((await env.RATE_KV.get(key)) || 0); } catch { return 0; }
    },
    async incr(key, ttl) {
      try { await env.RATE_KV.put(key, String(Number((await env.RATE_KV.get(key)) || 0) + 1), { expirationTtl: Math.max(60, ttl) }); } catch { /* 略過 */ }
    },
  };
}

// 功能開關在這個節點快取 FLAG_CACHE_S 秒（後台改了最慢 1 分鐘生效）；資料庫出錯時照常顯示（預設開啟）
async function featureOn(name, request, ctx) {
  const key = new Request(new URL("/__flags/" + name, request.url).toString());
  const hit = await caches.default.match(key);
  if (hit) return (await hit.text()) === "1";
  let on = true;
  try { on = await featureEnabled(name); } catch (e) { console.error("feature flag " + name + ":", e); return true; }
  ctx.waitUntil(caches.default.put(key, new Response(on ? "1" : "0", { headers: { "Cache-Control": `max-age=${FLAG_CACHE_S}` } })));
  return on;
}

// 雲端後台的翻譯：交給 biboost-translate worker（{ ok, result, model, colo }）
function translator(env) {
  if (!env.TRANSLATE) return undefined;
  return async (from, targets, fields) => {
    const res = await env.TRANSLATE.fetch("https://biboost-translate/translate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, targets, fields }),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new TranslateError(j.error || `翻譯失敗（${res.status}）`);
    console.log(`translate: ${j.model} @ ${j.colo}`);   // wrangler tail 看得到在哪個機房跑的
    return j.result;
  };
}

async function adminPage(request, env) {
  let res = await env.ASSETS.fetch(request);
  // 前端路由（/admin/lotteries-v2/3 之類）沒有對應的檔案：回後台首頁，由前端依網址顯示；有副檔名的（js、css）照實回 404
  if (res.status === 404 && !/\.[a-z0-9]+$/i.test(new URL(request.url).pathname)) {
    res = await env.ASSETS.fetch(new Request(new URL("/admin", request.url), request));
  }
  const html = (res.headers.get("Content-Type") || "").includes("text/html");
  return withHeaders(res, html ? { ...ADMIN_HEADERS, "Cache-Control": "no-store" } : ADMIN_HEADERS);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith(API_PREFIX)) {
      const res = await handleAdminApi(request, {
        local: false, env, ip: request.headers.get("CF-Connecting-IP") || "", limiter: kvLimiter(env), translate: translator(env),
      });
      return withHeaders(res, ADMIN_HEADERS);
    }
    if (path === "/admin" || path.startsWith("/admin/")) return adminPage(request, env);
    if ((path === "/donate" || path === "/donate.html") && !(await featureOn("donate", request, ctx))) {
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    return env.ASSETS.fetch(request);
  },
};
