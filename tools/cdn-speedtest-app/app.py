#!/usr/bin/env python3
# Bilibili CDN 測速（GUI 版）：給海外朋友雙擊執行。流程：
#   1 入口：選語言（繁中／簡中／英／日／韓）、閱讀英文隱私聲明並勾選同意、（作者用）開發者測試模式藏在底部「進階設定 → 開發者選項」
#   2 測速目的：單純測試／建立擴充「自訂節點列表」，或參加抽獎（填 email、必中獎邀請碼；依國家顯示進行中的抽獎）
#   3 網路檢查：頻寬與 VPN；只有參加抽獎才當門禁，單純測試只做參考
#   4 B 站 App 掃 QR code 登入（必要，1080P 以上才準）
#   5 自動測速（國家依出口 IP；DNS 不代表當地時改用 Google DoH 帶自己的 ECS），進度條，可停止並關閉
#      測試模式：不測速，只跑 5 秒假進度，產生標示 TEST 的假報告
#   6 結果摘要，確認後把 REPORT.md / summary.json / 詳細記錄（log）/ email 傳到作者的 Google Apps Script，
#     並把建議的 10 個節點寫進瀏覽器擴充的「自訂節點列表」（extdetect.py）
#   7 感謝頁（沒裝擴充時提示安裝後再按「建立自訂列表」）；關閉時刪掉已上傳的本機結果
# 啟動時在背景檢查 GitHub Latest Release 有沒有新版 exe（updater.py）：還在入口頁就直接換新版重開，否則關閉時才換檔。
# 同意隱私聲明後，安裝／執行／測速／發送等事件會送一筆使用紀錄（Apps Script action=log → Neon）。
# 測速核心在 core/（speedtest.py / bili.py / videos.py / netinfo.py / nodes.json）。
import json, os, queue, re, shutil, subprocess, sys, threading, time, traceback, urllib.request, uuid, webbrowser
import tkinter as tk
from tkinter import ttk, messagebox

APP_VERSION = "1.10.0"
MAC = sys.platform == "darwin"
if MAC:
    # python.org 的 Mac 版 Python（打包用的）不讀系統鑰匙圈，預設 CA 檔也不存在，HTTPS 全部驗證失敗：改用 certifi 的 CA
    import ssl
    if not os.path.isfile(ssl.get_default_verify_paths().openssl_cafile or ""):
        try:
            import certifi
            os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        except ImportError:
            pass
HERE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
if not getattr(sys, "frozen", False):
    sys.path.insert(0, os.path.join(HERE, "core"))
sys.path.insert(0, HERE)
from i18n import LANGS, PRIVACY_EN, EXT_NAME, ext_name, t, default_lang  # noqa: E402
import extdetect  # noqa: E402
import lottery_text  # noqa: E402
import updater  # noqa: E402

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
# 1.6.0 起細測改成「快篩通過且冷門探測沒回 403 的全部節點」（原本只取前 80 名），真正下載的節點約多 1.6–2.2 倍，
# 細測權重由 24 調成 45；冷門探測只抓 1MB、403 立刻回應，給 3。尚未用實測校正
WEIGHTS = [("detect", 2), ("env", 6), ("pool", 12), ("pick", 4), ("ceiling", 5), ("stage1", 45), ("probe", 3),
           ("stage2", 45), ("report", 2)]


# 進行中抽獎的 metadata（report worker，不用 token）；文字由 lottery_text.py 組。
# v2：只有抽獎 v2（禮物卡各自有面額，lottery_text.py 兩種格式都吃）；/v1/lotteries 只有 v1 的抽獎，留給舊版 exe。
# 1.7.0（含）以前的 exe 是透過 Apps Script（action=lotteries）讀 lotteries.html，那條路保留給舊版用
LOTTERY_API = "https://bcs-report.bilibili-cdn-switcher-tools.workers.dev/v2/lotteries"
LOG_MAX = 500_000   # 隨報告送出的詳細記錄最多幾個字（只留最後這段）；一次測速約 20–40KB，Apps Script 整包上限 3MB


def post_json(payload, timeout=90):
    """POST 到 Apps Script 網頁應用程式（config.upload_url），回傳 JSON"""
    if not CONFIG.get("upload_url"):
        raise RuntimeError("no upload_url")
    req = urllib.request.Request(CONFIG["upload_url"], data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=timeout))


# 預估時間：各階段預估秒數加總。固定階段用 FIXED_SECS（2026-10 新加坡實測）；快篩／冷門探測／細測＝
# 筆數 × 每筆秒數 ÷ 並行數。每筆秒數在快篩前用 ITEM_SECS（由舊公式「耗時 ≈ 1.25 × (7 + 105 ÷ 並行數) 分鐘、
# 約 1900 筆」反推），快篩進行中改用快篩至今的實測 TTFB 與速度推算（Runner.item_secs）
FIXED_SECS = dict(detect=5, env=20, pool=270, pick=20, ceiling=30, report=5)
ITEM_SECS = 4.2
# 以下比例與速度都取自 cdn-speedtest-results/ 歷史報告的中位數（2026-10，139 份）
KEEP_RATIO = 0.34   # 快篩通過的節點比例（四分位 0.27–0.51）；快篩進行中改用至今的結果推估
PROBE_PASS = 0.55   # 快篩通過的節點裡，冷門探測沒回 403、進細測的比例（四分位 0.43–0.72）
# 典型單一連線速度（Mbps，網路檢查頁 B 站單連線實測的中位數；報告 ≥ 3 份的國家才列，其他國家用 default）。
# 只用在測速開始前的預估並行數；實際並行數由第 5 步「量測頻寬上限」重新量
TYPICAL_PER_CONN = dict(TW=92.5, HK=54.6, SG=35.5, JP=50.4, default=53.0)
N_SCREEN, N_TEST = 3, 10   # 快篩、細測影片數（videos.pick 的 n_screen、n_test）


