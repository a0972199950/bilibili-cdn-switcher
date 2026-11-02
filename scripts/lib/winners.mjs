// 後台「中獎人」分頁：抽獎 v2 抽出的中獎人（lotteries_v2.draw.winners）與必中獎參加人（invite_codes）放在同一張表，
// 用 type 區分（"lottery"／"guaranteed"）。各自的資料還是存在原本的地方，這裡只負責合併成一樣的列，以及「禮物卡已寄出」的記錄
// （寄出日期、花費金額與幣別、備註）。其他動作（審核、寄信、作廢邀請碼…）照舊走 invites.mjs、lotteries-v2.mjs。
//
// 每一列：{ key, type, email, lottery: { id, title, country, currency, giftCards } | null, country, rid, isp, ispLabel, receivedAt,
//          mailedAt, prizeSentAt, prizeNote, prizeCost, prizeCurrency, 抽獎另外有 drawAt（抽出時間）,
//          必中獎另外有 invite: { code, createdAt, revokedAt, review, reviewNote, reviewAuto, reviewedAt, reports, testReports, reportCount } }
// key：必中獎 "invite:<邀請碼>"，抽獎 "lottery:<抽獎 id>:<報告編號>"
import * as I from "./invites.mjs";
import { LotteryError, sql } from "./lotteries.mjs";
import * as V from "./lotteries-v2.mjs";
import { ispLabel } from "./speedtest-reports.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const taipeiDate = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);

export async function listWinners() {
  const [inv, lotteries, choices] = await Promise.all([I.listInvites(), I.boundLotteries(), I.lotteryChoices()]);
  const rows = [];
  for (const r of inv.rows) {
    const report = r.reports ? r.reports.find((x) => x.archived) || r.reports[0] : null;
    rows.push({
      key: `invite:${r.code}`, type: "guaranteed", email: r.email, lottery: r.lottery,
      country: report?.country || r.lottery?.country || null, rid: report?.rid || null, isp: report?.isp || null,
      ispLabel: report?.ispLabel || null, receivedAt: report?.receivedAt || null,
      mailedAt: r.mailedAt, prizeSentAt: r.prizeSentAt, prizeNote: r.prizeNote, prizeCost: r.prizeCost, prizeCurrency: r.prizeCurrency,
      invite: {
        code: r.code, createdAt: r.createdAt, revokedAt: r.revokedAt, review: r.review, reviewNote: r.reviewNote, reviewAuto: r.reviewAuto,
        reviewedAt: r.reviewedAt,
        reports: r.reports, testReports: r.testReports, reportCount: r.reportCount,
      },
    });
  }
  const draws = await sql("select id, isps, draw from lotteries_v2 where draw is not null");
  for (const d of draws) {
    const l = lotteries.get(d.id);
    for (const w of d.draw.winners || []) {
      if (w.deletedAt) continue;   // 刪除的不列
      rows.push({
        key: `lottery:${d.id}:${w.rid}`, type: "lottery", email: w.email, lottery: l, country: l.country, rid: w.rid, isp: w.isp,
        ispLabel: ispLabel(l.country, w.isp, d.isps || []), receivedAt: w.receivedAt, drawAt: d.draw.at,
        mailedAt: w.mailedAt || null, prizeSentAt: w.prizeSentAt || null, prizeNote: w.prizeNote || "",
        prizeCost: w.prizeCost ?? null, prizeCurrency: w.prizeCurrency || null,
      });
    }
  }
  // 依送出報告的時間，新的在前（沒有報告的必中獎碼排最後）
  rows.sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
  return { rows, sheetError: inv.sheetError, archive: inv.archive, reviews: I.REVIEWS, lotteries: choices };
}

// 檢查「禮物卡已寄出」的表單：{ date: "YYYY-MM-DD"（台灣時間）, cost, currency, note }。
// prevAt：之前記的寄出時間（修改時日期沒變就保留原本的時間點）；日期是今天就記現在，其他日期記那天中午
export function normPrize(p, prevAt = null) {
  if (!p || typeof p !== "object") throw new LotteryError("格式錯誤");
  const today = taipeiDate(Date.now());
  const date = p.date || today;
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw new LotteryError("寄出日期要是 YYYY-MM-DD");
  if (date > today) throw new LotteryError("寄出日期不能是未來");
  const at = prevAt && taipeiDate(prevAt) === date ? prevAt : date === today ? Date.now() : Date.parse(`${date}T12:00:00+08:00`);
  const cost = p.cost == null || p.cost === "" ? null : Number(p.cost);
  if (cost != null && !(cost >= 0)) throw new LotteryError("花費金額要是 0 以上的數字");
  const currency = cost == null ? null : String(p.currency || "").trim().toUpperCase();
  if (cost != null && !/^[A-Z]{3}$/.test(currency)) throw new LotteryError("有填花費金額時要選幣別");
  return { at, note: String(p.note || "").trim() || null, cost, currency };
}

// 記錄（或修改）禮物卡已寄出；prize = null 取消標記。revoke：必中獎同時作廢邀請碼（抽獎的沒有邀請碼，忽略）
export async function setPrize(key, prize, { revoke = false } = {}) {
  const m = /^invite:(.+)$/.exec(key) || /^lottery:(\d+):(.+)$/.exec(key);
  if (!m) throw new LotteryError(`看不懂的中獎人 ${key}`);
  if (key.startsWith("invite:")) {
    const code = m[1];
    if (!prize) return I.unmarkPrizeSent(code);
    const prev = (await sql("select prize_sent_at from invite_codes where code = $1", [code]))[0];
    if (!prev) throw new LotteryError(`找不到邀請碼 ${code}`);
    return I.markPrizeSent(code, normPrize(prize, prev.prize_sent_at ? new Date(prev.prize_sent_at).getTime() : null), revoke);
  }
  const id = Number(m[1]), rid = m[2];
  if (!prize) return void (await V.setWinnerPrizeSent(id, rid, null));
  const w = (await V.getLotteryV2(id))?.draw?.winners.find((x) => x.rid === rid);
  if (!w) throw new LotteryError(`第 ${id} 個抽獎沒有報告 #${rid} 的中獎人`);
  await V.setWinnerPrizeSent(id, rid, normPrize(prize, w.prizeSentAt || null));
}

// 刪除中獎人（特殊情況用）：必中獎同時作廢邀請碼；抽獎中獎人從名單拿掉（不補抽）
export async function deleteWinner(key) {
  let m = /^invite:(.+)$/.exec(key);
  if (m) return I.deleteInvite(m[1]);
  m = /^lottery:(\d+):(.+)$/.exec(key);
  if (!m) throw new LotteryError(`看不懂的中獎人 ${key}`);
  await V.deleteWinner(Number(m[1]), m[2]);
}
