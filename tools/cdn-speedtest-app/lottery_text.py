"""抽獎說明文字：依抽獎的 metadata（report worker GET /v1/lotteries 的一筆）組出各語言的文字，以及 exe 顯示用的 HTML。

- exe（app.py）的「測速目的」頁用它把抽獎畫成 HTML（tkinterweb 顯示）
- 本機 scripts/lottery.mjs 也呼叫它：`python lottery_text.py < meta.json` 印出 {語言: HTML}，寫進 lotteries.html 欄位，
  給還在透過 Apps Script 讀 html 的舊版 exe（1.7.0（含）以前）看
- 擴充有自己的一份（src/lottery-text.js），範本表 TEXT 兩邊要一起改

metadata：{ title: "…"（擴充跑馬燈捲動的那段）, country: "TW", prize: { amount: 200, currency: "TWD", giftCards: ["7-11 禮物卡", ...] }, winners: 3,
            isps: ["台灣大寬頻", ...]（空的＝該國所有使用者）, drawDays: 7,
            startDate: "2026-10-01", endDate: "2026-10-30", drawBy: "2026-11-06" }
v2（/v2/lotteries）的禮物卡各自有面額：prize: { currency: "HKD", giftCards: [{ name, amount }, ...] }（沒有 prize.amount）；
面額不同時金額寫成範圍（HK$100–150），獎品那行每張卡後面附面額。title 是 {語言: 文字}（依介面語言 → en → zh-TW → 任一 取一種）。兩種格式都吃。
禮物卡與寬頻業者名稱只用舉辦國家的語言（參加者都在那個國家），其餘文字依介面語言。
"""
import html as _html
import json
import sys
from html.parser import HTMLParser

DOC_URL = "https://lazy-cv.com/docs/bilibili-cdn-speedtest"
LANGS = ["zh-TW", "zh-CN", "en", "ja", "ko"]

# 幣別 → 金額前綴（沒有的就寫成「200 XXX」）
CURRENCY = {"TWD": "NT$", "HKD": "HK$", "MOP": "MOP$", "SGD": "S$", "MYR": "RM", "JPY": "¥", "KRW": "₩", "THB": "฿",
            "PHP": "₱", "IDR": "Rp", "VND": "₫", "USD": "US$", "CAD": "C$", "AUD": "A$", "NZD": "NZ$", "GBP": "£",
            "EUR": "€", "CNY": "CN¥"}

# 國家名稱（src/lottery-text.js 有同一張表，兩邊要一起改；表裡沒有的國家：exe 顯示代碼，擴充用瀏覽器的 Intl 名稱）
COUNTRY = {
    "TW": ("台灣", "台湾", "Taiwan", "台湾", "대만"),
    "HK": ("香港", "香港", "Hong Kong", "香港", "홍콩"),
    "MO": ("澳門", "澳门", "Macao", "マカオ", "마카오"),
    "SG": ("新加坡", "新加坡", "Singapore", "シンガポール", "싱가포르"),
    "MY": ("馬來西亞", "马来西亚", "Malaysia", "マレーシア", "말레이시아"),
    "JP": ("日本", "日本", "Japan", "日本", "일본"),
    "KR": ("南韓", "韩国", "South Korea", "韓国", "대한민국"),
    "TH": ("泰國", "泰国", "Thailand", "タイ", "태국"),
    "VN": ("越南", "越南", "Vietnam", "ベトナム", "베트남"),
    "ID": ("印尼", "印度尼西亚", "Indonesia", "インドネシア", "인도네시아"),
    "PH": ("菲律賓", "菲律宾", "Philippines", "フィリピン", "필리핀"),
    "US": ("美國", "美国", "United States", "アメリカ合衆国", "미국"),
    "CA": ("加拿大", "加拿大", "Canada", "カナダ", "캐나다"),
    "GB": ("英國", "英国", "United Kingdom", "イギリス", "영국"),
    "AU": ("澳洲", "澳大利亚", "Australia", "オーストラリア", "오스트레일리아"),
    "NZ": ("紐西蘭", "新西兰", "New Zealand", "ニュージーランド", "뉴질랜드"),
    "DE": ("德國", "德国", "Germany", "ドイツ", "독일"),
    "FR": ("法國", "法国", "France", "フランス", "프랑스"),
}

