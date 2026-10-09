#!/usr/bin/env python3
# Bilibili CDN 測速（GUI 版）：給海外朋友雙擊執行。流程：
#   1 入口：選語言（繁中／簡中／英／日／韓）、閱讀英文隱私聲明並勾選同意、（作者用）開發者測試模式
#   2 測速目的：單純測試／建立擴充「自訂節點列表」，或參加抽獎（填 email、必中獎邀請碼；依國家顯示禮物卡）
#   3 網路檢查：頻寬與 VPN；只有參加抽獎才當門禁，單純測試只做參考
#   4 B 站 App 掃 QR code 登入（必要，1080P 以上才準）
#   5 自動測速（國家依出口 IP；DNS 不代表當地時改用 Google DoH 帶自己的 ECS），進度條，可停止並關閉
#      測試模式：不測速，只跑 5 秒假進度，產生標示 TEST 的假報告
#   6 結果摘要，確認後把 REPORT.md / summary.json / email 傳到作者的 Google Apps Script，
#     並把建議的 10 個節點寫進瀏覽器擴充的「自訂節點列表」（extdetect.py）
#   7 感謝頁（沒裝擴充時提示安裝後再按「建立自訂列表」）；關閉時刪掉已上傳的本機結果
# 同意隱私聲明後，安裝／執行／測速／發送等事件會送一筆使用紀錄（Apps Script action=log → Neon）。
# 測速核心在 core/（speedtest.py / bili.py / videos.py / netinfo.py / nodes.json），從 /cdn-speedtest skill 複製出來、各自維護，不互相依賴。
import json, os, queue, re, shutil, sys, threading, time, traceback, urllib.request, uuid, webbrowser
import tkinter as tk
from tkinter import ttk, messagebox

APP_VERSION = "1.5.1"
HERE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
if not getattr(sys, "frozen", False):
    sys.path.insert(0, os.path.join(HERE, "core"))
sys.path.insert(0, HERE)
from i18n import LANGS, PRIVACY_EN, EXT_NAME, ext_name, t, default_lang  # noqa: E402
import extdetect  # noqa: E402

EXT_URL_DEFAULT = ("https://chromewebstore.google.com/detail/dfaddcffoondcendifiljhdbdagebgch"
                   "?utm_source=cdn_speedtest_app&utm_medium=referral&utm_campaign=speedtest")
SUPPORT_URL_DEFAULT = "https://chromewebstore.google.com/detail/dfaddcffoondcendifiljhdbdagebgch/support"


def load_config():
    for p in (os.path.join(HERE, "config.json"), os.path.join(os.path.dirname(sys.executable), "config.json")):
        if os.path.exists(p):
            try:
                return json.load(open(p, encoding="utf-8"))
            except Exception:
                pass
    return {}


CONFIG = load_config()
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def gift_for(country):
    """config.json 的 gift_cards：{國家代碼: {vendor, amount}, "default": {...}}；沒設定回 None"""
    g = CONFIG.get("gift_cards") or {}
    c = g.get((country or "").upper()) or g.get("default") or {}
    if c.get("vendor") or c.get("amount"):
        return dict(country=(country or "").upper(), vendor=c.get("vendor") or "", amount=c.get("amount") or "")
    return None


class LogWriter:
    """把 print 的輸出接到 GUI 的佇列與 run.log（視窗程式沒有 stdout）"""
    def __init__(self, q):
        self.q, self.file, self.buf = q, None, []

    def attach(self, path):
        self.file = open(path, "a", encoding="utf-8")
        for line in self.buf: self.file.write(line)
        self.buf = []

    def detach(self):
        """關閉 run.log（Windows 上開著的檔案刪不掉）"""
        if self.file:
            self.file.close()
            self.file = None

    def write(self, s):
        if not s: return
        if self.file:
            self.file.write(s); self.file.flush()
        else:
            self.buf.append(s)
        for line in s.splitlines():
            if line.strip(): self.q.put(("log", line.strip()))

    def flush(self):
        pass


# 進度權重（依實際耗時粗估）
WEIGHTS = [("detect", 2), ("env", 6), ("pool", 12), ("pick", 4), ("ceiling", 5), ("stage1", 45), ("stage2", 24),
           ("report", 2)]


def post_json(payload, timeout=90):
    """POST 到 Apps Script 網頁應用程式（config.upload_url），回傳 JSON"""
    if not CONFIG.get("upload_url"):
        raise RuntimeError("no upload_url")
    req = urllib.request.Request(CONFIG["upload_url"], data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=timeout))


PROBE_HOSTS = ("upos-sz-mirror08ct.bilivideo.com", "upos-sz-mirror08c.bilivideo.com", "upos-sz-mirrorhw.bilivideo.com")


def probe_per_conn():
    """對幾個主要 B 站節點各量一次單一連線速度（8MB，訪客 480P 即可），回傳中位數 Mbps；失敗回 None。
    約 5–20 秒。只打 popular + playurl（view 對訪客常回 412 風控），不重試，失敗就交給呼叫端用預設值"""
    import statistics
    import bili, speedtest as S
    pop = bili.api("https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1", retry=1)["data"]["list"]
    url = None
    # 長片才有 8MB；有些熱門片會 -404（地區、付費），最多試 4 支
    for v in [x for x in sorted(pop, key=lambda x: -(x.get("duration") or 0)) if x.get("cid")][:4]:
        try:
            r = bili.api(f"https://api.bilibili.com/x/player/playurl?bvid={v['bvid']}&cid={v['cid']}&fnval=4048",
                         retry=1)
        except Exception:
            continue
        ss = ((r.get("data") or {}).get("dash") or {}).get("video") or []
        url = next((u for s in ss for u in [s.get("baseUrl", "")] + (s.get("backupUrl") or []) if "/upgcxcode/" in u),
                   None)
        if url: break
    if not url:
        return None
    ok = [r["mbps"] for r in (S.fetch(S.swap(url, h), 8 << 20, timeout=6) for h in PROBE_HOSTS)
          if not r.get("err") and r.get("mbps")]
    return statistics.median(ok) if ok else None


def estimate_minutes(down_mbps, per_conn_mbps=None):
    """預估整個測速耗時（分鐘，取 5 的倍數）。
    耗時主要取決於並行數（大部分時間花在等逾時的節點），並行數的算法與測速相同：
    頻寬 × 0.5 ÷ 單一連線速度（最多算 8K 碼率上限 PER_CONN_CAP），限制在 1–8。實測校正：耗時 ≈ 7 + 105 ÷ 並行數
    （並行 4 → 29 分、3 → 43 分、2／1 → 69–80 分）。量不到單一連線速度時就用上限值。"""
    import speedtest as S
    per = min(per_conn_mbps or S.PER_CONN_CAP, S.PER_CONN_CAP)
    conc = max(1, min(8, int(0.5 * (down_mbps or 50) / per)))
    m = 7 + 105 / conc
    return int(min(120, max(20, 5 * round(m / 5))))


def cjk_wrap(text, font, width):
    """Tk 只在空白處斷行，中日文長句會整段被擠到下一行；改成依實際字寬逐字斷行（英文單字、韓文詞不拆）"""
    out = []
    for para in text.split("\n"):
        line = ""
        for tok in re.findall(r"[A-Za-z0-9@._:/'’\"\-가-힣]+|\s+|.", para):
            # 標點不放行首（避頭）：寧可這行稍微超出一點
            if line and font.measure(line + tok) > width and tok not in "，。、；：！？）」』,.;:!?)":
                out.append(line.rstrip())
                line = tok.lstrip()
            else:
                line += tok
        out.append(line.rstrip())
    return "\n".join(out)


def norm_code(c):
    return re.sub(r"[\s-]", "", c or "").upper()


