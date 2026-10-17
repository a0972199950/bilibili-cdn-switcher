/**
 * 問題回報收件端：擴充的回報頁（src/report.html）POST 到這裡，這裡
 *  1) 把完整診斷文字 commit 進私有 repo（LOGS_REPO）/<yyyy>/<mm>/<id>.md，並在 index.csv 追加一行
 *  2) 在公開 repo（ISSUES_REPO）開 issue：描述 + 去識別化摘要 + 私有檔連結（不含 IP / ISP / bvid / 聯絡方式）
 *  3) contact 看起來是 email 時，請 Apps Script（MAIL_URL，由作者 Gmail 寄出）寄一封確認信附 issue 連結；失敗不影響結果
 *  4) 回傳 { ok, id, issueUrl, issueNumber, emailed }
 * 任一 GitHub 步驗失敗仍盡量回 200（檔案已存就算收到），避免使用者重送造成重複。
 * 這裡不另外記錄任何 log（避免第二份個資副本）。
 *
 * 另有兩個公開的 GET（不用 token、不收任何使用者資料；結果在 Cloudflare 邊緣快取 LOTTERY_CACHE_S 秒，Neon 不會每次開 popup 都被打到）：
 *  - /v1/lotteries：進行中抽獎的 metadata（Neon 的 lotteries），給測速 exe 的「測速目的」頁，文字由 exe 自己組（lottery_text.py）
 *  - /v1/announcements：擴充的公告（Neon 的 announcements）：抽獎公告附抽獎 metadata（擴充用 src/lottery-text.js 組字），
 *    一般公告是後台寫的各語言前綴／標題／HTML
 *  - /v2/lotteries、/v2/announcements：新版擴充與 exe 用。抽獎只來自抽獎 v2（Neon 的 lotteries_v2，見 scripts/lib/lotteries-v2.mjs：
 *    每張禮物卡各自的面額、備註 HTML），v1 只來自 lotteries，兩邊各自獨立（v2 建的抽獎舊版看不到）
 */
const MAX_BODY = 256 * 1024;
const MAX_DESC = 4000;
const RATE_LIMIT = 5; // 同一來源 IP 10 分鐘內最多幾筆
const RATE_WINDOW_S = 600;
const TYPES = ["bug", "feature"];
const LOTTERY_CACHE_S = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

