# 測速的網路環境：連線類型（有線／Wi-Fi／疑似行動網路）、Wi-Fi 細節、總頻寬（speedtest.net 測速）。
# 只用 Python 標準函式庫。不記錄 SSID 等可識別所在地點的資訊。
import collections, http.client, json, os, re, subprocess, sys, threading, time, urllib.error, urllib.request, statistics
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
    # 實際上網的網卡：問 Windows 連到外網會走哪張（Find-NetRoute）。不能只比預設路由的 RouteMetric：
    # 已斷線的 Wi-Fi 可能還留著一條 metric 一樣的預設路由，手機 USB 分享會被誤判成 Wi-Fi。
    # Find-NetRoute 失敗時退回「已連線網卡的預設路由，比 RouteMetric＋InterfaceMetric」
    ps = ("$i = (Find-NetRoute -RemoteIPAddress 1.1.1.1 -ErrorAction SilentlyContinue | Select-Object -First 1).InterfaceIndex; "
          "if (-not $i) { $up = (Get-NetAdapter | Where-Object Status -eq 'Up').ifIndex; "
          "$i = (Get-NetRoute -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue | "
          "Where-Object { $up -contains $_.InterfaceIndex } | "
          "Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1).InterfaceIndex }; "
          "if ($i) { Get-NetAdapter -InterfaceIndex $i | "
          "Select-Object Name, InterfaceDescription, MediaType, PhysicalMediaType, LinkSpeed | ConvertTo-Json -Compress }")
    out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], timeout=20)
    try:
        a = json.loads(out.strip() or "{}")
    except Exception:
        a = {}
    desc = f"{a.get('InterfaceDescription', '')} {a.get('PhysicalMediaType', '')} {a.get('MediaType', '')}"
    if re.search(r"Remote NDIS|Mobile Broadband|WWAN|Cellular|\bLTE\b|Android|iPhone|Apple Mobile", desc, re.I):
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


def _mac_wifi(adapter):
    """Mac 的 Wi-Fi 規格（system_profiler，不取 SSID）。訊號強度換算成跟 Windows netsh 一樣的百分比：2 × (dBm + 100)"""
    try:
        d = json.loads(run(["system_profiler", "-json", "SPAirPortDataType"], timeout=20) or "{}")
        ifs = [i for x in d.get("SPAirPortDataType") or [] for i in x.get("spairport_airport_interfaces") or []]
        cur = next((i.get("spairport_current_network_information") for i in ifs if i.get("_name") == adapter), None)
    except Exception:
        return None
    if not cur: return None
    sig = re.match(r"\s*(-?\d+)\s*dBm", str(cur.get("spairport_signal_noise") or ""))
    ch = re.match(r"\s*(\d+)", str(cur.get("spairport_network_channel") or ""))
    rate = cur.get("spairport_network_rate")
    return dict(radio=cur.get("spairport_network_phymode"),
                signal_pct=max(0, min(100, 2 * (int(sig.group(1)) + 100))) if sig else None,
                rx_mbps=None, tx_mbps=float(rate) if isinstance(rate, (int, float)) else None,
                channel=int(ch.group(1)) if ch else None)


def _unix_link():
    kind, adapter, wifi = "未知", None, None
    if sys.platform == "darwin":
        dev = re.search(r"interface:\s*(\S+)", run(["route", "-n", "get", "default"]))
        adapter = dev.group(1) if dev else None
        ports = run(["networksetup", "-listallhardwareports"])
        for blk in ports.split("\n\n"):
            if adapter and f"Device: {adapter}" in blk:
                kind = "Wi-Fi" if "Wi-Fi" in blk else "有線" if "Ethernet" in blk or "LAN" in blk else \
                    "行動網路（手機分享）" if "iPhone" in blk else "未知"
        if kind == "Wi-Fi":
            wifi = _mac_wifi(adapter)
    else:
        m = re.search(r"dev\s+(\S+)", run(["ip", "route", "show", "default"]))
        adapter = m.group(1) if m else None
        if adapter:
            kind = "Wi-Fi" if os.path.exists(f"/sys/class/net/{adapter}/wireless") else \
                "行動網路" if re.match(r"wwan|usb|rmnet", adapter) else "有線"
    return dict(kind=kind, adapter=adapter, link_speed=None, wifi=wifi)


