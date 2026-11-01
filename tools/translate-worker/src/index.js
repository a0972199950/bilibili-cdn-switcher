/**
 * 雲端後台的翻譯（biboost-translate worker，見 ../wrangler.toml）：biboost-site 的後台 API 透過 service binding 呼叫，
 * 登入檢查在 biboost-site 做完了，這裡只翻譯。
 *   POST /translate  { from, targets, fields } → { ok: true, result: { 語言: { 欄位 } }, model, colo }
 *                    翻譯失敗（TranslateError）回 400 { ok: false, error }（訊息給人看的中文）
 * colo：這次實際在哪個 Cloudflare 機房執行（確認 placement 有固定在新加坡；讀不到是 null）
 */
import { TranslateError, translateWithGemini } from "../../../scripts/lib/translate.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function colo() {
  try {
    const t = await (await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(3000) })).text();
    return /^colo=(\w+)$/m.exec(t)?.[1] || null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/translate") return json(404, { ok: false, error: "not_found" });
    let body;
    try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
    const model = env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    const where = colo();
    try {
      const result = await translateWithGemini({ apiKey: env.GEMINI_API_KEY, model }, body.from, body.targets, body.fields);
      return json(200, { ok: true, result, model, colo: await where });
    } catch (e) {
      if (e instanceof TranslateError) return json(400, { ok: false, error: e.message, colo: await where });
      console.error("translate:", e);
      return json(500, { ok: false, error: String(e?.message || e) });
    }
  },
};
