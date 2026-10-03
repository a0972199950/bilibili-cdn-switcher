# /cdn-speedtest 網路環境：連線類型（有線／Wi-Fi／疑似行動網路）、Wi-Fi 細節、總頻寬（Cloudflare 測速）。
# 只用 Python 標準函式庫。不記錄 SSID 等可識別所在地點的資訊。
import json, os, re, subprocess, sys, threading, time, urllib.request, statistics
from concurrent.futures import ThreadPoolExecutor

_NO_WINDOW = 0x08000000 if os.name == "nt" else 0  # 打包成視窗程式時，子程序不要閃出命令列視窗


def run(cmd, timeout=15):
    """執行外部指令並回傳文字輸出（Windows 依 OEM 編碼解碼；不開新視窗）"""
    try:
        o = subprocess.run(cmd, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL,
                           creationflags=_NO_WINDOW)
        enc = "utf-8"
        if os.name == "nt":
            try:
                import ctypes
                enc = f"cp{ctypes.windll.kernel32.GetOEMCP()}"
            except Exception:
                enc = "cp950"
        return (o.stdout or b"").decode(enc, "replace").replace("\r", "")
    except Exception:
        return ""


MOBILE_ISP = re.compile(r"\b(mobile|cellular|wireless|lte|5g|telkomsel|softbank|docomo|kddi|t-mobile|vodafone|airtel|"
                        r"jio|smartone|hutchison|fareastone|far eastone|celcom|maxis|dtac|truemove|viettel)\b", re.I)


def _windows_link():
    ps = ("$r = Get-NetRoute -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue | Sort-Object RouteMetric | "
          "Select-Object -First 1; if ($r) { Get-NetAdapter -InterfaceIndex $r.InterfaceIndex | "
          "Select-Object Name, InterfaceDescription, MediaType, PhysicalMediaType, LinkSpeed | ConvertTo-Json -Compress }")
    out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], timeout=20)
    try:
        a = json.loads(out.strip() or "{}")
    except Exception:
        a = {}
    desc = f"{a.get('InterfaceDescription', '')} {a.get('PhysicalMediaType', '')} {a.get('MediaType', '')}"
    if re.search(r"Remote NDIS|Mobile Broadband|WWAN|Cellular|LTE|Android|iPhone|Apple Mobile", desc, re.I):
        kind = "行動網路（手機 USB 分享／行動網卡）"
    elif re.search(r"802\.11|Wireless|Wi-?Fi|WLAN", desc, re.I):
        kind = "Wi-Fi"
    elif re.search(r"802\.3|Ethernet|乙太", desc, re.I):
        kind = "有線"
    else:
        kind = "未知"
    wifi = None
    if kind == "Wi-Fi":
        t = run(["netsh", "wlan", "show", "interfaces"])
        radio = re.search(r"802\.11\w+", t)
        sig = re.search(r"(\d+)\s*%", t)
        rates = re.findall(r"\(Mbps\)\s*:\s*([\d.]+)", t)
        ch = re.search(r"(?:Channel|通道|频道|頻道)\s*:\s*(\d+)", t)
        wifi = dict(radio=radio.group(0) if radio else None, signal_pct=int(sig.group(1)) if sig else None,
                    rx_mbps=float(rates[0]) if rates else None, tx_mbps=float(rates[1]) if len(rates) > 1 else None,
                    channel=int(ch.group(1)) if ch else None)
    return dict(kind=kind, adapter=a.get("InterfaceDescription"), link_speed=a.get("LinkSpeed"), wifi=wifi)


def _unix_link():
    kind, adapter = "未知", None
    if sys.platform == "darwin":
        dev = re.search(r"interface:\s*(\S+)", run(["route", "-n", "get", "default"]))
        adapter = dev.group(1) if dev else None
        ports = run(["networksetup", "-listallhardwareports"])
        for blk in ports.split("\n\n"):
            if adapter and f"Device: {adapter}" in blk:
                kind = "Wi-Fi" if "Wi-Fi" in blk else "有線" if "Ethernet" in blk or "LAN" in blk else \
                    "行動網路（手機分享）" if "iPhone" in blk else "未知"
    else:
        m = re.search(r"dev\s+(\S+)", run(["ip", "route", "show", "default"]))
        adapter = m.group(1) if m else None
        if adapter:
            kind = "Wi-Fi" if os.path.exists(f"/sys/class/net/{adapter}/wireless") else \
                "行動網路" if re.match(r"wwan|usb|rmnet", adapter) else "有線"
    return dict(kind=kind, adapter=adapter, link_speed=None, wifi=None)