def link_info(isp_org=""):
    """回傳 dict(kind, kind_note, adapter, link_speed, wifi)。
    接手機 Wi-Fi 熱點時電腦只看得到 Wi-Fi，所以另用 ISP 名稱推測「疑似行動網路」。"""
    print("讀取網路介面卡資訊（連線類型、Wi-Fi 規格）…", flush=True)
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


MAC_VPN_IF = re.compile(r"^(utun|ipsec|ppp|tun|tap|wg)\d*$")


def _mac_vpn_adapters():
    """Mac：外網流量走的網卡是 VPN 類（utun、ipsec、ppp…）。macOS 平常就有好幾張 utun（iCloud 等系統服務用），
    所以只看預設路由與 OpenVPN/WireGuard 常用的 0/1 + 128.0/1 路由實際走哪張，不看網卡存不存在；
    另外 scutil --nc 列出的系統 VPN 服務（IKEv2、L2TP、IPSec、App 建的 VPN 設定）已連線也算"""
    out, ifs = [], []
    m = re.search(r"interface:\s*(\S+)", run(["route", "-n", "get", "default"]))
    if m: ifs.append(m.group(1))
    for line in run(["netstat", "-rn", "-f", "inet"]).splitlines():
        f = line.split()
        if len(f) >= 4 and f[0] in ("0/1", "128.0/1", "0.0.0.0/1", "128.0.0.0/1"):
            ifs.append(f[3])
    out += [f"{i}（預設路由）" for i in dict.fromkeys(ifs) if MAC_VPN_IF.match(i)]
    for line in run(["scutil", "--nc", "list"]).splitlines():
        if "(Connected)" in line:
            name = re.search(r'"([^"]+)"', line)
            out.append(f"{name.group(1) if name else 'VPN'}（系統 VPN 設定）")
    return out