# 寬頻業者之間的分隔、禮物卡「A、B 或 C」的列舉與「或」
ISP_SEP = {"zh-TW": "／", "zh-CN": "／", "en": ", ", "ja": "・", "ko": ", "}
LIST_SEP = {"zh-TW": "、", "zh-CN": "、", "en": ", ", "ja": "、", "ko": ", "}
OR = {"zh-TW": "或", "zh-CN": "或", "en": " or ", "ja": "または", "ko": " 또는 "}
# 獎品那行的禮物卡清單「A／B（自選）」：分隔與多種時加在後面的「自選」
CARD_SEP = {"zh-TW": "／", "zh-CN": "／", "en": " / ", "ja": "／", "ko": " / "}
CHOICE = {"zh-TW": "（自選）", "zh-CN": "（自选）", "en": " (your choice)", "ja": "（選択可）", "ko": "(선택)"}

# 範本（{amount} NT$200、{n} 名額、{country} 國名、{isps} 業者、{who} 誰可以參加、{cards} 禮物卡「A 或 B」、
#       {prizeCards} 禮物卡「A／B（自選）」、{start} {end} {drawBy} 月/日、{days}）
# ↓ 與 src/lottery-text.js 的 TEXT 相同（how 例外：exe 版說「選參加抽獎」，擴充版多了「下載測速工具」）
TEXT = {
    "label": ("{amount} 抽獎:", "{amount} 抽奖:", "{amount} draw:", "{amount} 抽選:", "{amount} 추첨:"),
    "who_isps": ("{isps} 用戶", "{isps} 用户", "{isps} users", "{isps} をご利用の方", "{isps} 사용자"),
    "who_country": ("{country}用戶", "{country}用户", "Users in {country}", "{country}在住の方", "{country} 사용자"),
    "line": ("{who}在 {end} 前完成測速，抽 {n} 名 {cards}",
             "{who}在 {end} 前完成测速，抽 {n} 名 {cards}",
             "{who}: finish the speed test by {end} to enter the draw for a gift card ({cards}), winners: {n}",
             "{who}は {end} までに速度テストを完了すると、{n} 名にギフトカード（{cards}）が当たります",
             "{who}는 {end}까지 속도 테스트를 마치면 {n}명에게 기프트 카드({cards})를 드려요"),
    "title": ("{country}限定：{amount} 禮物卡 × {n} 名", "{country}限定：{amount} 礼品卡 × {n} 名",
              "{country} only: {amount} gift cards, winners: {n}", "{country}限定：{amount} ギフトカード × {n} 名",
              "{country} 한정: {amount} 기프트 카드 × {n}명"),
    "eligible_isps": ("參加資格：以下寬頻用戶", "参加资格：以下宽带用户",
                      "Who can join: users of the following broadband providers", "対象：以下のブロードバンドをご利用の方",
                      "참여 대상: 다음 인터넷 서비스 사용자"),
    "eligible_all": ("參加資格：{country}的網路用戶", "参加资格：{country}的网络用户", "Who can join: anyone in {country}",
                     "対象：{country}在住の方", "참여 대상: {country}의 모든 사용자"),
    "period": ("活動期間：{start} – {end}", "活动期间：{start} – {end}", "When: {start} – {end}", "期間：{start}～{end}",
               "기간: {start} ~ {end}"),
    "prize": ("獎品價值：{amount} 的 {prizeCards}", "奖品价值：{amount} 的 {prizeCards}",
              "Prize value: {amount} — {prizeCards}",
              "賞品の価値：{amount} の {prizeCards}", "경품 가치: {amount} 상당의 {prizeCards}"),
    # 禮物卡面額不同時（v2）：{prizeCards} 是「A HK$100／B HK$150（自選）」
    "prize_each": ("獎品：{prizeCards}", "奖品：{prizeCards}", "Prize: {prizeCards}", "賞品：{prizeCards}", "경품: {prizeCards}"),
    "draw": ("活動結束後 {days} 日內（{drawBy} 前）抽出 {n} 名符合資格的參加者，以 email 通知",
             "活动结束后 {days} 日内（{drawBy} 前）抽出 {n} 名符合资格的参加者，以 email 通知",
             "Winners ({n}) will be drawn from eligible participants within {days} days after the event ends (by {drawBy}) and notified by email",
             "終了後 {days} 日以内（{drawBy} まで）に条件を満たす参加者から {n} 名を抽選し、メールでお知らせします",
             "종료 후 {days}일 이내({drawBy}까지) 조건을 충족한 참여자 중 {n}명을 추첨해 이메일로 알려 드립니다"),
    "how": ("參加方式：選「參加抽獎」並留下 email，完成測速並發送報告。",
            "参加方式：选择“参加抽奖”并留下 email，完成测速并发送报告。",
            "How to join: choose \"Join the prize draw\", enter your email, finish the test and send the report.",
            "参加方法：「抽選に参加する」を選んでメールアドレスを入力し、テストを完了してレポートを送信してください。",
            "참여 방법: \"추첨에 참여\"를 선택하고 이메일을 입력한 뒤, 테스트를 마치고 보고서를 보내 주세요."),
    "doc_link": ("測速教學", "测速教程", "Guide", "使い方", "사용 방법"),
    # 抽獎 v2 的備註區塊標題（同擴充 _locales 的 lotteryNote）
    "note": ("備註", "备注", "Notes", "備考", "참고 사항"),
}