def est_conc(down_mbps, country=None):
    """預估並行數，算法與測速相同：頻寬 × 0.5 ÷ 單一連線速度（最多算 8K 碼率上限 PER_CONN_CAP），限制在 1–8。
    單一連線速度用該國的典型值 TYPICAL_PER_CONN"""
    import speedtest as S
    per = TYPICAL_PER_CONN.get((country or "").upper()) or TYPICAL_PER_CONN["default"]
    return max(1, min(8, int(0.5 * (down_mbps or 50) / min(per, S.PER_CONN_CAP))))


def plan_secs(conc, n_nodes, keep1=None, keep2=None, item_probe=ITEM_SECS, item2=ITEM_SECS):
    """各階段預估秒數 {階段: 秒}。keep1＝快篩通過的節點數、keep2＝進細測的節點數（未知就用 KEEP_RATIO、PROBE_PASS 推）"""
    keep1 = int(n_nodes * KEEP_RATIO) if keep1 is None else keep1
    keep2 = int(keep1 * PROBE_PASS) if keep2 is None else keep2
    return dict(FIXED_SECS, stage1=n_nodes * N_SCREEN * ITEM_SECS / conc, probe=keep1 * item_probe / conc,
                stage2=keep2 * N_TEST * item2 / conc)


def fmt_minutes(secs):
    """顯示用的分鐘數：20 分鐘以內取整（無條件進位），以上取 5 的倍數"""
    m = secs / 60
    return max(1, -int(-m // 1)) if m <= 20 else int(5 * round(m / 5))


def estimate_minutes(down_mbps, country=None):
    """網路檢查頁顯示的預計分鐘數（測速開始後由實測一路修正，見 App.tick）"""
    import bili
    return fmt_minutes(sum(plan_secs(est_conc(down_mbps, country), len(bili.nodes())).values()))


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
    """這台電腦的隨機 ID（第一次執行時產生，存在 %LOCALAPPDATA%\\CDNSpeedTest；Mac 是 ~/Library/Application Support），
    回傳 (ID, 是否第一次執行)"""
    base = os.path.expanduser("~/Library/Application Support") if MAC else \
        os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "CDNSpeedTest")
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
        last_plan = [0.0]

        def progress(name, i, n):
            self.q.put(("progress", name, i, n))
            # 快篩進行中每 30 秒依至今的結果重算一次後面各步的預估（快篩跑完才算會差很多：細測預估要等 20 分鐘才修正）
            if name == "stage1" and time.time() - last_plan[0] >= 30:
                last_plan[0] = time.time()
                self.send_plan(S)
        S.PROGRESS = progress
        names = [n for n, _ in WEIGHTS]
        self.n_nodes = min(len(bili.nodes()), a.limit_nodes or 10 ** 9)
        self.cc = None
        self.secs = {}   # 各階段實際耗時（寫進 state.json，日後校正 FIXED_SECS／ITEM_SECS 用）

        def step(name, fn):
            i = names.index(name) + 1
            print(f"══ {time.strftime('%H:%M:%S')}  {i}/{len(names)} {t('st_' + name, 'zh-TW')}：開始 ══")
            self.q.put(("stage", name))
            t0 = time.time()
            fn()
            self.secs[name] = round(time.time() - t0)
            print(f"══ {i}/{len(names)} {t('st_' + name, 'zh-TW')}：完成，耗時 {self.secs[name]} 秒 ══")
            self.send_plan(S)

        def detect():
            nonlocal chk
            chk = S.dns_check()
            # step() 結束時就會送第一次預估，要先知道國家（並行數依國家的典型單連線速度推）
            self.cc = (chk["exit"].get("country") or "XX").upper()

        chk = None
        step("detect", detect)
        e = chk["exit"]
        S.PRESET_DNS_CHECK = None if e.get("err") else chk   # env 步驟直接沿用，不重查（查失敗就讓 env 再試一次）
        cc = self.cc = (e.get("country") or "XX").upper()
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
                         ("stage1", S.cmd_stage1), ("probe", S.cmd_probe), ("stage2", S.cmd_stage2),
                         ("report", S.cmd_report)):
            step(name, lambda fn=fn: fn(cc, a))
        S.STATE["stage_secs"] = self.secs
        print(f"總耗時 {sum(self.secs.values()) // 60} 分 {sum(self.secs.values()) % 60} 秒；各階段（秒）：{self.secs}")
        json.dump(S.STATE, open(os.path.join(S.OUT, "state.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        self.q.put(("done", S.OUT))

    def send_plan(self, S):
        """依目前已知的資訊（實際並行數、快篩通過幾個節點、快篩量到的速度）重算各階段預估秒數 → GUI。
        快篩還在跑時，用至今的結果推估：有結果的節點裡「目前全部成功」的比例 × 節點數 ≈ 會通過幾個"""
        bw = self.check.get("bw") or {}
        conc = S.STATE.get("conc") or est_conc(bw.get("down_mbps"), self.cc)
        keep1 = keep2 = None
        item_probe = item2 = ITEM_SECS
        if S.OUT and S.has("stage1.json"):
            keep1 = len(S.load("stage1.json")["keep"])
            item_probe, item2 = self.item_secs(S, S.load("stage1.json")["keep"])
        elif S.OUT and S.has("stage1.jsonl"):
            per = {}
            for r in self.stage1_rows(S):
                per.setdefault(r["host"], []).append(not r.get("err") and (r.get("bytes") or 0) > 0)
            if len(per) >= 20:   # 太少時比例不可靠，維持預設比例
                ok = [h for h, v in per.items() if all(v)]
                keep1 = round(self.n_nodes * len(ok) / len(per))
                item_probe, item2 = self.item_secs(S, ok)
        if S.OUT and S.has("probe.json"):
            keep2 = len(S.load("probe.json")["keep"])
        self.q.put(("plan", plan_secs(conc, self.n_nodes, keep1, keep2, item_probe, item2)))

    @staticmethod
    def stage1_rows(S):
        out = []
        try:
            for x in open(S.path("stage1.jsonl"), encoding="utf-8"):
                try:
                    out.append(json.loads(x))
                except ValueError:   # 空行、寫到一半的最後一行
                    pass
        except OSError:
            pass
        return out

    @classmethod
    def item_secs(cls, S, keep):
        """由快篩實測推估冷門探測（1MB）、細測（4MB，每筆最多 STAGE2_CAP 秒）每筆秒數：TTFB + 下載時間"""
        import statistics
        keep = set(keep)
        rs = cls.stage1_rows(S)
        rs = [r for r in rs if r["host"] in keep and not r.get("err") and r.get("mbps") and r.get("ttfb") is not None]
        if not rs:
            return ITEM_SECS, ITEM_SECS
        ttfb = statistics.mean(r["ttfb"] / 1000 for r in rs)
        mbps = statistics.median(r["mbps"] for r in rs)
        return ttfb + 8 / mbps, min(ttfb + 32 / mbps, S.STAGE2_CAP)


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
                           network=dict(kind="Wi-Fi"), bandwidth=dict(down_mbps=123.4, latency_ms=20),
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
if MAC:
    FAMILY = {"zh-TW": "PingFang TC", "zh-CN": "PingFang SC", "ja": "Hiragino Sans", "ko": "Apple SD Gothic Neo",
              "en": "Helvetica Neue"}
# Tk 的字級單位是 point：Windows 1pt = 96/72 px，Mac 1pt = 1px，Mac 不放大的話整個介面字太小
FONT_K = 1.25 if MAC else 1
MONO = "Menlo" if MAC else "Consolas"
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
        # 螢幕矮（例如 768 高的 Mac）時縮短視窗，免得底部按鈕被 Dock／工作列擋住；內容會捲動
        h = min(self.px(760), self.winfo_screenheight() - self.px(110))
        self.geometry(f"{self.px(680)}x{h}+{max(0, (self.winfo_screenwidth() - self.px(680)) // 2)}+{self.px(30)}")
        self.minsize(self.px(600), min(self.px(680), h))
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
        self.plan = None          # 測速中各階段預估秒數（Runner 每完成一步就依實測重算一次）
        self.log_lines = []       # 詳細記錄視窗的內容（含時間）
        self.country = None
        self.testing = False
        self.install_id, self.first_run = install_info()
        self.lottery_items = None       # 進行中抽獎的 metadata（全部國家；None＝還沒抓到或抓失敗，下次進這頁再抓）
        self.lottery_loading = False
        self.lottery_shown, self.lottery_idx, self.lottery_sliding = [], 0, False   # 「測速目的」頁 carousel：列出的抽獎、顯示中的是第幾個、是否正在滑動
        self.add_ext = tk.BooleanVar(value=True)             # 發送後把建議節點加入擴充的自訂節點列表
        # 預設勾 Chrome；Mac 有裝 Safari 版擴充（BiBoost）時改勾 Safari
        default_b = "Safari" if MAC and extdetect.safari_installs() else "Chrome"
        self.ext_vars = {b: tk.BooleanVar(value=(b == default_b)) for b in extdetect.BROWSERS}
        self.ext_results = {}       # 各瀏覽器建立自訂節點列表的結果：ok / missing / outdated（感謝頁用）
        self.left_entry = False     # 按過入口頁的「下一步」：之後下載好的新版留到關閉程式時才換
        self.update_file = None     # 已下載、驗證過的新版 exe
        self.update_avail = None    # Mac：Latest 有比較新的版本（入口頁顯示下載連結）
        self.protocol("WM_DELETE_WINDOW", self.quit_app)
        self.bind_all("<MouseWheel>", self.on_wheel)
        if MAC:   # ⌘Q／選單的「結束」跟按 ✕ 一樣（測速中會先問、感謝頁會清掉已上傳的結果）
            self.createcommand("tk::mac::Quit", lambda: self.tk.eval(self.protocol("WM_DELETE_WINDOW")))
        self.after(100, self.pump)
        self.show_entry()
        threading.Thread(target=self.update_worker, daemon=True).start()
        # 抽獎清單一啟動就先抓（不送任何資料，隱私聲明有列這個 Worker），進第 2 頁時通常已經抓好、不用等；
        # 國家偵測（查出口 IP）還是等同意隱私聲明、進第 2 頁才做
        self.lottery_loading = True
        threading.Thread(target=self.lottery_worker, daemon=True).start()

    # ── 自我更新（updater.py） ─────────────────────────────
    def update_worker(self):
        if MAC:   # Mac 版不自動換檔，只在入口頁顯示下載連結
            v = updater.check_only(APP_VERSION)
            if v: self.q.put(("update_avail", v))
            return
        updater.cleanup()
        r = updater.check_and_download(APP_VERSION)
        if r: self.q.put(("update_ready", *r))

    def on_update_avail(self, ver):
        self.update_avail = ver
        if not self.left_entry: self.show_entry()

    def on_update_ready(self, ver, path):
        self.update_file = path
        if self.left_entry: return   # 已經在流程中：不打斷，關閉時再換
        body, _ = self.page()
        self.text(body, self.T("updating", v=ver), style="H2.TLabel").pack(pady=(self.px(80), 0))
        self.after(800, self.restart_updated)

    def restart_updated(self):
        if updater.apply(self.update_file, restart=True):
            self.destroy()
            os._exit(0)
        self.update_file = None
        self.show_entry()

    def apply_update_on_exit(self):
        if self.update_file:
            updater.apply(self.update_file, restart=False)
            self.update_file = None

    # ── 外觀 ──────────────────────────────────────────────
    def px(self, n):
        return int(n * self.scale)

    def setup_fonts(self):
        import tkinter.font as tkfont
        fam = FAMILY.get(self.lang, FAMILY["en"]) if os.name == "nt" or MAC else "Helvetica"
        spec = dict(body=(11, "normal"), small=(9, "normal"), h1=(18, "bold"), h2=(12, "bold"), brand=(12, "bold"),
                    hero=(24, "bold"), tiny=(8, "normal"))
        for k, (size, weight) in spec.items():  # 單位是 point：DPI aware 後 Tk 會依縮放自動換算
            if k in self.fonts:
                self.fonts[k].configure(family=fam, size=round(size * FONT_K), weight=weight)
            else:
                self.fonts[k] = tkfont.Font(self, family=fam, size=round(size * FONT_K), weight=weight)
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
        s.configure("Adv.TButton", background=C["bg"], foreground="#9499A0", borderwidth=0, padding=0)
        s.map("Adv.TButton", background=[("active", C["bg"])], foreground=[("active", C["muted"])])
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
        s.configure("Adv.TButton", font=f["tiny"])
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
        if self.update_avail:
            ttk.Button(body, text="⬆ " + self.T("update_avail", v=self.update_avail), style="Link.TButton",
                       cursor="hand2", width=0, command=lambda: webbrowser.open(updater.MAC_DOWNLOAD_URL)).pack(
                anchor="w", pady=(0, self.px(6)))

        nxt = ttk.Button(foot, text=self.T("next") + "  →", style="Accent.TButton", command=self.entry_next)
        upd = lambda: nxt.state(["!disabled"] if self.agree.get() else ["disabled"])
        ttk.Checkbutton(body, text=self.T("agree"), variable=self.agree, command=upd).pack(anchor="w")
        nxt.pack(side="right")
        # 開發者測試模式藏在「進階設定 → 開發者選項」第二層選單，免得一般使用者誤點
        adv = ttk.Button(foot, text=self.T("advanced"), style="Adv.TButton", cursor="hand2", width=0)
        adv.config(command=lambda: self.advanced_menu(adv))
        adv.pack(side="left", anchor="s")
        upd()

    def advanced_menu(self, anchor):
        if getattr(self, "_adv_menu", None): self._adv_menu.destroy()
        m = self._adv_menu = tk.Menu(self, tearoff=0, font=self.fonts["small"])
        dev = tk.Menu(m, tearoff=0, font=self.fonts["small"])
        dev.add_checkbutton(label=self.T("test_mode"), variable=self.test_mode, command=self.on_test_mode)
        m.add_cascade(label=self.T("developer"), menu=dev)
        m.update_idletasks()   # 按鈕貼著視窗底部，選單往上彈才不會跑出視窗
        m.tk_popup(anchor.winfo_rootx(), anchor.winfo_rooty() - m.winfo_reqheight())

    def on_test_mode(self):
        self.set_title()
        self.banner.config(text=self.T("test_banner") if self.test_mode.get() else "")

    def entry_next(self):
        """同意隱私聲明後才送使用紀錄（第一次在這台電腦執行多送一筆 install），每次開程式只送一次"""
        if not getattr(self, "run_logged", False):
            self.run_logged = True
            if self.first_run: self.log_event("install")
            self.log_event("run")
        self.left_entry = True
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
        for i, k in enumerate(("m_vpn", "m_down", "m_lat")):   # VPN 最先出結果，排第一
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
        # 目前在做什麼（最新一行記錄）：分得出是卡住還是在等
        self.logline = ttk.Label(body, text="", style="Tiny.TLabel", wraplength=self.wrap())
        self.logline.pack(side="bottom", anchor="w")
        ttk.Button(foot, text="←  " + self.T("back"), command=self.show_email).pack(side="left")
        ttk.Button(foot, text="📄  " + self.T("log_btn"), command=self.show_log).pack(side="left", padx=(self.px(10), 0))
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
        self.metric["m_lat"].config(text=fmt(bw.get("latency_ms"), "ms"))
        if vpn is not None: self.on_check_vpn(gen, vpn)
        # 網速與 VPN 只有參加抽獎才當門禁；單純測試（多半只是想建立自己的節點列表，網路環境常常比較複雜）只提示
        lottery = self.join.get() == "lottery"
        self.est_min = estimate_minutes(down, self.country) if down else None
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
        # 每次檢查完都能手動重測（行動網路等的速度起伏大，量到偏低的時候常常再測一次就正常）
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
        # 使用者所在國家進行中的抽獎：不管選哪個都顯示，吸引參加；沒有就顯示「目前暫無進行中的活動」，抓到之前是空的
        self.lottery_slot = ttk.Frame(body, padding=(self.px(28), self.px(6), 0, 0))
        self.lottery_slot.pack(fill="x")
        # 選了參加抽獎才出現：email、必中獎邀請碼（獎品寫在上方的抽獎內容裡）
        form = self.lottery_form = ttk.Frame(body, padding=(self.px(28), self.px(6), 0, 0))
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
        if self.lottery_items is not None:
            self.render_lotteries()
        elif not self.lottery_loading:
            self.lottery_loading = True
            threading.Thread(target=self.lottery_worker, daemon=True).start()

    # ── 進行中的抽獎：report worker 給 metadata（全部國家），只顯示使用者所在國家的；文字由 lottery_text.py 組成
    #    HTML，用 tkinterweb 顯示 ──
    def lottery_worker(self):
        try:
            req = urllib.request.Request(LOTTERY_API, headers={"User-Agent": f"CDNSpeedTest/{APP_VERSION}"})
            r = json.load(urllib.request.urlopen(req, timeout=20))
            items = r.get("items") if r.get("ok") else None
        except Exception:
            items = None
        self.q.put(("lotteries", items))

    def on_lotteries(self, items):
        self.lottery_loading = False
        if isinstance(items, list):
            self.lottery_items = items
        self.render_lotteries()

    def render_lotteries(self):
        if not (hasattr(self, "lottery_slot") and self.lottery_slot.winfo_exists()): return
        for w in self.lottery_slot.winfo_children(): w.destroy()
        show_all = self.test_mode.get()   # 開發者測試模式：不管國家，全部顯示
        if self.lottery_items is None or not (self.country or show_all):   # 還沒抓到（或抓失敗）、國家還沒偵測到：先不顯示
            return
        now = time.time() * 1000
        items = [i for i in self.lottery_items
                 if (show_all or i.get("country") == self.country) and i.get("startsAt", 0) <= now < i.get("endsAt", 0)]
        if not items:
            self.text(self.lottery_slot, self.T("lottery_none"), style="Muted.TLabel").pack(anchor="w")
            return
        # 多個抽獎時是 carousel：一次顯示一個，左右滑動切換（不循環，到頭／到尾那邊的箭頭變灰），下方圓點指示目前是第幾個；
        # 只有一個就不顯示導覽列。每個抽獎各一個 HtmlFrame，疊在同一個舞台（stage）裡，用 place(relx=…) 移動，
        # 超出舞台的部分 Tk 會裁掉。舞台高度取所有抽獎裡最高的，切換時不會跳動
        from tkinterweb import HtmlFrame
        try:
            htmls = [lottery_text.to_html(i, self.lang) for i in items]
        except Exception:   # metadata 不完整（理論上 lottery.mjs 會擋）
            return
        self.lottery_shown, self.lottery_idx, self.lottery_sliding = items, 0, False
        stage = self.lottery_stage = tk.Frame(self.lottery_slot, bg=C["accent_soft"], height=self.px(120))
        stage.pack(fill="x")
        stage.pack_propagate(False)
        self.lottery_pages = []
        for i, h in enumerate(htmls):
            hf = HtmlFrame(stage, messages_enabled=False, horizontal_scrollbar=False, vertical_scrollbar="auto",
                           on_link_click=webbrowser.open)
            hf.load_html(f"<html><body style=\"margin:10px 14px;font-family:'{FAMILY.get(self.lang, 'Segoe UI')}';"
                         f"font-size:{round(10 * FONT_K)}pt;color:{C['text']};background:{C['accent_soft']}\">" + h + "</body></html>")
            hf.place(relx=0 if i == 0 else 1, y=0, relwidth=1, relheight=1)
            self.lottery_pages.append(hf)
        if len(items) > 1:
            self.lottery_nav_build()

        def fit():   # 舞台高度＝最高的那個抽獎，最多 220（超過就捲動）
            try:
                if not stage.winfo_exists(): return
                h = max(int(p.html.bbox()[3]) for p in self.lottery_pages)
            except Exception:
                return
            if h > 0: stage.configure(height=min(h + 4, self.px(220)))
        # 排版完成的時間不固定（量太早會拿到 0 或不完整的高度，框就停在初始的 120）：多量幾次
        for ms in (150, 500, 1200):
            self.after(ms, fit)

    def lottery_nav_build(self):
        """carousel 導覽列：‹（圓形按鈕）・圓點指示器・›；都畫在 Canvas 上（ttk 按鈕做不出網頁 carousel 的樣子）"""
        nav = tk.Frame(self.lottery_slot, bg=C["card"])
        nav.pack(pady=(self.px(8), 0))
        s, lw = self.px(26), max(2, self.px(2))
        self.lottery_arrows = {}
        for d in (-1, 1):
            cv = tk.Canvas(nav, width=s, height=s, bg=C["card"], highlightthickness=0, bd=0)
            cv.create_oval(1, 1, s - 2, s - 2, outline=C["line"], fill=C["card"], tags="ring")
            m, a = s / 2, s * 0.14
            pts = (m - d * a * 0.5, m - a, m + d * a * 0.5, m, m - d * a * 0.5, m + a)
            cv.create_line(*pts, width=lw, capstyle="round", joinstyle="round", tags="chev")
            cv.bind("<Button-1>", lambda e, d=d: self.lottery_go(self.lottery_idx + d))
            cv.bind("<Enter>", lambda e, cv=cv: self.lottery_arrow_hover(cv, True))
            cv.bind("<Leave>", lambda e, cv=cv: self.lottery_arrow_hover(cv, False))
            cv.pack(side="left" if d < 0 else "right")
            self.lottery_arrows[d] = cv
        n, gap, r = len(self.lottery_pages), self.px(14), self.px(3.5)
        dots = self.lottery_dots = tk.Canvas(nav, width=n * gap, height=s, bg=C["card"], highlightthickness=0, bd=0,
                                             cursor="hand2")
        for i in range(n):
            cx = gap * i + gap / 2
            dots.create_oval(cx - r, s / 2 - r, cx + r, s / 2 + r, outline="", tags=f"dot{i}")
        dots.bind("<Button-1>", lambda e: self.lottery_go(min(n - 1, int(e.x // gap))))
        dots.pack(side="left", padx=self.px(10))
        self.lottery_nav_update()

    def lottery_arrow_hover(self, cv, on):
        enabled = cv.cget("cursor") == "hand2"
        cv.itemconfigure("ring", fill=C["accent_soft"] if on and enabled else C["card"],
                         outline=C["accent"] if on and enabled else C["line"])

    def lottery_nav_update(self):
        n, i = len(self.lottery_pages), self.lottery_idx
        for d, cv in self.lottery_arrows.items():
            enabled = 0 <= i + d < n
            cv.itemconfigure("chev", fill=C["accent_dark"] if enabled else C["line"])
            cv.configure(cursor="hand2" if enabled else "")
            if not enabled: cv.itemconfigure("ring", fill=C["card"], outline=C["line"])
        for k in range(n):
            self.lottery_dots.itemconfigure(f"dot{k}", fill=C["accent"] if k == i else C["line"])

    def lottery_go(self, i):
        """滑到第 i 個抽獎：舊的往一邊滑出、新的從另一邊滑入（約 0.26 秒，減速）；超出範圍或滑動中不動"""
        n = len(self.lottery_pages)
        if not (0 <= i < n) or i == self.lottery_idx or self.lottery_sliding: return
        old, new = self.lottery_pages[self.lottery_idx], self.lottery_pages[i]
        d = 1 if i > self.lottery_idx else -1
        self.lottery_idx, self.lottery_sliding = i, True
        self.lottery_nav_update()
        steps, dur = 16, 260
        new.place_configure(relx=d)

        def frame(k):
            if not (old.winfo_exists() and new.winfo_exists()):
                self.lottery_sliding = False
                return
            e = 1 - (1 - k / steps) ** 3   # ease-out cubic
            old.place_configure(relx=-d * e)
            new.place_configure(relx=d * (1 - e))
            if k < steps:
                self.after(dur // steps, lambda: frame(k + 1))
            else:
                self.lottery_sliding = False
        frame(1)

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
        self.render_lotteries()

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
        # 開發用：從原始碼執行且設了 CDNST_DEV_COOKIE_FILE 時，沿用檔案裡的登入、登入成功後寫回（chmod 600）。
        # 檔案放 repo 外，內容不印出；打包後的 App 一律不讀不寫，cookie 只留在記憶體
        dev = None if getattr(sys, "frozen", False) else os.environ.get("CDNST_DEV_COOKIE_FILE")
        if dev:
            try:
                with open(dev, encoding="utf-8") as f:
                    saved = f.read().strip()
                if saved:
                    print("[開發] 沿用 CDNST_DEV_COOKIE_FILE 的 B 站登入（檔案刪掉就會改回掃 QR code）")
                    self.q.put(("login_ok", gen, saved))
                    return
            except OSError:
                pass
        while alive():
            try:
                ql = QRLogin()
                self.q.put(("qr", gen, ql.generate()))
                while alive():
                    time.sleep(2)
                    code = ql.poll()
                    if not alive(): return
                    if code == SUCCESS:
                        cookie = ql.cookie()
                        if dev:
                            try:
                                fd = os.open(dev, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                                with os.fdopen(fd, "w", encoding="utf-8") as f:
                                    f.write(cookie)
                                os.chmod(dev, 0o600)
                            except OSError:
                                pass
                        self.q.put(("login_ok", gen, cookie))
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
        self.desc = self.text(body, self.T("test_desc", min=self.est_min or "30–110"), style="Muted.TLabel",
                              justify="center")
        self.desc.pack(pady=(self.px(6), 0))
        info = ttk.Frame(body, style="Soft.TFrame", padding=(self.px(16), self.px(10)))
        info.pack(fill="x", pady=(self.px(18), self.px(22)))
        self.env_label = ttk.Label(info, text="…", style="Soft.TLabel", justify="center")
        self.env_label.pack()
        self.stage_label = ttk.Label(body, text="", style="H2.TLabel")
        self.stage_label.pack(anchor="w")
        self.stage_desc = ttk.Label(body, text="", style="Muted.TLabel", wraplength=self.wrap())
        self.stage_desc.pack(anchor="w", pady=(self.px(2), 0))
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
        ttk.Button(foot, text="📄  " + self.T("log_btn"), command=self.show_log).pack(side="left", padx=(self.px(10), 0))
        self.testing = True
        self.protocol("WM_DELETE_WINDOW", self.stop_and_close)
        self.log_event("guaranteed" if self.invite_ok_code() else "lottery" if self.lottery_email() else "free",
                       self.lottery_email())
        self.t0, self.frac, self.desc_total = time.time(), 0.0, None
        self.plan, self.cur_stage, self.stage_t0, self.cur_prog, self.prog0 = None, None, time.time(), None, None
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
        self.cur_stage, self.stage_t0, self.cur_prog, self.prog0 = name, time.time(), None, None
        if not self.plan:
            self.set_frac(self.stage_base(name)[0])
        idx = [n for n, _ in WEIGHTS].index(name) + 1 if name in dict(WEIGHTS) else 0
        self.stage_label.config(text=f"{idx}/{len(WEIGHTS)}  {self.T('st_' + name)}")
        self.stage_desc.config(text=cjk_wrap(self.T("sd_" + name), self.fonts["body"], self.wrap()), wraplength=0)
        self.detail.config(text="")
        self.update_desc()

    def on_progress(self, name, i, n):
        if name == self.cur_stage:
            self.cur_prog = (i, n)
            if self.prog0 is None:
                self.prog0 = (time.time(), i)   # 速度從這一步第一次回報進度起算（快篩：試連、先記完連不上的節點之後）
        if not self.plan:
            base, w = self.stage_base(name)
            self.set_frac(base + w * (i / max(1, n)))
        self.detail.config(text=f"{i} / {n}")

    def on_plan(self, plan):
        self.plan = plan
        self.update_desc()

    def rate(self):
        """目前這步的實際速度（筆／秒）：從第一次回報進度起算，已完成 3% 以上且跑了 10 秒以上才算，否則 None"""
        if not self.prog0 or not self.cur_prog: return None
        (t0, i0), (i, n) = self.prog0, self.cur_prog
        el, di = time.time() - t0, i - i0
        return di / el if n and di >= max(3, (n - i0) * 0.03) and el > 10 else None

    def remaining_secs(self):
        """預估剩餘秒數：目前這步有實際速度（rate）就用它推算，否則用預估秒數扣掉已經過的時間；
        再加上後面各步的預估秒數。還沒有預估回 None"""
        if not self.plan or not self.cur_stage: return None
        names = [n for n, _ in WEIGHTS]
        r = self.rate()
        if r:
            i, n = self.cur_prog
            left = (n - i) / r
        else:
            left = max(self.plan.get(self.cur_stage, 0) - (time.time() - self.stage_t0), 0)
        after = names[names.index(self.cur_stage) + 1:] if self.cur_stage in names else []
        return left + sum(self.plan.get(s, 0) for s in after)

    def update_desc(self):
        """標題下「預計約需 N 分鐘」改成最新預估的總時間（已經過 + 預估剩餘）。每秒由 tick 檢查，
        但跟目前顯示的差 2 分鐘以上、且超過 10% 才改，免得數字一直跳"""
        rem = self.remaining_secs()
        if rem is None or not (hasattr(self, "desc") and self.desc.winfo_exists()): return
        total, shown = time.time() - self.t0 + rem, self.desc_total
        if shown is not None and abs(total - shown) < max(120, 0.1 * shown): return
        if shown is not None and fmt_minutes(total) == fmt_minutes(shown): return   # 顯示出來一樣（20 分鐘以上取 5 的倍數）
        if shown is not None and self.cur_stage in ("stage1", "probe", "stage2") and not self.rate():
            # 這幾步剛開始時剩餘時間還是事前預估，幾秒後就改用實際速度推算；先不改標題，免得 25 → 30 → 25 來回跳
            return
        self.desc_total = total
        # 寫進詳細記錄（會隨報告送出），事後對照預估與實際耗時
        el = time.time() - self.t0
        print(f"預計總時間：約 {fmt_minutes(total)} 分鐘" + (f"（原本約 {fmt_minutes(shown)} 分鐘）" if shown else "")
              + f"；已經過 {int(el // 60)}:{int(el % 60):02d}，目前在「{t('st_' + self.cur_stage, 'zh-TW')}」", flush=True)
        txt = self.T("test_desc", min=fmt_minutes(total))
        self.desc.config(text=cjk_wrap(txt, self.fonts["body"], self.wrap()), wraplength=0)

    def on_env(self, d):
        self.env_label.config(text=f"📍 {d['country']} {d.get('city') or ''}　·　{d.get('org') or ''}\n"
                                   f"DNS：{self.T('dns_doh') if d.get('doh') else self.T('dns_sys')}")

    def on_log(self, line):
        line = f"{time.strftime('%H:%M:%S')}  {line}"
        self.log_lines.append(line)
        if hasattr(self, "logline") and self.logline.winfo_exists():
            self.logline.config(text=line[:160])
        w = getattr(self, "log_text", None)
        if w is not None and w.winfo_exists():
            at_end = w.yview()[1] >= 0.999   # 使用者往上捲在看舊記錄時就不要自動捲到底
            w.config(state="normal")
            w.insert("end", line + "\n")
            w.config(state="disabled")
            if at_end: w.see("end")

    def show_log(self):
        """詳細記錄視窗：每一步的開始／完成與耗時、各階段的輸出（同 run.log），測速中持續更新"""
        w = getattr(self, "log_win", None)
        if w is not None and w.winfo_exists():
            w.deiconify(); w.lift()
            return
        w = self.log_win = tk.Toplevel(self)
        w.title(self.T("log_btn"))
        w.geometry(f"{self.px(760)}x{self.px(480)}")
        w.configure(bg=C["card"])
        sb = ttk.Scrollbar(w)
        sb.pack(side="right", fill="y")
        t = self.log_text = tk.Text(w, wrap="word", font=self.fonts["small"], yscrollcommand=sb.set, bg=C["card"],
                                    fg=C["text"], relief="flat", padx=self.px(10), pady=self.px(8))
        t.pack(fill="both", expand=True)
        sb.config(command=t.yview)
        t.insert("end", "".join(x + "\n" for x in self.log_lines))
        t.config(state="disabled")
        t.see("end")

    def tick(self):
        if not (hasattr(self, "eta") and self.eta.winfo_exists()) or not self.testing: return
        el = time.time() - self.t0
        txt = f"⏱  {self.T('elapsed')} {int(el // 60)}:{int(el % 60):02d}"
        rem = self.remaining_secs()
        if rem is not None:
            self.set_frac(el / max(1.0, el + rem))   # 有預估時進度條依時間走，與剩餘時間一致
            txt += "　·　" + self.T("remaining", m=int(rem // 60) + 1)
        elif self.frac > 0.15:
            txt += "　·　" + self.T("remaining", m=int(el * (1 - self.frac) / self.frac // 60) + 1)
        self.eta.config(text=txt)
        self.update_desc()
        self.after(1000, self.tick)

    def stop_and_close(self):
        """測速中途停止：確認後直接結束程式（背景測速執行緒會一起結束，不發送任何資料）"""
        if self.testing and not messagebox.askyesno(self.T("stop_q_title"), self.T("stop_q"), parent=self):
            return
        self.apply_update_on_exit()
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
                (self.T("f_bw"), f"↓ {bw.get('down_mbps')} Mbps"),
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
                extension_url=CONFIG.get("extension_url") or EXT_URL_DEFAULT,
                # 詳細記錄（同「📄 詳細記錄」視窗：含網路檢查頁、每步開始／完成與耗時），作者事後分析用；
                # 只有測速時印出的訊息，不含 cookie、email
                log="\n".join(self.log_lines)[-LOG_MAX:],
                meta=dict(country=sm["country"], city=e.get("city"), isp=e.get("org"), ip=e.get("ip"),
                          network=(sm["env"].get("network") or {}).get("kind"), time=sm.get("time"),
                          down_mbps=bw.get("down_mbps"), latency_ms=bw.get("latency_ms"),
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
        self.apply_update_on_exit()
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
                gift = self.T("gift_word")
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
            self.phone_import_box(body)
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
        try:
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
                         font=(MONO, round(9 * FONT_K)), padx=0, pady=0, highlightthickness=0)
            tx.insert("1.0", "\n".join(f"{i:>2}. {h}" for i, h in enumerate(hosts, 1)))
            tx.config(state="disabled")
            if len(hosts) > 5:
                sb = ttk.Scrollbar(lst, orient="vertical", command=tx.yview)
                tx.configure(yscrollcommand=sb.set)
                sb.pack(side="right", fill="y")
            tx.pack(side="left", fill="x", expand=True)
        finally:   # Safari 的提示框排在最後（瀏覽器的順序 Safari 也在最後）
            if self.ext_results.get("Safari") == "ok":
                self.safari_hint_box()

    def safari_hint_box(self):
        """Safari 讀不到擴充有沒有啟用、有沒有允許 bilibili.com：開了網址就提醒怎麼確認，附重新匯入的按鈕"""
        sbox = tk.Frame(self.ext_area, bg="#FAFBFC", highlightbackground=C["line"], highlightthickness=1)
        sbox.pack(fill="x", pady=(self.px(14), 0))
        tk.Label(sbox, text=cjk_wrap("🧭  " + self.T("safari_hint"), self.fonts["body"], self.px(520)),
                 bg="#FAFBFC", fg=C["text"], font=self.fonts["body"], justify="left").pack(
            anchor="w", padx=self.px(14), pady=(self.px(10), self.px(4)))
        ttk.Button(sbox, text=self.T("safari_retry"), style="Small.TButton",
                   command=lambda: self.build_custom_list("Safari")).pack(anchor="e", padx=self.px(14),
                                                                         pady=(0, self.px(10)))

    def phone_import_box(self, parent):
        """「加到 iPhone / iPad」：匯入網址的 QR code（用相機掃描、Safari 開啟，由 Safari 版擴充匯入）＋複製網址；
        Mac 另有「用 AirDrop 傳送」。iPhone 開 www 會被轉到 m.bilibili.com，hash 會跟著保留，擴充在 m 站一樣匯入"""
        hosts = self.custom_hosts()
        if not hosts: return
        url = extdetect.IMPORT_URL + ",".join(hosts)
        bg = "#FAFBFC"
        box = tk.Frame(parent, bg=bg, highlightbackground=C["line"], highlightthickness=1)
        box.pack(fill="x", pady=(self.px(10), 0))
        tk.Label(box, text="📱  " + self.T("phone_title"), bg=bg, fg=C["text"], font=self.fonts["h2"]).pack(
            anchor="w", padx=self.px(14), pady=(self.px(10), self.px(4)))
        row = tk.Frame(box, bg=bg)
        row.pack(fill="x", padx=self.px(14), pady=(0, self.px(12)))
        import qrcode
        qr = qrcode.QRCode(border=2, error_correction=qrcode.constants.ERROR_CORRECT_L)
        qr.add_data(url)
        qr.make(fit=True)
        m = qr.get_matrix()
        cell = max(2, self.px(150) // len(m))
        size = cell * len(m)
        cv = tk.Canvas(row, width=size, height=size, bg="white", highlightthickness=0)
        for y, r in enumerate(m):
            for x, v in enumerate(r):
                if v: cv.create_rectangle(x * cell, y * cell, (x + 1) * cell, (y + 1) * cell, fill="black", outline="")
        cv.pack(side="left", anchor="n")
        right = tk.Frame(row, bg=bg)
        right.pack(side="left", fill="x", expand=True, padx=(self.px(14), 0))
        tk.Label(right, text=cjk_wrap(self.T("phone_desc"), self.fonts["body"], self.px(330)), bg=bg, fg=C["text"],
                 font=self.fonts["body"], justify="left").pack(anchor="w")
        btns = tk.Frame(right, bg=bg)
        btns.pack(anchor="w", pady=(self.px(10), 0))
        cb = ttk.Button(btns, text=self.T("copy_url"), style="Small.TButton")

        def copy():
            self.clipboard_clear()
            self.clipboard_append(url)
            cb.config(text="✓ " + self.T("copied"))
            self.after(1500, lambda: cb.winfo_exists() and cb.config(text=self.T("copy_url")))
        cb.config(command=copy)
        cb.pack(side="left")
        if MAC:
            ttk.Button(btns, text=self.T("airdrop"), style="Small.TButton",
                       command=lambda: self.airdrop(url)).pack(side="left", padx=(self.px(8), 0))

    def airdrop(self, url):
        """Mac：用系統的 AirDrop 分享視窗傳網址（NSSharingService，透過 osascript 的 JavaScript ObjC bridge，不需要 pyobjc）。
        分享視窗跟著 osascript 行程，留 5 分鐘讓使用者選裝置；失敗就安靜略過（還有 QR code 與複製網址）"""
        js = ("ObjC.import('AppKit');function run(a){var app=$.NSApplication.sharedApplication;"
              "app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);"
              "var s=$.NSSharingService.sharingServiceNamed('com.apple.share.AirDrop.send');"
              "var it=$.NSArray.arrayWithObject($.NSURL.URLWithString(a[0]));"
              "if(!s||s.isNil()||!s.canPerformWithItems(it))return 'unavailable';"
              "app.activateIgnoringOtherApps(true);s.performWithItems(it);"
              "$.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(300));return 'shown';}")
        try:
            subprocess.Popen(["osascript", "-l", "JavaScript", "-e", js, url], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
            print("[AirDrop] 開啟分享視窗")
        except OSError as e:
            print(f"[AirDrop] 無法開啟：{e}")

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
