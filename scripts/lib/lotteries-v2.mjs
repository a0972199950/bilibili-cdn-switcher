// 抽獎 v2（Neon 的 lotteries_v2，資料表建在 lotteries.mjs 的 ensureTable）：比 v1 多了
//   · 每張禮物卡各自的面額：giftCards = [{ name: "7-Eleven 電子現金券", amount: 100 }, ...]（幣別整個抽獎共用一種）
//   · 備註：HTML（後台富文本編輯器），擴充的抽獎公告視窗有備註時多一個「備註」區塊（html-sanitize.js 依白名單重建）
//   · 標題（跑馬燈捲動的那段）與備註都是 { 語言: 文字 }，只填一種也行（各端依 介面語言 → en → zh-TW → 任一 退回）；
//     後台可以用本機的 Claude Code 翻成其他語言（scripts/lib/translate.mjs）
// 跟 v1（lotteries）各自獨立：新版擴充與 exe 讀 report worker 的 /v2/*（只有 v2），舊版讀 /v1/*（只有 v1），v2 建的抽獎舊版看不到。
// 抽獎公告用 announcements.lottery_v2_id 掛在 v2 上。從 v1 遷移（migrateFromV1）時 v1 那筆不動（舊版照常顯示到結束），
// 那則公告多掛上 v2（lottery_id 與 lottery_v2_id 都有），公告 id 不變。
// 抽出中獎人（drawWinners，抽獎結束後才能抽）：參加者來自測速報告的 Google 試算表「CDN SpeedTest Log」（Apps Script 寫的），
// 依抽獎設定篩選、再對照本機歸檔（cdn-speedtest-results/，/collect-speedtest-mail 排除了 VPN、無效、重複），結果存在 lotteries_v2.draw。
// 本機後台 admin/ 的「抽獎 v2」用這一份。錯誤一律丟 LotteryError（訊息給人看的中文）。
//
// metadata（後台表單）：
//   { title: { 語言: 文字 }, country: "HK", start: "2026-10-01", end: "2026-10-30", currency: "HKD",
//     giftCards: [{ name, amount }, ...], note: { 語言: "<p>…</p>" }（可空）, winners: 3, isps: [...], drawDays: 7 }
import { randomInt } from "node:crypto";
import { LANGS, LotteryError, ensureTable as ensureBaseTables, previewFromApi, sql } from "./lotteries.mjs";
import {
  archivedRids, cjkPad, extName, fillText, ispLabel, ispMatcher, mailLang, money, pickText, sendGmail, sheetEntries,
} from "./speedtest-reports.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 20000;

// 建表在 lotteries.mjs；v2 之後才加的欄位放這裡（這支後台會即時重新載入，lotteries.mjs 改了要重開 dev server）
let v2Ready = null;
function ensureTable() {
  v2Ready ||= (async () => {
    await ensureBaseTables();
    // 抽獎結果：{ at, winners: [{ email, rid, isp, receivedAt }], pool, entries, excluded: { 原因: 筆數 }, ispMap }
    await sql("alter table lotteries_v2 add column if not exists draw jsonb");
  })().catch((e) => { v2Ready = null; throw e; });
  return v2Ready;
}

// { 語言: 文字 } 只留認得的語言、去掉空白；全空回 null
function langMap(v) {
  if (!v || typeof v !== "object") return null;
  const out = {};
  for (const l of LANGS) if (typeof v[l] === "string" && v[l].trim()) out[l] = v[l].trim();
  return Object.keys(out).length ? out : null;
}