# 備註 HTML（後台寫的）依白名單重建：同擴充的 src/html-sanitize.js——只留排版標籤、不留屬性（https 連結的 href 例外），
# DROP 的標籤連內容一起丟（圖片也丟：載入外部圖片會把使用者的 IP 送出去），其他標籤拆掉外殼只留內容
KEEP_TAGS = {"h1", "h2", "h3", "h4", "p", "b", "strong", "i", "em", "u", "s", "small", "sub", "sup", "br", "hr",
             "ul", "ol", "li", "a", "span", "div", "code", "blockquote", "table", "thead", "tbody", "tr", "th", "td"}
DROP_TAGS = {"script", "style", "iframe", "frame", "object", "embed", "form", "input", "button", "select", "textarea",
             "template", "noscript", "svg", "math", "img", "picture", "video", "audio", "canvas", "link", "meta", "base",
             "title", "head"}
VOID_TAGS = {"br", "hr", "img", "input", "link", "meta", "base", "embed"}


class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.drop, self.stack = [], 0, []

    def handle_starttag(self, tag, attrs):
        if tag in DROP_TAGS:
            if tag not in VOID_TAGS:
                self.drop += 1
            return
        if self.drop:
            return
        href = dict(attrs).get("href") or "" if tag == "a" else ""
        keep = tag in KEEP_TAGS and (tag != "a" or href.lower().startswith("https://"))
        if tag not in VOID_TAGS:
            self.stack.append((tag, keep))
        if keep:
            self.out.append(f'<a href="{_html.escape(href)}">' if tag == "a" else f"<{tag}>")

    def handle_endtag(self, tag):
        if tag in DROP_TAGS:
            if tag not in VOID_TAGS and self.drop:
                self.drop -= 1
            return
        if self.drop or tag in VOID_TAGS or all(t != tag for t, _ in self.stack):
            return
        while self.stack:   # 關到對應的那一層（中間沒關的一起關）
            t, keep = self.stack.pop()
            if keep:
                self.out.append(f"</{t}>")
            if t == tag:
                break

    def handle_data(self, data):
        if not self.drop:
            self.out.append(_html.escape(data))

    def result(self):
        while self.stack:
            t, keep = self.stack.pop()
            if keep:
                self.out.append(f"</{t}>")
        return "".join(self.out)


def sanitize_html(html):
    p = _Sanitizer()
    p.feed(str(html or ""))
    p.close()
    return p.result()


def _lang(lang):
    return lang if lang in LANGS else "en"


def _num(a):
    a = float(a)
    return f"{a:,.0f}" if a == int(a) else f"{a:,.2f}"


def amount_text(a, currency, hi=None):
    """金額；給 hi（且不同於 a）時是範圍：HK$100–150、100–150 XXX"""
    num = _num(a) + (f"–{_num(hi)}" if hi is not None and float(hi) != float(a) else "")
    cur = (currency or "").upper()
    sym = CURRENCY.get(cur)
    return sym + num if sym else f"{num} {cur}".strip()


def card_list(prize):
    """禮物卡清單統一成 [{name, amount}]：舊格式是字串陣列，面額都是 prize.amount"""
    out = []
    for c in prize.get("giftCards") or []:
        c = {"name": c, "amount": prize.get("amount")} if isinstance(c, str) else c
        if c and c.get("name"):
            out.append({"name": str(c["name"]), "amount": float(c["amount"])})
    return out


def month_day(d):
    _, m, day = d.split("-")
    return f"{int(m)}/{int(day)}"


