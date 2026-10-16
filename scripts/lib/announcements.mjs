// 擴充的公告（Neon 的 announcements；資料表建在 lotteries.mjs 的 ensureTable，因為抽獎建立時要同一句 SQL 建公告）。
//   · type = 'lottery'：新增抽獎時自動建立。前綴（NT$200 抽獎:）、標題、國家、期間、點開後的內容都跟著抽獎，
//     由擴充依抽獎資料自己組（src/lottery-text.js），這裡不能改；抽獎結束後公告自動不顯示
//   · type = 'html'：後台寫的一般公告。前綴（可省略）、標題、點開後的 HTML 都是 { 語言: 文字 }，
//     只填一種語言也行（擴充依 介面語言 → en → zh-TW → 任一 的順序退回）；countries 空＝所有國家；
//     沒有期間，刪掉才消失
// 擴充透過 report worker 的 GET /v1/announcements 讀取。錯誤一律丟 AnnouncementError（訊息給人看的中文）。
import { ensureTable, sql } from "./lotteries.mjs";

export const LANGS = ["zh-TW", "zh-CN", "en", "ja", "ko"];

export class AnnouncementError extends Error {}

// { 語言: 文字 } 只留認得的語言、去掉空白；全空回 null
function langMap(v) {
  if (!v || typeof v !== "object") return null;
  const out = {};
  for (const l of LANGS) if (typeof v[l] === "string" && v[l].trim()) out[l] = v[l].trim();
  return Object.keys(out).length ? out : null;
}

// 檢查並整理一般公告；不合格丟 AnnouncementError
export function validateHtmlAnnouncement(a) {
  const fail = (msg) => { throw new AnnouncementError(msg); };
  if (!a || typeof a !== "object") fail("格式錯誤");
  const title = langMap(a.title), html = langMap(a.html);
  if (!title) fail("標題（title）至少要填一種語言");
  if (!html) fail("點開後的內容（html）至少要填一種語言");
  const countries = Array.isArray(a.countries) ? a.countries.map((c) => String(c).trim().toUpperCase()).filter(Boolean) : [];
  if (countries.some((c) => !/^[A-Z]{2}$/.test(c))) fail("國家（countries）要是兩碼大寫國家代碼，例如 TW");
  return { prefix: langMap(a.prefix), title, html, countries: [...new Set(countries)] };
}

const ROW_SQL = `select a.id, a.type, a.lottery_id, a.prefix, a.title, a.html, a.countries,
    to_char(a.created_at at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI') as created,
    to_char(a.updated_at at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI') as updated,
    l.title as lottery_title, l.country as lottery_country,
    case when l.id is null then null when l.ended_at is not null then 'ended_early' when now() < l.starts_at then 'upcoming'
         when now() >= l.ends_at then 'ended' else 'active' end as lottery_status
  from announcements a left join lotteries l on l.id = a.lottery_id`;

function rowToAnnouncement(r) {
  const base = { id: r.id, type: r.type, created: r.created, updated: r.updated };
  if (r.type === "lottery") {
    return { ...base, lotteryId: r.lottery_id, title: { "zh-TW": r.lottery_title }, countries: r.lottery_country ? [r.lottery_country] : [],
             lotteryStatus: r.lottery_status, visible: r.lottery_status === "active" };
  }
  return { ...base, prefix: r.prefix || {}, title: r.title || {}, html: r.html || {}, countries: r.countries || [], visible: true };
}

// 全部公告，新的在前；visible＝擴充目前會不會顯示（一般公告一直顯示；抽獎公告只在抽獎進行中顯示）
export async function listAnnouncements() {
  await ensureTable();
  return (await sql(`${ROW_SQL} order by a.created_at desc, a.id desc`)).map(rowToAnnouncement);
}

export async function getAnnouncement(id) {
  await ensureTable();
  const rows = await sql(`${ROW_SQL} where a.id = $1`, [id]);
  return rows.length ? rowToAnnouncement(rows[0]) : null;
}

// 新增一般公告，回傳 id
export async function addHtmlAnnouncement(input) {
  const a = validateHtmlAnnouncement(input);
  await ensureTable();
  const rows = await sql(
    `insert into announcements (type, prefix, title, html, countries) values ('html', $1::jsonb, $2::jsonb, $3::jsonb, $4::text[]) returning id`,
    [a.prefix && JSON.stringify(a.prefix), JSON.stringify(a.title), JSON.stringify(a.html), a.countries.length ? a.countries : null],
  );
  return rows[0].id;
}

// 覆寫一般公告；找不到（或是抽獎公告）回 false
export async function updateHtmlAnnouncement(id, input) {
  const a = validateHtmlAnnouncement(input);
  await ensureTable();
  const rows = await sql(
    `update announcements set prefix = $2::jsonb, title = $3::jsonb, html = $4::jsonb, countries = $5::text[], updated_at = now()
     where id = $1 and type = 'html' returning id`,
    [id, a.prefix && JSON.stringify(a.prefix), JSON.stringify(a.title), JSON.stringify(a.html), a.countries.length ? a.countries : null],
  );
  return rows.length > 0;
}

// 刪除一般公告（抽獎公告跟著抽獎，不能在這裡刪）；找不到回 false
export async function deleteHtmlAnnouncement(id) {
  await ensureTable();
  const rows = await sql("delete from announcements where id = $1 and type = 'html' returning id", [id]);
  return rows.length > 0;
}
