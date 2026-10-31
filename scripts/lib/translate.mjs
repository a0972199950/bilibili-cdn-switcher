// 翻譯公告、抽獎的前綴／標題／HTML（後台的「翻譯」按鈕）。兩種做法用同一份提示詞、同樣的回傳格式：
//   · translateFields：本機後台用本機的 Claude Code（claude -p）。
//     走 claude.ai 訂閱的登入，不用 API key：子程序的環境拿掉 ANTHROPIC_API_KEY／ANTHROPIC_AUTH_TOKEN
//     （這台電腦的使用者環境變數有設 API key，留著的話 claude 會改走 API 計費）。
//     只給翻譯，不給工具（--tools ""）、不載入 MCP、不讀使用者與專案設定（避免跑到 hooks），在暫存資料夾執行、不留 session。
//   · translateWithGemini：雲端後台用 Gemini API（tools/translate-worker，固定在新加坡執行：Gemini 不支援香港等地區）
import os from "node:os";
import { spawn } from "node:child_process";

export const LANG_NAMES = {
  "zh-TW": "Traditional Chinese (Taiwan)", "zh-CN": "Simplified Chinese (Mainland China)",
  en: "English", ja: "Japanese", ko: "Korean",
};
const TIMEOUT_MS = 180_000;
const GEMINI_TIMEOUT_MS = 90_000;
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";

export class TranslateError extends Error {}

function buildPrompt(from, targets, fields) {
  return `You translate short in-app announcements for a browser extension that makes bilibili videos load faster for viewers outside mainland China.

Translate the fields below from ${LANG_NAMES[from]} into each of these languages: ${targets.map((l) => `${LANG_NAMES[l]} ("${l}")`).join(", ")}.

Rules:
- "html" is HTML: keep every tag and attribute exactly as it is and translate only the visible text.
- "prefix" is a short label shown in front of a scrolling title, like "Notice:". Keep it short, ending with a colon the way that language normally writes one.
- "title" is a single line that scrolls in a small bar; keep it about as long as the source.
- Keep product names, brand names, URLs, numbers, dates and times unchanged.
- Simplified Chinese uses Mainland China wording; Traditional Chinese uses Taiwan wording.
- Match the source tone: concise and friendly.

Reply with only a JSON object and nothing else, keyed by the language codes above, each holding the same fields as the source:
{"<language code>": {${Object.keys(fields).map((k) => `"${k}": "..."`).join(", ")}}}

Source (${LANG_NAMES[from]}):
${JSON.stringify(fields, null, 2)}`;
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const args = ["-p", "--output-format", "json", "--tools", '""', "--strict-mcp-config", "--no-session-persistence",
                  "--setting-sources", "local"];
    // Windows 上 claude 是 .cmd，要透過 shell 才找得到；參數都是固定字串，prompt 從 stdin 給
    const child = spawn("claude", args, { cwd: os.tmpdir(), env, shell: process.platform === "win32", windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new TranslateError("Claude 翻譯逾時（超過 3 分鐘）")); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(new TranslateError(`執行 claude 失敗：${e.message}（本機要裝 Claude Code）`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new TranslateError(`claude 結束代碼 ${code}：${(err || out).trim().slice(0, 300)}`));
      resolve(out);
    });
    child.stdin.end(prompt, "utf8");
  });
}

// 從 claude 的回覆裡取出 JSON 物件（容許外面包了 ```json 區塊）
function parseReply(stdout) {
  let wrapper;
  try { wrapper = JSON.parse(stdout); } catch { throw new TranslateError("claude 的輸出不是 JSON"); }
  if (wrapper.is_error) throw new TranslateError(`claude 回報錯誤：${String(wrapper.result || "").slice(0, 300)}`);
  const text = String(wrapper.result || "");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new TranslateError("claude 沒有回傳翻譯結果");
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw new TranslateError("claude 回傳的翻譯不是合法的 JSON"); }
}

// 檢查參數：回傳要翻的語言與非空的欄位
function prepare(from, targets, fields) {
  if (!LANG_NAMES[from]) throw new TranslateError(`不認得的語言：${from}`);
  targets = (Array.isArray(targets) ? targets : []).filter((l) => l !== from && LANG_NAMES[l]);
  const src = Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => typeof v === "string" && v.trim()));
  if (!src.title) throw new TranslateError("來源語言要先填標題");
  return { targets, src };
}

// 模型回的 JSON → { 語言: { 欄位 } }；少了語言或欄位就丟錯，不填半套
function checkReply(reply, targets, src) {
  const out = {};
  for (const l of targets) {
    const t = reply?.[l];
    if (!t || typeof t !== "object") throw new TranslateError(`翻譯結果少了 ${LANG_NAMES[l]}`);
    out[l] = {};
    for (const k of Object.keys(src)) {
      if (typeof t[k] !== "string" || !t[k].trim()) throw new TranslateError(`翻譯結果的 ${LANG_NAMES[l]} 少了 ${k}`);
      out[l][k] = t[k].trim();
    }
  }
  return out;
}

// fields：來源語言的 { prefix?, title, html? }（空的欄位不用給）；回傳 { 語言: { 同樣的欄位 } }
export async function translateFields(from, targets, fields) {
  const p = prepare(from, targets, fields);
  if (!p.targets.length) return {};
  return checkReply(parseReply(await runClaude(buildPrompt(from, p.targets, p.src))), p.targets, p.src);
}

// 同上，改用 Gemini API（{ apiKey, model }）
export async function translateWithGemini({ apiKey, model }, from, targets, fields) {
  if (!apiKey) throw new TranslateError("沒有設定 GEMINI_API_KEY");
  const p = prepare(from, targets, fields);
  if (!p.targets.length) return {};
  let res;
  try {
    res = await fetch(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(from, p.targets, p.src) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (e) {
    throw new TranslateError(e?.name === "TimeoutError" ? "Gemini 翻譯逾時（超過 90 秒）" : `連不到 Gemini：${e?.message || e}`);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(j.error?.message || res.status);
    if (/location is not supported/i.test(msg)) throw new TranslateError("Gemini 不支援這次執行的地區，請改用本機後台翻譯");
    throw new TranslateError(`Gemini 回報錯誤（${res.status}）：${msg.slice(0, 300)}`);
  }
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts || []).map((x) => x.text || "").join("");
  if (!text) throw new TranslateError(`Gemini 沒有回傳翻譯結果（${cand?.finishReason || j.promptFeedback?.blockReason || "空白"}）`);
  let reply;
  try { reply = JSON.parse(text); } catch { throw new TranslateError("Gemini 回傳的翻譯不是合法的 JSON"); }
  return checkReply(reply, p.targets, p.src);
}
