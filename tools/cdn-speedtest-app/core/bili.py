# /cdn-speedtest 共用模組：B 站 API（含 WBI 簽名）、cookie、登入檢查、playurl、節點清單。
# 只用 Python 標準函式庫。cookie 絕不印出或寫入任何結果檔。
import json, os, time, hashlib, urllib.request, urllib.parse, urllib.error

SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
REF = "https://www.bilibili.com/"


def _cookie():
    """優先讀環境變數 BILI_COOKIE，否則讀目前工作目錄的 .env.local（BILI_COOKIE=...）"""
    c = os.environ.get("BILI_COOKIE", "").strip()
    if c:
        return c, "環境變數 BILI_COOKIE"
    p = os.path.join(os.getcwd(), ".env.local")
    try:
        for line in open(p, encoding="utf-8"):
            if line.startswith("BILI_COOKIE="):
                v = line.strip()[len("BILI_COOKIE="):].strip().strip('"').strip("'")
                if v:
                    return v, ".env.local"
    except OSError:
        pass
    return "", "無"


COOKIE, COOKIE_SRC = _cookie()


def api(url, retry=3):
    h = {"User-Agent": UA, "Referer": REF}
    if COOKIE:
        h["Cookie"] = COOKIE
    for i in range(retry):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=15))
        except urllib.error.HTTPError as e:
            if e.code != 412 or i == retry - 1:
                raise
            time.sleep(5 * (i + 1))  # 412 = 風控，稍等再試


_MIX = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39,
        12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
        57, 62, 11, 36, 20, 34, 44, 52]
_nav = None
_mixin = None


def nav():
    global _nav
    if _nav is None:
        _nav = api("https://api.bilibili.com/x/web-interface/nav")
    return _nav


def login_status():
    """回傳 dict(login, vip, cookie_src)；不含帳號名稱等個資"""
    try:
        d = nav().get("data") or {}
        return dict(login=bool(d.get("isLogin")), vip=bool((d.get("vipStatus") or 0) == 1), cookie_src=COOKIE_SRC)
    except Exception as e:
        return dict(login=False, vip=False, cookie_src=COOKIE_SRC, err=str(e)[:80])


def wbi(base, params):
    global _mixin
    if _mixin is None:
        n = nav()["data"]["wbi_img"]
        raw = n["img_url"].rsplit("/", 1)[1].split(".")[0] + n["sub_url"].rsplit("/", 1)[1].split(".")[0]
        _mixin = "".join(raw[i] for i in _MIX)[:32]
    params = dict(params, wts=int(time.time()))
    q = urllib.parse.urlencode(sorted(params.items()))
    return base + "?" + q + "&w_rid=" + hashlib.md5((q + _mixin).encode()).hexdigest()


def view(bvid):
    return api(f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}")["data"]


def dash_streams(bvid, cid):
    """playurl 的 dash 影像串流 [{id(qn), codecid, baseUrl, backupUrl, ...}]"""
    d = api(f"https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&fnval=4048&fourk=1&qn=127")["data"]
    return d["dash"]["video"]


def nodes():
    """回傳 [{host, source, name?, group?}]：只讀本技能自己的節點清單 nodes.json"""
    return json.load(open(os.path.join(SKILL_DIR, "nodes.json"), encoding="utf-8"))["nodes"]