// 檢查並整理 metadata；不合格丟 LotteryError
export function validateMetaV2(m) {
  const fail = (msg) => { throw new LotteryError(msg); };
  if (!m || typeof m !== "object") fail("格式錯誤");
  const strList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim());
  const title = langMap(m.title);
  if (!title) fail("標題（title）至少要填一種語言：會顯示在擴充的跑馬燈");
  if (!/^[A-Z]{2}$/.test(m.country || "")) fail("國家（country）要是兩碼大寫國家代碼，例如 TW");
  if (!DATE_RE.test(m.start || "") || !DATE_RE.test(m.end || "") || m.end < m.start) fail("活動期間（start／end）要是 YYYY-MM-DD，且結束日不早於開始日");
  if (!/^[A-Z]{3}$/.test(m.currency || "")) fail("幣別（currency）要是三碼幣別，例如 TWD、HKD");
  if (!Array.isArray(m.giftCards) || !m.giftCards.length) fail("禮物卡（giftCards）至少要有一種");
  const giftCards = m.giftCards.map((c, i) => {
    if (!c || typeof c.name !== "string" || !c.name.trim()) fail(`第 ${i + 1} 張禮物卡沒有名稱`);
    if (!(Number(c.amount) > 0)) fail(`「${c.name.trim()}」的面額要是正數`);
    return { name: c.name.trim(), amount: Number(c.amount) };
  });
  if (!(Number.isInteger(m.winners) && m.winners > 0)) fail("名額（winners）要是正整數");
  if (m.isps != null && !strList(m.isps)) fail("寬頻業者（isps）要是字串陣列（省略＝該國所有使用者）");
  const drawDays = m.drawDays == null ? 7 : m.drawDays;
  if (!(Number.isInteger(drawDays) && drawDays >= 0)) fail("結束後幾天內抽出（drawDays）要是 0 以上的整數");
  if (m.note != null && typeof m.note !== "object") fail("備註（note）要是 { 語言: HTML }");
  const note = langMap(m.note);
  for (const [l, h] of Object.entries(note || {})) if (h.length > NOTE_MAX) fail(`${l} 的備註太長（${h.length} 字元，上限 ${NOTE_MAX}）`);
  return {
    title, country: m.country, start: m.start, end: m.end, currency: m.currency, giftCards,
    note, winners: m.winners, isps: (m.isps || []).map((x) => x.trim()), drawDays,
  };
}

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// 跟 worker /v2/* 回傳的格式一樣（lottery_text.py / src/lottery-text.js 吃這個）
export function apiMetaV2(m) {
  return { title: m.title, country: m.country, prize: { currency: m.currency, giftCards: m.giftCards }, note: m.note,
           winners: m.winners, isps: m.isps, drawDays: m.drawDays, startDate: m.start, endDate: m.end, drawBy: addDays(m.end, m.drawDays) };
}

// 各端會顯示什麼：{ exe: { 語言: html }, ext: { 語言: {...} }, note: { 語言: 備註 HTML } | null }
export function previewTextsV2(m) {
  return { ...previewFromApi(apiMetaV2(m)), note: m.note };
}

// 台灣時間的日期 → 時間點（結束日整天都算：存隔天 00:00）
const START = (p) => `(${p}::date)::timestamp at time zone 'Asia/Taipei'`;
const END = (p) => `(${p}::date + 1)::timestamp at time zone 'Asia/Taipei'`;

// $1～$10
function params(m) {
  return [JSON.stringify(m.title), m.country, m.currency, JSON.stringify(m.giftCards), m.note && JSON.stringify(m.note),
          m.isps.length ? m.isps : null, m.winners, m.drawDays, m.start, m.end];
}

// 新增，回傳 id；同一句 SQL 建抽獎公告，不會只建一半
export async function addLotteryV2(meta) {
  const m = validateMetaV2(meta);
  await ensureTable();
  const rows = await sql(
    `with v as (
       insert into lotteries_v2 (title, country, currency, gift_cards, note, isps, winners, draw_days, starts_at, ends_at)
       values ($1::jsonb, $2, $3, $4::jsonb, $5::jsonb, $6::text[], $7, $8, ${START("$9")}, ${END("$10")}) returning id),
     a as (insert into announcements (type, lottery_v2_id) select 'lottery', id from v)
     select id from v`,
    params(m),
  );
  return rows[0].id;
}

// 覆寫；找不到回 false
export async function updateLotteryV2(id, meta) {
  const m = validateMetaV2(meta);
  await ensureTable();
  const rows = await sql(
    `update lotteries_v2 set title = $1::jsonb, country = $2, currency = $3, gift_cards = $4::jsonb, note = $5::jsonb, isps = $6::text[],
       winners = $7, draw_days = $8, starts_at = ${START("$9")}, ends_at = ${END("$10")}
     where id = $11 returning id`,
    [...params(m), id],
  );
  return rows.length > 0;
}