def join_or(items, lang):
    items = [str(x) for x in items if x]
    if len(items) < 2:
        return "".join(items)
    sep = OR[lang]
    if lang in ("zh-TW", "zh-CN", "ja") and items[-1][:1].isascii():   # 「或」後面接英數字時補空格：「或 Apple」
        sep += " "
    return LIST_SEP[lang].join(items[:-1]) + sep + items[-1]


def pick_text(v, lang):
    """v1 的 title 是字串；v2 是 {語言: 文字}：介面語言 → en → zh-TW → 任一種"""
    if not isinstance(v, dict):
        return v or ""
    for k in [lang, "en", "zh-TW", *v]:
        if v.get(k):
            return str(v[k])
    return ""


def compose(meta, lang):
    """回傳 dict：label（跑馬燈固定的「NT$200 抽獎：」）、line（跑馬燈捲動的那段：抽獎的 title；沒有 title 時用組出來的一句話）、line（跑馬燈的一句話）、title、eligible、
    isp_list（限定業者時列在 eligible 下一行的業者名單，不限時是空字串）、period、prize、draw、how、doc_link"""
    lang = _lang(lang)
    i = LANGS.index(lang)
    isps = [x for x in (meta.get("isps") or []) if x]
    prize = meta["prize"]
    cur = prize.get("currency")
    lst = card_list(prize)
    cards = [c["name"] for c in lst]
    lo, hi = min(c["amount"] for c in lst), max(c["amount"] for c in lst)
    each = lo != hi   # 面額不同：獎品那行每張卡附面額
    prize_cards = [f"{c['name']} {amount_text(c['amount'], cur)}" for c in lst] if each else cards
    v = dict(amount=amount_text(lo, cur, hi), n=meta["winners"],
             country=(COUNTRY.get(meta["country"]) or [meta["country"]] * 5)[i],
             isps=ISP_SEP[lang].join(isps), cards=join_or(cards, lang),
             prizeCards=CARD_SEP[lang].join(prize_cards) + (CHOICE[lang] if len(cards) > 1 else ""),
             start=month_day(meta["startDate"]), end=month_day(meta["endDate"]), drawBy=month_day(meta["drawBy"]),
             days=meta.get("drawDays", 7))

    def T(key):
        return TEXT[key][i].format(**v)

    v["who"] = T("who_isps") if isps else T("who_country")
    out = {k: T(k) for k in ("label", "line", "title", "period", "draw", "how", "doc_link")}
    out["prize"] = T("prize_each" if each else "prize")
    title = pick_text(meta.get("title"), lang)
    if title:   # exe 沒有跑馬燈，留著讓兩份 compose 結果一致
        out["line"] = title
    out["eligible"] = T("eligible_isps") if isps else T("eligible_all")
    out["isp_list"] = v["isps"]
    return out


def to_html(meta, lang, doc_url=DOC_URL):
    """exe（tkinterweb）顯示用的 HTML：標題＋資格（＋業者名單）／期間／獎品／抽獎方式＋參加方式與教學連結＋備註（v2，有填才有）"""
    s = {k: _html.escape(str(x)) for k, x in compose(meta, lang).items()}
    p = '<p style="margin:0 0 4px">{}</p>'
    isp = '<p style="margin:0 0 4px 1.5em">{}</p>'.format(s["isp_list"]) if s["isp_list"] else ""
    note = sanitize_html(pick_text(meta.get("note"), _lang(lang)))
    if note.strip():
        note = ('<div style="margin:8px 0 0;padding-top:4px;border-top:1px solid #F3B6C8">'
                '<p style="margin:0 0 2px;font-weight:bold">' + TEXT["note"][LANGS.index(_lang(lang))] + "</p>" + note + "</div>")
    else:
        note = ""
    return ('<h3 style="margin:0 0 4px;color:#E85C86">' + s["title"] + "</h3>"
            + p.format(s["eligible"]) + isp
            + "".join(p.format(s[k]) for k in ("period", "prize", "draw"))
            + '<p style="margin:0">' + s["how"] + ' <a href="' + _html.escape(doc_url) + '">' + s["doc_link"] + "</a></p>"
            + note)


if __name__ == "__main__":
    # scripts/lottery.mjs：stdin 給 metadata JSON，stdout 印出 {語言: HTML}
    sys.stdout.reconfigure(encoding="utf-8")
    meta = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    print(json.dumps({lang: to_html(meta, lang) for lang in LANGS}, ensure_ascii=False))
