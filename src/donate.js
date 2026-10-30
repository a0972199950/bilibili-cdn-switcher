"use strict";
/*
 * 贊助頁（donate.html）：popup 按「贊助我一杯咖啡」開成一般分頁。
 *  - 乾爹排行榜：GET <DONATE_API>/v1/donors（report worker），同一位贊助者的多筆已在後端合併、換算成美金，依累計金額排序
 *  - 贊助入口：付款地區 → 幣別與金額（一杯咖啡為單位的快選＋自訂，有下限）→ 上榜名稱與頭像 → 前往付款
 *  - 贊助者身分：隨機的 donorId（storage.sync：同一個瀏覽器帳號的各台裝置共用；不支援 sync 的退回 local），
 *    排行榜只公開它的雜湊（pid），donorId 本身只在付款時送給後端。名稱與頭像存 storage.local 的 donateProfile，下次自動帶入
 *  - 沒上傳頭像的人，用名稱產生的 10 種預設角色頭像（avatarSvg）讓他挑；排行榜上只存「第幾種」，各端依名稱自己畫
 */
// report worker：商店版與網站版用正式的 api.biboost.app（Stripe 正式帳戶）；本機載入的開發版用測試環境 api-staging.biboost.app
// （Stripe 沙盒＋Neon staging 分支，怎麼測都不會出現在真的排行榜上）。management.getSelf 不需要權限；網站版沒有它，用正式的
var DONATE_API_PROD = "https://api.biboost.app";
var DONATE_API_STAGING = "https://api-staging.biboost.app";
var DONATE_API = DONATE_API_PROD;
var apiReady = new Promise(function (resolve) {
  try {
    chrome.management.getSelf(function (self) {
      if (self && self.installType === "development") DONATE_API = DONATE_API_STAGING;
      resolve();
    });
  } catch (e) { resolve(); }
});
var NAME_MAX = 20;
var AVATAR_STYLES = 10;
var AVATAR_PX = 128; // 上傳的頭像縮成 128×128（正方形置中裁切）
var PODIUM = 3;
var MAX_USD = 2000; // 防手滑多打幾個 0

// 幣別：sym = 金額前面的符號（Intl 在中文介面會把新台幣、港幣都寫成「$」，跟美金分不出來，所以自己定）；usd = 1 單位約合多少美金（只用來顯示「約 US$」與預估名次，實際排名用付款當下的匯率在後端換算）；
// dec = 小數位數；min = 最低金額：Stripe 新加坡帳戶最壞情況（國際卡＋換匯 5.9%＋S$0.50）扣完手續費後實收仍約 US$0.5 以上（spec/donate.md 研究報告 3.2）；
// cup = 一杯咖啡的價格。匯率是 2026-10-29 的，半年檢查一次就好
var CURRENCIES = {
  USD: { sym: "US$", usd: 1, dec: 2, min: 1, cup: 3 },
  TWD: { sym: "NT$", usd: 0.0308, dec: 0, min: 50, cup: 100 },
  HKD: { sym: "HK$", usd: 0.1275, dec: 0, min: 10, cup: 30 },
  SGD: { sym: "S$", usd: 0.78, dec: 2, min: 2, cup: 5 },
  MYR: { sym: "RM", usd: 0.245, dec: 2, min: 5, cup: 15 },
  JPY: { sym: "¥", usd: 0.00633, dec: 0, min: 200, cup: 500 },
  KRW: { sym: "₩", usd: 0.000746, dec: 0, min: 1500, cup: 5000 },
  CNY: { sym: "¥", usd: 0.1497, dec: 0, min: 10, cup: 25 },
  AUD: { sym: "A$", usd: 0.704, dec: 2, min: 1.5, cup: 5 },
  CAD: { sym: "C$", usd: 0.713, dec: 2, min: 1.5, cup: 5 },
  EUR: { sym: "€", usd: 1.115, dec: 2, min: 1, cup: 3 },
  GBP: { sym: "£", usd: 1.33, dec: 2, min: 1, cup: 3 },
  NZD: { sym: "NZ$", usd: 0.5625, dec: 2, min: 2, cup: 5 },
  BRL: { sym: "R$", usd: 0.1865, dec: 2, min: 6, cup: 15 },
  IDR: { sym: "Rp", usd: 0.0000551, dec: 0, min: 20000, cup: 50000 },
  VND: { sym: "₫", usd: 0.0000388, dec: 0, min: 25000, cup: 75000 },
  THB: { sym: "฿", usd: 0.02964, dec: 0, min: 35, cup: 100 },
  PHP: { sym: "₱", usd: 0.01567, dec: 0, min: 65, cup: 180 },
  CHF: { sym: "CHF ", usd: 1.21, dec: 2, min: 1, cup: 3 },
  SEK: { sym: "kr ", usd: 0.1014, dec: 0, min: 10, cup: 30 },
  MXN: { sym: "MX$", usd: 0.0531, dec: 0, min: 20, cup: 55 }
};
// 幣別選單的排序：依最近 30 天各國打開 popup 的比例（npm run worker:opens -- 30，2026-10-30；國家換成 COUNTRY_CURRENCY 的幣別加總），
// 不在這裡的（目前沒有使用者）照代碼 A–Z 排在後面。比例變了再重排
var CURRENCY_ORDER = ["TWD", "HKD", "JPY", "USD", "SGD", "AUD", "MYR", "CAD", "GBP", "KRW", "EUR", "BRL", "IDR", "VND", "NZD"];
var CUPS = [1, 3, 5, 10];
// 依 IP 偵測到的國家 → 預設幣別（沒有對應的用美金）。金流依幣別決定（providerOf），所以不用選國家
var COUNTRY_CURRENCY = { TW: "TWD", HK: "HKD", MO: "HKD", SG: "SGD", MY: "MYR", JP: "JPY", KR: "KRW", CN: "CNY", US: "USD", CA: "CAD", AU: "AUD", GB: "GBP",
  NZ: "NZD", BR: "BRL", ID: "IDR", VN: "VND", TH: "THB", PH: "PHP", CH: "CHF", LI: "CHF", SE: "SEK", MX: "MXN" };
var EU = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"];
// 金流：全部走 Stripe 新加坡帳戶。綠界（新台幣）的程式留著但先關掉：贊助會被綠界歸成「斗內」要申請個人特約，
// 要稅籍資料與辦公環境照（spec/donate.md ⑧）。要開時這裡改 true，並在 worker 設好 ECPAY_* secrets（worker 有 secrets 才分流）
var ECPAY_ON = false;
function providerOf(cur) { return ECPAY_ON && cur === "TWD" ? "ecpay" : "stripe"; }
// 付款頁上會出現的付款方式（spec/donate.md 研究報告）：Stripe 的 ALL 是每個幣別都有的，其餘依幣別；
// 綠界：信用卡（限台灣發行）、Apple Pay、超商條碼／代碼（金額 NT$150 起，worker 的 ECPAY_CVS_MIN）
var METHODS = {
  ecpay: ["card_tw", "applepay", "cvs"],
  ALL: ["googlepay", "applepay", "card"],
  SGD: ["paynow", "grabpay", "alipay", "wechat"], CNY: ["alipay", "wechat"], USD: ["alipay"], KRW: ["naverpay", "payco", "samsungpay"]
};
var METHOD_LABELS = { applepay: "Apple Pay", googlepay: "Google Pay", paynow: "PayNow", grabpay: "GrabPay", alipay: "Alipay", wechat: "WeChat Pay", naverpay: "Naver Pay", payco: "PAYCO", samsungpay: "Samsung Pay" };
var METHOD_KEYS = { card: "donateMethodCard", card_tw: "donateMethodCardTw", cvs: "donateMethodCvs" };
// 稱號：累計美金 ≥ min（由高到低）
var TIERS = [{ min: 100, cls: "t4", key: "donateTier4" }, { min: 50, cls: "t3", key: "donateTier3" }, { min: 20, cls: "t2", key: "donateTier2" }, { min: 5, cls: "t1", key: "donateTier1" }, { min: 0, cls: "t0", key: "donateTier0" }];

