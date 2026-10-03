# B 站網頁版 QR code 登入。cookie 只留在記憶體（交給測速使用），不寫檔、不上傳。
import json, urllib.request, urllib.parse, http.cookiejar

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
HDR = {"User-Agent": UA, "Referer": "https://www.bilibili.com/"}

# poll 回傳的 data.code
SCANNED_WAIT_CONFIRM = 86090
NOT_SCANNED = 86101
EXPIRED = 86038
SUCCESS = 0


class QRLogin:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.key = None

    def _get(self, url):
        return json.load(self.opener.open(urllib.request.Request(url, headers=HDR), timeout=15))

    def generate(self):
        """回傳要編進 QR code 的網址"""
        d = self._get("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")["data"]
        self.key = d["qrcode_key"]
        return d["url"]

    def poll(self):
        """回傳 data.code（見上方常數）"""
        q = urllib.parse.urlencode(dict(qrcode_key=self.key))
        d = self._get(f"https://passport.bilibili.com/x/passport-login/web/qrcode/poll?{q}")["data"]
        return d.get("code")

    def cookie(self):
        """登入成功後組出 Cookie 字串；另取 buvid3/buvid4（降低 API 風控）"""
        try:
            d = self._get("https://api.bilibili.com/x/frontend/finger/spi")["data"]
            extra = {"buvid3": d.get("b_3"), "buvid4": d.get("b_4")}
        except Exception:
            extra = {}
        kv = {c.name: c.value for c in self.jar if c.domain.endswith("bilibili.com")}
        for k, v in extra.items():
            if v and k not in kv:
                kv[k] = v
        return "; ".join(f"{k}={v}" for k, v in kv.items())
