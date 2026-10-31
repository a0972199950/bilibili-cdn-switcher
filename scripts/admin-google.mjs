// 產生雲端後台（biboost.app/admin）寄信、讀測速報告試算表用的 Google 憑證，直接設成 biboost-site 的 secret GOOGLE_OAUTH。
//   npm run admin:google            （在自己的終端機視窗跑：會開瀏覽器到 Google 同意畫面，同意後自動設好，憑證不會印出來）
//   npm run admin:google -- --port 8001   回呼的埠號（預設 8000；被占用時換一個，Desktop 類型的 OAuth client 任何埠都行）
// 權限只要三個（不像本機 google-workspace MCP 的憑證那樣能讀寫整個信箱、雲端硬碟）：
//   gmail.send（寄信）、spreadsheets.readonly（讀試算表）、drive.metadata.readonly（用名稱找試算表）；另外 email（測試信寄給自己）
// OAuth client 沿用 google-workspace MCP 那組（~/.google_workspace_mcp/credentials/<email>.json 的 client_id、client_secret）。
// 注意：Google Cloud 的 OAuth 同意畫面如果還是「測試中」，refresh token 7 天就失效；要長期用請改成「正式版」。
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "openid", "email",
];
const NEED = SCOPES.filter((s) => s.startsWith("https://"));
const CRED_DIR = path.join(os.homedir(), ".google_workspace_mcp", "credentials");
const TIMEOUT_MS = 5 * 60_000;

const argPort = process.argv.indexOf("--port");
const PORT = argPort > 0 ? Number(process.argv[argPort + 1]) : 8000;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function client() {
  let files = [];
  try { files = fs.readdirSync(CRED_DIR).filter((f) => f.includes("@") && f.endsWith(".json")); } catch { /* 沒有資料夾 */ }
  if (!files.length) die(`找不到 OAuth client（${CRED_DIR}）：先用 google-workspace MCP 登入一次`);
  const c = JSON.parse(fs.readFileSync(path.join(CRED_DIR, files[0]), "utf8"));
  if (!c.client_id || !c.client_secret) die("google-workspace MCP 的憑證裡沒有 client_id／client_secret");
  return c;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

// 等 Google 導回 localhost，回傳授權碼
function waitForCode(state) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT);
      if (url.pathname !== "/oauth2callback") { res.writeHead(404).end(); return; }
      const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(ok ? "<p>已收到授權，可以關掉這個分頁，回到終端機。</p>" : "<p>授權失敗，請看終端機的訊息。</p>");
      server.close();
      clearTimeout(timer);
      if (ok) resolve(url.searchParams.get("code"));
      else reject(new Error(url.searchParams.get("error") || "state 不符"));
    });
    const timer = setTimeout(() => { server.close(); reject(new Error("等了 5 分鐘沒有完成授權")); }, TIMEOUT_MS);
    server.on("error", (e) => { clearTimeout(timer); reject(e.code === "EADDRINUSE" ? new Error(`埠 ${PORT} 被占用：加 -- --port 8001 換一個`) : e); });
    server.listen(PORT, "localhost");
  });
}

// 把 JSON 從 stdin 交給 wrangler（不經過命令列參數、不印出來）
function putSecret(value) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "secret", "put", "GOOGLE_OAUTH", "--config", "tools/site/wrangler.toml"],
      { stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`wrangler secret put 結束代碼 ${code}`))));
    child.stdin.end(value);
  });
}

const c = client();
const verifier = crypto.randomBytes(32).toString("base64url");
const state = crypto.randomBytes(16).toString("base64url");
const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
auth.search = new URLSearchParams({
  client_id: c.client_id, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES.join(" "),
  access_type: "offline", prompt: "consent", state,
  code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
}).toString();

const pending = waitForCode(state);
console.log("在瀏覽器登入要寄信的 Gmail 帳號，三個權限都勾選後按「繼續」。瀏覽器沒有自動打開的話，手動開這個網址：\n" + auth);
openBrowser(auth.toString());
let code;
try { code = await pending; } catch (e) { die(`授權失敗：${e.message}`); }

const res = await fetch(c.token_uri || "https://oauth2.googleapis.com/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: c.client_id, client_secret: c.client_secret, code, code_verifier: verifier, redirect_uri: REDIRECT, grant_type: "authorization_code",
  }),
});
const j = await res.json().catch(() => ({}));
if (!res.ok || !j.refresh_token) die(`換不到 refresh token（${j.error || res.status}${j.error_description ? `：${j.error_description}` : ""}）`);
const granted = String(j.scope || "").split(" ");
const missing = NEED.filter((s) => !granted.includes(s));
if (missing.length) die(`少了權限（同意畫面要全部勾選）：${missing.map((s) => s.split("/").pop()).join("、")}`);
let email = "";
try { email = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString("utf8")).email || ""; } catch { /* 沒有 id_token */ }

console.log(`授權帳號：${email || "（讀不到 email，測試信會改讀 Gmail profile 而失敗）"}；設定 biboost-site 的 GOOGLE_OAUTH…`);
try {
  await putSecret(JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: j.refresh_token, email }));
} catch (e) {
  die(`設定 secret 失敗：${e.message}`);
}
console.log("完成。雲端後台重新整理後就能寄信、讀試算表。");