// 提前結束（資料保留）；從 v1 遷移來的，v1 那筆也一起結束（舊版才不會繼續顯示已取消的抽獎）。回傳標題，找不到回 null
export async function endLotteryV2(id) {
  await ensureTable();
  const rows = await sql(
    `with v as (update lotteries_v2 set ended_at = coalesce(ended_at, now()) where id = $1 returning migrated_from, title),
     l as (update lotteries set ended_at = coalesce(ended_at, now()) where id = (select migrated_from from v))
     select title from v`,
    [id],
  );
  return rows.length ? rows[0].title : null;
}

// v1 裡還沒結束（進行中、未開始）、還沒遷移的抽獎
const MIGRATABLE = `from lotteries l
  where l.country is not null and l.ended_at is null and now() < l.ends_at
    and not exists (select 1 from lotteries_v2 v where v.migrated_from = l.id)`;

export async function migratableV1() {
  await ensureTable();
  return sql(`select l.id, l.title ${MIGRATABLE} order by l.starts_at, l.id`);
}

// 把 v1 還沒結束的抽獎複製到 v2：每張禮物卡的面額都是原本的面額、沒有備註；v1 那筆不動（舊版照常顯示），
// 那則抽獎公告多掛上 v2（新版改顯示 v2 的資料，公告 id 不變）。回傳 [{ id（v2）, v1Id }]
export async function migrateFromV1() {
  await ensureTable();
  const rows = await sql(
    `with v as (
       insert into lotteries_v2 (migrated_from, title, country, currency, gift_cards, note, isps, winners, draw_days, starts_at, ends_at, created_at)
       select l.id, jsonb_build_object('zh-TW', l.title), l.country, l.currency,
         (select jsonb_agg(jsonb_build_object('name', t.g, 'amount', l.prize_amount) order by t.o)
            from unnest(l.gift_cards) with ordinality as t(g, o)),
         null, l.isps, l.winners, coalesce(l.draw_days, 7), l.starts_at, l.ends_at, l.created_at
       ${MIGRATABLE}
       returning id, migrated_from),
     ann as (update announcements x set lottery_v2_id = v.id from v where x.lottery_id = v.migrated_from)
     select id, migrated_from from v`,
  );
  return rows.map((r) => ({ id: r.id, v1Id: r.migrated_from }));
}

const ROW_SQL = `select id, migrated_from, title, country, currency, gift_cards, note, isps, winners, draw_days, draw,
    (extract(epoch from starts_at) * 1000)::float8 as starts_ms,
    (extract(epoch from least(ended_at, ends_at)) * 1000)::float8 as ends_ms,   -- 提前結束的以結束那一刻為準
    to_char(starts_at at time zone 'Asia/Taipei', 'YYYY-MM-DD') as start_date,
    to_char(ends_at at time zone 'Asia/Taipei' - interval '1 day', 'YYYY-MM-DD') as end_date,
    case when ended_at is not null then 'ended_early' when now() < starts_at then 'upcoming'
         when now() >= ends_at then 'ended' else 'active' end as status
  from lotteries_v2`;

function rowToLottery(r) {
  return {
    id: r.id, migratedFrom: r.migrated_from, title: r.title, status: r.status, country: r.country, start: r.start_date, end: r.end_date,
    currency: r.currency, giftCards: (r.gift_cards || []).map((c) => ({ name: c.name, amount: Number(c.amount) })),
    note: r.note || {}, winners: r.winners, isps: r.isps || [], drawDays: r.draw_days,
    draw: r.draw || null, startsAt: r.starts_ms, endsAt: r.ends_ms,
    drawable: r.status === "ended" || r.status === "ended_early",   // 結束（含提前結束）後才能抽
  };
}

// 全部 v2 抽獎，新的在前
export async function listLotteriesV2() {
  await ensureTable();
  return (await sql(`${ROW_SQL} order by starts_at desc, id desc`)).map(rowToLottery);
}

export async function getLotteryV2(id) {
  await ensureTable();
  const rows = await sql(`${ROW_SQL} where id = $1`, [id]);
  return rows.length ? rowToLottery(rows[0]) : null;
}