def _local_vpn_adapters():
    """預設路由（0.0.0.0/0、OpenVPN/WireGuard 常用的 0.0.0.0/1 + 128.0.0.0/1）走的網卡中，名稱像 VPN 的。
    支援 Windows 與 Mac；其他系統回傳 []"""
    if sys.platform == "darwin":
        return _mac_vpn_adapters()
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
    訊號：ip-api（proxy、非行動網路的機房 IP）、本機預設路由走 VPN 網卡、
    電腦時區與 IP 所在地時區差 ≥ 2 小時。
    不用 proxycheck.io：它把「家用線路上開著 VPN／代理服務」的 IP 標成 Compromised Server，自己在家架 VPN server、
    或浮動 IP 被前一個使用者連累的人都會被誤判。
    限制：路由器層級、且從家用／公司線路出口的 VPN（例如回家的 PPTP）若時區相同，任何方法都偵測不到。"""
    sig, d = [], {}
    print("VPN 檢查：向 ip-api.com 查詢這個 IP 的類型（最多 8 秒）…", flush=True)
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
        print(f"  ip-api 查詢失敗：{_err(e)}（略過這項）", flush=True)
    print("VPN 檢查：檢查本機預設路由是否走 VPN 網卡…", flush=True)
    ad = _local_vpn_adapters()
    d["local_vpn_adapters"] = ad
    if ad:
        sig.append("本機 VPN 網卡：" + "、".join(ad))
    d["signals"], d["vpn"] = sig, bool(sig)
    print("VPN 檢查：" + ("⚠ " + "；".join(sig) if sig else "未偵測到"), flush=True)
    return d


# 呼叫端（例如 GUI 的網路檢查頁）已量過時可預先填入，env 就不再重測
PRESET_BW = None
PRESET_VPN = None

UA = {"User-Agent": "Mozilla/5.0 cdn-speedtest"}
# speedtest.net 依 IP 位置排序的最近伺服器（Ookla）。不用 Cloudflare：行動網路等共用出口 IP 常被它限流（429）
OOKLA_API = "https://www.speedtest.net/api/js/servers?engine=js&limit=5&https_functional=true"


def _err(e):
    """例外的簡短說明（HTTP 狀態碼、逾時、連線被拒…）"""
    if isinstance(e, urllib.error.HTTPError):
        return f"HTTP {e.code}"
    return str(getattr(e, "reason", e))[:60] or type(e).__name__


SAMPLE_SECS = 0.2   # 下載測速每幾秒取樣一次累積量（15 秒 → 75 個取樣）
MAX_CONNS = 32      # 下載測速最多開幾條連線（前半段依需要從 4 條加倍上去）
SCALE_EVERY = 8     # 每幾個取樣（1.6 秒）檢查一次要不要再加開：新連線要先過 TCP 慢啟動，太快比較會誤判沒變快
SCALE_GAIN = 1.10   # 加開後最近 1 秒比加開前快 10% 以上，才再加倍


def ookla_mean(samples):
    """Speedtest 公開的算法（help/guides/assessing-accuracy「How results are calculated」）：取樣依速度排序，
    去掉最快的 10%（20 段裡最快的 2 段），再去掉剩下的最慢 1/4（約佔全部 22%），其餘平均。
    排除開頭 TCP 慢啟動、連線建立與偶發停頓，不會因此低估"""
    s = sorted(samples)
    if len(s) < 5: return statistics.mean(s) if s else 0.0
    s = s[:len(s) - round(len(s) * 0.1)]
    return statistics.mean(s[round(len(s) * 0.25):])


def _timed_loop(fn, secs, conns, label="", max_conns=None):
    """conns 條連線並行，各自重複呼叫 fn(end, add) 直到 secs 秒（fn 每收完一段就 add(位元組數)）。
    每 SAMPLE_SECS 秒記一次這段時間的速度，時間一到用 ookla_mean 結算 → (Mbps, 整段平均 Mbps, 最後的連線數)；
    不等還卡在連線中的執行緒（daemon，之後自己逾時結束）。
    max_conns：同 Speedtest「測速前半段判斷需要時加開連線」——前半段每 SCALE_EVERY 個取樣檢查一次，加開的連線讓速度
    多 SCALE_GAIN 以上就再加倍（最多 max_conns 條），不再變快就停。有些網路（例如新加坡 M1 行動網路）每條連線限速約 25 Mbps，
    固定 4 條只量得到 100 Mbps。有加開連線時只用最後一次加開 1 秒後的取樣結算（前段連線數還不夠，不代表頻寬）。
    連線失敗會等 0.5 秒重試：每種錯誤第一次發生時印出來，結束時再印統計"""
    total = [0]
    lock = threading.Lock()
    end = time.time() + secs
    errs = collections.Counter()

    def add(n):
        with lock:
            total[0] += n

    def worker():
        while time.time() < end:
            try:
                fn(end, add)
            except Exception as e:
                msg = _err(e)
                with lock:
                    errs[msg] += 1
                    first = errs[msg] == 1
                if first:
                    print(f"    {label}連線失敗：{msg}，0.5 秒後重試（同樣的錯誤之後只在結束時統計）", flush=True)
                time.sleep(0.5)

    def start(k):
        for _ in range(k):
            threading.Thread(target=worker, daemon=True).start()

    t0 = time.time()
    start(conns)
    per_sec = round(1 / SAMPLE_SECS)
    scaling, prev, steady_from = bool(max_conns and max_conns > conns), None, 0
    samples, last_n, last_t = [], 0, t0
    while True:
        time.sleep(max(0.0, min(SAMPLE_SECS, end - time.time())))
        now = time.time()
        with lock:
            n = total[0]
        if now > last_t:
            samples.append((n - last_n) * 8 / (now - last_t) / 1e6)
        last_n, last_t = n, now
        if now >= end: break
        if scaling and len(samples) % SCALE_EVERY == 0:
            r = statistics.mean(samples[-per_sec:])
            if now - t0 > secs / 2 or conns >= max_conns or (prev is not None and r < prev * SCALE_GAIN):
                scaling = False
                if prev is not None:
                    print(f"    {label}連線數停在 {conns} 條（最近 1 秒 {r:.0f} Mbps）", flush=True)
            else:
                more = min(conns, max_conns - conns)
                print(f"    {label}最近 1 秒 {r:.0f} Mbps，" + (f"比加開前快 {r / prev - 1:.0%}，" if prev else "")
                      + f"再加開 {more} 條連線（{conns} → {conns + more}）", flush=True)
                start(more)
                conns, prev = conns + more, r
                steady_from = len(samples) + per_sec   # 新連線 1 秒後才算穩定
    with lock:
        err_items = list(errs.items())
    if err_items: print(f"    {label}連線失敗統計：" + "、".join(f"{k} ×{v}" for k, v in err_items), flush=True)
    if not n: return 0.0, 0.0, conns
    use = samples[steady_from:] if len(samples) - steady_from >= 10 else samples
    return round(ookla_mean(use), 1), round(n * 8 / max(0.1, time.time() - t0) / 1e6, 1), conns


def _ookla_servers():
    """最近幾台 Ookla 伺服器的 host:port；失敗回 []"""
    try:
        rows = json.load(urllib.request.urlopen(urllib.request.Request(OOKLA_API, headers=UA), timeout=8))
        return [s["host"] for s in rows if s.get("host")]
    except Exception as e:
        print(f"  取得 speedtest.net 伺服器清單失敗：{_err(e)}", flush=True)
        return []


def _ping(host, n=5):
    """延遲（ms）：同一條 HTTPS 連線重複請求 /hello，取最小值（同 Speedtest：重複多次取最低）。
    第一次請求含 TCP／TLS 握手，不算；連線被伺服器關掉就重連（重連那次也不算）。連不上回 None"""
    name, _, port = host.partition(":")
    conn, lat = None, []
    try:
        for i in range(n + 1):
            fresh = conn is None
            if fresh:
                conn = http.client.HTTPSConnection(name, int(port or 443), timeout=3)
            t = time.perf_counter()
            try:
                conn.request("GET", f"/hello?nocache={time.time_ns()}", headers=UA)
                conn.getresponse().read()
            except (http.client.HTTPException, ConnectionError):
                if fresh: raise
                conn.close(); conn = None
                continue
            if not fresh:
                lat.append((time.perf_counter() - t) * 1000)
    except Exception:
        pass
    finally:
        if conn: conn.close()
    return min(lat) if lat else None


def bandwidth(down_secs=15, conns=4):
    """總頻寬：延遲、下載 Mbps。與 B 站無關，用來分辨「當地網路本身慢」還是「連 B 站慢」，也是頻寬上限。
    用 speedtest.net 最近的幾台伺服器，挑延遲最低的；下載量不到就換下一台（最多 3 台）。
    量法照 Speedtest 公開的測法：4 條連線起跳、前半段需要時加開連線（最多 MAX_CONNS）、固定時間、
    取樣後去掉最快 10% 與最慢約 22% 再平均（ookla_mean）；
    延遲＝同一條連線重複請求取最小值（_ping）。
    不量上傳：播放用不到，報告與分析也沒用到，在行動網路上還多吃流量、多花 6 秒"""
    res = dict(latency_ms=None, down_mbps=None, source=None)
    print("頻寬：向 speedtest.net 取得離你最近的伺服器（最多 8 秒）…", flush=True)
    hosts = _ookla_servers()
    if not hosts:
        res["err"] = "無法取得 speedtest.net 伺服器清單"
        return res
    short = lambda h: h.split(":")[0]
    print(f"  {len(hosts)} 台：{'、'.join(map(short, hosts))}；同時測延遲（每台同一條連線請求 5 次取最小值，每次最多 3 秒）…", flush=True)
    with ThreadPoolExecutor(len(hosts)) as ex:
        pings = list(ex.map(_ping, hosts))
    print("  延遲：" + "、".join(f"{short(h)} {round(p)} ms" if p is not None else f"{short(h)} 連不上"
                               for p, h in zip(pings, hosts)), flush=True)
    ranked = sorted((p, h) for p, h in zip(pings, hosts) if p is not None)
    if not ranked:
        res["err"] = "speedtest.net 伺服器都連不上"
        return res

    for lat, host in ranked[:3]:
        print(f"  下載測速：{short(host)}，{conns} 條連線起跳（前半段需要時自動加開，最多 {MAX_CONNS} 條）"
              f"同時下載 {down_secs} 秒…", flush=True)
        def down(end, add, host=host):
            r = urllib.request.urlopen(urllib.request.Request(f"https://{host}/download?size=25000000", headers=UA),
                                       timeout=10)
            while time.time() < end:
                b = r.read(32768)   # 小塊讀，取樣才不會一段有一段沒有
                if not b: break
                add(len(b))
        d, avg, used = _timed_loop(down, down_secs, conns, "下載", max_conns=MAX_CONNS)
        if d:
            res.update(latency_ms=round(lat), down_mbps=d, down_avg_mbps=avg, conns=used,
                       source=f"speedtest.net {short(host)}")
            print(f"  下載 {d} Mbps（{used} 條連線；去掉最快 10%、最慢約 22% 的取樣後平均；"
                  f"含慢啟動的整段平均 {avg} Mbps）", flush=True)
            break
        print("  這台量不到下載速度，換下一台", flush=True)
    if not res["down_mbps"]:
        res["err"] = "下載測速無法連線（speedtest.net）"
    return res
