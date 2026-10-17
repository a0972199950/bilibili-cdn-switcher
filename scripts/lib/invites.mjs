// 必中獎參加人（Neon 的 invite_codes，CLI 是 scripts/invite.mjs）的後台邏輯：列表、審核、寄信、記錄獎品已寄出、作廢／恢復邀請碼、新增邀請碼。
//   · 一組邀請碼一列：同一個人用同一組碼送了好幾份報告也只算一列，報告數、最新一份報告（國家、ISP、有沒有歸檔）從試算表彙整
//     （試算表的「參加方式」是 Apps Script 依伺服器端驗證寫的：只算「必中獎」的列；驗證失敗的記成「抽獎」，不算在這裡）
//   · 審核（review）：pending 待確認／valid 有效／invalid 無效，給人判斷用；有沒有歸檔（排除 VPN／無效／重複）只是參考
//   · 寄信：草稿依報告國家的語言（謝謝參加 → 報告確認有效、對某業者的測速結果會幫助同業者 → 回信從禮物卡清單選一種 → 幾天內寄出），
//     在後台確認、修改後才由使用者按寄出（speedtest-reports.mjs 的 sendGmail），寄出時間記在 mailed_at
//   · 獎品已寄出（prize_sent_at、prize_note）：照規則同時作廢邀請碼（之後不能再用）
//   · 參加的抽獎（lottery_v2_id）：在後台產生邀請碼時就綁定（createInvite），獎品照那個抽獎的禮物卡與面額。
//     用 CLI（scripts/invite.mjs）產生的沒有綁定，寄信時禮物卡要自己填
// 作廢只影響之後的驗證與送報告（Apps Script 讀 revoked_at），資料保留。錯誤一律丟 LotteryError（訊息給人看的中文）。
import crypto from "node:crypto";
import { LotteryError, sql } from "./lotteries.mjs";
import {
  archivedRids, cjkPad, extName, fillText, ispLabel, mailLang, money, sendGmail, sheetEntries,
} from "./speedtest-reports.mjs";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉容易看錯的 0/O、1/I（同 scripts/invite.mjs）
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const REVIEWS = { pending: "待確認", valid: "有效", invalid: "無效" };
// 寫信時預設的幣別（依報告國家）
const COUNTRY_CURRENCY = { TW: "TWD", HK: "HKD", MO: "MOP", SG: "SGD", MY: "MYR", JP: "JPY", KR: "KRW", CN: "CNY" };

