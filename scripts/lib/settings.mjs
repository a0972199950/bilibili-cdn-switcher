// 後台與腳本的雜項設定（Neon 的 settings：key → jsonb）。
//   功能開關不在這裡，見 features.mjs（舊的 donate_enabled 第一次建 features 表時會搬過去）。
import { sql } from "./lotteries.mjs";

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