// ── 抽出中獎人 ─────────────────────────────────────────────────────────────────────────────────────
// 參加者：測速報告的試算表「CDN SpeedTest Log」（讀取、本機歸檔、業者對照、寄信都在 speedtest-reports.mjs）。
// 資格：參加方式＝抽獎（必中獎另外送，不抽，同國家活動期間內有必中獎報告的 email 其他報告也不算；純測速沒留 email；
// 邀請碼驗證失敗的試算表記成「抽獎」，照一般參加者算）、不是測試模式、國家相同、收到時間在活動期間內（台灣時間；
// 提前結束的到結束那一刻）、有限定業者時 ISP 要對得上、報告有歸檔到本機 cdn-speedtest-results/<國家>/（/collect-speedtest-mail
// 排除了 VPN、無效、重複送出；還沒收信的也算不合格，抽之前先收信）。同一個 email 只算一次（取最早那份）。
export const EXCLUDE_REASONS = {
  test: "測試模式", notLottery: "純測速", guaranteed: "必中獎（邀請碼）", guaranteedEmail: "同 email 在活動期間有必中獎報告",
  noEmail: "沒有 email", country: "其他國家", period: "不在活動期間",
  isp: "業者不符", notArchived: "沒有歸檔（VPN／無效／重複，或還沒收信）", duplicate: "同一個 email 的其他報告",
};

// 依設定篩出符合資格的參加者；回傳 { pool: [...], entries（試算表總列數）, excluded: { 原因: 筆數 }, ispMap }
export async function eligibleEntries(l) {
  const entries = await sheetEntries();
  const archived = archivedRids(l.country);
  const isp = l.isps.length ? ispMatcher(l.country, l.isps) : null;
  const excluded = Object.fromEntries(Object.keys(EXCLUDE_REASONS).map((k) => [k, 0]));
  const inPeriod = (e) => e.receivedAt >= l.startsAt && e.receivedAt < l.endsAt;
  // 必中獎（邀請碼驗證成功）的人另外送獎品：同國家、活動期間內有必中獎報告的 email，其他抽獎報告也不算
  const guaranteedEmails = new Set(entries.filter((e) => !e.test && e.join === "必中獎" && e.email && e.country === l.country && inPeriod(e))
    .map((e) => e.email.toLowerCase()));
  const ok = [];
  for (const e of entries) {
    const reason = e.test ? "test" : e.join === "必中獎" ? "guaranteed" : e.join !== "抽獎" ? "notLottery" : !e.email ? "noEmail"
      : e.country !== l.country ? "country" : !inPeriod(e) ? "period" : guaranteedEmails.has(e.email.toLowerCase()) ? "guaranteedEmail"
      : isp && !isp.test(e.isp) ? "isp" : !archived.has(e.rid) ? "notArchived" : null;
    if (reason) excluded[reason]++;
    else ok.push(e);
  }
  ok.sort((a, b) => a.receivedAt - b.receivedAt);
  const seen = new Set(), pool = [];
  for (const e of ok) {
    const key = e.email.toLowerCase();
    if (seen.has(key)) { excluded.duplicate++; continue; }
    seen.add(key);
    pool.push(e);
  }
  return { pool, entries: entries.length, excluded, ispMap: isp ? isp.map.map(({ name, via }) => ({ name, via })) : [] };
}

