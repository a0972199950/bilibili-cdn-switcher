// 功能開關（feature toggle）：Neon 的 features（key → data jsonb）。後台「功能管理」（admin/、biboost.app/admin）改，其他地方只讀。
//   · data 一定有 enabled（布林）；其他欄位是後台自訂的屬性（小寫英數字與底線的字串或布林），這裡只檢查格式、原樣保存與下發
//   · 沒有這張表、沒有這一列＝用 FEATURES 的預設值
//   · 擴充：report worker 的 GET /v1/features 把所有列簽章後下發（tools/report-worker/src/features.js），擴充驗章後使用（src/features.js）
//   · biboost-site 的頁面直接查這張表（featureEnabled），在 Cloudflare 邊緣快取 60 秒
// 現有功能不加開關；之後有新功能要開關時，加進 FEATURES（擴充那邊的預設值在 src/features.js 的 DEFAULTS，兩邊要一致，測試會比對）。
import { sql } from "./lotteries.mjs";

// 程式碼裡登記的功能：key、後台顯示的名稱與說明、預設值
export const FEATURES = [
  {
    key: "donate",
    name: "贊助",
    desc: "關閉時：popup 收起「贊助」按鈕、擴充的贊助頁只剩排行榜、biboost.app/donate 回 404、結帳 API 回 403。Safari 版本來就不顯示贊助，不受影響。",
    defaults: { enabled: true },
  },
];

const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const VALUE_RE = /^[a-z0-9_]{1,32}$/;
const MAX_FIELDS = 8;

export class FeatureError extends Error {
  constructor(message) { super(message); this.name = "FeatureError"; }
}

const catalog = (key) => FEATURES.find((f) => f.key === key) || null;
const defaultsOf = (key) => ({ enabled: true, ...(catalog(key)?.defaults || {}) });

let ready = null;
// 第一次建表時，把舊的 settings.donate_enabled 搬過來（後台之前的贊助開關）
function ensureTable() {
  ready ||= (async () => {
    await sql(`create table if not exists features (
      key text primary key,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now())`);
    const [{ t }] = await sql("select to_regclass('settings')::text as t");
    if (t) {
      await sql(`insert into features (key, data)
        select 'donate', jsonb_build_object('enabled', value <> 'false'::jsonb) from settings where key = 'donate_enabled'
        on conflict (key) do nothing`);
    }
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// 後台清單：程式碼登記的功能（沒存過的用預設值）＋資料庫裡其他的列
// → [{ key, name, desc, data, updatedAt, known }]
export async function listFeatures() {
  await ensureTable();
  const rows = await sql("select key, data, updated_at from features order by key");
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = FEATURES.map((f) => {
    const r = byKey.get(f.key);
    byKey.delete(f.key);
    return { key: f.key, name: f.name, desc: f.desc, data: { ...defaultsOf(f.key), ...(r?.data || {}) }, updatedAt: r?.updated_at || null, known: true };
  });
  for (const r of byKey.values()) out.push({ key: r.key, name: r.key, desc: "", data: { ...defaultsOf(r.key), ...(r.data || {}) }, updatedAt: r.updated_at, known: false });
  return out;
}

export async function getFeature(key) {
  await ensureTable();
  const rows = await sql("select data from features where key = $1", [key]);
  return { ...defaultsOf(key), ...(rows[0]?.data || {}) };
}

export async function featureEnabled(key) {
  return (await getFeature(key)).enabled !== false;
}

// patch：{ enabled?: 布林, <屬性>?: 字串｜布林｜null（null＝刪掉這個屬性） }，合併進現有的值
export function validatePatch(key, patch) {
  if (!KEY_RE.test(String(key))) throw new FeatureError(`功能代號格式不對：${key}`);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new FeatureError("沒有要改的內容");
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!KEY_RE.test(k)) throw new FeatureError(`屬性名稱格式不對：${k}`);
    if (k === "enabled") {
      if (typeof v !== "boolean") throw new FeatureError("開關只能是開或關");
    } else if (!(v === null || typeof v === "boolean" || (typeof v === "string" && VALUE_RE.test(v)))) {
      throw new FeatureError(`屬性 ${k} 的值格式不對`);
    }
    out[k] = v;
  }
  return out;
}

export async function setFeature(key, patch) {
  const p = validatePatch(key, patch);
  const data = { ...(await getFeature(key)) };
  for (const [k, v] of Object.entries(p)) {
    if (v === null) delete data[k]; else data[k] = v;
  }
  if (typeof data.enabled !== "boolean") data.enabled = true;
  if (Object.keys(data).length > MAX_FIELDS) throw new FeatureError(`屬性最多 ${MAX_FIELDS} 個`);
  await sql(`insert into features (key, data) values ($1, $2::jsonb)
    on conflict (key) do update set data = excluded.data, updated_at = now()`, [key, JSON.stringify(data)]);
  return data;
}
