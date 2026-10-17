// 抽獎說明文字：依抽獎的 metadata（report worker GET /v1/lotteries 的一筆）組出各語言的文字。
// popup 的跑馬燈（label + line）與公告視窗 announcement.html 的抽獎公告（title、eligible、period、prize、draw）共用。
// 測速 exe 有自己的一份（tools/cdn-speedtest-app/lottery_text.py），範本表 TEXT 兩邊要一起改；
// 國家名稱兩邊共用同一張對照表（COUNTRY）；表裡沒有的國家這裡才用瀏覽器的 Intl.DisplayNames。
//
// metadata：{ title: "…"（跑馬燈捲動的那段）, country: "TW", prize: { amount: 200, currency: "TWD", giftCards: ["7-11 禮物卡", ...] }, winners: 3,
//             isps: ["台灣大寬頻", ...]（空的＝該國所有使用者）, drawDays: 7,
//             startDate: "2026-10-01", endDate: "2026-10-30", drawBy: "2026-11-06" }
// v2（/v2/*）的禮物卡各自有面額：prize: { currency: "HKD", giftCards: [{ name: "7-Eleven 電子現金券", amount: 100 }, ...] }（沒有 prize.amount）；
// 面額不同時金額寫成範圍（HK$100–150），獎品那行每張卡後面附面額。title 是 { 語言: 文字 }（依介面語言 → en → zh-TW → 任一 取一種）。兩種格式都吃。
// 禮物卡與寬頻業者名稱只用舉辦國家的語言（參加者都在那個國家），其餘文字依介面語言。
(function () {
  "use strict";
  var LANGS = ["zh-TW", "zh-CN", "en", "ja", "ko"];
  // 國家名稱（順序同 LANGS）：與 lottery_text.py 的 COUNTRY 相同，兩邊要一起改；表裡沒有的國家才用瀏覽器的 Intl 名稱
  // （Intl 的寫法各瀏覽器版本不一定相同，例如英文的美國會變成「US」）
  var COUNTRY = {
    TW: ["台灣", "台湾", "Taiwan", "台湾", "대만"],
    HK: ["香港", "香港", "Hong Kong", "香港", "홍콩"],
    MO: ["澳門", "澳门", "Macao", "マカオ", "마카오"],
    SG: ["新加坡", "新加坡", "Singapore", "シンガポール", "싱가포르"],
    MY: ["馬來西亞", "马来西亚", "Malaysia", "マレーシア", "말레이시아"],
    JP: ["日本", "日本", "Japan", "日本", "일본"],
    KR: ["南韓", "韩国", "South Korea", "韓国", "대한민국"],
    TH: ["泰國", "泰国", "Thailand", "タイ", "태국"],
    VN: ["越南", "越南", "Vietnam", "ベトナム", "베트남"],
    ID: ["印尼", "印度尼西亚", "Indonesia", "インドネシア", "인도네시아"],
    PH: ["菲律賓", "菲律宾", "Philippines", "フィリピン", "필리핀"],
    US: ["美國", "美国", "United States", "アメリカ合衆国", "미국"],
    CA: ["加拿大", "加拿大", "Canada", "カナダ", "캐나다"],
    GB: ["英國", "英国", "United Kingdom", "イギリス", "영국"],
    AU: ["澳洲", "澳大利亚", "Australia", "オーストラリア", "오스트레일리아"],
    NZ: ["紐西蘭", "新西兰", "New Zealand", "ニュージーランド", "뉴질랜드"],
    DE: ["德國", "德国", "Germany", "ドイツ", "독일"],
    FR: ["法國", "法国", "France", "フランス", "프랑스"]
  };
  var CURRENCY = { TWD: "NT$", HKD: "HK$", MOP: "MOP$", SGD: "S$", MYR: "RM", JPY: "¥", KRW: "₩", THB: "฿",
    PHP: "₱", IDR: "Rp", VND: "₫", USD: "US$", CAD: "C$", AUD: "A$", NZD: "NZ$", GBP: "£", EUR: "€", CNY: "CN¥" };
  var ISP_SEP = { "zh-TW": "／", "zh-CN": "／", en: ", ", ja: "・", ko: ", " };
  var LIST_SEP = { "zh-TW": "、", "zh-CN": "、", en: ", ", ja: "、", ko: ", " };
  var OR = { "zh-TW": "或", "zh-CN": "或", en: " or ", ja: "または", ko: " 또는 " };
  // 獎品那行的禮物卡清單「A／B（自選）」：分隔與多種時加在後面的「自選」
  var CARD_SEP = { "zh-TW": "／", "zh-CN": "／", en: " / ", ja: "／", ko: " / " };
  var CHOICE = { "zh-TW": "（自選）", "zh-CN": "（自选）", en: " (your choice)", ja: "（選択可）", ko: "(선택)" };
  // 順序同 LANGS；與 lottery_text.py 的 TEXT 相同（how 例外：見 _locales 的 lotteryWinHow）
  var TEXT = {
    label: ["{amount} 抽獎:", "{amount} 抽奖:", "{amount} draw:", "{amount} 抽選:", "{amount} 추첨:"],
    who_isps: ["{isps} 用戶", "{isps} 用户", "{isps} users", "{isps} をご利用の方", "{isps} 사용자"],
    who_country: ["{country}用戶", "{country}用户", "Users in {country}", "{country}在住の方", "{country} 사용자"],
    line: ["{who}在 {end} 前完成測速，抽 {n} 名 {cards}",
      "{who}在 {end} 前完成测速，抽 {n} 名 {cards}",
      "{who}: finish the speed test by {end} to enter the draw for a gift card ({cards}), winners: {n}",
      "{who}は {end} までに速度テストを完了すると、{n} 名にギフトカード（{cards}）が当たります",
      "{who}는 {end}까지 속도 테스트를 마치면 {n}명에게 기프트 카드({cards})를 드려요"],
    title: ["{country}限定：{amount} 禮物卡 × {n} 名", "{country}限定：{amount} 礼品卡 × {n} 名",
      "{country} only: {amount} gift cards, winners: {n}", "{country}限定：{amount} ギフトカード × {n} 名",
      "{country} 한정: {amount} 기프트 카드 × {n}명"],
    eligible_isps: ["參加資格：以下寬頻用戶", "参加资格：以下宽带用户",
      "Who can join: users of the following broadband providers", "対象：以下のブロードバンドをご利用の方",
      "참여 대상: 다음 인터넷 서비스 사용자"],
    eligible_all: ["參加資格：{country}的網路用戶", "参加资格：{country}的网络用户", "Who can join: anyone in {country}",
      "対象：{country}在住の方", "참여 대상: {country}의 모든 사용자"],
    period: ["活動期間：{start} – {end}", "活动期间：{start} – {end}", "When: {start} – {end}", "期間：{start}～{end}",
      "기간: {start} ~ {end}"],
    prize: ["獎品價值：{amount} 的 {prizeCards}", "奖品价值：{amount} 的 {prizeCards}",
      "Prize value: {amount} — {prizeCards}",
      "賞品の価値：{amount} の {prizeCards}", "경품 가치: {amount} 상당의 {prizeCards}"],
    // 禮物卡面額不同時（v2）：{prizeCards} 是「A HK$100／B HK$150（自選）」
    prize_each: ["獎品：{prizeCards}", "奖品：{prizeCards}", "Prize: {prizeCards}", "賞品：{prizeCards}", "경품: {prizeCards}"],
    draw: ["活動結束後 {days} 日內（{drawBy} 前）抽出 {n} 名符合資格的參加者，以 email 通知",
      "活动结束后 {days} 日内（{drawBy} 前）抽出 {n} 名符合资格的参加者，以 email 通知",
      "Winners ({n}) will be drawn from eligible participants within {days} days after the event ends (by {drawBy}) and notified by email",
      "終了後 {days} 日以内（{drawBy} まで）に条件を満たす参加者から {n} 名を抽選し、メールでお知らせします",
      "종료 후 {days}일 이내({drawBy}까지) 조건을 충족한 참여자 중 {n}명을 추첨해 이메일로 알려 드립니다"]
  };
  function numText(a) {
    a = Number(a);
    return a.toLocaleString("en-US", { minimumFractionDigits: a === Math.floor(a) ? 0 : 2, maximumFractionDigits: 2 });
  }
  // 金額；給 max（且不同於 a）時是範圍：HK$100–150、100–150 XXX
  function amountText(a, currency, max) {
    var cur = String(currency || "").toUpperCase();
    var num = numText(a) + (max != null && Number(max) !== Number(a) ? "–" + numText(max) : "");
    return CURRENCY[cur] ? CURRENCY[cur] + num : (num + " " + cur).trim();
  }
  // 禮物卡清單統一成 [{ name, amount }]：舊格式是字串陣列，面額都是 prize.amount
  function cardList(prize) {
    return (prize.giftCards || []).map(function (c) {
      return typeof c === "string" ? { name: c, amount: prize.amount } : { name: c && c.name, amount: c && c.amount };
    }).filter(function (c) { return c.name; });
  }
  function monthDay(d) {
    var p = String(d).split("-");
    return Number(p[1]) + "/" + Number(p[2]);
  }
  function joinOr(items, lang) {
    items = (items || []).filter(Boolean).map(String);
    if (items.length < 2) return items.join("");
    var sep = OR[lang];
    if ((lang === "zh-TW" || lang === "zh-CN" || lang === "ja") && /^[\x00-\x7f]/.test(items[items.length - 1])) sep += " "; // 「或 Apple」
    return items.slice(0, -1).join(LIST_SEP[lang]) + sep + items[items.length - 1];
  }
  function countryName(code, lang) {
    if (COUNTRY[code]) return COUNTRY[code][LANGS.indexOf(lang)];
    try { return new Intl.DisplayNames([lang], { type: "region", style: "short" }).of(code) || code; } catch (e) { return code; } // short：「香港」而不是「中國香港特別行政區」
  }
  // v1 的 title 是字串；v2 是 { 語言: 文字 }：介面語言 → en → zh-TW → 任一種
  function pickText(v, lang) {
    if (!v || typeof v !== "object") return v || "";
    var keys = [lang, "en", "zh-TW"].concat(Object.keys(v));
    for (var k = 0; k < keys.length; k++) if (v[keys[k]]) return String(v[keys[k]]);
    return "";
  }
  function fill(tpl, v) {
    return tpl.replace(/\{(\w+)\}/g, function (m, k) { return k in v ? String(v[k]) : m; });
  }

  // 回傳 { label（跑馬燈固定在最前面的「NT$200 抽獎：」）, line（跑馬燈捲動的那段：抽獎的 title；沒有 title 時用組出來的一句話）, line（跑馬燈的一句話）, title, eligible,
  //        ispList（限定業者時列在 eligible 下一行的業者名單，不限時是空字串）, period, prize, draw }
  function compose(meta, lang) {
    if (LANGS.indexOf(lang) === -1) lang = "en";
    var i = LANGS.indexOf(lang);
    var isps = (meta.isps || []).filter(Boolean);
    var list = cardList(meta.prize), cur = meta.prize.currency;
    var cards = list.map(function (c) { return String(c.name); });
    var amounts = list.map(function (c) { return Number(c.amount); });
    var lo = Math.min.apply(null, amounts), hi = Math.max.apply(null, amounts);
    var each = lo !== hi; // 面額不同：獎品那行每張卡附面額
    var prizeCards = each ? list.map(function (c) { return c.name + " " + amountText(c.amount, cur); }) : cards;
    var v = {
      amount: amountText(lo, cur, hi), n: meta.winners, country: countryName(meta.country, lang),
      isps: isps.join(ISP_SEP[lang]), cards: joinOr(cards, lang),
      prizeCards: prizeCards.join(CARD_SEP[lang]) + (cards.length > 1 ? CHOICE[lang] : ""),
      start: monthDay(meta.startDate), end: monthDay(meta.endDate), drawBy: monthDay(meta.drawBy),
      days: meta.drawDays == null ? 7 : meta.drawDays
    };
    function T(key) { return fill(TEXT[key][i], v); }
    v.who = isps.length ? T("who_isps") : T("who_country");
    return {
      label: T("label"), line: pickText(meta.title, lang) || T("line"), title: T("title"), eligible: isps.length ? T("eligible_isps") : T("eligible_all"),
      ispList: v.isps,
      period: T("period"), prize: T(each ? "prize_each" : "prize"), draw: T("draw")
    };
  }

  window.LotteryText = { compose: compose };
})();