def install_info():
    """這台電腦的隨機 ID（第一次執行時產生，存在 %LOCALAPPDATA%\\CDNSpeedTest），回傳 (ID, 是否第一次執行)"""
    d = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "CDNSpeedTest")
    p = os.path.join(d, "install.json")
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)["id"], False
    except (OSError, ValueError, KeyError):
        pass
    iid = uuid.uuid4().hex
    try:
        os.makedirs(d, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(dict(id=iid, since=time.strftime("%Y-%m-%d %H:%M"), app_version=APP_VERSION), f)
    except OSError:
        pass
    return iid, True


def ip_country():
    try:
        return (json.load(urllib.request.urlopen("https://ipinfo.io/json", timeout=10)).get("country") or "").upper()
    except Exception:
        return ""


def out_root():
    base = os.path.join(os.path.expanduser("~"), "Documents")
    return os.path.join(base if os.path.isdir(base) else os.path.expanduser("~"), "CDN-SpeedTest")


class Runner(threading.Thread):
    """在背景執行完整測速；透過佇列回報 ('stage', name) / ('progress', name, done, total) / ('env', dict)
    / ('done', out_dir) / ('error', msg)"""
    def __init__(self, cookie, q, log, check=None):
        super().__init__(daemon=True)
        self.cookie, self.q, self.log, self.check = cookie, q, log, check or {}

    def run(self):
        try:
            self._run()
        except Exception as e:
            traceback.print_exc(file=self.log)
            self.q.put(("error", f"{type(e).__name__}: {e}"))

    def _run(self):
        import bili
        bili.COOKIE, bili.COOKIE_SRC = self.cookie or "", ("QR 登入" if self.cookie else "無（略過登入）")
        bili._nav = bili._mixin = None
        import speedtest as S
        import netinfo
        netinfo.PRESET_BW = self.check.get("bw")   # 網路檢查頁量過了，env 不重測
        netinfo.PRESET_VPN = self.check.get("vpn")

        class Args:
            allow_guest = False   # 付費測試要準：一定要登入（≥1080P），cookie 失效就中止，不降級成 480P
            if os.environ.get("CDNST_SMOKE"):  # 開發用試跑：少量節點與影片
                quick, limit_nodes, limit_videos = True, 8, 2
            def __getattr__(self, k): return None

        a = Args()
        S.PROGRESS = lambda name, i, n: self.q.put(("progress", name, i, n))
        stage = lambda n: self.q.put(("stage", n))

        stage("detect")
        chk = S.dns_check()
        e = chk["exit"]
        cc = (e.get("country") or "XX").upper()
        if not chk["dns_ok"]:
            S.DNS = "doh"  # 系統 DNS 不代表當地：改用 Google DoH，帶自己出口 IP 的 ECS
            S.set_doh_ecs(e.get("ip"))
        S.OUT = os.path.join(out_root(), f"{cc}-{time.strftime('%Y%m%d-%H%M')}")
        os.makedirs(S.OUT, exist_ok=True)
        S.STATE = dict(country=cc, app_version=APP_VERSION, dns=S.DNS)
        S.DEADLINE = None
        self.log.attach(os.path.join(S.OUT, "run.log"))
        print(f"國家 {cc}；DNS：{'系統 DNS' if not S.DNS else 'Google DoH（ECS ' + str(S.DOH_ECS) + '）'}；{chk['dns_verdict']}")
        self.q.put(("env", dict(country=cc, city=e.get("city"), org=e.get("org"), ip=e.get("ip"), doh=bool(S.DNS))))
        for name, fn in (("env", S.cmd_env), ("pool", S.cmd_pool), ("pick", S.cmd_pick), ("ceiling", S.cmd_ceiling),
                         ("stage1", S.cmd_stage1), ("stage2", S.cmd_stage2), ("report", S.cmd_report)):
            stage(name)
            fn(cc, a)
        json.dump(S.STATE, open(os.path.join(S.OUT, "state.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        self.q.put(("done", S.OUT))


class FakeRunner(threading.Thread):
    """開發者測試模式：不實際測速，5 秒跑完假進度，產生標示 TEST 的假報告（給作者測流程、寄信、試算表用）"""
    def __init__(self, q, country):
        super().__init__(daemon=True)
        self.q, self.country = q, country or "XX"

    def run(self):
        steps = [n for n, _ in WEIGHTS]
        self.q.put(("env", dict(country=self.country, city="TEST", org="TEST ISP", ip="0.0.0.0", doh=False)))
        for i, n in enumerate(steps):
            self.q.put(("stage", n))
            for k in range(1, 6):
                time.sleep(5 / len(steps) / 5)
                self.q.put(("progress", n, k, 5))
        out = os.path.join(out_root(), f"TEST-{time.strftime('%Y%m%d-%H%M%S')}")
        os.makedirs(out, exist_ok=True)
        sm = dict(test_mode=True, country=self.country, time=time.strftime("%Y-%m-%d %H:%M"),
                  env=dict(exit=dict(ip="0.0.0.0", country=self.country, city="TEST", org="TEST ISP"),
                           network=dict(kind="Wi-Fi"), bandwidth=dict(down_mbps=123.4, up_mbps=45.6, latency_ms=20),
                           login=True),
                  ceiling=500.0, default="upos-sz-mirror08ct.bilivideo.com",
                  recommended=["upos-sz-mirror08ct.bilivideo.com", "upos-sz-estghw.bilivideo.com"],
                  custom_list=["upos-sz-mirror08ct.bilivideo.com", "upos-sz-estghw.bilivideo.com",
                               "upos-sz-mirrorhwb.bilivideo.com"])
        json.dump(sm, open(os.path.join(out, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        open(os.path.join(out, "REPORT.md"), "w", encoding="utf-8").write(
            "# TEST MODE — fake report\n\nThis report was generated by developer test mode. No real test was run.\n")
        self.q.put(("done", out))


def enable_dpi_awareness():
    """讓 Windows 依顯示器縮放比例繪製（否則 125%/150% 縮放時整個視窗被點陣放大、文字模糊又小）"""
    if os.name != "nt": return
    import ctypes
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # Per-monitor DPI aware
    except Exception:
        try: ctypes.windll.user32.SetProcessDPIAware()
        except Exception: pass


# 配色（B 站粉）
C = dict(bg="#F4F5F7", card="#FFFFFF", text="#18191C", muted="#61666D", line="#E3E5E7", accent="#FB7299",
         accent_dark="#E85C86", accent_soft="#FFECF1", link="#00AEEC", ok="#2BA471", err="#D93025")
FAMILY = {"zh-TW": "Microsoft JhengHei UI", "zh-CN": "Microsoft YaHei UI", "ja": "Yu Gothic UI",
          "ko": "Malgun Gothic", "en": "Segoe UI"}
STEPS = 7


class App(tk.Tk):
    def __init__(self):
        enable_dpi_awareness()
        super().__init__()
        self.scale = max(1.0, self.winfo_fpixels("1i") / 96.0)  # 縮放倍率（100% = 1.0）
        self.lang = default_lang()
        self.fonts = {}
        self.setup_fonts()
        self.setup_style()
        self.configure(bg=C["bg"])
        self.geometry(f"{self.px(680)}x{self.px(760)}")
        self.minsize(self.px(600), self.px(680))
        self.set_icon()
        self.q = queue.Queue()
        self.log = LogWriter(self.q)
        sys.stdout = sys.stderr = self.log
        self.frame = None
        self.out_dir = None
        self.sm = None
        self.agree = tk.BooleanVar(value=False)
        self.test_mode = tk.BooleanVar(value=False)
        self.no_email = tk.BooleanVar(value=False)   # = 選了「不填 email，直接測試」
        self.join = tk.StringVar(value="free")     # free / lottery
        self.email_var = tk.StringVar()
        self.invite_var = tk.StringVar()
        self.invite_state = None                      # (結果 ok/bad/err, email, code)
        for v in (self.email_var, self.invite_var):   # 改了 email 或邀請碼 → 先前的驗證結果作廢
            v.trace_add("write", lambda *_: self.on_invite_edit())
        self.est_min = None
        self.country = None
        self.testing = False
        self.install_id, self.first_run = install_info()
        self.lottery_items, self.lottery_lang = None, None   # 進行中的抽獎（Apps Script → Neon），依語言快取
        self.add_ext = tk.BooleanVar(value=True)             # 發送後把建議節點加入擴充的自訂節點列表
        self.ext_vars = {b: tk.BooleanVar(value=(b == "Chrome")) for b in extdetect.BROWSERS}
        self.ext_results = {}       # 各瀏覽器建立自訂節點列表的結果：ok / missing / outdated（感謝頁用）
        self.protocol("WM_DELETE_WINDOW", self.quit_app)
        self.bind_all("<MouseWheel>", self.on_wheel)
        self.after(100, self.pump)
        self.show_entry()

    # ── 外觀 ──────────────────────────────────────────────
    def px(self, n):
        return int(n * self.scale)

    def setup_fonts(self):
        import tkinter.font as tkfont
        fam = FAMILY.get(self.lang, "Segoe UI") if os.name == "nt" else "Helvetica"
        spec = dict(body=(11, "normal"), small=(9, "normal"), h1=(18, "bold"), h2=(12, "bold"), brand=(12, "bold"),
                    hero=(24, "bold"), tiny=(8, "normal"))
        for k, (size, weight) in spec.items():  # 單位是 point：DPI aware 後 Tk 會依縮放自動換算
            if k in self.fonts:
                self.fonts[k].configure(family=fam, size=size, weight=weight)
            else:
                self.fonts[k] = tkfont.Font(self, family=fam, size=size, weight=weight)
        if hasattr(self, "style"):
            self.apply_font_styles()

    def setup_style(self):
        s = self.style = ttk.Style(self)
        s.theme_use("clam")
        s.configure(".", background=C["card"], foreground=C["text"], bordercolor=C["line"], focuscolor=C["accent"])
        s.configure("TFrame", background=C["card"])
        s.configure("Bg.TFrame", background=C["bg"])
        s.configure("Header.TFrame", background=C["card"])
        s.configure("Soft.TFrame", background=C["accent_soft"])
        s.configure("TLabel", background=C["card"], foreground=C["text"])
        s.configure("Bg.TLabel", background=C["bg"], foreground=C["muted"])
        s.configure("Muted.TLabel", background=C["card"], foreground=C["muted"])
        s.configure("Soft.TLabel", background=C["accent_soft"], foreground=C["text"])
        s.configure("Err.TLabel", background=C["card"], foreground=C["err"])
        s.configure("Accent.TButton", background=C["accent"], foreground="white", borderwidth=0,
                    padding=(self.px(22), self.px(8)))
        s.map("Accent.TButton", background=[("disabled", "#F5C2D1"), ("pressed", C["accent_dark"]),
                                            ("active", C["accent_dark"])],
              foreground=[("disabled", "white")])
        s.configure("TButton", background=C["card"], foreground=C["text"], bordercolor=C["line"], borderwidth=1,
                    padding=(self.px(16), self.px(7)))
        s.map("TButton", background=[("active", "#F1F2F3"), ("pressed", "#E7E8EA")])
        s.configure("Small.TButton", padding=(self.px(12), self.px(2)))
        s.configure("Link.TButton", background=C["card"], foreground=C["link"], borderwidth=0, padding=0)
        s.map("Link.TButton", background=[("active", C["card"])], foreground=[("active", C["accent"])])
        # 勾選框：clam 主題勾選時畫 ✕，改成自己畫的圖：未勾＝白底灰框，勾選＝綠底白勾，停用時變淡
        imgs = self.check_images()
        s.element_create("Green.Checkbutton.indicator", "image", imgs["off"],
                         ("disabled", "selected", imgs["on_dis"]), ("disabled", imgs["off_dis"]), ("selected", imgs["on"]),
                         sticky="w")
        s.layout("TCheckbutton", [("Checkbutton.padding", {"sticky": "nswe", "children": [
            ("Green.Checkbutton.indicator", {"side": "left", "sticky": ""}),
            ("Checkbutton.focus", {"side": "left", "sticky": "w", "children": [
                ("Checkbutton.label", {"sticky": "nswe"})]})]})])
        s.configure("TCheckbutton", background=C["card"], foreground=C["text"], padding=(0, self.px(3)))
        s.map("TCheckbutton", background=[("active", C["card"])], foreground=[("disabled", C["muted"])])
        s.configure("TRadiobutton", background=C["card"], foreground=C["text"], indicatorcolor=C["card"],
                    indicatorbackground=C["card"], indicatorsize=self.px(14), indicatormargin=(0, 0, self.px(8), 0),
                    padding=(0, self.px(3)))
        s.map("TRadiobutton", indicatorcolor=[("selected", C["accent"])], background=[("active", C["card"])],
              foreground=[("disabled", C["muted"])])
        s.configure("TEntry", fieldbackground=C["card"], bordercolor=C["line"], lightcolor=C["line"],
                    padding=self.px(6))
        s.map("TEntry", bordercolor=[("focus", C["accent"])], lightcolor=[("focus", C["accent"])])
        s.configure("TCombobox", fieldbackground=C["card"], background=C["card"], arrowsize=self.px(12),
                    padding=self.px(4))
        s.map("TCombobox", fieldbackground=[("readonly", C["card"])], selectbackground=[("readonly", C["card"])],
              selectforeground=[("readonly", C["text"])])
        s.configure("Accent.Horizontal.TProgressbar", troughcolor="#EEF0F2", background=C["accent"],
                    bordercolor="#EEF0F2", lightcolor=C["accent"], darkcolor=C["accent"], thickness=self.px(12))
        self.apply_font_styles()

    def check_images(self):
        """勾選框圖示（依縮放比例畫，先畫 4 倍再縮小做反鋸齒）；右側留空當作與文字的間距"""
        from PIL import Image, ImageDraw, ImageTk
        n, gap, k = self.px(16), self.px(8), 4
        out = {}
        for name, on, alpha in (("off", False, 255), ("on", True, 255), ("off_dis", False, 110), ("on_dis", True, 110)):
            im = Image.new("RGBA", ((n + gap) * k, n * k), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            box = (k, k, n * k - k, n * k - k)
            if on:
                d.rounded_rectangle(box, radius=3 * k, fill=C["ok"])
                d.line([(0.25 * n * k, 0.52 * n * k), (0.43 * n * k, 0.70 * n * k), (0.76 * n * k, 0.32 * n * k)],
                       fill="white", width=max(2, round(n * k * 0.13)), joint="curve")
            else:
                d.rounded_rectangle(box, radius=3 * k, fill="white", outline="#B5B9BF", width=max(1, round(1.2 * k * self.scale)))
            im = im.resize((n + gap, n), Image.LANCZOS)
            if alpha < 255:
                im.putalpha(im.getchannel("A").point(lambda a: a * alpha // 255))
            out[name] = ImageTk.PhotoImage(im, master=self)
        self._check_imgs = out   # 留住參照，否則圖會被回收
        return out

    def apply_font_styles(self):
        s, f = self.style, self.fonts
        for st in (".", "TLabel", "Bg.TLabel", "Muted.TLabel", "Soft.TLabel", "Err.TLabel", "TButton", "TCheckbutton",
                   "TRadiobutton", "TEntry", "TCombobox"):
            s.configure(st, font=f["body"])
        s.configure("Accent.TButton", font=f["h2"])
        s.configure("Link.TButton", font=f["body"])
        s.configure("H1.TLabel", font=f["h1"], background=C["card"], foreground=C["text"])
        s.configure("H2.TLabel", font=f["h2"], background=C["card"], foreground=C["text"])
        s.configure("Hero.TLabel", font=f["hero"], background=C["card"], foreground=C["accent"])
        s.configure("Brand.TLabel", font=f["brand"], background=C["card"], foreground=C["text"])
        s.configure("Small.TLabel", font=f["small"], background=C["card"], foreground=C["muted"])
        s.configure("Tiny.TLabel", font=f["tiny"], background=C["card"], foreground="#9499A0")
        s.configure("Step.TLabel", font=f["small"], background=C["card"], foreground=C["accent"])
        self.option_add("*TCombobox*Listbox.font", f["body"])

    def T(self, key, **kw):
        return t(key, self.lang, **kw)

    def icon_path(self):
        return next((x for x in (os.path.join(HERE, "icon128.png"),
                                 os.path.join(HERE, "..", "..", "assets", "icons-prod", "icon128.png"))
                     if os.path.exists(x)), None)

    def set_icon(self):
        p = self.icon_path()
        self._icon = self._icon_small = self._icon_big = None
        if p:
            try:
                self._icon = tk.PhotoImage(file=p)
                self.iconphoto(True, self._icon)
                # 標題列用 32px*縮放、感謝頁用 96px*縮放（PhotoImage 只能整數倍縮小）
                self._icon_small = self._icon.subsample(max(1, round(128 / (32 * self.scale))))
                self._icon_big = self._icon.subsample(max(1, round(128 / (96 * self.scale))))
            except Exception:
                pass

    def set_title(self):
        self.title(f"{self.T('title')}  v{APP_VERSION}" + (f"  {self.T('test_banner')}" if self.test_mode.get() else ""))

    # ── 版面骨架：頁首（icon、標題、步驟）＋白色內容卡＋頁尾按鈕列 ──────────
    def page(self, step=None):
        """回傳 (body, footer)"""
        if self.frame: self.frame.destroy()
        self.set_title()
        outer = self.frame = ttk.Frame(self, style="Bg.TFrame")
        outer.pack(fill="both", expand=True)
        head = ttk.Frame(outer, style="Header.TFrame", padding=(self.px(20), self.px(12)))
        head.pack(fill="x")
        if self._icon_small:
            ttk.Label(head, image=self._icon_small).pack(side="left", padx=(0, self.px(10)))
        tt = ttk.Frame(head)
        tt.pack(side="left")
        ttk.Label(tt, text=self.T("title"), style="Brand.TLabel").pack(anchor="w")
        ttk.Label(tt, text=self.T("subtitle"), style="Small.TLabel").pack(anchor="w")
        if step:
            ttk.Label(head, text=self.T("step", i=step, n=STEPS), style="Step.TLabel").pack(side="right")
        # 一律建立，切換測試模式時只改文字（不重建整頁，免得畫面跳一下）
        self.banner = ttk.Label(head, text=self.T("test_banner") if self.test_mode.get() else "", style="Step.TLabel")
        self.banner.pack(side="right", padx=self.px(10))
        tk.Frame(outer, bg=C["accent"], height=max(2, self.px(3))).pack(fill="x")  # 粉色分隔線
        if step:  # 進度點
            dots = tk.Frame(outer, bg=C["bg"])
            dots.pack(pady=(self.px(10), 0))
            for i in range(1, STEPS + 1):
                tk.Frame(dots, bg=C["accent"] if i <= step else C["line"], width=self.px(28 if i == step else 14),
                         height=self.px(5)).pack(side="left", padx=self.px(3))
        # 按鈕列先釘在底部：內容再多也不會把它擠出視窗
        foot = ttk.Frame(outer, style="Bg.TFrame", padding=(self.px(20), self.px(14)))
        foot.pack(side="bottom", fill="x")
        card_wrap = ttk.Frame(outer, style="Bg.TFrame", padding=(self.px(20), self.px(12), self.px(20), 0))
        card_wrap.pack(fill="both", expand=True)
        card = tk.Frame(card_wrap, bg=C["card"], highlightbackground=C["line"], highlightcolor=C["line"],
                        highlightthickness=1)
        card.pack(fill="both", expand=True)
        # 內容放在 Canvas 裡：放得下時撐滿卡片（pack side="bottom" 的元件照樣貼底），放不下時出現捲軸、可用滾輪捲動
        cv = tk.Canvas(card, bg=C["card"], highlightthickness=0, bd=0, height=1)
        cv.pack(fill="both", expand=True)
        body = ttk.Frame(cv, padding=(self.px(26), self.px(22)))
        win = cv.create_window(0, 0, window=body, anchor="nw")
        sb = ttk.Scrollbar(card, orient="vertical", command=cv.yview)
        cv.configure(yscrollcommand=sb.set)
        self.scroll = dict(cv=cv, body=body, win=win, sb=sb, size=None)
        cv.bind("<Configure>", lambda e: self.relayout())
        return body, foot

    def relayout(self):
        """內容高度變了（或視窗大小變了）就重新算：Tk 不會通知 reqheight 變化，所以 pump 也會定期呼叫"""
        s = getattr(self, "scroll", None)
        if not s or not s["cv"].winfo_exists(): return
        cv, body = s["cv"], s["body"]
        w, h, need = cv.winfo_width(), cv.winfo_height(), body.winfo_reqheight()
        if w <= 1 or s["size"] == (w, h, need): return
        s["size"] = (w, h, need)
        cv.itemconfigure(s["win"], width=w, height=max(h, need))
        cv.configure(scrollregion=(0, 0, w, max(h, need)))
        if need > h:
            s["sb"].place(relx=1, rely=0, relheight=1, anchor="ne")
        else:
            s["sb"].place_forget()
            cv.yview_moveto(0)

    def on_wheel(self, e):
        s = getattr(self, "scroll", None)
        if not s or not s["cv"].winfo_exists() or not s["size"] or s["size"][2] <= s["size"][1]: return
        if isinstance(e.widget, tk.Text) or "html" in str(e.widget).lower(): return   # 隱私聲明等自己會捲的元件
        s["cv"].yview_scroll(int(-e.delta / 120) or (-1 if e.delta > 0 else 1), "units")

    def wrap(self, n=560):
        return self.px(n)

    def text(self, parent, s, style="TLabel", **kw):
        """多行文字：先依字寬斷好行（中日文才不會整段被擠到下一行）；wraplength 留著給之後 config 換的文字用"""
        wl = kw.pop("wraplength", self.wrap())
        if wl and s:
            s = cjk_wrap(s, self.fonts.get({"Small.TLabel": "small", "Tiny.TLabel": "tiny"}.get(style, "body")), wl)
        return ttk.Label(parent, text=s, style=style, wraplength=wl, **kw)

    # ── 使用紀錄：事件送到 Apps Script（action=log → Neon app_events），失敗就算了，不影響流程 ──
    def log_event(self, kind, email=""):
        if not CONFIG.get("upload_url"): return
        payload = dict(token=CONFIG.get("token", ""), action="log", type=kind, email=email,
                       install_id=self.install_id, app_version=APP_VERSION, lang=self.lang,
                       test_mode=bool(self.test_mode.get()))

        def work():
            country = self.country or ip_country()
            if country and not self.country: self.q.put(("country", country))
            try:
                post_json(dict(payload, country=country), timeout=30)
            except Exception:
                pass
        threading.Thread(target=work, daemon=True).start()

    def store_url(self, browser):
        if browser == "Chrome" and CONFIG.get("extension_url"):
            return CONFIG["extension_url"]
        return extdetect.STORE_URLS[browser]

    def store_links(self, parent):
        """「擴充功能【名稱】線上應用程式商店」，下一行是 Chrome ∙ Firefox ∙ Edge 三個商店連結"""
        fr = ttk.Frame(parent)
        ttk.Label(fr, text="🔗 " + self.T("ext_link", name=ext_name(self.lang)), style="Muted.TLabel").pack(anchor="w")
        row = ttk.Frame(fr)
        row.pack(anchor="w", padx=(self.px(24), 0))
        for i, b in enumerate(extdetect.BROWSERS):
            if i: ttk.Label(row, text=" ∙ ", style="Muted.TLabel").pack(side="left")
            ttk.Button(row, text=b, style="Link.TButton", cursor="hand2", width=0,
                       command=lambda b=b: webbrowser.open(self.store_url(b))).pack(side="left")
        return fr

    def lottery_email(self):
        return self.email_var.get().strip() if self.join.get() == "lottery" else ""

    def pump(self):
        try:
            while True:
                kind, *a = self.q.get_nowait()
                h = getattr(self, f"on_{kind}", None)
                if h: h(*a)
        except queue.Empty:
            pass
        self.relayout()
        self.after(150, self.pump)

    # ── 頁 1：入口（語言、隱私聲明、測試模式） ─────────────
    def show_entry(self):
        body, foot = self.page(1)
        top = ttk.Frame(body)
        top.pack(fill="x")
        ttk.Label(top, text=self.T("privacy"), style="H1.TLabel").pack(side="left")
        names = [n for _, n in LANGS]
        cb = ttk.Combobox(top, values=names, state="readonly", width=10, font=self.fonts["body"])
        cb.set(dict(LANGS)[self.lang])
        cb.pack(side="right")
        ttk.Label(top, text="🌐 " + self.T("language"), style="Muted.TLabel").pack(side="right", padx=self.px(8))

        def on_lang(_):
            self.lang = LANGS[names.index(cb.get())][0]
            self.setup_fonts()
            self.show_entry()
        cb.bind("<<ComboboxSelected>>", on_lang)

        box_fr = tk.Frame(body, bg=C["line"], padx=1, pady=1)
        box_fr.pack(fill="both", expand=True, pady=(self.px(14), self.px(10)))
        box = tk.Text(box_fr, wrap="word", font=self.fonts["small"], relief="flat", bg="#FAFBFC", fg=C["text"],
                      padx=self.px(14), pady=self.px(10), spacing1=self.px(1), spacing3=self.px(3), height=12)
        sb = ttk.Scrollbar(box_fr, command=box.yview)
        self.style.configure("Vertical.TScrollbar", arrowsize=self.px(12))
        box.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        box.pack(side="left", fill="both", expand=True)
        box.insert("1.0", PRIVACY_EN.format(ext=EXT_NAME, ext_url=CONFIG.get("extension_url") or EXT_URL_DEFAULT,
                                            support=CONFIG.get("support_url") or SUPPORT_URL_DEFAULT))
        box.config(state="disabled")

        self.store_links(body).pack(anchor="w", pady=(0, self.px(10)))

        nxt = ttk.Button(foot, text=self.T("next") + "  →", style="Accent.TButton", command=self.entry_next)
        upd = lambda: nxt.state(["!disabled"] if self.agree.get() else ["disabled"])
        ttk.Checkbutton(body, text=self.T("agree"), variable=self.agree, command=upd).pack(anchor="w")
        ttk.Checkbutton(body, text=self.T("test_mode"), variable=self.test_mode,
                        command=self.on_test_mode).pack(anchor="w", pady=(self.px(4), 0))
        nxt.pack(side="right")
        upd()

    def on_test_mode(self):
        self.set_title()
        self.banner.config(text=self.T("test_banner") if self.test_mode.get() else "")

    def entry_next(self):
        """同意隱私聲明後才送使用紀錄（第一次在這台電腦執行多送一筆 install），每次開程式只送一次"""
        if not getattr(self, "run_logged", False):
            self.run_logged = True
            if self.first_run: self.log_event("install")
            self.log_event("run")
        self.show_email()

    # ── 頁 3：網路檢查（頻寬門檻 + VPN；只有參加抽獎才擋） ─────────────
    def min_down(self):
        return float(CONFIG.get("min_down_mbps") or 50)

    def show_check(self, rerun=False):
        """rerun=False 且先前檢查過 → 直接顯示上次的結果（從下一頁返回、或改了測速目的時不用重測）"""
        body, foot = self.page(3)
        lottery = self.join.get() == "lottery"
        ttk.Label(body, text="📶  " + self.T("check_title"), style="H1.TLabel").pack(anchor="w")
        self.text(body, self.T("check_desc" if lottery else "check_desc_free", min=f"{self.min_down():g}"),
                  style="Muted.TLabel", justify="left").pack(anchor="w", pady=(self.px(8), self.px(16)))
        grid = ttk.Frame(body)
        grid.pack(fill="x")
        self.metric = {}
        for i, k in enumerate(("m_down", "m_up", "m_lat", "m_vpn")):
            cell = tk.Frame(grid, bg="#FAFBFC", highlightbackground=C["line"], highlightthickness=1)
            cell.grid(row=0, column=i, sticky="nsew", padx=(0 if i == 0 else self.px(8), 0))
            grid.columnconfigure(i, weight=1, uniform="m")
            tk.Label(cell, text=self.T(k), bg="#FAFBFC", fg=C["muted"], font=self.fonts["small"]).pack(
                pady=(self.px(10), 0))
            v = tk.Label(cell, text="…", bg="#FAFBFC", fg=C["text"], font=self.fonts["h2"])
            v.pack(pady=(self.px(2), self.px(10)))
            self.metric[k] = v
        self.check_box = ttk.Frame(body, style="Soft.TFrame", padding=(self.px(16), self.px(12)))
        self.check_box.pack(fill="x", pady=(self.px(18), 0))
        self.check_msg = self.text(self.check_box, self.T("check_running"), style="Soft.TLabel", justify="left",
                                   wraplength=self.wrap(540))
        self.check_msg.pack(anchor="w")
        self.check_bar = ttk.Progressbar(body, mode="indeterminate", style="Accent.Horizontal.TProgressbar")
        self.check_bar.pack(fill="x", pady=(self.px(14), 0))
        self.check_bar.start(12)
        ttk.Button(foot, text="←  " + self.T("back"), command=self.show_email).pack(side="left")
        self.check_next = ttk.Button(foot, text=self.T("next") + "  →", style="Accent.TButton", command=self.show_login)
        self.check_next.pack(side="right")
        self.check_next.state(["disabled"])
        self.check_retry = ttk.Button(foot, text="↻  " + self.T("check_retry"), command=lambda: self.show_check(True))
        self.check_gen = getattr(self, "check_gen", 0) + 1
        prev = getattr(self, "check", None)
        if prev and not rerun and prev.get("vpn") is not None:
            self.on_check_done(self.check_gen, prev["vpn"], prev["bw"])
        else:
            threading.Thread(target=self.check_worker, args=(self.check_gen,), daemon=True).start()

    def check_worker(self, gen):
        try:
            import netinfo
            vpn = netinfo.vpn_check()
            self.q.put(("check_vpn", gen, vpn))
            bw = netinfo.bandwidth()
            if bw.get("down_mbps"):
                try:
                    bw["bili_per_conn_mbps"] = probe_per_conn()
                except Exception:
                    bw["bili_per_conn_mbps"] = None
            self.q.put(("check_done", gen, vpn, bw))
        except Exception as e:
            self.q.put(("check_done", gen, None, dict(err=str(e)[:80])))

    def alive_check(self, gen):
        return gen == self.check_gen and hasattr(self, "check_msg") and self.check_msg.winfo_exists()

    def on_check_vpn(self, gen, vpn):
        if not self.alive_check(gen): return
        self.metric["m_vpn"].config(text=self.T("vpn_found") if vpn.get("vpn") else self.T("vpn_none"),
                                    fg=C["err"] if vpn.get("vpn") else C["ok"])
        if vpn.get("country"): self.country = vpn["country"].upper()

    def on_check_done(self, gen, vpn, bw):
        if not self.alive_check(gen): return
        self.check_bar.stop()
        self.check_bar.pack_forget()
        down = bw.get("down_mbps")
        fmt = lambda x, u: "-" if x is None else f"{x:g} {u}"
        self.metric["m_down"].config(text=fmt(down, "Mbps"),
                                     fg=C["ok"] if (down or 0) >= self.min_down() else C["err"])
        self.metric["m_up"].config(text=fmt(bw.get("up_mbps"), "Mbps"))
        self.metric["m_lat"].config(text=fmt(bw.get("latency_ms"), "ms"))
        if vpn is not None: self.on_check_vpn(gen, vpn)
        # 網速與 VPN 只有參加抽獎才當門禁；單純測試（多半只是想建立自己的節點列表，網路環境常常比較複雜）只提示
        lottery = self.join.get() == "lottery"
        self.est_min = estimate_minutes(down, bw.get("bili_per_conn_mbps")) if down else None
        eta = "\n" + self.T("check_eta", min=self.est_min) if self.est_min else ""
        if vpn is None or (down is None and bw.get("err")):
            msg, ok = self.T("check_err", err=bw.get("err") or "?"), False
        elif vpn.get("vpn"):
            msg, ok = self.T("fail_vpn" if lottery else "warn_vpn") + "\n· " + "\n· ".join(vpn.get("signals") or []), False
        elif (down or 0) < self.min_down():
            msg, ok = self.T("fail_slow" if lottery else "warn_slow", down=f"{down:g}", min=f"{self.min_down():g}"), False
        else:
            msg, ok = "✅  " + self.T("check_pass") + eta, True
        self.check = dict(bw=bw, vpn=vpn, ok=ok)
        can_go = ok or not lottery or self.test_mode.get()
        if not ok:
            msg = "⚠  " + msg
            if not lottery:
                msg += "\n\n" + self.T("check_free_warn") + eta
            else:
                msg += "\n\n💡 " + self.T("check_back_free")
                if self.test_mode.get(): msg += "\n" + self.T("check_testmode")
        self.check_msg.config(text=cjk_wrap(msg, self.fonts["body"], self.px(540)), wraplength=0)
        if can_go:
            self.check_next.state(["!disabled"])
        if not ok:
            self.check_retry.pack(side="left", padx=(self.px(10), 0))

    # ── 頁 2：測速目的（單純測試／參加抽獎＋必中獎邀請碼） ───────────
    def show_email(self):
        body, foot = self.page(2)
        ttk.Label(body, text="🎯  " + self.T("purpose_title"), style="H1.TLabel").pack(anchor="w",
                                                                                   pady=(0, self.px(14)))
        ttk.Radiobutton(body, text=self.T("opt_free"), variable=self.join, value="free",
                        command=self.on_join).pack(anchor="w")
        self.text(body, cjk_wrap(self.T("opt_free_desc"), self.fonts["body"], self.px(530)), style="Muted.TLabel",
                  justify="left", wraplength=0).pack(anchor="w", padx=(self.px(28), 0), pady=(0, self.px(4)))
        ttk.Radiobutton(body, text=self.T("opt_lottery"), variable=self.join, value="lottery",
                        command=self.on_join).pack(anchor="w", pady=(self.px(6), 0))
        # 進行中的抽獎（HTML，從資料庫讀）：不管選哪個都顯示，吸引參加；讀到之前是空的
        self.lottery_slot = ttk.Frame(body, padding=(self.px(28), self.px(6), 0, 0))
        self.lottery_slot.pack(fill="x")
        # 選了參加抽獎才出現：禮物卡說明（有進行中的抽獎時不顯示）、email、必中獎邀請碼
        form = self.lottery_form = ttk.Frame(body, padding=(self.px(28), self.px(6), 0, 0))
        box = self.gift_box = ttk.Frame(form, style="Soft.TFrame", padding=(self.px(14), self.px(10)))
        box.pack(fill="x", pady=(0, self.px(10)))
        self.gift_label = self.text(box, self.T("gift_detecting"), style="Soft.TLabel", justify="left",
                                    wraplength=self.wrap(510))
        self.gift_label.pack(anchor="w")
        ttk.Label(form, text=self.T("email"), style="H2.TLabel").pack(anchor="w")
        self.email_ent = ttk.Entry(form, textvariable=self.email_var, font=self.fonts["body"])
        self.email_ent.pack(fill="x", pady=(self.px(4), 0))
        self.email_err = self.text(form, "", style="Err.TLabel")
        self.email_err.pack(anchor="w")
        ttk.Label(form, text=self.T("invite"), style="H2.TLabel").pack(anchor="w", pady=(self.px(6), 0))
        row = ttk.Frame(form)
        row.pack(fill="x", pady=(self.px(4), 0))
        self.invite_btn = ttk.Button(row, text=self.T("invite_verify"), command=self.verify_invite)
        self.invite_btn.pack(side="right", padx=(self.px(8), 0))
        self.invite_ent = ttk.Entry(row, textvariable=self.invite_var, font=self.fonts["body"])
        self.invite_ent.pack(side="left", fill="x", expand=True)
        self.invite_ent.bind("<Return>", lambda e: self.verify_invite())
        self.invite_box = tk.Frame(form, bg=C["bg"])
        self.invite_msg = tk.Label(self.invite_box, text="", bg=C["bg"], fg=C["text"], font=self.fonts["body"],
                                   justify="left", anchor="w")
        self.invite_msg.pack(fill="x", padx=self.px(14), pady=self.px(10))

        ttk.Button(foot, text="←  " + self.T("back"), command=self.show_entry).pack(side="left")
        self.email_next_btn = ttk.Button(foot, text=self.T("next") + "  →", style="Accent.TButton",
                                         command=self.email_next)
        self.email_next_btn.pack(side="right")
        self.on_join()
        if self.invite_state and self.invite_current():
            self.show_invite_box(self.invite_state[0])
        if not self.country:
            threading.Thread(target=self.detect_country, daemon=True).start()
        else:
            self.on_country(self.country)
        if self.lottery_lang == self.lang:
            self.render_lotteries()
        elif CONFIG.get("upload_url"):
            threading.Thread(target=self.lottery_worker, args=(self.lang,), daemon=True).start()

    # ── 進行中的抽獎：Apps Script（action=lotteries）從 Neon 讀，HTML 用 tkinterweb 顯示 ──
    def lottery_worker(self, lang):
        try:
            r = post_json(dict(token=CONFIG.get("token", ""), action="lotteries", lang=lang), timeout=20)
            items = (r.get("items") or []) if r.get("ok") else []
        except Exception:
            items = []
        self.q.put(("lotteries", lang, items))

    def on_lotteries(self, lang, items):
        self.lottery_items, self.lottery_lang = items, lang
        if lang == self.lang:
            self.render_lotteries()

    def render_lotteries(self):
        if not (hasattr(self, "lottery_slot") and self.lottery_slot.winfo_exists()): return
        for w in self.lottery_slot.winfo_children(): w.destroy()
        items = self.lottery_items or []
        if not items:
            return
        self.gift_box.pack_forget()   # 抽獎內容會寫獎品，不再重複顯示 config 的禮物卡說明
        from tkinterweb import HtmlFrame
        box = tk.Frame(self.lottery_slot, bg=C["accent_soft"], height=self.px(120))
        box.pack(fill="x")
        box.pack_propagate(False)
        hf = HtmlFrame(box, messages_enabled=False, horizontal_scrollbar=False, vertical_scrollbar="auto",
                       on_link_click=webbrowser.open)
        hf.load_html(f"<html><body style=\"margin:10px 14px;font-family:'{FAMILY.get(self.lang, 'Segoe UI')}';"
                     f"font-size:10pt;color:{C['text']};background:{C['accent_soft']}\">"
                     + '<hr style="border:0;border-top:1px solid #F5C2D1;margin:10px 0">'.join(i["html"] for i in items)
                     + "</body></html>")
        hf.pack(fill="both", expand=True)

        def fit():   # 高度跟著內容，最多 220（超過就捲動）
            try:
                h = int(hf.html.bbox()[3])
            except Exception:
                return
            if h > 0: box.configure(height=min(h + 4, self.px(220)))
        self.after(150, fit)

    def on_join(self):
        free = self.join.get() == "free"
        self.no_email.set(free)
        self.email_err.config(text="")
        if free:
            self.lottery_form.pack_forget()
        else:
            self.lottery_form.pack(fill="x")
            self.email_ent.focus_set()

    def invite_current(self):
        st = self.invite_state
        return bool(st) and st[1] == self.email_var.get().strip().lower() and st[2] == norm_code(self.invite_var.get())

    def invite_ok_code(self):
        """驗證成功且仍是目前填的 email／邀請碼 → 回傳邀請碼，否則空字串（當作沒填）"""
        if self.join.get() == "lottery" and self.invite_state and self.invite_state[0] == "ok" and self.invite_current():
            return self.invite_state[2]
        return ""

    def on_invite_edit(self):
        if not (hasattr(self, "invite_box") and self.invite_box.winfo_exists()): return
        if self.invite_state and not self.invite_current():
            self.invite_state = None
            self.invite_box.pack_forget()
        if self.email_err.cget("text"):
            self.email_err.config(text="")

    def show_invite_box(self, kind, err=""):
        bg, fg = dict(ok=("#E7F6EE", C["ok"]), bad=("#FFF4E5", "#9A5B00"), err=("#FFF4E5", "#9A5B00"),
                      checking=(C["bg"], C["muted"]), need=("#FDECEC", C["err"]))[kind]
        text = dict(ok=self.T("invite_ok"), bad=self.T("invite_bad"), err=self.T("invite_err", err=err or "?"),
                    checking=self.T("invite_checking"), need=self.T("invite_need_email"))[kind]
        self.invite_box.config(bg=bg, highlightbackground=fg if kind == "ok" else bg, highlightthickness=1)
        self.invite_msg.config(text=cjk_wrap(text, self.fonts["body"], self.px(520)), bg=bg, fg=fg)
        self.invite_box.pack(fill="x", pady=(self.px(10), 0))

    def verify_invite(self, then_next=False):
        email, code = self.email_var.get().strip(), norm_code(self.invite_var.get())
        if not code: return
        if not EMAIL_RE.match(email):
            self.show_invite_box("need")
            return
        self.invite_btn.state(["disabled"])
        self.email_next_btn.state(["disabled"])
        self.show_invite_box("checking")
        self.invite_gen = getattr(self, "invite_gen", 0) + 1
        threading.Thread(target=self.invite_worker, args=(self.invite_gen, email.lower(), code, then_next),
                         daemon=True).start()

    def invite_worker(self, gen, email, code, then_next):
        err = ""
        try:
            r = post_json(dict(token=CONFIG.get("token", ""), action="verify_invite", email=email, code=code),
                          timeout=30)
            res = "ok" if r.get("valid") else ("bad" if r.get("ok") else "err")
            err = r.get("err") or ""
        except Exception as e:
            res, err = "err", str(e)[:60]
        self.q.put(("invite", gen, email, code, res, err, then_next))

    def on_invite(self, gen, email, code, res, err, then_next):
        if gen != self.invite_gen or not (hasattr(self, "invite_box") and self.invite_box.winfo_exists()): return
        self.invite_btn.state(["!disabled"])
        self.email_next_btn.state(["!disabled"])
        self.invite_state = (res, email, code)
        if not self.invite_current():   # 驗證途中又改了內容
            self.invite_state = None
            self.invite_box.pack_forget()
            return
        self.show_invite_box(res, err)
        if then_next and res == "ok":
            self.show_check()

    def detect_country(self):
        self.q.put(("country", ip_country()))

    def on_country(self, c):
        self.country = c or self.country
        if not (hasattr(self, "gift_label") and self.gift_label.winfo_exists()): return
        g = gift_for(c)
        s = self.T("gift_body", gift=f"{g['vendor']} {g['amount']}".strip()) if g else self.T("gift_body_generic")
        self.gift_label.config(text=cjk_wrap(s, self.fonts["body"], self.px(500)), wraplength=0)

    def email_next(self):
        self.no_email.set(self.join.get() == "free")
        if self.no_email.get():
            self.show_check()
            return
        if not EMAIL_RE.match(self.email_var.get().strip()):
            self.email_err.config(text=self.T("email_invalid"))
            return
        # 填了邀請碼但還沒驗證（或內容改過）→ 先驗證：成功直接下一步；失敗留在本頁顯示原因，再按一次就當作沒填
        if norm_code(self.invite_var.get()) and not self.invite_current():
            self.verify_invite(then_next=True)
            return
        self.show_check()

    # ── 頁 4：QR 登入 ──────────────────────────────────────
    def show_login(self):
        body, foot = self.page(4)
        ttk.Label(body, text=self.T("login_title"), style="H1.TLabel").pack()
        self.text(body, self.T("login_desc"), style="Muted.TLabel", justify="center").pack(pady=(self.px(6), 0))
        self.qr_size = self.px(260)
        qr_wrap = tk.Frame(body, bg=C["line"], padx=1, pady=1)
        qr_wrap.pack(pady=self.px(16))
        self.qr = tk.Canvas(qr_wrap, width=self.qr_size, height=self.qr_size, bg="white", highlightthickness=0)
        self.qr.pack()
        self.login_status = self.text(body, self.T("qr_generating"), style="Muted.TLabel")
        self.login_status.pack()
        ttk.Button(foot, text="←  " + self.T("back"), command=lambda: (self.stop_login(), self.show_check())).pack(
            side="left")
        self.login_alive = True
        self.login_gen = getattr(self, "login_gen", 0) + 1
        threading.Thread(target=self.login_worker, args=(self.login_gen,), daemon=True).start()

    def stop_login(self):
        self.login_alive = False

    def draw_qr(self, url):
        import qrcode
        qr = qrcode.QRCode(border=2)
        qr.add_data(url)
        qr.make(fit=True)
        m = qr.get_matrix()
        cell = self.qr_size // len(m)
        off = (self.qr_size - cell * len(m)) // 2
        self.qr.delete("all")
        for y, row in enumerate(m):
            for x, v in enumerate(row):
                if v:
                    self.qr.create_rectangle(off + x * cell, off + y * cell, off + (x + 1) * cell,
                                             off + (y + 1) * cell, fill="black", outline="")

    def login_worker(self, gen):
        from qrlogin import QRLogin, SUCCESS, EXPIRED, SCANNED_WAIT_CONFIRM
        alive = lambda: self.login_alive and self.login_gen == gen
        while alive():
            try:
                ql = QRLogin()
                self.q.put(("qr", gen, ql.generate()))
                while alive():
                    time.sleep(2)
                    code = ql.poll()
                    if not alive(): return
                    if code == SUCCESS:
                        self.q.put(("login_ok", gen, ql.cookie()))
                        return
                    if code == SCANNED_WAIT_CONFIRM:
                        self.q.put(("login_msg", gen, "qr_scanned"))
                    if code == EXPIRED:
                        self.q.put(("login_msg", gen, "qr_expired"))
                        break
            except Exception:
                self.q.put(("login_msg", gen, "qr_neterr"))
                time.sleep(5)

    def on_qr(self, gen, url):
        if gen == self.login_gen and self.login_alive and self.qr.winfo_exists():
            self.draw_qr(url)
            self.login_status.config(text=self.T("qr_waiting"))

    def on_login_msg(self, gen, key):
        if gen == self.login_gen and self.login_alive and self.login_status.winfo_exists():
            self.login_status.config(text=self.T(key))

    def on_login_ok(self, gen, cookie):
        if gen == self.login_gen and self.login_alive:
            self.start_test(cookie)

    # ── 頁 4：測速進度 ──────────────────────────────────────
    def start_test(self, cookie):
        self.stop_login()
        body, foot = self.page(5)
        ttk.Label(body, text=self.T("test_title"), style="H1.TLabel").pack()
        self.text(body, self.T("test_desc", min=self.est_min or "30–110"), style="Muted.TLabel", justify="center").pack(
            pady=(self.px(6), 0))
        info = ttk.Frame(body, style="Soft.TFrame", padding=(self.px(16), self.px(10)))
        info.pack(fill="x", pady=(self.px(18), self.px(22)))
        self.env_label = ttk.Label(info, text="…", style="Soft.TLabel", justify="center")
        self.env_label.pack()
        self.stage_label = ttk.Label(body, text="", style="H2.TLabel")
        self.stage_label.pack(anchor="w")
        self.bar = ttk.Progressbar(body, mode="determinate", maximum=1000, style="Accent.Horizontal.TProgressbar")
        self.bar.pack(fill="x", pady=(self.px(8), self.px(6)))
        row = ttk.Frame(body)
        row.pack(fill="x")
        self.pct = ttk.Label(row, text="0%", style="H2.TLabel")
        self.pct.pack(side="left")
        self.detail = ttk.Label(row, text="", style="Muted.TLabel")
        self.detail.pack(side="right")
        self.eta = ttk.Label(body, text="", style="Muted.TLabel")
        self.eta.pack(anchor="w", pady=(self.px(10), 0))
        self.logline = ttk.Label(body, text="", style="Tiny.TLabel", wraplength=self.wrap())
        self.logline.pack(side="bottom", anchor="w")
        ttk.Button(foot, text="■  " + self.T("stop_close"), command=self.stop_and_close).pack(side="left")
        self.testing = True
        self.protocol("WM_DELETE_WINDOW", self.stop_and_close)
        self.log_event("guaranteed" if self.invite_ok_code() else "lottery" if self.lottery_email() else "free",
                       self.lottery_email())
        self.t0, self.frac = time.time(), 0.0
        if self.test_mode.get():
            FakeRunner(self.q, self.country).start()
        else:
            Runner(cookie, self.q, self.log, getattr(self, "check", None)).start()
        self.tick()

    def stage_base(self, name):
        tot = sum(w for _, w in WEIGHTS)
        before = 0
        for n, w in WEIGHTS:
            if n == name: return before / tot, w / tot
            before += w
        return 1.0, 0.0

    def set_frac(self, x):
        self.frac = max(self.frac, min(1.0, x))
        self.bar["value"] = int(self.frac * 1000)
        self.pct.config(text=f"{int(self.frac * 100)}%")

    def on_stage(self, name):
        base, _ = self.stage_base(name)
        self.set_frac(base)
        idx = [n for n, _ in WEIGHTS].index(name) + 1 if name in dict(WEIGHTS) else 0
        self.stage_label.config(text=f"{idx}/{len(WEIGHTS)}  {self.T('st_' + name)}")
        self.detail.config(text="")

    def on_progress(self, name, i, n):
        base, w = self.stage_base(name)
        self.set_frac(base + w * (i / max(1, n)))
        self.detail.config(text=f"{i} / {n}")

    def on_env(self, d):
        self.env_label.config(text=f"📍 {d['country']} {d.get('city') or ''}　·　{d.get('org') or ''}\n"
                                   f"DNS：{self.T('dns_doh') if d.get('doh') else self.T('dns_sys')}")

    def on_log(self, line):
        if hasattr(self, "logline") and self.logline.winfo_exists():
            self.logline.config(text=line[:160])

    def tick(self):
        if not (hasattr(self, "eta") and self.eta.winfo_exists()) or not self.testing: return
        el = time.time() - self.t0
        txt = f"⏱  {self.T('elapsed')} {int(el // 60)}:{int(el % 60):02d}"
        if self.frac > 0.15:
            txt += "　·　" + self.T("remaining", m=int(el * (1 - self.frac) / self.frac // 60) + 1)
        self.eta.config(text=txt)
        self.after(1000, self.tick)

    def stop_and_close(self):
        """測速中途停止：確認後直接結束程式（背景測速執行緒會一起結束，不發送任何資料）"""
        if self.testing and not messagebox.askyesno(self.T("stop_q_title"), self.T("stop_q"), parent=self):
            return
        self.destroy()
        os._exit(0)

    def on_error(self, msg):
        self.testing = False
        self.protocol("WM_DELETE_WINDOW", self.quit_app)
        body, foot = self.page(5)
        ttk.Label(body, text="⚠  " + self.T("failed"), style="H1.TLabel").pack(pady=self.px(8))
        self.text(body, msg, style="Muted.TLabel").pack(pady=self.px(8))
        ttk.Button(foot, text=self.T("close"), style="Accent.TButton", command=self.quit_app).pack(side="right")

    # ── 頁 5：確認發送 ──────────────────────────────────────
    def on_done(self, out_dir):
        self.testing = False
        self.protocol("WM_DELETE_WINDOW", self.quit_app)
        self.out_dir = out_dir
        sm = self.sm = json.load(open(os.path.join(out_dir, "summary.json"), encoding="utf-8"))
        self.log_event("test_done", self.lottery_email())
        env = sm["env"]
        e, n, bw = env.get("exit") or {}, env.get("network") or {}, env.get("bandwidth") or {}
        email = "" if self.no_email.get() else self.email_var.get().strip()
        rows = [(self.T("f_country"), f"{sm['country']}  {e.get('city') or ''}"),
                (self.T("f_isp"), e.get("org") or "-"),
                (self.T("f_ip"), e.get("ip") or "-"),
                (self.T("f_network"), (n.get("kind") or "-") + (f"（{n['kind_note']}）" if n.get("kind_note") else "")),
                (self.T("f_bw"), f"↓ {bw.get('down_mbps')}  /  ↑ {bw.get('up_mbps')} Mbps"),
                (self.T("f_login"), self.T("yes") if env.get("login") else self.T("no480")),
                (self.T("f_email"), (email + "  ·  " + (self.T("join_invite") if self.invite_ok_code()
                                                         else self.T("join_lottery"))) if email else self.T("none")),
                (self.T("f_default"), sm.get("default") or "-")]
        rec = self.custom_hosts()
        self.summary_text = "\n".join(f"{k}：{v}" for k, v in rows) + "\n" + self.T("f_rec") + "：\n" + \
            "\n".join(f"  {i}. {h}" for i, h in enumerate(rec, 1))

        body, foot = self.page(6)
        ttk.Label(body, text="✅  " + self.T("done_title"), style="H1.TLabel").pack(anchor="w")
        grid = ttk.Frame(body)
        grid.pack(fill="x", pady=(self.px(14), self.px(6)))
        for i, (k, v) in enumerate(rows):
            ttk.Label(grid, text=k, style="Muted.TLabel").grid(row=i, column=0, sticky="nw", pady=self.px(3),
                                                               padx=(0, self.px(18)))
            ttk.Label(grid, text=v, wraplength=self.px(400)).grid(row=i, column=1, sticky="w", pady=self.px(3))
        if rec:
            ttk.Label(body, text=self.T("f_rec"), style="Muted.TLabel").pack(anchor="w", pady=(self.px(6), 0))
            ttk.Label(body, text="  ·  ".join(h.replace(".bilivideo.com", "") for h in rec[:10]),
                      style="Small.TLabel", wraplength=self.wrap()).pack(anchor="w", pady=(self.px(2), 0))
        # 要不要把建議節點加入擴充、加到哪些瀏覽器（預設勾 Chrome）
        ext = ttk.Frame(body)
        ext.pack(fill="x", pady=(self.px(12), 0))
        ttk.Checkbutton(ext, text=self.T("add_to_ext"), variable=self.add_ext, command=self.on_add_ext).pack(anchor="w")
        row = ttk.Frame(ext)
        row.pack(anchor="w", padx=(self.px(28), 0))
        self.ext_checks = []
        for b, v in self.ext_vars.items():
            c = ttk.Checkbutton(row, text=b, variable=v)
            c.pack(side="left", padx=(0, self.px(22)))
            self.ext_checks.append(c)
        q = ttk.Frame(body, style="Soft.TFrame", padding=(self.px(14), self.px(10)))
        q.pack(fill="x", side="bottom")
        self.text(q, self.T("send_q"), style="Soft.TLabel", justify="left", wraplength=self.wrap(540)).pack(anchor="w")
        self.send_status = self.text(body, "", style="Muted.TLabel")
        self.send_status.pack(side="bottom", anchor="w", pady=self.px(6))
        ttk.Button(foot, text=self.T("open_folder"), command=self.open_folder).pack(side="left")
        self.send_btn = ttk.Button(foot, text=self.T("send") + "  ✉", style="Accent.TButton", command=self.send)
        self.send_btn.pack(side="right")
        ttk.Button(foot, text=self.T("dont_send"), command=lambda: self.show_thanks(False)).pack(
            side="left", padx=(self.px(10), 0))
        self.on_add_ext()
        if not CONFIG.get("upload_url"):
            self.send_btn.state(["disabled"])
            self.send_status.config(text=self.T("no_upload"))

    def on_add_ext(self):
        """不加入擴充時，瀏覽器選項停用，發送鈕改回單純「發送」"""
        on = self.add_ext.get()
        for c in self.ext_checks:
            c.state(["!disabled"] if on else ["disabled"])
        self.send_btn.config(text=self.T("send" if on else "send_only") + "  ✉")

    def target_browsers(self):
        return [b for b, v in self.ext_vars.items() if v.get()] if self.add_ext.get() else []

    def custom_hosts(self):
        """寫進擴充「自訂節點列表」的節點：測速核心依池分散挑的 custom_list（舊版結果沒有就用建議清單）"""
        sm = self.sm or {}
        return (sm.get("custom_list") or sm.get("recommended") or [])[:10]

    def build_custom_list(self, browser):
        """把節點交給這個瀏覽器裡的擴充（見 extdetect.py），回傳 ok / missing / outdated"""
        hosts = self.custom_hosts()
        if not hosts: return "missing"
        try:
            status = extdetect.import_hosts(browser, hosts)
        except Exception:
            traceback.print_exc(file=self.log)
            status = "missing"
        if status == "ok":
            self.log_event("custom_list", self.lottery_email())
        return status

    def open_folder(self):
        if os.name == "nt":
            os.startfile(self.out_dir)
        else:
            import subprocess
            subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", self.out_dir])

    def send(self):
        if self.add_ext.get() and not self.target_browsers() and \
                not messagebox.askyesno(self.T("no_browser_title"), self.T("no_browser_q"), parent=self):
            return
        self.send_btn.state(["disabled"])
        self.send_status.config(text=self.T("sending"))
        threading.Thread(target=self.send_worker, daemon=True).start()

    def send_worker(self):
        try:
            sm = self.sm
            e = sm["env"].get("exit") or {}
            bw = sm["env"].get("bandwidth") or {}
            email = "" if self.no_email.get() else self.email_var.get().strip()
            payload = dict(
                token=CONFIG.get("token", ""), action="report", app_version=APP_VERSION, lang=self.lang,
                test_mode=bool(self.test_mode.get()), email=email, no_compensation=bool(self.no_email.get()),
                invite_code=self.invite_ok_code() if email else "",
                gift=gift_for(sm["country"]), extension_url=CONFIG.get("extension_url") or EXT_URL_DEFAULT,
                meta=dict(country=sm["country"], city=e.get("city"), isp=e.get("org"), ip=e.get("ip"),
                          network=(sm["env"].get("network") or {}).get("kind"), time=sm.get("time"),
                          down_mbps=bw.get("down_mbps"), up_mbps=bw.get("up_mbps"), latency_ms=bw.get("latency_ms"),
                          ceiling=sm.get("ceiling"), default=sm.get("default"), login=sm["env"].get("login"),
                          n_nodes=self.n_nodes()),
                text=self.summary_text,
                report=open(os.path.join(self.out_dir, "REPORT.md"), encoding="utf-8").read(),
                summary=sm)
            r = post_json(payload)
            self.q.put(("sent", r.get("ok"), r.get("err")))
        except Exception as ex:
            self.q.put(("sent", False, str(ex)[:120]))

    def on_sent(self, ok, err):
        if ok:
            self.sent = True
            self.log_event("send", self.lottery_email())
            self.ext_results = {b: self.build_custom_list(b) for b in self.target_browsers()}
            self.show_thanks(True)
        else:
            self.send_btn.state(["!disabled"])
            self.send_status.config(text=self.T("send_failed", err=err))

    def quit_app(self):
        """關閉程式（感謝頁的「關閉」、視窗的 ✕）：報告已上傳的話先刪掉本機的結果"""
        if getattr(self, "sent", False):
            self.cleanup_local()
        self.destroy()

    def cleanup_local(self):
        """刪掉已上傳的本機結果資料夾（只刪 out_root() 底下的），CDN-SpeedTest 空了也一併刪"""
        root, d = os.path.abspath(out_root()), os.path.abspath(self.out_dir or "")
        if os.path.dirname(d) != root:
            return False
        self.log.detach()
        shutil.rmtree(d, ignore_errors=True)
        try:
            os.rmdir(root)   # 還有其他結果（例如沒送出的）就會失敗，保留
        except OSError:
            pass
        return not os.path.exists(d)

    def n_nodes(self):
        st = (self.sm or {}).get("stage1") or {}
        return st.get("n_nodes") or 299

    # ── 頁 7：感謝 ──────────────────────────────────────────
    def show_thanks(self, sent):
        email = "" if self.no_email.get() else self.email_var.get().strip()
        body, foot = self.page(7)
        pending = sent and any(st != "ok" for st in self.ext_results.values())
        if self._icon_big and not pending:  # 要顯示「還沒裝擴充」提示時省掉大圖示，免得版面太高
            ttk.Label(body, image=self._icon_big).pack(pady=(self.px(10), self.px(6)))
        ttk.Label(body, text="🎉  " + (self.T("thanks_hero") if sent else self.T("thanks_unsent_title")),
                  style="Hero.TLabel").pack()
        country = (self.sm or {}).get("country") or self.country or ""
        if sent:
            self.text(body, self.T("thanks_lead", n=self.n_nodes(), country=country), justify="center").pack(
                pady=(self.px(12), self.px(16)))
            if email:   # 參加抽獎才有後續步驟
                g = gift_for(country)
                gift = self.T("gift_word_v", gift=f"{g['vendor']} {g['amount']}".strip()) if g else self.T("gift_word")
                box = ttk.Frame(body, style="Soft.TFrame", padding=(self.px(18), self.px(14)))
                box.pack(fill="x")
                ttk.Label(box, text=self.T("thanks_next"), style="Soft.TLabel", font=self.fonts["h2"]).pack(anchor="w")
                for i, s in enumerate((self.T("thanks_step_mail", email=email), self.T("thanks_step_verify"),
                                       self.T("thanks_step_gift" if self.invite_ok_code() else "thanks_step_lottery",
                                              gift=gift)), 1):
                    self.text(box, f"{i}.  {s}", style="Soft.TLabel", justify="left",
                              wraplength=self.wrap(520)).pack(anchor="w", pady=(self.px(6), 0))
            self.ext_area = ttk.Frame(body)
            self.ext_area.pack(fill="x")
            self.text(body, "🧹  " + self.T("thanks_cleaned"), style="Muted.TLabel", justify="center").pack(
                side="bottom", pady=(self.px(8), 0))
            self.render_ext_area(retried=False)
        else:
            self.text(body, self.T("thanks_not_sent", path=self.out_dir), style="Muted.TLabel", justify="center").pack(
                pady=(self.px(14), 0))
            self.store_links(body).pack(pady=(self.px(18), 0))
        ttk.Button(foot, text=self.T("close"), style="Accent.TButton", command=self.quit_app).pack(side="right")

    def render_ext_area(self, retried):
        """感謝頁的「自訂節點列表」狀態（依發送時勾選的瀏覽器）：全部成功時不顯示（手動重試成功才說一聲）；
        還沒裝／版本太舊的瀏覽器各列一行並附安裝（更新）按鈕，中間放「建立自訂列表」重試"""
        for w in self.ext_area.winfo_children():
            w.destroy()
        failed = {b: st for b, st in self.ext_results.items() if st != "ok"}
        if not failed:
            if retried:
                box = tk.Frame(self.ext_area, bg="#E7F6EE", highlightbackground=C["ok"], highlightthickness=1)
                box.pack(fill="x", pady=(self.px(14), 0))
                tk.Label(box, text=cjk_wrap("✓  " + self.T("ext_built"), self.fonts["body"], self.px(520)),
                         bg="#E7F6EE", fg=C["ok"], font=self.fonts["body"], justify="left").pack(
                    anchor="w", padx=self.px(14), pady=self.px(10))
            return
        bg, fg = "#FFF4E5", "#9A5B00"
        box = tk.Frame(self.ext_area, bg=bg)
        box.pack(fill="x", pady=(self.px(14), 0))
        tk.Label(box, text=cjk_wrap("⚠  " + self.T("ext_missing_list"), self.fonts["body"], self.px(520)), bg=bg, fg=fg,
                 font=self.fonts["body"], justify="left").pack(anchor="w", padx=self.px(14), pady=(self.px(10), self.px(4)))
        for b, st in failed.items():
            row = tk.Frame(box, bg=bg)
            row.pack(fill="x", padx=(self.px(36), self.px(14)), pady=self.px(2))
            if st == "outdated":
                vers = ", ".join(sorted({x["version"] for x in extdetect.detect(b)[1]})) or "?"
                msg, btn = self.T("ext_st_outdated", ver=vers), self.T("update")
            else:
                msg, btn = self.T("ext_st_missing"), self.T("install")
            tk.Label(row, text=f"{b}：{msg}", bg=bg, fg=C["text"], font=self.fonts["body"]).pack(side="left")
            ttk.Button(row, text=btn, style="Small.TButton",
                       command=lambda b=b: webbrowser.open(self.store_url(b))).pack(side="right")
        ttk.Button(box, text="🧩  " + self.T("build_list"), style="Accent.TButton", command=self.retry_build).pack(
            pady=(self.px(10), self.px(12)))
        # 或是手動加：列出建議的 10 個節點（兩欄、可選取），附「全部複製」（擴充的輸入框可以一次貼上多個）
        hosts = self.custom_hosts()
        if not hosts: return
        man = tk.Frame(self.ext_area, bg="#FAFBFC", highlightbackground=C["line"], highlightthickness=1)
        man.pack(fill="x", pady=(self.px(10), 0))
        top = tk.Frame(man, bg="#FAFBFC")
        top.pack(fill="x", padx=self.px(14), pady=(self.px(8), self.px(4)))
        cb = ttk.Button(top, text=self.T("copy_all"), style="Small.TButton")
        cb.config(command=lambda: self.copy_hosts(hosts, cb))
        cb.pack(side="right")
        tk.Label(top, text=cjk_wrap(self.T("manual_add"), self.fonts["body"], self.px(400)), bg="#FAFBFC",
                 fg=C["text"], font=self.fonts["body"], justify="left").pack(side="left", anchor="w")
        # 一行一個往下列，最多顯示 5 行，其餘用自己的捲軸（滾輪在清單上捲的是清單）
        lst = tk.Frame(man, bg="#FAFBFC")
        lst.pack(fill="x", padx=(self.px(14), self.px(6)), pady=(0, self.px(8)))
        tx = tk.Text(lst, height=min(5, len(hosts)), wrap="none", relief="flat", bg="#FAFBFC", fg=C["text"],
                     font=("Consolas", 9), padx=0, pady=0, highlightthickness=0)
        tx.insert("1.0", "\n".join(f"{i:>2}. {h}" for i, h in enumerate(hosts, 1)))
        tx.config(state="disabled")
        if len(hosts) > 5:
            sb = ttk.Scrollbar(lst, orient="vertical", command=tx.yview)
            tx.configure(yscrollcommand=sb.set)
            sb.pack(side="right", fill="y")
        tx.pack(side="left", fill="x", expand=True)

    def copy_hosts(self, hosts, btn):
        self.clipboard_clear()
        self.clipboard_append("\n".join(hosts))
        btn.config(text="✓ " + self.T("copied"))
        self.after(1500, lambda: btn.winfo_exists() and btn.config(text=self.T("copy_all")))

    def retry_build(self):
        for b, st in list(self.ext_results.items()):
            if st != "ok":
                self.ext_results[b] = self.build_custom_list(b)
        self.render_ext_area(retried=True)


if __name__ == "__main__":
    App().mainloop()