// 抽出中獎人並存起來（已經抽過的會覆蓋；沒有人符合資格時也存，winners 是空的，畫面才看得到排除原因）；回傳 draw
export async function drawWinners(id) {
  const l = await getLotteryV2(id);
  if (!l) throw new LotteryError(`找不到 v2 第 ${id} 個抽獎`);
  if (!l.drawable) throw new LotteryError("抽獎結束後才能抽出中獎人");
  const { pool, entries, excluded, ispMap } = await eligibleEntries(l);
  const picked = [...pool];
  for (let i = picked.length - 1; i > 0; i--) {   // Fisher–Yates，用 crypto 亂數
    const j = randomInt(i + 1);
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  const winners = picked.slice(0, l.winners).map(({ email, rid, isp, receivedAt }) => ({ email, rid, isp, receivedAt }));
  const draw = { at: Date.now(), winners, pool: pool.length, entries, excluded, ispMap };
  await sql("update lotteries_v2 set draw = $2::jsonb where id = $1", [id, JSON.stringify(draw)]);
  return draw;
}

// ── 通知中獎人 ─────────────────────────────────────────────────────────────────────────────────────
// 後台先產生草稿（winnerMailDraft，語言依抽獎國家），在畫面上確認、修改後才由使用者按寄出（sendWinnerMail）：
// 從使用者自己的 Gmail 寄純文字信（speedtest-reports.mjs 的 sendGmail），寄出時間記在 draw.winners[i].mailedAt。
// 信的內容：感謝參加 → 恭喜在哪個活動中獎、他在某業者的測速結果會幫助同業者的其他使用者 → 回信從禮物卡清單選一種
// （只有一種就回信確認）→ 收到回信後幾天內寄出
const MAIL = {
  "zh-TW": {
    subject: "🎉 恭喜中獎：{title}",
    body: "你好，\n\n我是「{ext}」的開發者 John。謝謝你參加測速抽獎，也謝謝你撥時間幫忙測速！\n\n恭喜你在「{title}」中獎了 🎉（報告編號 #{rid}）\n你對{ispCjk}的測速結果，會用來幫助其他同樣使用{ispCjk}的使用者。\n\n{prize}\n\n收到你的回信後，我會在幾天內把禮物卡寄到這個信箱。\n\n再次恭喜，也再次感謝你的協助！\n\nJohn\n{ext} 開發者",
    choose: "獎品可以從以下禮物卡擇一，請直接回覆這封信告訴我你要哪一種：", one: "獎品是「{card}」，請直接回覆這封信確認。",
    card: "{name}（{amount}）",
  },
  "zh-HK": {
    subject: "🎉 恭喜中獎：{title}",
    body: "你好，\n\n我係「{ext}」嘅開發者 John。多謝你參加測速抽獎，亦多謝你抽時間幫手測速！\n\n恭喜你喺「{title}」中咗獎 🎉（報告編號 #{rid}）\n你喺{ispCjk}嘅測速結果，會用嚟幫其他同樣用緊{ispCjk}嘅用戶。\n\n{prize}\n\n收到你回覆之後，我會喺幾日內將禮品卡寄去呢個電郵地址。\n\n再次恭喜，亦再次多謝你幫手！\n\nJohn\n{ext} 開發者",
    choose: "獎品可以喺以下禮品卡揀一款，直接回覆呢封電郵話我知你想要邊款就得：", one: "獎品係「{card}」，直接回覆呢封電郵確認就得。",
    card: "{name}（{amount}）",
  },
  "zh-CN": {
    subject: "🎉 恭喜中奖：{title}",
    body: "你好，\n\n我是“{ext}”的开发者 John。感谢你参加测速抽奖，也感谢你抽空帮忙测速！\n\n恭喜你在“{title}”中奖了 🎉（报告编号 #{rid}）\n你对{ispCjk}的测速结果，会用来帮助其他同样使用{ispCjk}的用户。\n\n{prize}\n\n收到你的回复后，我会在几天内把礼品卡发到这个邮箱。\n\n再次恭喜，也再次感谢你的帮助！\n\nJohn\n{ext} 开发者",
    choose: "奖品可以从以下礼品卡中任选一种，请直接回复这封邮件告诉我你想要哪一种：", one: "奖品是“{card}”，请直接回复这封邮件确认。",
    card: "{name}（{amount}）",
  },
  en: {
    subject: "🎉 You won: {title}",
    body: "Hi,\n\nI'm John, the developer of {ext}. Thank you for joining the speed test prize draw, and for taking the time to run the test!\n\nCongratulations — you're a winner in \"{title}\" 🎉 (report #{rid})\nYour speed test results on {isp} will help other {isp} users.\n\n{prize}\n\nOnce I get your reply, I'll send the gift card to this email address within a few days.\n\nCongratulations again, and thank you so much for your help!\n\nJohn\nDeveloper of {ext}",
    choose: "You can choose one of the following gift cards. Just reply to this email and let me know which one you'd like:",
    one: "Your prize is {card}. Just reply to this email to confirm.", card: "{name} ({amount})",
  },
  ja: {
    subject: "🎉 当選のお知らせ：{title}",
    body: "こんにちは。\n\n「{ext}」の開発者の John です。速度テストの抽選にご参加いただき、またテストにお時間をいただき、ありがとうございました。\n\n「{title}」にご当選されました。おめでとうございます 🎉（レポート番号 #{rid}）\n{ispCjk}での速度テストの結果は、同じ{ispCjk}をご利用の方のために役立てさせていただきます。\n\n{prize}\n\nご返信をいただいてから数日以内に、ギフトカードをこのメールアドレスにお送りします。\n\n改めておめでとうございます。ご協力いただき、本当にありがとうございました。\n\nJohn\n{ext} 開発者",
    choose: "賞品は以下のギフトカードからお選びいただけます。このメールにご返信のうえ、ご希望のものをお知らせください。",
    one: "賞品は「{card}」です。このメールにご返信いただき、ご確認ください。", card: "{name}（{amount}）",
  },
  ko: {
    subject: "🎉 당첨을 축하드려요: {title}",
    body: "안녕하세요.\n\n'{ext}' 개발자 John입니다. 속도 테스트 추첨에 참여해 주시고, 시간을 내어 테스트해 주셔서 감사합니다!\n\n'{title}'에 당첨되셨어요. 축하드립니다 🎉 (보고서 번호 #{rid})\n{isp}에서 측정해 주신 속도 테스트 결과는 다른 {isp} 사용자분들께 큰 도움이 될 거예요.\n\n{prize}\n\n답장을 받으면 며칠 이내에 이 이메일 주소로 기프트 카드를 보내 드릴게요.\n\n다시 한번 축하드리며, 도와주셔서 정말 감사합니다!\n\nJohn\n{ext} 개발자",
    choose: "경품은 아래 기프트 카드 중 하나를 고르실 수 있어요. 이 메일에 답장으로 원하시는 카드를 알려 주세요.",
    one: "경품은 '{card}'입니다. 이 메일에 답장으로 확인해 주세요.", card: "{name} ({amount})",
  },
};
// 中獎人的信件草稿：{ to, lang, subject, body }；lang 省略＝依抽獎國家
export async function winnerMailDraft(id, rid, { lang } = {}) {
  const l = await getLotteryV2(id);
  const w = l?.draw?.winners.find((x) => x.rid === rid);
  if (!w) throw new LotteryError(`v2 第 ${id} 個抽獎沒有報告 #${rid} 的中獎人`);
  lang = MAIL[lang] ? lang : mailLang(l.country);
  const t = MAIL[lang];
  const cards = l.giftCards.map((c) => fillText(t.card, { name: c.name, amount: money(c.amount, l.currency) }));
  const prize = cards.length > 1 ? `${t.choose}\n${cards.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : fillText(t.one, { card: cards[0] });
  const isp = ispLabel(l.country, w.isp, l.isps);
  const v = { title: pickText(l.title, lang), ext: extName(lang), rid, prize, isp, ispCjk: cjkPad(isp) };
  return { to: w.email, lang, subject: fillText(t.subject, v), body: fillText(t.body, v) };
}

// 用使用者自己的 Gmail 寄給中獎人（純文字），記下寄出時間；回傳更新後的 draw。
// toSelf：測試用，改寄給使用者自己（主旨加「[測試]」），不記成已寄信
export async function sendWinnerMail(id, rid, { subject, body, toSelf = false }) {
  const l = await getLotteryV2(id);
  const draw = l?.draw;
  const w = draw?.winners.find((x) => x.rid === rid);
  if (!w) throw new LotteryError(`v2 第 ${id} 個抽獎沒有報告 #${rid} 的中獎人`);
  const sent = await sendGmail({ to: w.email, subject, body, toSelf });
  if (toSelf) return draw;
  w.mailedAt = Date.now();
  w.mailThreadId = sent.threadId;
  await sql("update lotteries_v2 set draw = $2::jsonb where id = $1", [id, JSON.stringify(draw)]);
  return draw;
}
