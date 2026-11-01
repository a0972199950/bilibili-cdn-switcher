// 贊助（擴充的贊助頁 src/donate.html、report worker 的 /v1/donors、/v1/donate/*）在 Neon 的資料表與管理動作。
// scripts/donations.mjs（CLI）與後台的「贊助管理」（admin-api.mjs）用這一份。
//
//   donors：每位贊助者一筆。pid = sha256("bcs-donor:" + donorId) 前 16 碼（擴充與 worker 同一算法），donorId 本身不存。
//           上榜名稱、頭像（預設頭像第幾種，或上傳的圖片 data URL）以最近一次贊助送來的為準；hidden = 不上榜（檢舉／不雅名稱、頭像）
//   donation_intents：按下「前往付款」時建立（金流的 checkout 還沒付款），記下當時的名稱、頭像、金額、語言、瀏覽器、版本、國家…
//   donations：金流 webhook 確認付款成功的每一筆（原幣別金額、換算美金、手續費、實收、付款方式、時間、原始事件）；
//              provider + provider_ref 唯一，同一個事件重送不會重複記
//   donor_aliases：同一位贊助者的其他 pid（付款 email 相同時 worker 自動合併；排行榜、改名稱頭像都先換成 canonical）
// 排行榜只算 status = 'paid'，同一個 pid 合併，依美金累計排序（同額時先達到的在前）。
import { sql } from "./lotteries.mjs";

export class DonationError extends Error {}

let tableReady = null;
export function ensureTable() {
  tableReady ||= (async () => {
    await sql(`create table if not exists donors (
      pid text primary key,
      name text not null default '',
      avatar_style int,
      avatar_image text,
      hidden boolean not null default false,
      email text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now())`);
    await sql(`create table if not exists donation_intents (
      id text primary key,
      pid text not null,
      name text not null default '',
      avatar_style int,
      avatar_image text,
      amount numeric not null,
      currency text not null,
      region text,
      country text,
      lang text,
      browser text,
      ext_version text,
      provider text,
      provider_session text,
      created_at timestamptz not null default now())`);
    await sql(`create table if not exists donations (
      id bigserial primary key,
      pid text not null references donors(pid),
      intent_id text references donation_intents(id),
      provider text not null,
      provider_ref text not null,
      status text not null default 'paid' check (status in ('paid', 'refunded', 'disputed')),
      amount numeric not null,
      currency text not null,
      usd numeric not null,
      fee_usd numeric,
      net_usd numeric,
      fx_rate numeric,
      method text,
      region text,
      country text,
      lang text,
      browser text,
      ext_version text,
      payer_email text,
      paid_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      raw jsonb,
      unique (provider, provider_ref))`);
    await sql("create index if not exists donations_pid on donations (pid)");
    // email 自動合併：換了 donorId（換電腦、沒開同步）但付款 email 相同 → 舊 pid 指到同一位（canonical）
    await sql(`create table if not exists donor_aliases (
      pid text primary key,
      canonical text not null,
      created_at timestamptz not null default now())`);
    await sql("create index if not exists donors_email on donors (email)");
    // 綠界的通知不給 email：選新台幣時擴充讓使用者選填，存在 intent 上
    await sql("alter table donation_intents add column if not exists email text");
  })().catch((e) => { tableReady = null; throw e; });
  return tableReady;
}

// 排行榜（同 worker 的 /v1/donors，含 hidden 的人，管理用）
export async function listDonors() {
  await ensureTable();
  return sql(`select d.pid, d.name, d.hidden, d.avatar_style, d.avatar_image is not null as has_image,
      sum(x.usd)::float8 as usd, count(*)::int as count, min(x.paid_at) as first_at, max(x.paid_at) as last_at
    from donations x join donors d using (pid) where x.status = 'paid'
    group by d.pid order by usd desc, max(x.paid_at)`);
}

// 金流商：後台「贊助管理」的名稱與「到金流後台看這筆」的連結。之後接新的金流，在這裡加一個
//   url(d)：d 是 listDonations 的一筆（provider_ref＝Stripe PaymentIntent id／綠界 TradeNo；raw.livemode＝Stripe 是不是正式環境）
export const PROVIDERS = {
  stripe: {
    name: "Stripe",
    url: (d) => `https://dashboard.stripe.com/${d.raw?.livemode === false ? "test/" : ""}payments/${encodeURIComponent(d.ref)}`,
  },
  // 綠界後台沒有單筆交易的網址，連到廠商後台首頁（交易編號在列表上可以複製去查）
  ecpay: { name: "綠界", url: () => "https://vendor.ecpay.com.tw/" },
};

