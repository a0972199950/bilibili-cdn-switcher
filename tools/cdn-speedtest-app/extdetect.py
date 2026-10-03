# 找出這台電腦哪些瀏覽器（設定檔）裝了擴充，並用該瀏覽器開匯入網址，把測速推薦的節點寫進擴充的「自訂節點列表」。
# 瀏覽器不讓外部程式直接寫擴充的 storage，所以改成開 B 站網址、由擴充的 content script（bridge.js）從網址讀節點：
#   https://www.bilibili.com/#cdnsw-import=1.<host>,<host>,…
# 擴充只收自己節點清單裡有的節點，見 src/background.js。
# 安裝與否看瀏覽器設定檔：Chromium 系看 Secure Preferences／Preferences 的 extensions.settings，
# Firefox 看設定檔的 extensions.json。商店版要夠新（MIN_VERSION 起才有匯入功能）；開發者載入的未封裝版一律算可用。
import glob, json, os, re, subprocess

STORE_IDS = {"dfaddcffoondcendifiljhdbdagebgch",   # Chrome 線上應用程式商店（Edge 也可能從這裡裝）
             "dllallgilijcacpdemjafegibdafcbdp"}   # Edge 附加元件
GECKO_ID = "bilibili-cdn-switcher@a0972199950.github.io"
MIN_VERSION = (1, 7, 0)   # 第一個有「自訂節點列表」匯入功能的擴充版本
BROWSERS = ("Chrome", "Firefox", "Edge")   # GUI 讓使用者勾選的瀏覽器
CHROMIUM = [("Chrome", r"Google\Chrome\User Data", "chrome.exe"),
            ("Edge", r"Microsoft\Edge\User Data", "msedge.exe")]
IMPORT_URL = "https://www.bilibili.com/#cdnsw-import=1."
UTM = "utm_source=cdn_speedtest_app&utm_medium=referral&utm_campaign=speedtest"
STORE_URLS = {   # 各瀏覽器的擴充商店頁（入口頁連結、感謝頁的安裝按鈕）
    "Chrome": "https://chromewebstore.google.com/detail/dfaddcffoondcendifiljhdbdagebgch?" + UTM,
    "Firefox": "https://addons.mozilla.org/addon/bilibili-cdn-switcher/?" + UTM,
    "Edge": "https://microsoftedge.microsoft.com/addons/detail/dllallgilijcacpdemjafegibdafcbdp?" + UTM,
}


def ver(s):
    return tuple(int(x) for x in re.findall(r"\d+", s or "")[:3])


def app_path(exe):
    """登錄檔 App Paths 裡瀏覽器執行檔的位置；找不到回 None"""
    try:
        import winreg
    except ImportError:
        return None
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}") as k:
                p = winreg.QueryValue(k, None)
                if p and os.path.isfile(p.strip('"')):
                    return p.strip('"')
        except OSError:
            pass
    return None


def chromium_installs():
    out = []
    local = os.environ.get("LOCALAPPDATA") or ""
    for browser, rel, exe in CHROMIUM:
        root = os.path.join(local, rel)
        if not os.path.isdir(root):
            continue
        for prof in sorted(os.listdir(root)):
            settings = {}
            for fn in ("Preferences", "Secure Preferences"):
                try:
                    with open(os.path.join(root, prof, fn), encoding="utf-8") as f:
                        for eid, s in ((json.load(f).get("extensions") or {}).get("settings") or {}).items():
                            if isinstance(s, dict):
                                settings.setdefault(eid, {}).update(s)   # 同一個擴充的欄位可能分在兩個檔
                except (OSError, ValueError):
                    pass
            for eid, s in settings.items():
                if s.get("disable_reasons") or s.get("state") == 0:
                    continue   # 停用中
                path = s.get("path") or ""
                if eid in STORE_IDS:
                    v = (s.get("manifest") or {}).get("version") or os.path.basename(path).split("_")[0]
                    out.append(dict(browser=browser, profile=prof, exe=exe, version=v, dev=False))
                elif os.path.isabs(path) and all(os.path.isfile(os.path.join(path, x))
                                                 for x in ("bridge.js", "main-hook.js", "cdn-list.json")):
                    out.append(dict(browser=browser, profile=prof, exe=exe, version="dev", dev=True))
    return out


def firefox_installs():
    out = []
    for p in glob.glob(os.path.join(os.environ.get("APPDATA") or "", r"Mozilla\Firefox\Profiles\*\extensions.json")):
        try:
            with open(p, encoding="utf-8") as f:
                addons = json.load(f).get("addons") or []
        except (OSError, ValueError):
            continue
        for a in addons:
            if a.get("id") == GECKO_ID and a.get("active"):
                out.append(dict(browser="Firefox", profile=os.path.basename(os.path.dirname(p)), exe="firefox.exe",
                                version=a.get("version") or "", dev=False))
    return out


def detect(browser):
    """某個瀏覽器的狀態 (狀態, 安裝清單)：ok＝至少一個設定檔可匯入；outdated＝有裝但版本太舊；missing＝沒裝"""
    found = [x for x in chromium_installs() + firefox_installs() if x["browser"] == browser]
    for x in found:
        x["ok"] = x["dev"] or ver(x["version"]) >= MIN_VERSION
    if any(x["ok"] for x in found):
        return "ok", [x for x in found if x["ok"]]
    return ("outdated" if found else "missing"), found


def import_hosts(browser, hosts):
    """用這個瀏覽器裝了擴充的每個設定檔開匯入網址；回傳狀態（ok / outdated / missing）"""
    status, found = detect(browser)
    if status != "ok":
        return status
    url = IMPORT_URL + ",".join(hosts)
    exe = app_path(found[0]["exe"])
    if not exe:
        return "missing"
    opened = 0
    for x in (found[:1] if browser == "Firefox" else found):   # Firefox 只開預設設定檔
        try:
            if browser == "Firefox":
                subprocess.Popen([exe, "-new-tab", url])
            else:
                subprocess.Popen([exe, f"--profile-directory={x['profile']}", url])
            opened += 1
        except OSError:
            pass
    return "ok" if opened else "missing"
