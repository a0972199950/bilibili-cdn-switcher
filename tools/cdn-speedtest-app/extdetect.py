# 找出這台電腦哪些瀏覽器（設定檔）裝了擴充，並用該瀏覽器開匯入網址，把測速推薦的節點寫進擴充的「自訂節點列表」。
# 瀏覽器不讓外部程式直接寫擴充的 storage，所以改成開 B 站網址、由擴充的 content script（bridge.js）從網址讀節點：
#   https://www.bilibili.com/#cdnsw-import=1.<host>,<host>,…
# 擴充只收自己節點清單裡有的節點，見 src/background.js。
# 安裝與否看瀏覽器設定檔：Chromium 系看 Secure Preferences／Preferences 的 extensions.settings，
# Firefox 看設定檔的 extensions.json。商店版要夠新（MIN_VERSION 起才有匯入功能）；開發者載入的未封裝版一律算可用。
# Mac 另有 Safari：擴充包在 App（BiBoost）裡，版本看 App 的 Info.plist；Safari 有沒有啟用擴充、有沒有允許 bilibili.com
# 外部程式讀不到（設定檔受系統保護），App 有裝就當作可匯入。
import glob, json, os, plistlib, re, subprocess, sys

MAC = sys.platform == "darwin"

STORE_IDS = {"dfaddcffoondcendifiljhdbdagebgch",   # Chrome 線上應用程式商店（Edge 也可能從這裡裝）
             "dllallgilijcacpdemjafegibdafcbdp"}   # Edge 附加元件
GECKO_ID = "bilibili-cdn-switcher@a0972199950.github.io"
MIN_VERSION = (1, 7, 0)   # 第一個有「自訂節點列表」匯入功能的擴充版本
BROWSERS = ("Chrome", "Firefox", "Edge", "Safari") if MAC else ("Chrome", "Firefox", "Edge")   # GUI 讓使用者勾選的瀏覽器
# (瀏覽器, Windows：%LOCALAPPDATA% 下的設定檔資料夾, Windows 執行檔, Mac：~/Library/Application Support 下的設定檔資料夾,
#  Mac：App 的 bundle ID)
CHROMIUM = [("Chrome", r"Google\Chrome\User Data", "chrome.exe", "Google/Chrome", "com.google.Chrome"),
            ("Edge", r"Microsoft\Edge\User Data", "msedge.exe", "Microsoft Edge", "com.microsoft.edgemac")]
FIREFOX_BUNDLE = "org.mozilla.firefox"
SAFARI_APP_BUNDLE = "com.johnh.bilibili-cdn-switcher"   # 裝 Safari 擴充的 App（BiBoost）
MAC_SUPPORT = os.path.expanduser("~/Library/Application Support")
IMPORT_URL = "https://www.bilibili.com/#cdnsw-import=1."
UTM = "utm_source=cdn_speedtest_app&utm_medium=referral&utm_campaign=speedtest"
STORE_URLS = {   # 各瀏覽器的擴充商店頁（入口頁連結、感謝頁的安裝按鈕）
    "Chrome": "https://chromewebstore.google.com/detail/dfaddcffoondcendifiljhdbdagebgch?" + UTM,
    "Firefox": "https://addons.mozilla.org/addon/bilibili-cdn-switcher/?" + UTM,
    "Edge": "https://microsoftedge.microsoft.com/addons/detail/dllallgilijcacpdemjafegibdafcbdp?" + UTM,
    "Safari": "https://apps.apple.com/app/id6817181919?mt=12",
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


def mac_app(bundle):
    """Mac 上這個 bundle ID 的 App 路徑；找不到回 None。先看 /Applications，再問 Spotlight（排除 Xcode 建置產物）"""
    for d in ("/Applications", os.path.expanduser("~/Applications")):
        for p in glob.glob(os.path.join(d, "*.app")):
            if mac_app_info(p).get("CFBundleIdentifier") == bundle:
                return p
    try:
        out = subprocess.run(["mdfind", f"kMDItemCFBundleIdentifier == '{bundle}'"], capture_output=True, text=True,
                             timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    for p in out.splitlines():
        if p.endswith(".app") and "/Build/Products/" not in p and "/DerivedData/" not in p:
            return p
    return None


def mac_app_info(path):
    try:
        with open(os.path.join(path, "Contents", "Info.plist"), "rb") as f:
            return plistlib.load(f)
    except (OSError, ValueError, plistlib.InvalidFileException):
        return {}


def chromium_installs():
    out = []
    local = os.environ.get("LOCALAPPDATA") or ""
    for browser, rel, exe, mac_rel, bundle in CHROMIUM:
        root = os.path.join(MAC_SUPPORT, mac_rel) if MAC else os.path.join(local, rel)
        exe = bundle if MAC else exe
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
    pat = os.path.join(MAC_SUPPORT, "Firefox", "Profiles", "*", "extensions.json") if MAC else \
        os.path.join(os.environ.get("APPDATA") or "", r"Mozilla\Firefox\Profiles\*\extensions.json")
    for p in glob.glob(pat):
        try:
            with open(p, encoding="utf-8") as f:
                addons = json.load(f).get("addons") or []
        except (OSError, ValueError):
            continue
        for a in addons:
            if a.get("id") == GECKO_ID and a.get("active"):
                out.append(dict(browser="Firefox", profile=os.path.basename(os.path.dirname(p)),
                                exe=FIREFOX_BUNDLE if MAC else "firefox.exe",
                                version=a.get("version") or "", dev=False))
    return out


def safari_installs():
    """Mac：裝了 BiBoost（內含 Safari 擴充）就算一筆；版本用 App 的版本號"""
    if not MAC: return []
    app = mac_app(SAFARI_APP_BUNDLE)
    if not app: return []
    return [dict(browser="Safari", profile=None, exe="com.apple.Safari", app=app,
                 version=mac_app_info(app).get("CFBundleShortVersionString") or "", dev=False)]


def detect(browser):
    """某個瀏覽器的狀態 (狀態, 安裝清單)：ok＝至少一個設定檔可匯入；outdated＝有裝但版本太舊；missing＝沒裝"""
    if browser == "Safari":
        found = safari_installs()
    else:
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
    exe = found[0]["exe"] if MAC else app_path(found[0]["exe"])
    if not exe or (MAC and not mac_app(exe)):
        return "missing"
    opened = 0
    for x in (found[:1] if browser in ("Firefox", "Safari") else found):   # Firefox 只開預設設定檔
        try:
            if MAC:
                # -b：用 bundle ID 指定 App；Chromium 系要 -n 才會把 --args 交給瀏覽器（已開著時轉給既有的視窗）
                args = ["open", "-n", "-b", exe, "--args", f"--profile-directory={x['profile']}", url] \
                    if browser in ("Chrome", "Edge") else ["open", "-b", exe, url]
                if subprocess.run(args, capture_output=True, timeout=30).returncode != 0:
                    continue
            elif browser == "Firefox":
                subprocess.Popen([exe, "-new-tab", url])
            else:
                subprocess.Popen([exe, f"--profile-directory={x['profile']}", url])
            opened += 1
        except (OSError, subprocess.SubprocessError):
            pass
    return "ok" if opened else "missing"