let ready = null;
function ensureTable() {
  ready ||= (async () => {
    // 同 scripts/invite.mjs 的建表；後台用到的欄位另外加
    await sql(`create table if not exists invite_codes (
      code text primary key,
      email text not null,
      created_at timestamptz not null default now(),
      revoked_at timestamptz,
      last_verified_at timestamptz,
      report_count int not null default 0,
      last_report_id text,
      last_report_at timestamptz)`);
    await sql(`alter table invite_codes
      add column if not exists review text not null default 'pending',
      add column if not exists review_note text,
      add column if not exists mailed_at timestamptz,
      add column if not exists mail_thread_id text,
      add column if not exists prize_sent_at timestamptz,
      add column if not exists prize_note text,
      add column if not exists lottery_v2_id int references lotteries_v2(id) on delete set null`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const ms = (t) => (t ? new Date(t).getTime() : null);
const normCode = (c) => String(c || "").replace(/[\s-]/g, "").toUpperCase();

// 全部邀請碼（新的在前），附上試算表彙整的報告。試算表讀不到時 reports 是 null，並回傳 sheetError
export async function listInvites() {
  await ensureTable();
  const codes = await sql("select * from invite_codes order by created_at desc");
  let entries = null, sheetError = "";
  try { entries = await sheetEntries(); } catch (e) { sheetError = e.message; }
  const byCode = new Map();
  for (const e of entries || []) {
    if (e.join !== "必中獎" || !e.invite) continue;
    if (!byCode.has(e.invite)) byCode.set(e.invite, []);
    byCode.get(e.invite).push(e);
  }
  const archivedBy = new Map();
  const archived = (e) => {
    if (!archivedBy.has(e.country)) archivedBy.set(e.country, archivedRids(e.country));
    return archivedBy.get(e.country).has(e.rid);
  };
  const lotteries = await boundLotteries();
  const rows = codes.map((r) => {
    const all = (byCode.get(r.code) || []).sort((a, b) => b.receivedAt - a.receivedAt);
    const real = all.filter((e) => !e.test).map((e) => ({
      rid: e.rid, receivedAt: e.receivedAt, country: e.country, isp: e.isp, ispLabel: ispLabel(e.country, e.isp), archived: archived(e),
    }));
    return {
      code: r.code, email: r.email, createdAt: ms(r.created_at), revokedAt: ms(r.revoked_at), lastVerifiedAt: ms(r.last_verified_at),
      review: r.review, reviewNote: r.review_note || "", mailedAt: ms(r.mailed_at), prizeSentAt: ms(r.prize_sent_at), prizeNote: r.prize_note || "",
      reports: entries ? real : null, testReports: all.length - real.length,
      reportCount: r.report_count,   // Apps Script 記的正式報告數（試算表讀不到時參考）
      lottery: lotteries.get(r.lottery_v2_id) || null,   // 參加的抽獎（產生邀請碼時綁定的）；null＝沒綁定（CLI 產生的）
    };
  });
  return { rows, sheetError };
}

// 抽獎 v2 的 id → { id, title（繁中，沒有就任一語言）, country, currency, giftCards: [{ name, amount }] }
// （直接查表，不 import lotteries-v2.mjs，免得後台要重開）
async function boundLotteries() {
  const rows = await sql("select id, title, country, currency, gift_cards from lotteries_v2");
  return new Map(rows.map((l) => [l.id, {
    id: l.id, title: (l.title || {})["zh-TW"] || Object.values(l.title || {})[0] || "", country: l.country, currency: l.currency,
    giftCards: (l.gift_cards || []).map((c) => ({ name: c.name, amount: Number(c.amount) })),
  }]));
}

async function getInvite(code) {
  await ensureTable();
  const rows = await sql("select * from invite_codes where code = $1", [normCode(code)]);
  if (!rows.length) throw new LotteryError(`找不到邀請碼 ${code}`);
  return rows[0];
}

// 產生邀請碼時可以綁的抽獎 v2（新的在前）：[{ id, title, country, status }]
export async function lotteryChoices() {
  await ensureTable();
  return (await sql(`select id, title, country,
      case when ended_at is not null then 'ended_early' when now() < starts_at then 'upcoming'
           when now() >= ends_at then 'ended' else 'active' end as status
    from lotteries_v2 order by starts_at desc, id desc`))
    .map((l) => ({ id: l.id, title: (l.title || {})["zh-TW"] || Object.values(l.title || {})[0] || "", country: l.country, status: l.status }));
}

// 新增邀請碼（綁 email 與這次招募的抽獎 v2：獎品照那個抽獎的禮物卡與面額，不用事後猜），回傳碼
export async function createInvite(email, lotteryId) {
  email = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new LotteryError("email 格式不正確");
  await ensureTable();
  if (!(await sql("select 1 from lotteries_v2 where id = $1", [Number(lotteryId)])).length) throw new LotteryError("請選這組邀請碼屬於哪一個抽獎");
  for (;;) {
    const code = Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
    const rows = await sql("insert into invite_codes (code, email, lottery_v2_id) values ($1, $2, $3) on conflict (code) do nothing returning code",
                           [code, email, Number(lotteryId)]);
    if (rows.length) return rows[0].code;
  }
}

export async function setReview(code, review, note = "") {
  if (!REVIEWS[review]) throw new LotteryError("審核狀態要是 pending／valid／invalid");
  await getInvite(code);
  await sql("update invite_codes set review = $2, review_note = $3 where code = $1", [normCode(code), review, String(note || "").trim() || null]);
}

// 作廢（之後不能再驗證、送報告）／恢復
export async function revokeInvite(code) {
  await getInvite(code);
  await sql("update invite_codes set revoked_at = coalesce(revoked_at, now()) where code = $1", [normCode(code)]);
}
export async function restoreInvite(code) {
  await getInvite(code);
  await sql("update invite_codes set revoked_at = null where code = $1", [normCode(code)]);
}

// 獎品已寄出（note：寄了什麼，例如「7-11 商品卡 NT$200 序號 …」）；revoke：同時作廢邀請碼
export async function markPrizeSent(code, note, revoke = true) {
  await getInvite(code);
  await sql(`update invite_codes set prize_sent_at = now(), prize_note = $2
               ${revoke ? ", revoked_at = coalesce(revoked_at, now())" : ""} where code = $1`,
            [normCode(code), String(note || "").trim() || null]);
}
export async function unmarkPrizeSent(code) {
  await getInvite(code);
  await sql("update invite_codes set prize_sent_at = null, prize_note = null where code = $1", [normCode(code)]);
}

// ── 寄信 ─────────────────────────────────────────────────────────────────────────────────────
const MAIL = {
  "zh-TW": {
    subject: "🎁 謝謝你協助測速：禮物卡領取方式",
    body: "你好，\n\n我是「{ext}」的開發者 John。謝謝你用邀請碼參加測速，撥時間幫忙跑完測試！\n\n你的測速報告（報告編號 #{rid}）已經確認有效。你對{ispCjk}的測速結果，會用來幫助其他同樣使用{ispCjk}的使用者。\n\n{prize}\n\n收到你的回信後，我會在幾天內把禮物卡寄到這個信箱。\n\n再次感謝你的協助！\n\nJohn\n{ext} 開發者",
    choose: "作為謝禮，你可以從以下禮物卡擇一，請直接回覆這封信告訴我你要哪一種：", one: "作為謝禮，我會送你「{card}」，請直接回覆這封信確認。",
    card: "{name}（{amount}）",
  },
  "zh-CN": {
    subject: "🎁 感谢你协助测速：礼品卡领取方式",
    body: "你好，\n\n我是“{ext}”的开发者 John。感谢你用邀请码参加测速，抽空帮忙跑完测试！\n\n你的测速报告（报告编号 #{rid}）已经确认有效。你对{ispCjk}的测速结果，会用来帮助其他同样使用{ispCjk}的用户。\n\n{prize}\n\n收到你的回复后，我会在几天内把礼品卡发到这个邮箱。\n\n再次感谢你的帮助！\n\nJohn\n{ext} 开发者",
    choose: "作为谢礼，你可以从以下礼品卡中任选一种，请直接回复这封邮件告诉我你想要哪一种：", one: "作为谢礼，我会送你“{card}”，请直接回复这封邮件确认。",
    card: "{name}（{amount}）",
  },
  en: {
    subject: "🎁 Thanks for helping with the speed test: claim your gift card",
    body: "Hi,\n\nI'm John, the developer of {ext}. Thank you for joining the speed test with your invite code and taking the time to run it!\n\nYour report (#{rid}) has been verified. Your speed test results on {isp} will help other {isp} users.\n\n{prize}\n\nOnce I get your reply, I'll send the gift card to this email address within a few days.\n\nThank you again for your help!\n\nJohn\nDeveloper of {ext}",
    choose: "As a thank-you, you can choose one of the following gift cards. Just reply to this email and let me know which one you'd like:",
    one: "As a thank-you, I'll send you {card}. Just reply to this email to confirm.", card: "{name} ({amount})",
  },
  ja: {
    subject: "🎁 速度テストへのご協力ありがとうございました：ギフトカードの受け取り方法",
    body: "こんにちは。\n\n「{ext}」の開発者の John です。招待コードで速度テストにご参加いただき、テストにお時間をいただき、ありがとうございました。\n\nお送りいただいたレポート（レポート番号 #{rid}）の内容を確認しました。{ispCjk}での速度テストの結果は、同じ{ispCjk}をご利用の方のために役立てさせていただきます。\n\n{prize}\n\nご返信をいただいてから数日以内に、ギフトカードをこのメールアドレスにお送りします。\n\n改めて、ご協力いただき本当にありがとうございました。\n\nJohn\n{ext} 開発者",
    choose: "お礼として、以下のギフトカードからお選びいただけます。このメールにご返信のうえ、ご希望のものをお知らせください。",
    one: "お礼として「{card}」をお送りします。このメールにご返信いただき、ご確認ください。", card: "{name}（{amount}）",
  },
  ko: {
    subject: "🎁 속도 테스트에 도움을 주셔서 감사합니다: 기프트 카드 받는 방법",
    body: "안녕하세요.\n\n'{ext}' 개발자 John입니다. 초대 코드로 속도 테스트에 참여해 주시고, 시간을 내어 테스트해 주셔서 감사합니다!\n\n보내 주신 보고서(보고서 번호 #{rid})를 확인했어요. {isp}에서 측정해 주신 속도 테스트 결과는 다른 {isp} 사용자분들께 큰 도움이 될 거예요.\n\n{prize}\n\n답장을 받으면 며칠 이내에 이 이메일 주소로 기프트 카드를 보내 드릴게요.\n\n다시 한번 도와주셔서 정말 감사합니다!\n\nJohn\n{ext} 개발자",
    choose: "감사의 뜻으로 아래 기프트 카드 중 하나를 고르실 수 있어요. 이 메일에 답장으로 원하시는 카드를 알려 주세요.",
    one: "감사의 뜻으로 '{card}'을(를) 보내 드릴게요. 이 메일에 답장으로 확인해 주세요.", card: "{name} ({amount})",
  },
};

// 寄信用的報告：最新一份有歸檔的，沒有就最新一份
async function mailReport(code) {
  const { rows, sheetError } = await listInvites();
  const r = rows.find((x) => x.code === normCode(code));
  if (!r) throw new LotteryError(`找不到邀請碼 ${code}`);
  if (sheetError) throw new LotteryError(sheetError);
  const report = r.reports.find((x) => x.archived) || r.reports[0];
  if (!report) throw new LotteryError("這組邀請碼還沒有正式的測速報告");
  return { r, report };
}

// 信件草稿：{ to, lang, subject, body, country, currency }；lang 省略＝依報告國家。
// cards：[{ name（照報告國家的語言）, amount（省略就不寫面額） }]，省略＝對應抽獎的禮物卡；currency 省略＝對應抽獎的幣別，沒有就依報告國家
export async function inviteMailDraft(code, { lang, cards, currency } = {}) {
  const { r, report } = await mailReport(code);
  lang = MAIL[lang] ? lang : mailLang(report.country);
  currency = currency || r.lottery?.currency || COUNTRY_CURRENCY[report.country] || "USD";
  const t = MAIL[lang];
  const list = (cards || r.lottery?.giftCards || []).map((c) => (typeof c === "string" ? { name: c } : c))
    .map((c) => ({ name: String(c?.name || "").trim(), amount: Number(c?.amount) > 0 ? Number(c.amount) : null })).filter((c) => c.name);
  if (!list.length) throw new LotteryError("至少要有一種禮物卡");
  const labels = list.map((c) => (c.amount ? fillText(t.card, { name: c.name, amount: money(c.amount, currency) }) : c.name));
  const prize = labels.length > 1 ? `${t.choose}\n${labels.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : fillText(t.one, { card: labels[0] });
  const isp = report.ispLabel || report.isp;
  const v = { ext: extName(lang), rid: report.rid, prize, isp, ispCjk: cjkPad(isp) };
  return { to: r.email, lang, subject: fillText(t.subject, v), body: fillText(t.body, v), country: report.country, currency };
}

// 寄給這組邀請碼的 email（toSelf：測試，改寄給自己、不記成已寄信）
export async function sendInviteMail(code, { subject, body, toSelf = false }) {
  const inv = await getInvite(code);
  const sent = await sendGmail({ to: inv.email, subject, body, toSelf });
  if (!toSelf) await sql("update invite_codes set mailed_at = now(), mail_thread_id = $2 where code = $1", [inv.code, sent.threadId || null]);
}
