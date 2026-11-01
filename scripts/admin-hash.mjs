// 產生後台密碼的雜湊（ADMIN_PASS_HASH，scripts/lib/admin-auth.mjs）：npm run admin:hash，輸入密碼（不會顯示）後印出雜湊。
//   本機後台：寫進 .env.local 的 ADMIN_PASS_HASH（帳號是 ADMIN_USER）
//   雲端後台：npx wrangler secret put ADMIN_PASS_HASH --config tools/site/wrangler.toml，貼上印出來的雜湊
// 也可以用管線餵密碼：echo 密碼 | npm run admin:hash（會留在 shell 歷史紀錄，不建議）
import { hashPassword } from "./lib/admin-auth.mjs";

function readHidden(prompt) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      let buf = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (d) => { buf += d; });
      stdin.on("end", () => resolve(buf.replace(/\r?\n$/, "")));
      return;
    }
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    let s = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); stdout.write("\n"); resolve(s); }
      else if (ch === "\u0003") { stdout.write("\n"); process.exit(130); }
      else if (ch === "\u007f" || ch === "\b") s = s.slice(0, -1);
      else s += ch;
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}

const pass = await readHidden("後台密碼：");
if (pass.length < 8) {
  console.error("密碼至少 8 個字元");
  process.exit(1);
}
console.log(await hashPassword(pass));