def link_info(isp_org=""):
    """回傳 dict(kind, kind_note, adapter, link_speed, wifi)。
    接手機 Wi-Fi 熱點時電腦只看得到 Wi-Fi，所以另用 ISP 名稱推測「疑似行動網路」。"""
    try:
        d = _windows_link() if os.name == "nt" else _unix_link()
    except Exception as e:
        d = dict(kind="未知", adapter=None, link_speed=None, wifi=None, err=str(e)[:80])
    note = None
    if d["kind"] in ("Wi-Fi", "未知") and isp_org and MOBILE_ISP.search(isp_org):
        note = f"ISP 看起來是行動網路業者（{isp_org}），可能是手機熱點"
    d["kind_note"] = note
    return d


VPN_ADAPTER = re.compile(r"WireGuard|OpenVPN|TAP-Windows|TAP-Win32|Wintun|\bTUN\b|WAN Miniport|PPP|SSTP|IKEv2|"
                         r"L2TP|PPTP|VPN|Nord|Express|Proton|Surfshark|Mullvad|Private Internet|PIA|CyberGhost|"
                         r"Windscribe|Hotspot Shield|Tunnelblick|ZeroTier|Tailscale|Fortinet|FortiClient|AnyConnect|"
                         r"Cisco|GlobalProtect|PANGP|Pulse Secure|Zscaler|Cloudflare WARP|WARP|Psiphon|Astrill|"
                         r"Hamachi|SoftEther|Juniper|SonicWall|Check Point", re.I)


def _local_vpn_adapters():
    """預設路由（0.0.0.0/0、OpenVPN/WireGuard 常用的 0.0.0.0/1 + 128.0.0.0/1）走的網卡中，名稱像 VPN 的。
    只支援 Windows；其他系統回傳 []"""
    if os.name != "nt":
        return []
    ps = ("Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue | "
          "Where-Object { $_.DestinationPrefix -in @('0.0.0.0/0','0.0.0.0/1','128.0.0.0/1') } | "
          "ForEach-Object { Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue } | "
          "Select-Object -Unique Name, InterfaceDescription | ConvertTo-Json -Compress")
    out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], timeout=20).strip()
    try:
        rows = json.loads(out or "[]")
    except Exception:
        return []
    if isinstance(rows, dict): rows = [rows]
    return [f"{r.get('Name')}（{r.get('InterfaceDescription')}）" for r in rows
            if VPN_ADAPTER.search(f"{r.get('Name', '')} {r.get('InterfaceDescription', '')}")]


def vpn_check():
    """綜合判斷是否在用 VPN／代理。任一訊號成立即 vpn=True。
    訊號：ip-api（proxy、非行動網路的機房 IP）、proxycheck.io（VPN/proxy）、本機預設路由走 VPN 網卡、
    電腦時區與 IP 所在地時區差 ≥ 2 小時。
    限制：路由器層級、且從家用／公司線路出口的 VPN（例如回家的 PPTP）若時區相同，任何方法都偵測不到。"""
    sig, d = [], {}
    try:
        a = json.load(urllib.request.urlopen(
            "http://ip-api.com/json/?fields=status,countryCode,regionName,city,isp,org,as,proxy,hosting,mobile,"
            "offset,query", timeout=8))
        d["ipapi"] = {k: a.get(k) for k in ("countryCode", "city", "isp", "as", "proxy", "hosting", "mobile", "offset")}
        d["ip"], d["country"], d["isp"], d["mobile"] = a.get("query"), a.get("countryCode"), a.get("isp"), a.get("mobile")
        if a.get("proxy"):
            sig.append("ip-api：VPN／代理 IP")
        if a.get("hosting") and not a.get("mobile"):
            sig.append(f"ip-api：機房（資料中心）IP（{a.get('isp')}）")
        if a.get("offset") is not None:
            local = time.localtime().tm_gmtoff
            d["tz_offset_ip"], d["tz_offset_local"] = a["offset"], local
            if abs(local - a["offset"]) >= 2 * 3600:
                sig.append(f"時區不符：電腦 UTC{local / 3600:+g}、IP 所在地 UTC{a['offset'] / 3600:+g}")
    except Exception as e:
        d["ipapi_err"] = str(e)[:80]
    try:
        ip = d.get("ip") or json.load(urllib.request.urlopen("https://ipinfo.io/json", timeout=8)).get("ip")
        req = urllib.request.Request(f"https://proxycheck.io/v2/{ip}?vpn=1&asn=1",
                                     headers={"User-Agent": "Mozilla/5.0 cdn-speedtest"})  # 預設 Python UA 會被擋 403
        p = json.load(urllib.request.urlopen(req, timeout=10)).get(ip) or {}
        op = (p.get("operator") or {}).get("name") if isinstance(p.get("operator"), dict) else None
        d["proxycheck"] = dict(proxy=p.get("proxy"), type=p.get("type"), operator=op)
        if p.get("proxy") == "yes":
            sig.append(f"proxycheck：{p.get('type') or 'proxy'}" + (f"（{op}）" if op else ""))
    except Exception as e:
        d["proxycheck_err"] = str(e)[:80]
    ad = _local_vpn_adapters()
    d["local_vpn_adapters"] = ad
    if ad:
        sig.append("本機 VPN 網卡：" + "、".join(ad))
    d["signals"], d["vpn"] = sig, bool(sig)
    return d