// Neon 的 HTTP SQL 介面（同 scripts/lottery.mjs）；DATABASE_URL 是 postgresql://… 連線字串
async function neonSql(env, query, params = []) {
  const host = new URL(env.DATABASE_URL).hostname;
  const r = await fetch(`https://${host.replace(/^[^.]+\./, "api.")}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Neon-Connection-String": env.DATABASE_URL },
    body: JSON.stringify({ query, params })
  });
  if (!r.ok) throw new Error("neon_" + r.status);
  return (await r.json()).rows || [];
}

// 抽獎欄位（lotteries 的別名 l）：日期是台灣時間；startsAt / endsAt 是毫秒時間戳（endsAt 不含，即結束日隔天 00:00 台灣時間）
const LOTTERY_FIELDS = `l.id as l_id, l.title as l_title, l.country as l_country, l.prize_amount::float8 as l_amount, l.currency as l_currency,
    l.gift_cards as l_gift_cards, l.isps as l_isps, l.winners as l_winners, l.draw_days as l_draw_days,
    to_char(l.starts_at at time zone 'Asia/Taipei', 'YYYY-MM-DD') as l_start_date,
    to_char(l.ends_at at time zone 'Asia/Taipei' - interval '1 day', 'YYYY-MM-DD') as l_end_date,
    to_char(l.ends_at at time zone 'Asia/Taipei' - interval '1 day' + make_interval(days => coalesce(l.draw_days, 7)), 'YYYY-MM-DD') as l_draw_by,
    (extract(epoch from l.starts_at) * 1000)::float8 as l_starts_ms, (extract(epoch from l.ends_at) * 1000)::float8 as l_ends_ms`;
const LOTTERY_ACTIVE = "l.ended_at is null and l.country is not null and now() >= l.starts_at and now() < l.ends_at";

function lotteryItem(r) {
  return {
    id: r.l_id, title: r.l_title, country: r.l_country, prize: { amount: r.l_amount, currency: r.l_currency, giftCards: r.l_gift_cards || [] },
    winners: r.l_winners, isps: r.l_isps || [], drawDays: r.l_draw_days == null ? 7 : r.l_draw_days,
    startDate: r.l_start_date, endDate: r.l_end_date, drawBy: r.l_draw_by, startsAt: r.l_starts_ms, endsAt: r.l_ends_ms
  };
}

// 抽獎 v2 的欄位（lotteries_v2 的別名 v），日期規則同 LOTTERY_FIELDS
const LOTTERY_V2_FIELDS = `v.id as v_id, v.title as v_title, v.country as v_country, v.currency as v_currency, v.gift_cards as v_gift_cards,
    v.note as v_note, v.isps as v_isps, v.winners as v_winners, v.draw_days as v_draw_days,
    to_char(v.starts_at at time zone 'Asia/Taipei', 'YYYY-MM-DD') as v_start_date,
    to_char(v.ends_at at time zone 'Asia/Taipei' - interval '1 day', 'YYYY-MM-DD') as v_end_date,
    to_char(v.ends_at at time zone 'Asia/Taipei' - interval '1 day' + make_interval(days => v.draw_days), 'YYYY-MM-DD') as v_draw_by,
    (extract(epoch from v.starts_at) * 1000)::float8 as v_starts_ms, (extract(epoch from v.ends_at) * 1000)::float8 as v_ends_ms`;
const LOTTERY_V2_ACTIVE = "v.ended_at is null and now() >= v.starts_at and now() < v.ends_at";

// v2 的一筆：跟 v1 一樣，差在 prize 沒有 amount、giftCards 是 [{ name, amount }]，title 是 { 語言: 文字 }，多了 note（{ 語言: HTML } 或 null）
function lotteryItemV2(r) {
  return {
    id: r.v_id, title: r.v_title, country: r.v_country, prize: { currency: r.v_currency, giftCards: r.v_gift_cards || [] },
    note: r.v_note || null, winners: r.v_winners, isps: r.v_isps || [], drawDays: r.v_draw_days,
    startDate: r.v_start_date, endDate: r.v_end_date, drawBy: r.v_draw_by, startsAt: r.v_starts_ms, endsAt: r.v_ends_ms
  };
}

// GET 清單的共同流程：Cloudflare 邊緣快取 LOTTERY_CACHE_S 秒，沒命中才查 Neon
async function cachedList(request, env, ctx, path, load) {
  const cache = caches.default;
  const key = new Request(new URL(path, request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  if (!env.DATABASE_URL) return fail(503, "not_configured");
  let items;
  try { items = await load(); } catch (e) { return fail(502, "db"); }
  const res = new Response(JSON.stringify({ ok: true, items }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${LOTTERY_CACHE_S}`, ...CORS }
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// 進行中、有 metadata 的抽獎（依結束時間排序，不分國家，各端自己篩）——測速 exe 用：
// { ok, items: [{ id, title, country: "TW", prize: { amount, currency, giftCards: [...] }, winners, isps: [...]（空＝不限）, drawDays,
//   startDate: "2026-10-01", endDate: "2026-10-30", drawBy: "2026-11-06", startsAt, endsAt }] }
function lotteries(request, env, ctx) {
  return cachedList(request, env, ctx, "/v1/lotteries", async () =>
    (await neonSql(env, `select ${LOTTERY_FIELDS} from lotteries l where ${LOTTERY_ACTIVE} order by l.ends_at, l.id`)).map(lotteryItem));
}

// v2：進行中的抽獎 v2，格式同 /v1/lotteries，但 prize: { currency, giftCards: [{ name, amount }] }（沒有 prize.amount）、title: { 語言: 文字 }、note: { 語言: HTML } | null
function lotteriesV2(request, env, ctx) {
  return cachedList(request, env, ctx, "/v2/lotteries", async () =>
    (await neonSql(env, `select ${LOTTERY_V2_FIELDS} from lotteries_v2 v where ${LOTTERY_V2_ACTIVE} order by v.ends_at, v.id`)).map(lotteryItemV2));
}

// 擴充的公告（新的在前，不分國家，擴充自己篩）：
//   { id, type: "lottery", lottery: { 同 /v1/lotteries 的一筆 } }        只列進行中的抽獎；前綴、標題、內容由擴充依抽獎資料組
//   { id, type: "html", prefix: { 語言: 文字 } | null, title: { 語言: 文字 }, html: { 語言: HTML }, countries: ["TW"] | null（全部） }
// v2（/v2/announcements）：抽獎公告只列掛在抽獎 v2 上的（announcements.lottery_v2_id），lottery 是 /v2/lotteries 的一筆
function announcements(request, env, ctx, v2) {
  return cachedList(request, env, ctx, v2 ? "/v2/announcements" : "/v1/announcements", async () => {
    const rows = await neonSql(env, v2
      ? `select a.id, a.type, a.prefix, a.title, a.html, a.countries, ${LOTTERY_V2_FIELDS}
          from announcements a left join lotteries_v2 v on v.id = a.lottery_v2_id
          where a.type = 'html' or (a.type = 'lottery' and ${LOTTERY_V2_ACTIVE})
          order by a.created_at desc, a.id desc`
      : `select a.id, a.type, a.prefix, a.title, a.html, a.countries, ${LOTTERY_FIELDS}
          from announcements a left join lotteries l on l.id = a.lottery_id
          where a.type = 'html' or (a.type = 'lottery' and ${LOTTERY_ACTIVE})
          order by a.created_at desc, a.id desc`);
    return rows.map((r) => r.type === "lottery"
      ? { id: r.id, type: "lottery", lottery: v2 ? lotteryItemV2(r) : lotteryItem(r) }
      : { id: r.id, type: "html", prefix: r.prefix || null, title: r.title || {}, html: r.html || {}, countries: r.countries || null });
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/v1/lotteries") return lotteries(request, env, ctx);
    if (request.method === "GET" && url.pathname === "/v1/announcements") return announcements(request, env, ctx, false);
    if (request.method === "GET" && url.pathname === "/v2/lotteries") return lotteriesV2(request, env, ctx);
    if (request.method === "GET" && url.pathname === "/v2/announcements") return announcements(request, env, ctx, true);
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
