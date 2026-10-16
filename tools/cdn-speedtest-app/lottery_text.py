"""抽獎說明文字：依抽獎的 metadata（report worker GET /v1/lotteries 的一筆）組出各語言的文字，以及 exe 顯示用的 HTML。

- exe（app.py）的「測速目的」頁用它把抽獎畫成 HTML（tkinterweb 顯示）
- 本機 scripts/lottery.mjs 也呼叫它：`python lottery_text.py < meta.json` 印出 {語言: HTML}，寫進 lotteries.html 欄位，
  給還在透過 Apps Script 讀 html 的舊版 exe（1.7.0（含）以前）看
- 擴充有自己的一份（src/lottery-text.js），範本表 TEXT 兩邊要一起改

metadata：{ title: "…"（擴充跑馬燈捲動的那段）, country: "TW", prize: { amount: 200, currency: "TWD", giftCards: ["7-11 禮物卡", ...] }, winners: 3,
            isps: ["台灣大寬頻", ...]（空的＝該國所有使用者）, drawDays: 7,
            startDate: "2026-10-01", endDate: "2026-10-30", drawBy: "2026-11-06" }
禮物卡與寬頻業者名稱只用舉辦國家的語言（參加者都在那個國家），其餘文字依介面語言。
"""
import html as _html
import json
import sys

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
}


def _lang(lang):
    return lang if lang in LANGS else "en"


def amount_text(prize):
    a = float(prize["amount"])
    num = f"{a:,.0f}" if a == int(a) else f"{a:,.2f}"
    cur = (prize.get("currency") or "").upper()
    sym = CURRENCY.get(cur)
    return sym + num if sym else f"{num} {cur}".strip()


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


def compose(meta, lang):
    """回傳 dict：label（跑馬燈固定的「NT$200 抽獎：」）、line（跑馬燈捲動的那段：抽獎的 title；沒有 title 時用組出來的一句話）、line（跑馬燈的一句話）、title、eligible、
    isp_list（限定業者時列在 eligible 下一行的業者名單，不限時是空字串）、period、prize、draw、how、doc_link"""
    lang = _lang(lang)
    i = LANGS.index(lang)
    isps = [x for x in (meta.get("isps") or []) if x]
    cards = [str(x) for x in (meta["prize"].get("giftCards") or []) if x]
    v = dict(amount=amount_text(meta["prize"]), n=meta["winners"],
             country=(COUNTRY.get(meta["country"]) or [meta["country"]] * 5)[i],
             isps=ISP_SEP[lang].join(isps), cards=join_or(cards, lang),
             prizeCards=CARD_SEP[lang].join(cards) + (CHOICE[lang] if len(cards) > 1 else ""),
             start=month_day(meta["startDate"]), end=month_day(meta["endDate"]), drawBy=month_day(meta["drawBy"]),
             days=meta.get("drawDays", 7))

    def T(key):
        return TEXT[key][i].format(**v)

    v["who"] = T("who_isps") if isps else T("who_country")
    out = {k: T(k) for k in ("label", "line", "title", "period", "prize", "draw", "how", "doc_link")}
    if meta.get("title"):   # exe 沒有跑馬燈，留著讓兩份 compose 結果一致
        out["line"] = meta["title"]
    out["eligible"] = T("eligible_isps") if isps else T("eligible_all")
    out["isp_list"] = v["isps"]
    return out


def to_html(meta, lang, doc_url=DOC_URL):
    """exe（tkinterweb）顯示用的 HTML：標題＋資格（＋業者名單）／期間／獎品／抽獎方式＋參加方式與教學連結"""
    s = {k: _html.escape(str(x)) for k, x in compose(meta, lang).items()}
    p = '<p style="margin:0 0 4px">{}</p>'
    isp = '<p style="margin:0 0 4px 1.5em">{}</p>'.format(s["isp_list"]) if s["isp_list"] else ""
    return ('<h3 style="margin:0 0 4px;color:#E85C86">' + s["title"] + "</h3>"
            + p.format(s["eligible"]) + isp
            + "".join(p.format(s[k]) for k in ("period", "prize", "draw"))
            + '<p style="margin:0">' + s["how"] + ' <a href="' + _html.escape(doc_url) + '">' + s["doc_link"] + "</a></p>")


if __name__ == "__main__":
    # scripts/lottery.mjs：stdin 給 metadata JSON，stdout 印出 {語言: HTML}
    sys.stdout.reconfigure(encoding="utf-8")
    meta = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    print(json.dumps({lang: to_html(meta, lang) for lang in LANGS}, ensure_ascii=False))