# 呼叫端（例如 GUI 的網路檢查頁）已量過時可預先填入，env 就不再重測
PRESET_BW = None
PRESET_VPN = None

CF = "https://speed.cloudflare.com"
UA = {"User-Agent": "Mozilla/5.0 cdn-speedtest"}


def _timed_loop(fn, secs, conns):
    """conns 條連線並行，各自重複呼叫 fn() 直到 secs 秒；回傳總位元組 / 實際秒數 → Mbps"""
    total = [0]
    lock = threading.Lock()
    end = time.time() + secs

    def worker():
        while time.time() < end:
            try:
                n = fn(end)
            except Exception:
                time.sleep(0.5); n = 0
            with lock:
                total[0] += n

    t0 = time.time()
    ths = [threading.Thread(target=worker, daemon=True) for _ in range(conns)]
    for t in ths: t.start()
    for t in ths: t.join(secs + 20)
    return round(total[0] * 8 / max(0.1, time.time() - t0) / 1e6, 1)


# Cloudflare 被限流（429）或連不上時的下載測速備援：Linode 各地的公開測速檔，挑回應最快的一台
LINODE = ["singapore", "tokyo2", "mumbai1", "syd1", "frankfurt", "london", "newark", "fremont", "toronto1"]


def _linode_down(secs, conns):
    def url(r): return f"https://speedtest.{r}.linode.com/100MB-{r}.bin"

    def ttfb(r):
        try:
            t = time.perf_counter()
            urllib.request.urlopen(urllib.request.Request(url(r), headers=dict(UA, Range="bytes=0-65535")),
                                   timeout=5).read()
            return (time.perf_counter() - t), r
        except Exception:
            return None
    with ThreadPoolExecutor(len(LINODE)) as ex:
        ok = sorted(x for x in ex.map(ttfb, LINODE) if x)
    if not ok:
        return None, None
    best = ok[0][1]

    def down(end):
        r = urllib.request.urlopen(urllib.request.Request(url(best), headers=UA), timeout=10)
        n = 0
        while time.time() < end:
            b = r.read(262144)
            if not b: break
            n += len(b)
        return n
    return _timed_loop(down, secs, conns), f"linode-{best}"


def bandwidth(down_secs=8, up_secs=6, conns=4):
    """總頻寬：延遲（中位數）、下載、上傳 Mbps。與 B 站無關，用來分辨「當地網路本身慢」還是「連 B 站慢」。
    主要用 Cloudflare；下載失敗（常見是 429 限流）時改用最近的 Linode 測速檔。"""
    lat = []
    for _ in range(8):
        try:
            t = time.perf_counter()
            urllib.request.urlopen(urllib.request.Request(f"{CF}/__down?bytes=0", headers=UA), timeout=5).read()
            lat.append((time.perf_counter() - t) * 1000)
        except Exception:
            pass

    def down(end):
        r = urllib.request.urlopen(urllib.request.Request(f"{CF}/__down?bytes=25000000", headers=UA), timeout=10)
        n = 0
        while time.time() < end:
            b = r.read(262144)
            if not b: break
            n += len(b)
        return n

    blob = os.urandom(2 << 20)

    def up(end):
        urllib.request.urlopen(urllib.request.Request(f"{CF}/__up", data=blob, headers=UA, method="POST"),
                               timeout=15).read()
        return len(blob)

    res = dict(latency_ms=round(statistics.median(lat)) if lat else None, source="cloudflare")
    try:
        res["down_mbps"] = _timed_loop(down, down_secs, conns)
    except Exception as e:
        res["err"] = str(e)[:80]
    if not res.get("down_mbps"):
        d, src = _linode_down(down_secs, conns)
        if d:
            res.update(down_mbps=d, source=src)
            res.pop("err", None)
    try:
        res["up_mbps"] = _timed_loop(up, up_secs, conns) or None
    except Exception:
        res["up_mbps"] = None
    if not res.get("down_mbps"):
        res["err"] = res.get("err") or "下載測速無法連線（Cloudflare、Linode 都失敗）"
    return res
