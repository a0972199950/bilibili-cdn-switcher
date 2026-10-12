# exe 自我更新：啟動時讀 GitHub Latest Release 的 CDNSpeedTest.json（build.ps1 產生：version / sha256 / size），
# 版本比自己新就在背景下載到 exe 旁邊、驗 sha256，再由 app.py 決定何時換檔：
#   還在入口頁 → apply(restart=True)：自己改名成 <名稱>.old.exe、新檔換上原檔名、開新版、結束自己
#   已經往下走 → 關閉程式時 apply(restart=False)：只換檔，下次開就是新版（測速中途絕不打斷）
# 執行中的 exe 不能覆寫但可以改名，所以用改名換檔；.old.exe 由新版啟動時刪掉。
# 任何一步失敗（沒網路、資料夾不能寫、被防毒擋）都安靜跳過，照用目前版本。
# 只在打包後的 exe 生效；測試時可用環境變數 CDNSPEEDTEST_UPDATE_URL 指到別的 CDNSpeedTest.json。
import hashlib, json, os, subprocess, sys, time, urllib.parse, urllib.request

MANIFEST_URL = "https://github.com/a0972199950/bilibili-cdn-switcher/releases/latest/download/CDNSpeedTest.json"
UA = {"User-Agent": "Mozilla/5.0 cdn-speedtest-updater"}


def _ver(s):
    try:
        return tuple(int(x) for x in str(s).strip().lstrip("v").split("."))
    except ValueError:
        return ()


def _paths():
    exe = sys.executable
    stem, ext = os.path.splitext(exe)
    return exe, stem + ".old" + ext, exe + ".download"


def enabled():
    return getattr(sys, "frozen", False) and os.name == "nt"


def cleanup():
    """刪掉上次更新留下的舊版與沒下載完的暫存檔（舊版可能還在結束中，多試幾次）"""
    if not enabled(): return
    _, old, tmp = _paths()
    for _ in range(10):
        for p in (old, tmp):
            try:
                if os.path.exists(p): os.remove(p)
            except OSError:
                pass
        if not (os.path.exists(old) or os.path.exists(tmp)): return
        time.sleep(1)


def check_and_download(current):
    """有新版就下載並驗證，回傳 (新版號, 已驗證的暫存檔路徑)；沒有新版或失敗回傳 None"""
    if not enabled(): return None
    url = os.environ.get("CDNSPEEDTEST_UPDATE_URL") or MANIFEST_URL
    try:
        m = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15))
        if not _ver(m.get("version")) > _ver(current): return None
        tmp = _paths()[2]
        h = hashlib.sha256()
        src = urllib.request.urlopen(urllib.request.Request(urllib.parse.urljoin(url, m.get("url") or "CDNSpeedTest.exe"),
                                                            headers=UA), timeout=30)
        with open(tmp, "wb") as f:
            while True:
                b = src.read(1 << 16)
                if not b: break
                f.write(b); h.update(b)
        if h.hexdigest().lower() != str(m.get("sha256", "")).lower() or \
                (m.get("size") and os.path.getsize(tmp) != int(m["size"])):
            os.remove(tmp)
            print(f"[更新] v{m.get('version')} 下載的檔案驗證失敗，略過")
            return None
        print(f"[更新] 已下載 v{m.get('version')}")
        return m["version"], tmp
    except Exception as e:
        print(f"[更新] 檢查或下載失敗，略過：{str(e)[:120]}")
        try:
            os.remove(_paths()[2])
        except OSError:
            pass
        return None


def apply(tmp, restart):
    """把已驗證的新版換上原檔名；restart=True 時開新版。成功回傳 True（呼叫端接著結束程式）"""
    exe, old, _ = _paths()
    try:
        if os.path.exists(old): os.remove(old)
        os.rename(exe, old)
    except OSError as e:
        print(f"[更新] 無法替換執行檔，略過：{e}")
        return False
    try:
        os.rename(tmp, exe)
    except OSError as e:
        print(f"[更新] 無法放上新版，還原：{e}")
        try: os.rename(old, exe)
        except OSError: pass
        return False
    if restart:
        # 新版也是 PyInstaller onefile：不能繼承這個行程的 PyInstaller／Tcl 環境變數，否則它會去用
        # 本行程（即將刪掉）的解壓資料夾
        env = {k: v for k, v in os.environ.items()
               if not (k.startswith("_PYI") or k.startswith("_MEI") or k in ("TCL_LIBRARY", "TK_LIBRARY"))}
        env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
        try:
            subprocess.Popen([exe], env=env, close_fds=True, cwd=os.path.dirname(exe),
                             creationflags=0x00000008 | 0x00000200)   # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        except OSError as e:
            print(f"[更新] 已換成新版，但無法自動開啟：{e}")
    return True
