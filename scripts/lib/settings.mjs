// 後台的開關（Neon 的 settings：key → jsonb）。後台（admin/、biboost.app/admin）改，其他地方只讀。
//   donate_enabled：贊助的 feature toggle（後台「贊助管理」），預設開啟（沒有這張表、沒有這一列＝開啟）。關閉時：
//     · report worker 的 GET /v1/donate/config 與 /v1/donors 回 enabled: false → 擴充收起「贊助我一杯咖啡」按鈕，贊助頁只剩排行榜
//     · POST /v1/donate/checkout 回 403 disabled
//     · biboost-site 的 /donate 回 404（tools/site/src/index.js）
//     Safari 版本來就沒有贊助（App Store 只能用 IAP，寫死在擴充裡），不受這個開關影響。
//   report worker 與 biboost-site 各自直接查這張表（SETTING_SQL），結果在 Cloudflare 邊緣快取 60 秒。
import { sql } from "./lotteries.mjs";

export const DONATE_ENABLED = "donate_enabled";
// 讀一個開關（$1 = key）；report worker 用同一句（它不 import 這支）
export const SETTING_SQL = "select value from settings where key = $1";

let ready = null;
function ensureTable() {
  ready ||= sql(`create table if not exists settings (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now())`).catch((e) => { ready = null; throw e; });
  return ready;
}

// 沒設過的回 fallback
export async function getSetting(key, fallback) {
  await ensureTable();
  const rows = await sql(SETTING_SQL, [key]);
  return rows.length ? rows[0].value : fallback;
}

export async function setSetting(key, value) {
  await ensureTable();
  await sql(`insert into settings (key, value) values ($1, $2::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()`, [key, JSON.stringify(value)]);
}

export async function donateEnabled() {
  return (await getSetting(DONATE_ENABLED, true)) !== false;
}