// 狀態：refunded 已退款、disputed 爭議中（拒付）、available 已入帳（款項已進金流的可用餘額，Stripe 的 balance transaction 到了 available_on）、
// paid 已收款（付款成功、還沒入帳；綠界不給入帳時間，一律算已收款）
export function donationStatus(d, nowMs = Date.now()) {
  if (d.status === "refunded" || d.status === "disputed") return d.status;
  const on = Number(d.raw?.available_on);
  return on > 0 && on * 1000 <= nowMs ? "available" : "paid";
}

// 每一筆贊助（新的在前），後台「贊助管理」用。from／to：台灣時間的日期 YYYY-MM-DD（含當天），省略＝不限
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export async function listDonations({ from = "", to = "" } = {}) {
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw new DonationError("日期要是 YYYY-MM-DD");
  await ensureTable();
  const rows = await sql(`select x.id, x.pid, x.intent_id, x.provider, x.provider_ref, x.status, x.amount::float8 as amount, x.currency,
      x.usd::float8 as usd, x.fee_usd::float8 as fee_usd, x.net_usd::float8 as net_usd, x.method, x.country, x.lang, x.browser, x.ext_version,
      x.payer_email, x.raw, (extract(epoch from x.paid_at) * 1000)::float8 as paid_ms,
      i.name as intent_name, i.email as intent_email, d.name as donor_name, d.hidden
    from donations x left join donation_intents i on i.id = x.intent_id left join donors d on d.pid = x.pid
    where ($1::date is null or x.paid_at >= ($1::date)::timestamp at time zone 'Asia/Taipei')
      and ($2::date is null or x.paid_at < ($2::date + 1)::timestamp at time zone 'Asia/Taipei')
    order by x.paid_at desc, x.id desc`, [from || null, to || null]);
  const now = Date.now();
  return rows.map((r) => {
    const raw = r.raw || {};
    const d = {
      id: Number(r.id), pid: r.pid, intentId: r.intent_id, provider: r.provider, ref: r.provider_ref, rawStatus: r.status,
      amount: r.amount, currency: r.currency, usd: r.usd, feeUsd: r.fee_usd, netUsd: r.net_usd,
      method: r.method, wallet: raw.wallet || null, cardBrand: raw.card_brand || null,
      country: r.country, lang: r.lang, browser: r.browser, extVersion: r.ext_version,
      email: r.payer_email || r.intent_email || null,
      name: r.intent_name ?? "", donorName: r.donor_name ?? "", hidden: !!r.hidden,
      paidAt: r.paid_ms, availableOn: Number(raw.available_on) > 0 ? Number(raw.available_on) * 1000 : null,
      raw: { livemode: raw.livemode },
    };
    d.status = donationStatus({ status: r.status, raw }, now);
    const p = PROVIDERS[r.provider];
    d.providerName = p ? p.name : r.provider;
    d.providerUrl = p ? p.url(d) : null;
    return d;
  });
}

// 標成已退款（綠界退刷沒有通知，人工退款後用這個；Stripe 的退款 webhook 會自動標）：ref = 綠界 TradeNo 或 Stripe PaymentIntent id
export async function markRefunded(ref) {
  await ensureTable();
  const rows = await sql("update donations set status = 'refunded' where provider_ref = $1 returning pid, amount::float8 as amount, currency", [ref]);
  if (!rows.length) throw new DonationError(`找不到交易 ${ref}`);
  return rows[0];
}

// 不上榜／恢復上榜（不雅名稱、頭像）；clearImage 另外把上傳的頭像清掉，退回預設頭像
export async function setHidden(pid, hidden, { clearImage = false } = {}) {
  await ensureTable();
  const rows = await sql(`update donors set hidden = $2, ${clearImage ? "avatar_image = null," : ""} updated_at = now() where pid = $1 returning pid`, [pid, hidden]);
  if (!rows.length) throw new DonationError(`找不到贊助者 ${pid}`);
}
