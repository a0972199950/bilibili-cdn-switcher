// CDN 測速 GUI 的「必中獎邀請碼」管理（Neon Postgres）。
//   npm run invite:create -- a@x.com b@y.com     每個 email 產生一組邀請碼並印出
//   npm run invite:delete -- K7QM3XPA H4RT9WCE   把這些邀請碼標記為已失效（資料保留）
//   npm run invite:show                          列出每組 email ↔ 邀請碼與有效狀態
//
// 規則：邀請碼綁定 email（同一個 email 可以有多組）。有效期間可以無限次驗證、送報告（包括自己測試），
// 直到確定發出獎品後用 invite:delete 標記失效。Apps Script（指令碼屬性 NEON_URL）只讀取狀態並記錄使用紀錄。
//
// 連線字串放 .env.local 的 DATABASE_URL（見 .env.local.example）。走 Neon 的 HTTP SQL 端點，不額外裝套件。
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
} catch {
  // 沒有 .env.local 就看環境變數
}
const DB_URL = (process.env.DATABASE_URL || "").trim();

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉容易看錯的 0/O、1/I
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function sql(query, params = []) {
  const host = new URL(DB_URL).hostname;
  const res = await fetch(`https://${host.replace(/^[^.]+\./, "api.")}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Neon-Connection-String": DB_URL },
    body: JSON.stringify({ query, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neon ${res.status}：${text.slice(0, 300)}`);
  return JSON.parse(text).rows || [];
}

async function ensureTable() {
  await sql(`create table if not exists invite_codes (
    code text primary key,
    email text not null,
    created_at timestamptz not null default now(),
    revoked_at timestamptz,
    last_verified_at timestamptz,
    report_count int not null default 0,
    last_report_id text,
    last_report_at timestamptz)`);
  await sql("create index if not exists invite_codes_email_idx on invite_codes (lower(email))");
}

function newCode() {
  return Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

// 終端機裡中日韓文字佔兩格，padEnd 只算字元數會對不齊
const width = (s) => [...s].reduce((n, ch) => n + (/[⺀-￯]/.test(ch) ? 2 : 1), 0);
const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));

const normCode = (c) => String(c || "").replace(/[\s-]/g, "").toUpperCase();
const time = (t) => (t ? new Date(t).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 16) : "-");

async function create(emails) {
  const bad = emails.filter((e) => !EMAIL_RE.test(e));
  if (!emails.length || bad.length) {
    console.error(bad.length ? `email 格式不正確：${bad.join(", ")}` : "用法：npm run invite:create -- a@x.com b@y.com");
    process.exit(1);
  }
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    for (;;) {
      const rows = await sql(
        "insert into invite_codes (code, email) values ($1, $2) on conflict (code) do nothing returning code",
        [newCode(), email],
      );
      if (rows.length) {
        console.log(`${rows[0].code}  →  ${email}`);
        break;
      }
    }
  }
}

async function revoke(codes) {
  if (!codes.length) {
    console.error("用法：npm run invite:delete -- K7QM3XPA H4RT9WCE");
    process.exit(1);
  }
  for (const c of codes.map(normCode)) {
    const rows = await sql(
      "update invite_codes set revoked_at = coalesce(revoked_at, now()) where code = $1 returning email, revoked_at",
      [c],
    );
    console.log(rows.length ? `${c}  已失效（${rows[0].email}，${time(rows[0].revoked_at)}）` : `${c}  找不到這組邀請碼`);
  }
}

async function show() {
  const rows = await sql(
    "select * from invite_codes order by lower(email), created_at",
  );
  const w = Math.max(5, ...rows.map((r) => r.email.length));
  console.log(`${pad("email", w)}  ${pad("邀請碼", 8)}  ${pad("狀態", 18)}  ${pad("最後驗證", 16)}  報告數  最後報告`);
  for (const r of rows) {
    const st = r.revoked_at ? `已失效 ${time(r.revoked_at).slice(5)}` : "有效";
    console.log(
      `${pad(r.email, w)}  ${r.code}  ${pad(st, 18)}  ${pad(time(r.last_verified_at), 16)}  ` +
        `${String(r.report_count).padStart(6)}  ${r.last_report_id ? `#${r.last_report_id} ${time(r.last_report_at)}` : "-"}`,
    );
  }
  const valid = rows.filter((r) => !r.revoked_at).length;
  console.log(`共 ${rows.length} 組（有效 ${valid}、已失效 ${rows.length - valid}）`);
}

const [cmd, ...args] = process.argv.slice(2);
if (!DB_URL) {
  console.error("找不到 DATABASE_URL（.env.local 或環境變數）");
  process.exit(1);
}
await ensureTable();
if (cmd === "create") await create(args);
else if (cmd === "delete") await revoke(args);
else if (cmd === "show") await show();
else {
  console.error("用法：invite.mjs create|delete|show");
  process.exit(1);
}
