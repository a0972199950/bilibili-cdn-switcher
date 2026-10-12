/**
 * 問題回報收件端：擴充的回報頁（src/report.html）POST 到這裡，這裡
 *  1) 把完整診斷文字 commit 進私有 repo（LOGS_REPO）/<yyyy>/<mm>/<id>.md，並在 index.csv 追加一行
 *  2) 在公開 repo（ISSUES_REPO）開 issue：描述 + 去識別化摘要 + 私有檔連結（不含 IP / ISP / bvid / 聯絡方式）
 *  3) contact 看起來是 email 時，請 Apps Script（MAIL_URL，由作者 Gmail 寄出）寄一封確認信附 issue 連結；失敗不影響結果
 *  4) 回傳 { ok, id, issueUrl, issueNumber, emailed }
 * 任一 GitHub 步驗失敗仍盡量回 200（檔案已存就算收到），避免使用者重送造成重複。
 * 這裡不另外記錄任何 log（避免第二份個資副本）。
 */
const MAX_BODY = 256 * 1024;
const MAX_DESC = 4000;
const RATE_LIMIT = 5; // 同一來源 IP 10 分鐘內最多幾筆
const RATE_WINDOW_S = 600;
const TYPES = ["bug", "feature"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-BCS-Token",
  "Access-Control-Max-Age": "86400"
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
}
function fail(status, error) { return json(status, { ok: false, error }); }

function randId() {
  const a = new Uint8Array(4); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 6);
}
function pad(n) { return String(n).padStart(2, "0"); }

async function gh(env, method, path, body) {
  const headers = {
    Authorization: "Bearer " + env.GITHUB_TOKEN,
    Accept: "application/vnd.github+json",
    "User-Agent": "bcs-report-worker",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch("https://api.github.com" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, data };
}

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function unb64(s) {
  const bin = atob(s.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// 新檔直接 PUT；既有檔（index.csv）要先拿 sha。兩筆同時到會有一筆 409，重試一次
async function putFile(env, path, content, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await gh(env, "GET", `/repos/${env.LOGS_REPO}/contents/${path}`);
    const sha = cur.ok && cur.data && cur.data.sha;
    const existing = cur.ok && cur.data && cur.data.content ? unb64(cur.data.content) : "";
    const body = { message, content: b64(typeof content === "function" ? content(existing) : content) };
    if (sha) body.sha = sha;
    const r = await gh(env, "PUT", `/repos/${env.LOGS_REPO}/contents/${path}`, body);
    if (r.ok) return r.data;
    if (r.status !== 409 && r.status !== 422) throw new Error("github_put_" + r.status);
  }
  throw new Error("github_put_conflict");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function sendConfirmMail(env, p, id, result) {
  const to = (p.contact || "").trim();
  if (!env.MAIL_URL || !env.MAIL_SECRET || !result.issueUrl || !EMAIL_RE.test(to)) return false;
  try {
    const r = await fetch(env.MAIL_URL, {
      method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ secret: env.MAIL_SECRET, to, lang: p.lang || "", id, issueUrl: result.issueUrl, issueNumber: result.issueNumber })
    });
    const j = await r.json().catch(() => null);
    return !!(j && j.ok);
  } catch (e) { return false; }
}

function csvCell(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

function issueBody(p, fileUrl, id) {
  const s = p.summary || {};
  const lines = [
    p.description.trim(),
    "",
    "---",
    "| | |",
    "|---|---|",
    `| report | \`${id}\` |`,
    `| version | ${s.version || "-"} |`,
    `| browser | ${s.browser || "-"} / ${s.os || "-"} |`,
    `| country | ${s.country || "-"}${s.vpnSuspect ? " (vpn suspect)" : ""} |`,
    `| node | configured=${s.configured || "-"} effective=${s.effective || "-"} playurl=${s.playurlGiven || "-"} current=${s.currentCdn || "-"} |`,
    `| qn / speed | ${s.qn || "-"} / ${s.speed || "-"} |`,
    `| pattern | ${s.pattern || "-"} |`,
    `| recent | ${(s.recentKinds || []).join(" -> ") || "-"} |`,
    "",
    p.includeDiag ? `Log: ${fileUrl}` : "_No diagnostics attached (feature request)._"
  ];
  return lines.join("\n");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/report") return fail(404, "not_found");
    if (request.headers.get("X-BCS-Token") !== env.REPORT_TOKEN) return fail(401, "bad_token");
    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_BODY) return fail(413, "too_large");
    const text = await request.text();
    if (text.length > MAX_BODY) return fail(413, "too_large");
    let p;
    try { p = JSON.parse(text); } catch (e) { return fail(400, "bad_json"); }
    if (!p || p.v !== 1 || TYPES.indexOf(p.type) < 0 || typeof p.description !== "string" || !p.description.trim()) return fail(400, "bad_json");
    if (p.description.length > MAX_DESC) return fail(413, "too_large");
    if (p.includeDiag && typeof p.diagText !== "string") return fail(400, "bad_json");

    // 頻率限制（KV 以來源 IP 為 key）
    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    if (env.RATE_KV) {
      const key = "rl:" + ip;
      const n = Number((await env.RATE_KV.get(key)) || 0);
      if (n >= RATE_LIMIT) return fail(429, "rate_limited");
      await env.RATE_KV.put(key, String(n + 1), { expirationTtl: RATE_WINDOW_S });
    }

    const now = new Date();
    const ymd = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
    const id = `r_${ymd}_${randId()}`;
    const dir = `${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}`;
    const path = `${dir}/${id}.md`;
    const s = p.summary || {};
    const result = { ok: true, id, issueUrl: null, issueNumber: null, emailed: false, error: null };

    // 1) 私有 repo：完整日誌（可讀純文字）
    let fileUrl = `https://github.com/${env.LOGS_REPO}/blob/main/${path}`;
    const head = [
      `# ${id}  type=${p.type}  version=${s.version || "-"}  at=${now.toISOString()}`,
      "",
      "## description", "", p.description.trim(), "",
      "## contact", "", (p.contact || "").trim() || "-", ""
    ].join("\n");
    try {
      await putFile(env, path, head + (p.includeDiag ? p.diagText : "_(no diagnostics)_\n"), `report ${id} (${p.type})`);
    } catch (e) {
      result.error = String(e.message || e);
      fileUrl = null;
    }

    // 2) 公開 repo：issue
    if (fileUrl) {
      try {
        const r = await gh(env, "POST", `/repos/${env.ISSUES_REPO}/issues`, {
          title: `[${p.type}] ${p.description.trim().replace(/\s+/g, " ").slice(0, 60)}`,
          body: issueBody(p, fileUrl, id),
          labels: ["bug-report", `type:${p.type}`].concat(s.version ? [`v:${s.version}`] : [])
        });
        if (r.ok) { result.issueUrl = r.data.html_url; result.issueNumber = r.data.number; }
        else result.error = "github_issue_" + r.status;
      } catch (e) { result.error = "github_issue_failed"; }
      result.emailed = await sendConfirmMail(env, p, id, result);
      // 3) index.csv 追加一行（失敗不影響結果）
      try {
        const row = [id, now.toISOString(), p.type, s.version, s.country, s.isp, result.issueNumber].map(csvCell).join(",") + "\n";
        await putFile(env, "index.csv", (old) => (old || "id,time,type,version,country,isp,issue\n") + row, `index ${id}`);
      } catch (e) {}
    }
    return json(200, result);
  }
};
