// 贊助的資料表與排行榜管理（Neon Postgres，資料表說明見 scripts/lib/donations.mjs）。
//   npm run donations:setup                 建立資料表（部署有 /v1/donors 的 worker 前先跑一次）
//   npm run donations:show                  排行榜（含不上榜的人）
//   npm run donations:hide -- <pid>         不上榜（不雅名稱、頭像）；加 --clear-image 順便清掉上傳的頭像
//   npm run donations:unhide -- <pid>       恢復上榜
//   npm run donations:refund -- <交易編號>   退款後把那一筆標成已退款（不再算進排行榜）：綠界 TradeNo 或 Stripe PaymentIntent id
// worker 的排行榜在 Cloudflare 邊緣快取 1 分鐘，改完最慢 1 分鐘生效。連線字串同 lottery.mjs（.env.local 的 DATABASE_URL）。
import { DonationError, ensureTable, listDonors, markRefunded, setHidden } from "./lib/donations.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const pid = rest.find((a) => !a.startsWith("--"));

try {
  if (cmd === "setup") {
    await ensureTable();
    console.log("資料表已建立（donors、donation_intents、donations、donor_aliases）");
  } else if (cmd === "show") {
    const rows = await listDonors();
    if (!rows.length) console.log("還沒有贊助");
    rows.forEach((r, i) => {
      const avatar = r.has_image ? "上傳頭像" : `預設頭像 ${r.avatar_style ?? "-"}`;
      console.log(`${String(i + 1).padStart(3)}. ${r.pid}  US$${r.usd.toFixed(2).padStart(8)}  ×${r.count}  ${r.name || "（匿名）"}  ${avatar}${r.hidden ? "  【不上榜】" : ""}`);
    });
  } else if ((cmd === "hide" || cmd === "unhide") && pid) {
    await setHidden(pid, cmd === "hide", { clearImage: rest.includes("--clear-image") });
    console.log(`${pid} 已${cmd === "hide" ? "設為不上榜" : "恢復上榜"}`);
  } else if (cmd === "refund" && pid) {
    const r = await markRefunded(pid);
    console.log(`${pid}（${r.currency} ${r.amount}，贊助者 ${r.pid}）已標成退款`);
  } else {
    console.log("用法：npm run donations:setup | donations:show | donations:hide -- <pid> [--clear-image] | donations:unhide -- <pid> | donations:refund -- <交易編號>");
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof DonationError ? e.message : e);
  process.exitCode = 1;
}