var lang = uiLangTag();
var board = { loaded: false, failed: false, items: [], donors: 0 };
// style：0–9 預設頭像、"image"＝上傳的頭像；imageSaved＝已經送上排行榜的那張上傳頭像的雜湊（排行榜只給網址，比不出是不是同一張）
var me = { donorId: "", pid: "", name: "", style: 0, image: "", email: "", imageSaved: 0 };
var currency = "USD";

// ---------------- 格式 ----------------
function fill(str, v) { return str.replace(/\{(\w+)\}/g, function (m, k) { return k in v ? String(v[k]) : m; }); }
function fmtMoney(n, cur) {
  var c = CURRENCIES[cur], whole = Math.abs(n - Math.round(n)) < 1e-9;
  return c.sym + Number(n).toLocaleString(uiLanguage(), { minimumFractionDigits: whole ? 0 : c.dec, maximumFractionDigits: c.dec });
}
function fmtUsd(n) { return fmtMoney(Math.round(n * 100) / 100, "USD"); }
// 排行榜上的金額一律兩位小數，整數的才不會看起來像被四捨五入
function fmtBoardUsd(n) { return "US$" + Number(n).toLocaleString(uiLanguage(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// 要使用者決定金額的地方：美金後面附上目前幣別的約當金額（目前就是美金時不附）
function fmtUsdLocal(usd) {
  if (currency === "USD") return fmtUsd(usd);
  return fill(t("donateUsdLocal"), { usd: fmtUsd(usd), local: fmtMoney(fromUsd(usd, currency), currency) });
}
function toUsd(amount, cur) { return amount * CURRENCIES[cur].usd; }
// 美金 → 該幣別，無條件進位到幣別的最小單位，且不低於最低金額
function fromUsd(usd, cur) {
  var c = CURRENCIES[cur], f = Math.pow(10, c.dec);
  return Math.max(c.min, Math.ceil(usd / c.usd * f - 1e-9) / f);
}
function tierOf(usd) { for (var i = 0; i < TIERS.length; i++) if (usd >= TIERS[i].min) return TIERS[i]; return TIERS[TIERS.length - 1]; }
function displayName(name) { return (name || "").trim() || t("donateAnonymous"); }

// ---------------- 預設頭像：依名稱產生，10 種小物件 ----------------
// 0 電視、1 遊戲手把、2 卡帶、3 相機、4 手機、5 掌上遊戲機、6 磁碟片、7 燈泡、8 咖啡杯、9 鍵帽（名字第一個字）。
// 物件的顏色與表情（微笑／瞇眼笑／驚訝）依名字決定：同一個名字永遠畫出同一個頭像，不同名字選同一款也會不同色。圖都是自己畫的
function hashStr(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// 依名字固定的亂數（mulberry32）
function seeded(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) >>> 0;
    var x = Math.imul(seed ^ (seed >>> 15), seed | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
function initialOf(name) {
  var ch = Array.from((name || "").trim())[0];
  return ch ? ch.toUpperCase() : "?";
}
// [物件色, 背景淡色]
var AVATAR_COLORS = [
  ["#fb7299", "#ffd6e3"], ["#00aeec", "#cdeffd"], ["#ffb300", "#fff0c2"], ["#2ba471", "#d4f5e2"], ["#8041c8", "#e6dcfa"],
  ["#ff7a45", "#ffe0d0"], ["#36cfc9", "#d0f4f2"], ["#f759ab", "#ffd9ef"], ["#597ef7", "#dbe4ff"], ["#73d13d", "#e3f7cf"]
];
// 小臉：(cx, cy) 中心、s 大小、mood 0 微笑、1 瞇眼笑、2 驚訝
function faceSvg(cx, cy, s, mood) {
  var e = 6 * s, ey = cy - 2 * s, ink = "#3a2a2a", out;
  if (mood === 1) {
    out = '<path d="M' + (cx - e - 2.6 * s) + " " + ey + " q" + 2.6 * s + " " + -2.8 * s + " " + 5.2 * s + " 0 M" + (cx + e - 2.6 * s) + " " + ey + " q" + 2.6 * s + " " + -2.8 * s + " " + 5.2 * s +
      ' 0" stroke="' + ink + '" stroke-width="' + 1.8 * s + '" fill="none" stroke-linecap="round"/>';
  } else {
    out = '<circle cx="' + (cx - e) + '" cy="' + ey + '" r="' + 2.1 * s + '" fill="' + ink + '"/><circle cx="' + (cx + e) + '" cy="' + ey + '" r="' + 2.1 * s + '" fill="' + ink + '"/>';
  }
  out += mood === 2
    ? '<ellipse cx="' + cx + '" cy="' + (cy + 4.5 * s) + '" rx="' + 2 * s + '" ry="' + 2.4 * s + '" fill="' + ink + '"/>'
    : '<path d="M' + (cx - 3.2 * s) + " " + (cy + 3.6 * s) + " q" + 3.2 * s + " " + 3.2 * s + " " + 6.4 * s + ' 0" stroke="' + ink + '" stroke-width="' + 1.7 * s + '" fill="none" stroke-linecap="round"/>';
  return out + '<ellipse cx="' + (cx - 9.5 * s) + '" cy="' + (cy + 2.6 * s) + '" rx="' + 2.8 * s + '" ry="' + 1.7 * s + '" fill="#ff8fab" opacity=".55"/>' +
    '<ellipse cx="' + (cx + 9.5 * s) + '" cy="' + (cy + 2.6 * s) + '" rx="' + 2.8 * s + '" ry="' + 1.7 * s + '" fill="#ff8fab" opacity=".55"/>';
}
// 各物件的圖（{c} 換成物件色）與臉的位置 [cx, cy, 大小]
var GADGETS = [
  ['<path d="M50 30 L62 14" stroke="#5d4037" stroke-width="3" stroke-linecap="round"/><circle cx="62" cy="14" r="3.2" fill="#5d4037"/>' +
    '<rect x="16" y="30" width="68" height="48" rx="6" fill="{c}"/><rect x="22" y="36" width="44" height="36" rx="5" fill="#fff"/>' +
    '<circle cx="75" cy="44" r="3.4" fill="#fff" opacity=".85"/><circle cx="75" cy="56" r="3.4" fill="#fff" opacity=".85"/>' +
    '<rect x="26" y="78" width="6" height="6" rx="1" fill="#5d4037"/><rect x="68" y="78" width="6" height="6" rx="1" fill="#5d4037"/>', [44, 55, 0.75]],
  ['<path d="M26 36 H74 Q88 36 91 52 L94 68 Q96 80 85 81 Q78 82 72 72 L68 66 H32 L28 72 Q22 82 15 81 Q4 80 6 68 L9 52 Q12 36 26 36Z" fill="{c}"/>' +
    '<rect x="20" y="44" width="6" height="18" rx="1.5" fill="#fff"/><rect x="14" y="50" width="18" height="6" rx="1.5" fill="#fff"/>' +
    '<circle cx="78" cy="46" r="3.6" fill="#fff"/><circle cx="85" cy="53" r="3.6" fill="#fff"/><circle cx="71" cy="53" r="3.6" fill="#fff"/><circle cx="78" cy="60" r="3.6" fill="#fff"/>', [50, 50, 0.7]],
  ['<rect x="12" y="26" width="76" height="52" rx="6" fill="{c}"/><rect x="19" y="32" width="62" height="20" rx="3" fill="#fff"/>' +
    '<rect x="30" y="56" width="40" height="14" rx="7" fill="#3b3b3b"/><circle cx="39" cy="63" r="4.5" fill="#fff"/><circle cx="61" cy="63" r="4.5" fill="#fff"/>' +
    '<circle cx="39" cy="63" r="1.6" fill="#3b3b3b"/><circle cx="61" cy="63" r="1.6" fill="#3b3b3b"/><path d="M26 78 L30 70 H70 L74 78Z" fill="#000" opacity=".15"/>', [50, 42, 0.6]],
  ['<rect x="34" y="22" width="22" height="12" rx="3" fill="#3b3b3b"/><rect x="66" y="25" width="10" height="6" rx="2" fill="#3b3b3b"/>' +
    '<rect x="12" y="30" width="76" height="48" rx="9" fill="{c}"/><rect x="18" y="36" width="12" height="7" rx="2" fill="#fff" opacity=".8"/>' +
    '<circle cx="50" cy="55" r="19" fill="#3b3b3b"/><circle cx="50" cy="55" r="14" fill="#fff"/>', [50, 56, 0.6]],
  ['<rect x="30" y="10" width="40" height="80" rx="10" fill="#2f2f33"/><rect x="34" y="16" width="32" height="68" rx="6" fill="{c}"/>' +
    '<rect x="44" y="19" width="12" height="4" rx="2" fill="#2f2f33"/><rect x="43" y="78" width="14" height="2.5" rx="1.2" fill="#fff" opacity=".7"/>', [50, 46, 0.7]],
  ['<rect x="26" y="10" width="48" height="80" rx="8" fill="{c}"/><rect x="32" y="17" width="36" height="30" rx="3" fill="#3b3b3b"/><rect x="36" y="21" width="28" height="22" rx="2" fill="#cfe8a8"/>' +
    '<rect x="35" y="56" width="5" height="15" rx="1.2" fill="#3b3b3b"/><rect x="30" y="61" width="15" height="5" rx="1.2" fill="#3b3b3b"/>' +
    '<circle cx="61" cy="66" r="4" fill="#3b3b3b"/><circle cx="67" cy="59" r="4" fill="#3b3b3b"/>' +
    '<rect x="44" y="78" width="6" height="2.4" rx="1.2" fill="#3b3b3b" transform="rotate(-25 47 79)"/><rect x="53" y="78" width="6" height="2.4" rx="1.2" fill="#3b3b3b" transform="rotate(-25 56 79)"/>', [50, 33, 0.55]],
  ['<path d="M16 16 H76 L84 24 V84 H16Z" fill="{c}"/><rect x="32" y="16" width="34" height="22" fill="#cfd8dc"/><rect x="54" y="20" width="7" height="14" fill="{c}"/>' +
    '<rect x="24" y="48" width="52" height="34" rx="3" fill="#fff"/><path d="M30 56 H70" stroke="{c}" stroke-width="2" opacity=".5"/>', [50, 68, 0.6]],
  ['<path d="M50 12 C68 12 78 26 76 42 C75 52 66 56 64 66 H36 C34 56 25 52 24 42 C22 26 32 12 50 12Z" fill="{c}"/>' +
    '<rect x="37" y="66" width="26" height="6" rx="2" fill="#9e9e9e"/><rect x="38" y="73" width="24" height="5" rx="2" fill="#bdbdbd"/><rect x="42" y="79" width="16" height="6" rx="3" fill="#757575"/>' +
    '<path d="M10 30 l7 3 M90 30 l-7 3 M14 52 l7 -2 M86 52 l-7 -2" stroke="{c}" stroke-width="3" stroke-linecap="round"/>', [50, 40, 0.75]],
  ['<path d="M40 14 q-5 6 0 12 q5 6 0 12 M52 12 q-5 6 0 12 q5 6 0 12" stroke="#b0a49a" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<circle cx="74" cy="60" r="11" fill="none" stroke="{c}" stroke-width="6"/><rect x="22" y="40" width="52" height="44" rx="10" fill="{c}"/>' +
    '<rect x="22" y="40" width="52" height="8" rx="4" fill="#fff" opacity=".35"/>', [48, 63, 0.8]]
];
// 回傳 data:image/svg+xml 網址（給 <img>，不用 innerHTML）
function avatarSvg(name, style) {
  name = (name || "").trim() || t("donateAnonymous"); // 沒填名字：用「匿名乾爹」畫
  var r = seeded(hashStr(name + "|" + style));
  var col = AVATAR_COLORS[Math.floor(r() * AVATAR_COLORS.length)], c = col[0];
  var body = '<rect width="100" height="100" fill="' + col[1] + '"/>';
  var g = GADGETS[style];
  if (g) {
    body += g[0].replace(/\{c\}/g, c) + faceSvg(g[1][0], g[1][1], g[1][2], Math.floor(r() * 3));
  } else { // 9 鍵帽：名字第一個字
    body += '<rect x="16" y="20" width="68" height="66" rx="12" fill="' + c + '"/><rect x="16" y="20" width="68" height="66" rx="12" fill="#000" opacity=".18"/>' +
      '<rect x="22" y="22" width="56" height="52" rx="10" fill="' + c + '"/><rect x="26" y="25" width="48" height="44" rx="8" fill="#fff" opacity=".22"/>' +
      '<text x="50" y="48" dy=".35em" text-anchor="middle" font-family="-apple-system,Segoe UI,Microsoft JhengHei,Malgun Gothic,Yu Gothic,sans-serif" font-weight="800" font-size="30" fill="#fff">' + esc(initialOf(name)) + "</text>";
  }
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + body + "</svg>";
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
// 排行榜一筆的頭像網址：上傳的頭像由 worker 提供網址；其他依名稱與風格自己畫
function avatarSrc(item) {
  var av = item.avatar || {};
  if (av.url && /^(https:\/\/|data:image\/)/.test(av.url)) return av.url;
  return avatarSvg(item.name, Number(av.style) >= 0 && Number(av.style) < AVATAR_STYLES ? Number(av.style) : hashStr(displayName(item.name)) % AVATAR_STYLES);
}
function myAvatarSrc() { return me.style === "image" && me.image ? me.image : avatarSvg(me.name, Number(me.style) || 0); }
// ☕ 在 Windows 的 emoji 字型畫出來像一顆灰球：字串開頭的 ☕ 換成自己畫的咖啡杯
var CUP_SVG = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M11 3c-1 2 1 3 0 5M16 3c-1 2 1 3 0 5M21 3c-1 2 1 3 0 5" fill="none" stroke="#c9a27e" stroke-width="1.6" stroke-linecap="round"/><path d="M4 11h20v8a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8z" fill="#fff" stroke="#6b3e1f" stroke-width="2"/><path d="M6 13h16v5a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z" fill="#8b4f24"/><path d="M24 13h1.5a3.5 3.5 0 0 1 0 7H23" fill="none" stroke="#6b3e1f" stroke-width="2"/><path d="M2 28h24" stroke="#6b3e1f" stroke-width="2" stroke-linecap="round"/></svg>');
function setCupText(node, text) {
  node.textContent = "";
  if (text.indexOf("☕") === 0) { node.appendChild(img(CUP_SVG, "cupIcon")); text = text.replace(/^☕\s*/, ""); }
  node.appendChild(document.createTextNode(text));
}
// 只有網址圖片（上傳的頭像）延遲載入；自己畫的 data: SVG 不用，不然捲動前會是空白
function img(src, cls) { var el = document.createElement("img"); el.src = src; el.alt = ""; if (cls) el.className = cls; if (/^https:/.test(src)) el.loading = "lazy"; return el; }
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

// ---------------- 靜態文字 ----------------
document.title = t("donateTitle");
// 語言切換：跟 popup 進階設定的語言同一個設定（localStorage 的 uiLang＋chrome.storage.local 的 uiLang／uiMsgs，寫法同 popup.js），換完重載。
// 網址上測試用的 ?lang= 會蓋過設定，重載前先拿掉
var UI_LANG_NAMES = { zh_TW: "繁體中文", zh_CN: "简体中文", en: "English", ja: "日本語", ko: "한국어" };
(function () {
  var sel = $("langSelect");
  ["auto"].concat(UI_LANGS).forEach(function (code) {
    var o = document.createElement("option");
    o.value = code;
    o.textContent = code === "auto" ? t("uiLangAuto") : UI_LANG_NAMES[code];
    sel.appendChild(o);
  });
  sel.value = uiLangPref;
  sel.setAttribute("aria-label", t("uiLangLabel"));
  sel.addEventListener("change", function () {
    var v = sel.value;
    setUiLangPref(v);
    var q = new URLSearchParams(location.search);
    q.delete("lang");
    var rest = q.toString();
    chrome.storage.local.set({ uiLang: v, uiMsgs: v === "auto" ? null : loadUiMessages(v) }, function () {
      location.replace(location.pathname + (rest ? "?" + rest : "") + location.hash);
    });
  });
})();
document.documentElement.lang = uiLanguage();
[
  ["heroTitle", "donateBoardTitle"], ["heroSub", "donateBoardSub"], ["statDonorsLabel", "donateStatDonors"],
  ["tabBoard", "donateTabBoard"], ["tabGive", "donateTabGive"], ["giveTitle", "donateGiveTitle"], ["giveSub", "donateGiveSub"],
  ["stepAmount", "donateStepAmount"], ["currencyLabel", "donateCurrencyLabel"], ["stepProfile", "donateStepProfile"], ["nameNote", "donateNameNote"],
  ["previewLabel", "donatePreviewLabel"], ["stepPay", "donateStepPay"], ["emailLabel", "donateEmailLabel"], ["emailNote", "donateEmailNote"], ["fineText", "donateFine"], ["ctaBtn", "donateCta"], ["boardNote", "donateBoardNote"], ["tierLabel", "donateTierLegendLabel"], ["contactBtn", "donateContact"], ["contactCopy", "donateContactCopy"]
].forEach(function (p) { setCupText($(p[0]), t(p[1])); });
$("name").placeholder = t("donateAnonymous");

// ---------------- 分頁（窄螢幕）＆ 前往贊助 ----------------
var NARROW = window.matchMedia("(max-width: 900px)");
function setTab(tab) {
  document.body.setAttribute("data-tab", tab);
  $("tabBoard").classList.toggle("on", tab === "board");
  $("tabGive").classList.toggle("on", tab === "give");
  $("tabBoard").setAttribute("aria-selected", String(tab === "board"));
  $("tabGive").setAttribute("aria-selected", String(tab === "give"));
}
function goGive() {
  setTab("give");
  if (NARROW.matches) { window.scrollTo(0, $("give").offsetTop - $("tabBoard").offsetHeight - 8); return; }
  var g = $("give");
  g.classList.remove("pulse"); void g.offsetWidth; g.classList.add("pulse");
  $("amount").focus();
}
$("tabBoard").addEventListener("click", function () { setTab("board"); });
$("tabGive").addEventListener("click", function () { setTab("give"); });
$("ctaBtn").addEventListener("click", goGive);
if (location.hash === "#give") setTab("give");

// ---------------- 排行榜 ----------------
function renderStats() {
  $("statDonors").textContent = board.loaded ? String(board.donors) : "-";
  // 還沒有人贊助時不秀「0 位乾爹」
  $("stats").classList.toggle("hidden", board.loaded && !board.donors);
}
function tierChip(usd) { var tr = tierOf(usd); return el("span", "tier " + tr.cls, t(tr.key)); }
function countText(n) { return fill(t("donateTimes"), { n: n }); }

function renderPodium() {
  var box = $("podium");
  box.textContent = "";
  // 視覺順序：第 2、第 1、第 3
  [1, 0, 2].forEach(function (i) {
    var it = board.items[i];
    var pod = el("div", "pod r" + (i + 1) + (it ? "" : " empty") + (it && isMine(it) ? " me" : ""));
    pod.appendChild(el("span", "medal", ["🥇", "🥈", "🥉"][i]));
    if (it) {
      pod.appendChild(img(avatarSrc(it), "av"));
      pod.appendChild(el("div", "nm", displayName(it.name)));
      pod.appendChild(el("div", "amt", fmtBoardUsd(it.usd)));
      var cnt = el("div", "cnt");
      cnt.appendChild(tierChip(it.usd));
      cnt.appendChild(document.createTextNode(countText(it.count)));
      pod.appendChild(cnt);
    } else {
      pod.appendChild(img(avatarSvg("?", 0), "av"));
      pod.appendChild(el("div", "nm", t("donateVacant")));
      pod.appendChild(el("div", "cnt", t("donateVacantSub")));
    }
    box.appendChild(pod);
  });
}
// 一列（第 4 名以後；贊助表單的預覽也用）
function fillRow(row, rank, item, isMe) {
  row.textContent = "";
  row.appendChild(el("span", "rk", rank == null ? "?" : String(rank)));
  row.appendChild(img(item.src || avatarSrc(item), "av"));
  var who = el("div", "who");
  var nm = el("div", "nm", displayName(item.name));
  if (isMe) nm.appendChild(el("span", "youTag", t("donateYou")));
  who.appendChild(nm);
  var meta = el("div", "meta");
  meta.appendChild(tierChip(item.usd));
  if (item.count) meta.appendChild(document.createTextNode(countText(item.count)));
  who.appendChild(meta);
  row.appendChild(who);
  row.appendChild(el("span", "amt", fmtBoardUsd(item.usd)));
}
function renderList() {
  var list = $("list");
  list.textContent = "";
  board.items.slice(PODIUM).forEach(function (it, i) {
    var li = el("li", "row" + (isMine(it) ? " me" : ""));
    fillRow(li, PODIUM + i + 1, it, isMine(it));
    list.appendChild(li);
  });
  var st = $("boardState");
  st.textContent = "";
  st.classList.add("hidden");
  if (!board.loaded) {
    st.classList.remove("hidden");
    if (board.failed) {
      st.appendChild(el("div", "", t("donateBoardFailed")));
      var retry = el("button", "btn ghost small", t("donateRetry"));
      retry.type = "button"; retry.style.marginTop = "8px";
      retry.addEventListener("click", loadBoard);
      st.appendChild(retry);
    } else st.textContent = t("donateLoading");
  }
}
// 是不是自己：pid 相同，或自己的 pid 是付款 email 相同而被合併進來的（pids）
function isMine(it) { return !!me.pid && (it.pid === me.pid || (it.pids || []).indexOf(me.pid) >= 0); }
function myIndex() { for (var i = 0; i < board.items.length; i++) if (isMine(board.items[i])) return i; return -1; }
function myUsd() { var i = myIndex(); return i < 0 ? 0 : board.items[i].usd; }
// 加上 addUsd 之後會排第幾名（同額時先來的在前，所以要嚴格大於才超過）
function projectedRank(addUsd) {
  var total = myUsd() + addUsd, rank = 1;
  board.items.forEach(function (it) { if (!isMine(it) && it.usd >= total) rank++; });
  return rank;
}
// 激勵卡：依目前名次給一個「再多少就能超越誰」的目標，按鈕直接把差額帶進金額
var meTargetUsd = 0;
function renderMe() {
  var card = $("meCard");
  if (!board.loaded) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  var idx = myIndex(), text, icon, btn;
  meTargetUsd = 0;
  if (idx === 0) {
    icon = "👑"; btn = t("donateMeKeepBtn");
    var second = board.items[1];
    text = second ? fill(t("donateMeFirst"), { usd: fmtBoardUsd(board.items[0].usd), gap: fmtUsdLocal(board.items[0].usd - second.usd) }) : fill(t("donateMeFirstAlone"), { usd: fmtBoardUsd(board.items[0].usd) });
  } else if (idx > 0) {
    var above = board.items[idx - 1];
    meTargetUsd = Math.max(0.01, Math.round((above.usd - board.items[idx].usd) * 100 + 1) / 100);
    icon = "🔥"; btn = t("donateMeOvertakeBtn");
    text = fill(t("donateMeRank"), { rank: idx + 1, usd: fmtBoardUsd(board.items[idx].usd), gap: fmtUsdLocal(meTargetUsd), above: idx, name: displayName(above.name) });
  } else if (board.items.length < PODIUM) {
    icon = "🎉"; btn = t("donateMeJoinBtn");
    text = board.items.length ? fill(t("donateMeFewDonors"), { n: board.items.length, min: fmtMoney(CURRENCIES[currency].min, currency) }) : t("donateMeNoDonors");
  } else {
    // 還沒上榜：先講最低金額就能上榜，頒獎台放後面（第一句就丟高門檻會把小額的人嚇跑）；按鈕只帶最低金額以上的一杯咖啡，不帶頒獎台的金額
    var third = board.items[PODIUM - 1];
    icon = "🏆"; btn = t("donateMeJoinBtn");
    text = fill(t("donateMePodium"), { min: fmtMoney(CURRENCIES[currency].min, currency), gap: fmtUsdLocal(Math.floor(third.usd)) });
  }
  $("meIcon").textContent = icon;
  setRichText($("meText"), text);
  $("meBtn").textContent = btn;
  syncMeBtn();
}
$("meBtn").addEventListener("click", function () {
  if (meTargetUsd > 0) setAmount(fromUsd(meTargetUsd, currency));
  goGive();
});
// 手機寬度底部已經固定一顆「我也要上榜」，激勵卡的按鈕只在有具體差額（超車）時才留著
function syncMeBtn() { $("meBtn").classList.toggle("narrowHide", !(meTargetUsd > 0)); }
function renderBoard() { renderStats(); renderPodium(); renderList(); renderMe(); renderAmountHint(); renderPreview(); }

// GET /v1/donors：{ ok, items: [{ pid, name, avatar: { style } | { url }, usd, count }]（依 usd 由高到低）, donors }
// 後端還沒部署（404）時當作還沒有人贊助
// 開發用假資料：donate.html?mock（開發版 popup 的贊助按鈕會帶這個）不打 API，改用下面 30 個人；
// ?mock=me7 讓「你」排第 7 名（用這台裝置的贊助者 ID、名稱、頭像），?mock=empty 看還沒人贊助的樣子
var MOCK = new URLSearchParams(location.search).get("mock");
var MOCK_NAMES = ["阿貓喵喵", "Kevin_HK", "星野ゆめ", "小明不加班", "Pixel大叔", "도토리", "SG_Chloe", "B站深夜鐵粉", "Lena", "海外留學生阿宅",
  "MapleSyrup", "", "🐳鯨魚本鯨", "這個名字剛好有二十個字長度測試用的喔喔", "Tanaka", "珍奶去冰半糖", "kr_minsu", "CDN之神", "", "Oliver",
  "台北通勤族", "猫ちゃん", "Raymond", "宅宅工程師", "Ahmad", "", "포도맛", "Momo", "加拿大鵝", "Zoe"];
function mockBoard() {
  if (MOCK === "empty") return { ok: true, items: [], donors: 0 };
  var items = MOCK_NAMES.map(function (name, i) {
    return { pid: "mock" + i, name: name, avatar: { style: (i * 3) % AVATAR_STYLES }, usd: Math.round((520 / Math.pow(i + 1, 1.15) + 1) * 100) / 100, count: 1 + (i * 7) % 6 };
  });
  var m = /^me(\d+)$/.exec(MOCK || "");
  if (m && items[Number(m[1]) - 1]) {
    var mine = items[Number(m[1]) - 1];
    mine.pid = me.pid; mine.name = me.name || mine.name;
    mine.avatar = me.style === "image" ? { url: me.image } : { style: Number(me.style) || 0 };
  }
  return { ok: true, items: items, donors: items.length };
}
// fresh：略過 worker 的 1 分鐘邊緣快取直接讀資料庫（付款後確認上榜用；worker 有限次數）
function fetchBoard(fresh) {
  if (MOCK !== null) return Promise.resolve(mockBoard());
  return apiReady.then(function () { return fetch(DONATE_API + "/v1/donors" + (fresh ? "?fresh=1" : ""), { credentials: "omit", cache: "no-store" }); })
    .then(function (r) {
      if (r.status === 404) return { ok: true, items: [] };
      return r.json();
    });
}
function loadBoard(done, fresh) {
  // 已經載入過就不清空畫面（付款後切回來重抓時不閃）
  if (!board.loaded) { board.failed = false; renderBoard(); }
  fetchBoard(fresh)
    .then(function (j) {
      if (!j || !j.ok || !Array.isArray(j.items)) throw new Error("bad");
      board.items = j.items.filter(function (it) { return it && typeof it.pid === "string" && Number(it.usd) > 0; })
        .map(function (it) { return { pid: it.pid, pids: Array.isArray(it.pids) ? it.pids : [], name: Array.from(String(it.name || "")).slice(0, NAME_MAX).join(""), avatar: it.avatar || {}, usd: Number(it.usd), count: Number(it.count) || 1 }; });
      board.donors = Number(j.donors) || board.items.length;
      board.loaded = true;
      prefillFromBoard();
      renderBoard();
      if (typeof done === "function") done(true);
    })
    .catch(function () {
      if (!board.loaded) { board.failed = true; renderBoard(); }
      if (typeof done === "function") done(false);
    });
}

// ---------------- 贊助者身分與上榜資料 ----------------
var SYNC = chrome.storage.sync || chrome.storage.local;
function randomHex(bytes) {
  var a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return Array.from(a, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
// 公開用的 id：donorId 的 SHA-256 前 16 碼（worker 用同一個算法），排行榜只會出現這個
function pidOf(donorId) {
  return Promise.resolve().then(function () { return crypto.subtle.digest("SHA-256", new TextEncoder().encode("bcs-donor:" + donorId)); }).then(function (buf) {
    return Array.from(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("").slice(0, 16);
  });
}
function loadIdentity() {
  return new Promise(function (resolve) {
    SYNC.get({ donorId: "" }, function (s) {
      var id = s && /^[0-9a-f]{32}$/.test(s.donorId) ? s.donorId : "";
      if (!id) { id = randomHex(16); SYNC.set({ donorId: id }); }
      me.donorId = id;
      chrome.storage.local.get({ donateProfile: null }, function (l) {
        var p = l && l.donateProfile;
        if (p && typeof p === "object") {
          me.name = String(p.name || "").slice(0, NAME_MAX);
          me.image = typeof p.image === "string" && /^data:image\//.test(p.image) ? p.image : "";
          me.email = typeof p.email === "string" ? p.email : "";
          me.imageSaved = Number(p.imageSaved) || 0;
          me.style = p.style === "image" && me.image ? "image" : (Number(p.style) >= 0 && Number(p.style) < AVATAR_STYLES ? Number(p.style) : 0);
          me.saved = true;
        }
        pidOf(id).then(function (pid) { me.pid = pid; resolve(); }, function () { resolve(); });
      });
    });
  });
}
// 這台裝置沒存過上榜資料、但排行榜上已經有自己（例如在另一台同步登入的裝置贊助過）→ 從榜上帶入名稱與頭像風格
function prefillFromBoard() {
  if (me.saved) return;
  var i = myIndex();
  if (i < 0) return;
  var it = board.items[i];
  me.name = it.name;
  if (Number(it.avatar.style) >= 0) me.style = Number(it.avatar.style);
  $("name").value = me.name;
  renderProfile();
}
function saveProfile() {
  me.saved = true;
  chrome.storage.local.set({ donateProfile: { name: me.name, style: me.style, image: me.image, email: me.email, imageSaved: me.imageSaved } });
}

// ---------------- 贊助表單：幣別、金額 ----------------
function currencyOf(country) {
  if (COUNTRY_CURRENCY[country]) return COUNTRY_CURRENCY[country];
  return EU.indexOf(country) >= 0 ? "EUR" : "USD";
}
function currencyName(code) {
  try { return new Intl.DisplayNames([uiLanguage()], { type: "currency" }).of(code) || code; } catch (e) { return code; }
}
function currencyEnName(code) {
  try { return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) || code; } catch (e) { return code; }
}
function currencyLabel(code) { return currencyName(code) + "（" + CURRENCIES[code].sym.trim() + "）"; }
// 選單順序：CURRENCY_ORDER，其餘照代碼 A–Z
function currencyCodes() {
  var rest = Object.keys(CURRENCIES).filter(function (c) { return CURRENCY_ORDER.indexOf(c) < 0; }).sort();
  return CURRENCY_ORDER.filter(function (c) { return CURRENCIES[c]; }).concat(rest);
}
// 搜尋：代碼、介面語言的幣別名稱、英文名稱、符號，不分大小寫
function currencyMatches(q) {
  q = String(q || "").trim().toLowerCase();
  return currencyCodes().filter(function (code) {
    return !q || [code, currencyName(code), currencyEnName(code), CURRENCIES[code].sym].some(function (s) { return String(s).toLowerCase().indexOf(q) >= 0; });
  });
}
// 可搜尋的幣別選單（按鈕＋下拉面板：搜尋框、清單）。上下鍵移動、Enter 選、Esc 關；選到的值寫回隱藏的 #currency
var curActive = -1;
function renderCurList() {
  var list = $("curList");
  list.textContent = "";
  var codes = currencyMatches($("curSearch").value);
  if (!codes.length) { list.appendChild(el("li", "curNone", t("donateCurrencyNone"))); curActive = -1; return; }
  curActive = Math.max(0, Math.min(curActive, codes.length - 1));
  codes.forEach(function (code, i) {
    var li = el("li", "curOpt" + (code === currency ? " on" : "") + (i === curActive ? " active" : ""));
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", code === currency ? "true" : "false");
    li.appendChild(el("span", "curName", currencyName(code)));
    li.appendChild(el("span", "curCode", code + " · " + CURRENCIES[code].sym.trim()));
    // mousedown 先選，不讓搜尋框失去焦點
    li.addEventListener("mousedown", function (e) { e.preventDefault(); pickCurrency(code); });
    list.appendChild(li);
  });
  var act = list.children[curActive];
  if (act && act.scrollIntoView) act.scrollIntoView({ block: "nearest" });
}
function openCurrency() {
  $("curPanel").classList.remove("hidden");
  $("curBtn").setAttribute("aria-expanded", "true");
  $("curSearch").value = "";
  curActive = currencyMatches("").indexOf(currency);
  renderCurList();
  $("curSearch").focus();
}
function closeCurrency() {
  $("curPanel").classList.add("hidden");
  $("curBtn").setAttribute("aria-expanded", "false");
}
function pickCurrency(code) {
  closeCurrency();
  $("curBtn").focus();
  if (code !== currency) setCurrency(code, true);
}
function buildCurrencySelect() {
  $("curSearch").placeholder = t("donateCurrencySearch");
  $("curBtn").addEventListener("click", function () {
    if ($("curPanel").classList.contains("hidden")) openCurrency(); else closeCurrency();
  });
  $("curSearch").addEventListener("input", function () { curActive = 0; renderCurList(); });
  $("curSearch").addEventListener("keydown", function (e) {
    var codes = currencyMatches(this.value);
    if (e.key === "ArrowDown") { e.preventDefault(); curActive = Math.min(codes.length - 1, curActive + 1); renderCurList(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); curActive = Math.max(0, curActive - 1); renderCurList(); }
    else if (e.key === "Enter") { e.preventDefault(); if (codes[curActive]) pickCurrency(codes[curActive]); }
    else if (e.key === "Escape") { e.preventDefault(); closeCurrency(); $("curBtn").focus(); }
  });
  // 點外面或 Tab 離開就收起來
  document.addEventListener("mousedown", function (e) { if (!$("curPick").contains(e.target)) closeCurrency(); });
  $("curPick").addEventListener("focusout", function (e) { if (e.relatedTarget && !$("curPick").contains(e.relatedTarget)) closeCurrency(); });
}
var selectedCups = 1;
function setCurrency(code, keepAmount) {
  var oldUsd = keepAmount ? toUsd(amountValue() || 0, currency) : 0;
  currency = code;
  $("currency").value = code;
  $("curBtnText").textContent = currencyLabel(code);
  $("curSym").textContent = CURRENCIES[code].sym;
  renderMethods();
  $("amount").step = CURRENCIES[code].dec ? "0.01" : "1";
  $("amount").placeholder = fill(t("donateAmountPlaceholder"), { min: fmtMoney(CURRENCIES[code].min, code) });
  renderCups();
  renderMe();
  // 換幣別時：選了幾杯咖啡就照杯數換；自訂金額就換算成新幣別
  if (selectedCups) setAmount(CURRENCIES[code].cup * selectedCups, selectedCups);
  else if (oldUsd > 0) setAmount(fromUsd(oldUsd, code));
  else setAmount(CURRENCIES[code].cup, 1);
}
function renderCups() {
  var box = $("cups");
  box.textContent = "";
  CUPS.forEach(function (n) {
    var b = el("button", "cup" + (selectedCups === n ? " on" : ""));
    b.type = "button";
    var ic = el("span", "ic"); ic.appendChild(img(CUP_SVG, "cupIcon")); b.appendChild(ic);
    b.appendChild(el("span", "lb", fill(t("donateCups"), { n: n })));
    b.appendChild(el("span", "pr", fmtMoney(CURRENCIES[currency].cup * n, currency)));
    b.addEventListener("click", function () { setAmount(CURRENCIES[currency].cup * n, n); });
    box.appendChild(b);
  });
}
function amountValue() { var v = parseFloat($("amount").value); return isFinite(v) ? v : 0; }
function setAmount(v, cups) {
  selectedCups = cups || 0;
  $("amount").value = String(v);
  Array.prototype.forEach.call($("cups").children, function (b, i) { b.classList.toggle("on", CUPS[i] === selectedCups); });
  onAmountChange();
}
$("amount").addEventListener("input", function () {
  var v = amountValue(), hit = 0;
  CUPS.forEach(function (n) { if (v === CURRENCIES[currency].cup * n) hit = n; });
  selectedCups = hit;
  Array.prototype.forEach.call($("cups").children, function (b, i) { b.classList.toggle("on", CUPS[i] === hit); });
  onAmountChange();
});
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emailError() { return providerOf(currency) === "ecpay" && me.email && !EMAIL_RE.test(me.email) ? "donateEmailBad" : ""; }
$("email").addEventListener("input", function () {
  me.email = this.value.trim();
  saveProfile();
  $("emailErr").textContent = emailError() ? t("donateEmailBad") : "";
  onAmountChange();
});
// 金額檢查：回傳錯誤訊息的 key，沒問題回 ""
function amountError() {
  var v = amountValue(), c = CURRENCIES[currency];
  if (!(v > 0)) return "donateAmountEmpty";
  if (v < c.min) return "donateAmountMin";
  if (toUsd(v, currency) > MAX_USD) return "donateAmountMax";
  var f = Math.pow(10, c.dec);
  if (Math.abs(Math.round(v * f) - v * f) > 1e-6) return "donateAmountDecimals";
  return "";
}
function renderAmountHint() {
  var hint = $("amountHint"), err = amountError(), c = CURRENCIES[currency];
  hint.classList.toggle("err", !!err && err !== "donateAmountEmpty");
  var v = { min: fmtMoney(c.min, currency), max: fmtUsd(MAX_USD), dec: c.dec };
  if (err) { setRichText(hint, fill(t(err), v)); return; }
  var usd = toUsd(amountValue(), currency);
  v.usd = fmtUsd(usd);
  v.rank = board.loaded ? projectedRank(usd) : "?";
  v.min = fmtMoney(c.min, currency);
  setRichText(hint, fill(t(currency === "USD" ? "donateAmountOkUsd" : "donateAmountOk"), v));
}
function onAmountChange() {
  renderAmountHint();
  renderPreview();
  var err = amountError();
  $("payBtn").disabled = !!err || !!emailError();
  setCupText($("payBtn"), err ? t("donatePayBtnIdle") : fill(t("donatePayBtn"), { amount: fmtMoney(amountValue(), currency) }));
}
function renderMethods() {
  var box = $("methods");
  box.textContent = "";
  var provider = providerOf(currency);
  (provider === "ecpay" ? METHODS.ecpay : METHODS.ALL.concat(METHODS[currency] || [])).forEach(function (m) {
    box.appendChild(el("span", "method", METHOD_KEYS[m] ? (m === "cvs" ? "🏪 " : "💳 ") + t(METHOD_KEYS[m]) : METHOD_LABELS[m]));
  });
  $("methodsNote").textContent = t(provider === "ecpay" ? "donateMethodsNoteTw" : "donateMethodsNote");
  // 綠界的付款通知不給 email：選新台幣時讓使用者選填，用來把換電腦後的贊助合併成同一個人（Stripe 付款頁本來就會收 email）
  $("emailBox").classList.toggle("hidden", provider !== "ecpay");
}

// ---------------- 上榜名稱與頭像 ----------------
function renderProfile() {
  var box = $("avatars");
  box.textContent = "";
  for (var s = 0; s < AVATAR_STYLES; s++) (function (s) {
    var b = el("button", "avBtn" + (me.style === s ? " on" : ""));
    b.type = "button";
    b.setAttribute("aria-label", fill(t("donateAvatarStyle"), { n: s + 1 }));
    b.appendChild(img(avatarSvg(me.name, s)));
    b.addEventListener("click", function () { me.style = s; saveProfile(); renderProfile(); });
    box.appendChild(b);
  })(s);
  if (me.image) {
    var mine = el("button", "avBtn" + (me.style === "image" ? " on" : ""));
    mine.type = "button";
    mine.setAttribute("aria-label", t("donateAvatarMine"));
    mine.appendChild(img(me.image));
    mine.addEventListener("click", function () { me.style = "image"; saveProfile(); renderProfile(); });
    box.appendChild(mine);
  }
  var up = el("button", "avBtn upload", t("donateAvatarUpload"));
  up.type = "button";
  up.addEventListener("click", function () { $("avatarFile").click(); });
  box.appendChild(up);
  $("nameCount").textContent = Array.from(me.name).length + " / " + NAME_MAX;
  renderPreview();
}
// 已經上榜的人：名稱、頭像改了之後按「更新排行榜上的名稱與頭像」才送出（不用再贊助一次）
function renderProfileSave() {
  // 只有本人的那一列能改（email 合併進來的別名不行，worker 也只認本人的 pid）
  var i = myIndex(), it = i >= 0 ? board.items[i] : null;
  var own = !!it && it.pid === me.pid;
  $("profileSave").classList.toggle("hidden", !own);
  if (!own) return;
  var av = it.avatar || {};
  var same = it.name === me.name && (me.style === "image" ? !!av.url && me.imageSaved === hashStr(me.image) : !av.url && Number(av.style) === me.style);
  $("profileSaveBtn").disabled = same;
  $("profileSaveBtn").textContent = t(same ? "donateProfileSaved" : "donateProfileSave");
}
$("profileSaveBtn").addEventListener("click", function () {
  var btn = this;
  btn.disabled = true;
  var done = function () {
    var it = board.items[myIndex()];
    it.name = me.name;
    it.avatar = me.style === "image" ? { url: me.image } : { style: me.style };
    if (me.style === "image") { me.imageSaved = hashStr(me.image); saveProfile(); }
    renderBoard();
  };
  if (MOCK !== null) { done(); return; }
  fetch(DONATE_API + "/v1/donors/profile", {
    method: "POST", credentials: "omit", headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ v: 1, donorId: me.donorId, name: me.name, avatar: me.style === "image" ? { image: me.image } : { style: me.style } })
  })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (!j || !j.ok) throw new Error("bad"); done(); })
    .catch(function () { btn.disabled = false; showNotice("donateProfileFailed"); });
});
function renderPreview() {
  renderProfileSave();
  var usd = amountError() ? 0 : toUsd(amountValue(), currency);
  var idx = myIndex(), total = myUsd() + usd;
  fillRow($("previewRow"), board.loaded ? projectedRank(usd) : null,
    { name: me.name, src: myAvatarSrc(), usd: total, count: (idx < 0 ? 0 : board.items[idx].count) + 1 }, true);
  // 下一個稱號還差多少（已經是最高稱號就不顯示）
  var next = null;
  for (var i = TIERS.length - 1; i >= 0; i--) if (TIERS[i].min > total) { next = TIERS[i]; break; }
  var box = $("nextTier");
  if (!next || !usd) { box.textContent = ""; return; }
  setRichText(box, fill(t("donateNextTier"), { gap: fmtMoney(fromUsd(next.min - total, currency), currency), tier: t(next.key) }));
}
// 稱號說明（贊助卡片選金額的下方）：一行一個稱號與門檻
function renderTierLegend() {
  var box = $("tierLegend");
  box.textContent = "";
  // 由低到高一行一個：稱號｜門檻（最低一級寫「< 下一級的門檻」）
  TIERS.slice().reverse().forEach(function (tr, i, list) {
    var item = el("span", "legendItem");
    item.appendChild(el("span", "tier " + tr.cls, t(tr.key)));
    item.appendChild(el("span", "min", tr.min ? fmtUsd(tr.min) + "+" : "< " + fmtUsd(list[i + 1].min)));
    box.appendChild(item);
  });
}
$("name").addEventListener("input", function () {
  var v = Array.from(this.value).slice(0, NAME_MAX).join("");
  if (v !== this.value) this.value = v;
  me.name = v.trim();
  saveProfile();
  renderProfile();
});
// 上傳頭像：縮成 AVATAR_PX 正方形（置中裁切），存成 webp（不支援的瀏覽器退回 jpeg）的 data URL
$("avatarFile").addEventListener("change", function () {
  var f = this.files && this.files[0];
  this.value = "";
  if (!f || !/^image\//.test(f.type)) return;
  var url = URL.createObjectURL(f);
  var im = new Image();
  im.onload = function () {
    var side = Math.min(im.naturalWidth, im.naturalHeight);
    var cv = document.createElement("canvas");
    cv.width = cv.height = AVATAR_PX;
    cv.getContext("2d").drawImage(im, (im.naturalWidth - side) / 2, (im.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
    URL.revokeObjectURL(url);
    var data = cv.toDataURL("image/webp", 0.85);
    if (data.indexOf("data:image/webp") !== 0) data = cv.toDataURL("image/jpeg", 0.85);
    me.image = data; me.style = "image";
    saveProfile();
    renderProfile();
  };
  im.onerror = function () { URL.revokeObjectURL(url); };
  im.src = url;
});

// ---------------- 聯絡作者 ----------------
// 按了才顯示 email（mailto 連結＋複製）
var CONTACT_EMAIL = "a0972199950@gmail.com";
$("contactBtn").addEventListener("click", function () {
  $("contactMail").href = "mailto:" + CONTACT_EMAIL;
  $("contactMail").textContent = CONTACT_EMAIL;
  $("contactBox").classList.remove("hidden");
  this.classList.add("hidden");
});
$("contactCopy").addEventListener("click", function () {
  var btn = this;
  navigator.clipboard.writeText(CONTACT_EMAIL).then(function () {
    btn.textContent = t("donateContactCopied");
    setTimeout(function () { btn.textContent = t("donateContactCopy"); }, 1500);
  });
});

// ---------------- 前往付款 ----------------
function showNotice(key, ok) {
  var n = $("payNotice");
  n.className = "notice" + (ok ? " ok" : "");
  n.textContent = t(key);
}
// 付款前記下目前的贊助次數（存 storage：感謝頁的「回到贊助頁」會開新的贊助頁，要靠它判斷付款有沒有進來）
var PENDING_MAX_AGE_MS = 60 * 60 * 1000;
function savePending(p) { chrome.storage.local.set({ donatePending: p }); }
function clearPending() { chrome.storage.local.remove("donatePending"); }
$("payBtn").addEventListener("click", function () {
  if (amountError()) return;
  saveProfile();
  var btn = this;
  btn.disabled = true;
  fetch(DONATE_API + "/v1/donate/checkout", {
    method: "POST", credentials: "omit", headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      v: 1, donorId: me.donorId, name: me.name, avatar: me.style === "image" ? { image: me.image } : { style: me.style },
      amount: amountValue(), currency: currency, lang: lang, browser: detectBrowser(), version: chrome.runtime.getManifest().version,
      email: providerOf(currency) === "ecpay" ? me.email : "",
      // 感謝頁的「回到贊助頁」連回這裡（manifest 的 web_accessible_resources 只開放給 worker 的網域）
      back: chrome.runtime.getURL("donate.html")
    })
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || !j.ok || !/^https:\/\//.test(j.url || "")) throw new Error("bad");
      openTab(j.url);
      showNotice("donateCheckoutOpened", true);
      awaitingPayment = { count: myIndex() < 0 ? 0 : board.items[myIndex()].count, at: Date.now() };
      savePending(awaitingPayment);
      // 付款成功後排行榜就是這張上傳的頭像
      if (me.style === "image") { me.imageSaved = hashStr(me.image); saveProfile(); }
    })
    .catch(function () { showNotice("donateCheckoutFailed"); })
    .then(function () { btn.disabled = false; });
});

// 付款頁在新分頁：使用者切回這一頁時，略過快取重抓排行榜（fresh），自己的次數變多了就恭喜並告訴他現在第幾名。
// Stripe 的付款通知（webhook）通常付款後幾秒才到，所以還沒看到就每 3 秒再抓一次，最多 10 次（約 30 秒）
var CONFIRM_TRIES = 10;
var CONFIRM_EVERY_MS = 3000;
var awaitingPayment = null;
var confirmTimer = 0;
function confirmPayment(triesLeft) {
  if (!awaitingPayment) return;
  var before = awaitingPayment;
  showNotice("donateConfirming", true);
  loadBoard(function (ok) {
    var i = myIndex();
    if (ok && i >= 0 && board.items[i].count > before.count) {
      awaitingPayment = null;
      clearPending();
      setRichText($("payNotice"), fill(t("donateThanks"), { rank: i + 1 }));
      $("payNotice").className = "notice ok";
      setTab("board");
      return;
    }
    if (triesLeft > 1) confirmTimer = setTimeout(function () { confirmPayment(triesLeft - 1); }, CONFIRM_EVERY_MS);
    else showNotice("donateConfirmSlow"); // 約 30 秒還沒收到 Stripe 的通知；切走再切回來會再確認一輪
  }, true);
}
function onBack() {
  if (!awaitingPayment || document.visibilityState === "hidden") return;
  clearTimeout(confirmTimer);
  confirmPayment(CONFIRM_TRIES);
}
// 切分頁回來只會觸發 visibilitychange，切視窗回來是 focus，兩個都聽
window.addEventListener("focus", onBack);
document.addEventListener("visibilitychange", onBack);

// ---------------- 啟動 ----------------
// 從感謝頁的「回到贊助頁」進來（donate.html?fresh=1）：略過快取讀排行榜，並接著確認付款；網址上的 fresh 先拿掉，重新整理時才不會再跑一次
// 感謝頁、取消頁的「回到贊助頁」會在付款那個分頁開一個新的贊助頁（?fresh=1：付款完成；?cancel=1：取消）。
// 付款前的贊助頁通常還開著：用 BroadcastChannel 找它，找到就切回那個分頁、把這個新開的關掉，畫面才不會有兩個贊助頁；
// 原本的分頁一被切回來就會照 onBack 確認付款。沒找到（已經關掉了）才在這一頁自己確認。網址上的參數先拿掉，重新整理時不會再跑一次
var pageParams = new URLSearchParams(location.search);
var RETURN = pageParams.has("fresh") ? "paid" : pageParams.has("cancel") ? "cancel" : "";
if (RETURN) {
  pageParams.delete("fresh");
  pageParams.delete("cancel");
  var rest = pageParams.toString();
  history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
}
var PAGE_ID = Math.random().toString(36).slice(2);
var HANDOFF_WAIT_MS = 400;
var donateChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("bcs-donate") : null;
if (donateChannel) donateChannel.onmessage = function (e) {
  var m = e.data || {};
  if (m.type !== "returned" || m.from === PAGE_ID) return;
  // 付款取消了：不用再等這筆
  if (m.cancel) { awaitingPayment = null; clearTimeout(confirmTimer); $("payNotice").className = "notice hidden"; }
  var reply = function () {
    chrome.tabs.getCurrent(function (tab) { if (tab) donateChannel.postMessage({ type: "here", to: m.from, tabId: tab.id, windowId: tab.windowId }); });
  };
  if (m.cancel || awaitingPayment) { reply(); return; }
  // 付款後這一頁被重新整理過（記憶體裡的 awaitingPayment 沒了）：從 storage 接回來，切回這裡時照樣確認
  chrome.storage.local.get({ donatePending: null }, function (s) {
    var p = s.donatePending;
    if (p && Date.now() - Number(p.at || 0) < PENDING_MAX_AGE_MS) awaitingPayment = { count: Number(p.count) || 0, at: p.at };
    reply();
  });
};
// 找付款前開著的贊助頁，找到回 true（已經切過去並關掉自己）
function handOff(cancel, done) {
  if (!donateChannel) { done(false); return; }
  var found = false;
  var listener = function (e) {
    var m = e.data || {};
    if (m.type !== "here" || m.to !== PAGE_ID || found) return;
    found = true;
    chrome.windows.update(m.windowId, { focused: true });
    chrome.tabs.update(m.tabId, { active: true }, function () {
      chrome.tabs.getCurrent(function (tab) { if (tab) chrome.tabs.remove(tab.id); });
    });
  };
  donateChannel.addEventListener("message", listener);
  donateChannel.postMessage({ type: "returned", from: PAGE_ID, cancel: cancel });
  setTimeout(function () { donateChannel.removeEventListener("message", listener); done(found); }, HANDOFF_WAIT_MS);
}
function firstLoad() {
  if (!RETURN) { loadBoard(); return; }
  if (RETURN === "cancel") clearPending();
  handOff(RETURN === "cancel", function (found) {
    if (found) return;
    if (RETURN === "cancel") { loadBoard(); return; }
    chrome.storage.local.get({ donatePending: null }, function (s) {
      var p = s.donatePending;
      if (p && Date.now() - Number(p.at || 0) < PENDING_MAX_AGE_MS) {
        awaitingPayment = { count: Number(p.count) || 0, at: p.at };
        confirmPayment(CONFIRM_TRIES);
      } else loadBoard(null, true);
    });
  });
}
if (MOCK !== null) document.body.appendChild(el("div", "mockBadge", "MOCK DATA"));
else apiReady.then(function () { if (DONATE_API === DONATE_API_STAGING) document.body.appendChild(el("div", "mockBadge", "SANDBOX")); });
buildCurrencySelect();
renderTierLegend();
chrome.storage.local.get({ detectedCountry: "" }, function (s) {
  setCurrency(currencyOf(s.detectedCountry), false);
  loadIdentity().then(function () {
    $("name").value = me.name;
    $("email").value = me.email;
    renderProfile();
    firstLoad();
  });
});

// Test seam: only the unit-test harness (test/helpers/load.mjs) defines __BCS_TEST__.
if (globalThis.__BCS_TEST__ && typeof globalThis.__BCS_TEST__.register === "function") {
  globalThis.__BCS_TEST__.register("donate", {
    CURRENCIES: CURRENCIES, CURRENCY_ORDER: CURRENCY_ORDER, currencyCodes: currencyCodes, currencyMatches: currencyMatches, avatarSvg: avatarSvg, fromUsd: fromUsd, tierOf: tierOf, currencyOf: currencyOf, projectedRank: projectedRank,
    amountError: amountError, setAmount: setAmount, setCurrency: setCurrency, fmtMoney: fmtMoney, renderMe: renderMe, board: board, me: me
  });
}
