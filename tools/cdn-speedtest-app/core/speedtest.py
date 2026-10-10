#!/usr/bin/env python3
# /cdn-speedtest：在「當地網路」實測 Bilibili 點播 CDN 節點，找出該國最快的節點。只用 Python 標準函式庫。
#
# 用法（在 repo 根目錄或任何目錄執行；結果預設寫到 <cwd>/cdn-speedtest-results/<國家>-<YYYYMMDD-HHMM>/）：
#   python3 speedtest.py detect                    偵測出口國家、DNS 解析器是否在當地、登入狀態（開始前給使用者確認）
#   python3 speedtest.py all      <國家> [選項]    全流程（可續跑：每次跑到 BUDGET 秒就停，exit 3，再執行一次續跑）
#   python3 speedtest.py env      <國家>           出口 IP / DNS / 基準 RTT / 登入狀態
#   python3 speedtest.py pool     <國家>           收集影片池（可續跑）
#   python3 speedtest.py pick     <國家>           挑 3 支快篩 + 10 支細測 + 1 支冷門探測影片（固定種子）
#   python3 speedtest.py ceiling  <國家>           頻寬上限 + 自動決定並行數
#   python3 speedtest.py stage1   <國家>           快篩：全部節點 × 3 支熱門 × 2MB（可續跑）
#   python3 speedtest.py probe    <國家>           冷門探測：快篩通過的節點 × 1 支低播放 × 1MB，回 403 的不進細測（可續跑）
#   python3 speedtest.py stage2   <國家>           細測：快篩通過且冷門探測沒回 403 的全部節點 × 10 支 × 4MB，
#                                                  每筆最多 8 秒（可續跑）
#   python3 speedtest.py report   <國家>           排名 + 分級 + 依 CDN 池分散的建議清單 → REPORT.md / summary.json
#
# 環境變數：BUDGET=<秒>（分段執行）、DNS=<伺服器 IP>（節點網域改用指定 DNS 解析）、BILI_COOKIE=<cookie>
# Exit code：0 完成、3 未完成（再跑一次續跑）、4 未登入（需使用者決定）、5 出口國家與指定不符（疑似 VPN／漫遊）、
#            6 DNS 解析器與所在地不一致（GeoDNS 失真，見 SKILL.md「DNS 陷阱」）、2 參數或前置步驟錯誤
# <國家> 省略時依出口 IP 自動偵測。
import argparse, json, os, re, sys, time, random, socket, statistics, subprocess, threading, urllib.request, urllib.error, urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bili import UA, REF, dash_streams, nodes, login_status  # noqa: E402
import videos as V  # noqa: E402
import netinfo  # noqa: E402

RESULTS_ROOT = os.path.join(os.getcwd(), "cdn-speedtest-results")


class Partial(Exception): pass
class Stop(Exception):
    def __init__(self, code, msg): super().__init__(msg); self.code = code


# ── 輸出目錄與狀態 ─────────────────────────────────────────────
OUT = None
STATE = {}
DEADLINE = None


def path(name): return os.path.join(OUT, name)
def has(name): return os.path.exists(path(name))
def save(name, data): json.dump(data, open(path(name), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def load(name):
    if not has(name):
        raise Stop(2, f"缺少 {name}，請先執行前置步驟（或用 all）。輸出目錄：{OUT}")
    return json.load(open(path(name), encoding="utf-8"))


def resolve_out(country, out, new, cmd):
    if out:
        return os.path.abspath(out)
    if not new and os.path.isdir(RESULTS_ROOT):
        cands = sorted(d for d in os.listdir(RESULTS_ROOT)
                       if re.fullmatch(rf"{re.escape(country)}-\d{{8}}-\d{{4}}", d))
        if cands:
            last = os.path.join(RESULTS_ROOT, cands[-1])
            age_h = (time.time() - time.mktime(time.strptime(cands[-1][len(country) + 1:], "%Y%m%d-%H%M"))) / 3600
            finished = os.path.exists(os.path.join(last, "summary.json"))
            if cmd == "report" or (not finished and age_h < 12):
                return last  # 續跑最近一次未完成的測試（12 小時內）
    return os.path.join(RESULTS_ROOT, f"{country}-{time.strftime('%Y%m%d-%H%M')}")


def setting(args, key, default):
    """CLI 明確給的值優先，其次 state.json 記錄的值（續跑時沿用），最後是預設值；結果寫回 state"""
    v = getattr(args, key, None)
    if v is None:
        v = STATE.get(key, default)
    STATE[key] = v
    return v


def left():
    return None if DEADLINE is None else DEADLINE - time.time()


STARTED = time.time()


def check_budget(step, need):
    """本次執行已做過別的步驟、且剩餘時間不足 need 秒時，先停下來（避免撞到 10 分鐘的指令逾時）"""
    if DEADLINE is None:
        return
    if time.time() > DEADLINE or (time.time() - STARTED > 10 and left() < need):
        raise Partial(f"時間預算不足（下一步：{step}，約需 {need}s），再執行一次續跑")


# ── 網路工具 ──────────────────────────────────────────────────
def swap(url, host):
    return re.sub(r"^https?://[^/]+", "https://" + host, url)


def host_of(url):
    return re.match(r"https?://([^/]+)", url).group(1)


def stream_url(v):
    """重新取 playurl，回傳 videos.json 指定解析度/編碼的 /upgcxcode/ 網址（避開路徑格式不同的 mcdn/pcdn）"""
    ss = dash_streams(v["bvid"], v["cid"])
    s = next((x for x in ss if x["id"] == v["qn"] and x["codecid"] == v["codecid"]), None)
    if s is None:
        print(f"  ⚠ {v['bvid']} 找不到原本的 qn={v['qn']}/codec={v['codecid']}（登入狀態改變？），改用第一個串流")
        s = ss[0]
    for u in [s.get("baseUrl", "")] + (s.get("backupUrl") or []):
        if "/upgcxcode/" in u:
            return u
    raise RuntimeError(f"{v['bvid']} 沒有 upgcxcode 網址")


def cache_state(h):
    """從回應標頭判斷快取命中：HIT / MISS / None（看不出來；多數節點都是這樣，且標頭不一定可靠）"""
    g = {k.lower(): v for k, v in h.items()}
    for k in ("x-cache", "x-cache-status", "x-cache-lookup", "x-swift-cachetime"):
        if k in g:
            m = re.search(r"HIT|MISS", g[k], re.I)
            if m: return m.group(0).upper()
    if "via" in g:  # 華為等：取第一個 TCP_xxx（最靠近使用者的那層）
        m = re.search(r"TCP_(\w*?)(HIT|MISS)", g["via"], re.I)
        if m: return m.group(2).upper()
    if g.get("nginx-hit") == "1": return "HIT"
    return None


def fetch(url, nbytes, timeout=10, cap=30):
    """下載前 nbytes。回傳 dict(st, ttfb, mbps, total_mbps, bytes, cache, err)；
    ttfb=到收到回應標頭，mbps=標頭後本體吞吐；超過 cap 秒就截斷"""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": REF, "Range": f"bytes=0-{nbytes - 1}"})
    t0 = time.perf_counter()
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        t1 = time.perf_counter()
        n = 0
        while True:
            b = r.read(65536)
            if not b: break
            n += len(b)
            if time.perf_counter() - t0 > cap: break
        t2 = time.perf_counter()
        return dict(st=r.status, ttfb=round((t1 - t0) * 1000), mbps=round(n * 8 / (t2 - t1) / 1e6, 2) if t2 > t1 else 0,
                    total_mbps=round(n * 8 / (t2 - t0) / 1e6, 2), bytes=n, cache=cache_state(r.headers), err=None)
    except urllib.error.HTTPError as e:
        return dict(st=e.code, err=f"HTTP {e.code}")
    except Exception as e:
        msg = str(getattr(e, "reason", e))
        return dict(st=None, err="DNS" if "getaddrinfo" in msg or "Name or service" in msg or "nodename" in msg
                    else "timeout" if "timed out" in msg else msg[:60])


def tcp_rtt(host, port=443, n=5):
    ts = []
    for _ in range(n):
        try:
            ip = socket.gethostbyname(host)
            t = time.perf_counter(); s = socket.create_connection((ip, port), timeout=5)
            ts.append((time.perf_counter() - t) * 1000); s.close()
        except Exception:
            pass
    return round(statistics.median(ts)) if ts else None


def _oem():
    if os.name == "nt":
        try:
            import ctypes
            return f"cp{ctypes.windll.kernel32.GetOEMCP()}"  # 中文 Windows 為 cp950
        except Exception:
            return "cp950"
    return "utf-8"


def _nslookup_raw(args):
    return netinfo.run(["nslookup"] + args, timeout=10)


DOH_ECS = None  # DNS="doh" 時帶給 Google 的 ECS 子網（使用者出口 IP 的 /24），讓 GeoDNS 依使用者所在地回答


def doh(name):
    """Google DNS-over-HTTPS 解析，帶使用者自己的 ECS。回傳 (ips, canonical)"""
    q = dict(name=name, type="A")
    if DOH_ECS: q["edns_client_subnet"] = DOH_ECS
    try:
        d = json.load(urllib.request.urlopen("https://dns.google/resolve?" + urllib.parse.urlencode(q), timeout=10))
    except Exception:
        return [], None
    ans = d.get("Answer") or []
    ips = sorted({a["data"] for a in ans if a.get("type") == 1})
    cn = [a["data"].rstrip(".").lower() for a in ans if a.get("type") == 5]
    return ips, ((cn[-1] if cn else name.lower()) if ips else None)


def set_doh_ecs(ip):
    global DOH_ECS
    if ip and re.fullmatch(r"\d+\.\d+\.\d+\.\d+", ip):
        DOH_ECS = ".".join(ip.split(".")[:3]) + ".0/24"


def nslookup(name, server=None):
    """回傳 (ips, canonical)。server="doh" 用 Google DoH；否則呼叫系統 nslookup
    （輸出第一段是 DNS 伺服器本身，跳過；Windows 中文語系輸出用 OEM 編碼）"""
    if server == "doh":
        return doh(name)
    o = _nslookup_raw([name] + ([server] if server else []))
    tail = o.split("\n\n", 1)[1] if "\n\n" in o else ""
    ips = sorted(set(re.findall(r"\b\d+\.\d+\.\d+\.\d+\b", tail)))
    names = [x for x in re.findall(r"\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b", tail.lower()) if x != name.lower()]
    return ips, (names[0] if names and ips else (name if ips else None))


def system_dns_server():
    o = _nslookup_raw(["localhost"])
    head = o.split("\n\n", 1)[0]
    m = re.findall(r"\b\d+\.\d+\.\d+\.\d+\b", head)
    return m[0] if m else None


DNS = os.environ.get("DNS") or None  # 例如 168.95.1.1：節點網域改用指定 DNS 解析；"doh" = Google DoH 帶自己的 ECS
PROGRESS = None  # 選用：PROGRESS(階段, 已完成, 總數)，給 GUI 顯示進度
# 決定並行數時，單一連線速度最多算到這裡（Mbps）：B 站 8K 串流宣告碼率實測 12–59 Mbps，取 60。
# 節點再快，播放也用不到，所以並行時頂端被抹平成同一級沒關係，換來更多並行、更短的測速時間
PER_CONN_CAP = 60
_resolved = {}
_orig_gai = socket.getaddrinfo


def _gai(host, *a, **k):
    ips = _resolved.get(host)
    if ips is None: return _orig_gai(host, *a, **k)
    if not ips: raise socket.gaierror(11001, "getaddrinfo failed (DNS override)")
    return _orig_gai(ips[0], *a, **k)  # TLS SNI/憑證驗證仍用原網域，只換連線 IP


def pre_resolve(hosts):
    if not DNS: return
    todo = [h for h in hosts if h not in _resolved]
    with ThreadPoolExecutor(16) as ex:
        for h, (ips, _) in zip(todo, ex.map(lambda h: nslookup(h, DNS), todo)): _resolved[h] = ips
    socket.getaddrinfo = _gai
    print(f"    用 DNS {DNS} 解析 {len(todo)} 個網域，{sum(1 for h in todo if _resolved[h])} 個有結果", flush=True)


def canonical(host):
    """CNAME 解析後的正式名稱（判斷 CDN 池用）；失敗回 None"""
    return resolve(host)[0]


def resolve(host):
    """(CNAME 正式名稱, 解析到的 IP 清單)；失敗回 (None, [])。分池用，與測速時的解析方式相同"""
    if DNS:
        ips, cn = nslookup(host, DNS)
        return cn, ips
    try:
        name, _, ips = socket.gethostbyname_ex(host)
        return name.lower(), sorted(ips)
    except Exception:
        return None, []


def pool_of(host, canon):
    """(池 key, 池中文標籤)。bcache cn-* 以 cn-{地點}-{電信}-{叢集} 分家族；其餘以 CNAME 正式名稱分組。
    同池的用途是清單分散備援（同池最多 2 個），看的是「會不會一起失敗」，不是速度接不接近：
    33 份報告中，bcache 同家族一起失敗 99%（不同家族 64%）、upos 同 CNAME 82%（不同 CNAME 37%）。
    解析到完全相同 IP 組合的池再由 assign_pools() 合併"""
    short = host.split(".")[0]
    if short.startswith("cn-"):
        fam = "-".join(short.split("-")[:4])
        lab = f"香港 bcache（{fam}）" if fam.startswith("cn-hk-") else f"B 站自建 bcache（{fam}）"
        return fam, lab + ("（DNS 解析失敗）" if not canon else "")
    if not canon:
        return host, "（DNS 解析失敗）"
    key = canon[len(host) + 1:] if canon.startswith(host + ".") else canon
    if key == host:
        return host, f"{short}（無 CNAME）"
    if "cdnhwc" in key:
        lab = "華為冷資料池" if "cold" in key else "華為一般池" if key.startswith("hcdnv.") else "華為 CDN"
    elif "myqcloud" in key:
        lab = "騰訊雲 COS"
    elif "tdnsv" in key or "dnsv1" in key or "cdntip" in key:
        lab = "騰訊雲 CDN"
    elif "kunlun" in key or "alikunlun" in key or "aliyun" in key:
        lab = "阿里雲 CDN"
    elif "akamai" in key or "akadns" in key:
        lab = "Akamai"
    else:
        lab = "其他"
    return key, f"{lab}（{key}）"


def assign_pools(res):
    """res = {host: (CNAME, IP 清單)} → {host: (池 key, 標籤)}。先依 pool_of 分（bcache 家族／CNAME），
    再把解析到「完全相同」IP 組合的池合併：同一批機器，CNAME 不同也該算同池（例如 08c、08ct、hw 解析到相同的 IP）。
    只有部分 IP 重疊不合併：33 份報告中，華為一般／冷資料池（共用 1 個 IP）一起失敗 60–70%，
    騰訊 cos／tf-all-tx（也共用 1 個 IP）只有 30%，與不相關的節點（34%）差不多，部分重疊分不出這兩種情況"""
    base = {h: pool_of(h, cn) for h, (cn, _) in res.items()}
    parent = {}

    def find(k):
        while parent.get(k, k) != k: k = parent[k]
        return k

    owner = {}
    for h, (_, ips) in sorted(res.items()):
        if not ips: continue
        s = frozenset(ips)
        if s not in owner:
            owner[s] = h
            continue
        a, b = find(base[h][0]), find(base[owner[s]][0])
        if a != b: parent[max(a, b)] = min(a, b)
    labels = {}
    for h in res: labels.setdefault(find(base[h][0]), set()).add(base[h][1])
    out = {}
    for h in res:
        k = find(base[h][0])
        labs = sorted(labels[k])
        out[h] = (k, labs[0] if len(labs) == 1 else labs[0] + "＋同 IP：" + "、".join(labs[1:]))
    return out


# ── 並行測試矩陣（可續跑） ─────────────────────────────────────
def run_matrix(tasks, conc, nbytes, logname, timeout, cap=30):
    """tasks = [(host, video_key, url)]；隨機順序並行跑，每筆結果即時追加到 <logname>.jsonl。
    已在記錄檔裡的 (host, key) 會跳過，所以中斷後重跑即可續跑。全部完成才回傳 [(host, key, result)]。"""
    log = path(logname + ".jsonl")
    want = {(t[0], t[1]) for t in tasks}
    prev = [json.loads(l) for l in open(log, encoding="utf-8") if l.strip()] if os.path.exists(log) else []
    seen = {(p["host"], p["video"]) for p in prev} & want
    todo = [t for t in tasks if (t[0], t[1]) not in seen]
    random.shuffle(todo)  # 打亂順序，降低時段波動與同家族 CDN 共用快取的順序偏差
    pre_resolve(sorted({t[0] for t in todo}))
    print(f"    已完成 {len(seen)}/{len(tasks)}，本次要跑 {len(todo)}"
          + (f"（時間預算剩 {left():.0f}s）" if DEADLINE else ""), flush=True)
    stop = [False]
    lock = threading.Lock()
    f = open(log, "a", encoding="utf-8")
    # 留一點餘裕給收尾中的連線（最長 timeout + 30s 截斷）
    margin = timeout + 35

    def one(t):
        if stop[0] or (DEADLINE and time.time() > DEADLINE - margin):
            stop[0] = True
            return
        r = fetch(t[2], nbytes, timeout=timeout, cap=cap)
        with lock:
            f.write(json.dumps(dict(host=t[0], video=t[1], **r), ensure_ascii=False) + "\n"); f.flush()
            seen.add((t[0], t[1]))
            if len(seen) % 100 == 0: print(f"    {len(seen)}/{len(tasks)}", flush=True)
            if PROGRESS: PROGRESS(logname, len(seen), len(tasks))

    with ThreadPoolExecutor(conc) as ex:
        list(ex.map(one, todo))
    f.close()
    if len(seen) < len(tasks):
        raise Partial(f"{logname} 未完成 {len(seen)}/{len(tasks)}，再執行一次續跑")
    rows = {}
    for l in open(log, encoding="utf-8"):
        if l.strip():
            r = json.loads(l)
            if (r["host"], r["video"]) in want:
                rows[(r["host"], r["video"])] = r  # 同一筆重複時取最後一筆
    return [(r.pop("host"), r.pop("video"), r) for r in rows.values()]


# ── 子指令 ────────────────────────────────────────────────────
def cmd_env(country, args):
    login = login_status()
    try:
        ip = json.load(urllib.request.urlopen("https://ipinfo.io/json", timeout=10))
    except Exception as e:
        ip = dict(err=str(e)[:80])
    txt = _nslookup_raw(["-type=TXT", "o-o.myaddr.l.google.com."])
    isp = setting(args, "isp_dns", None)
    keys = ["upos-sz-mirror08ct.bilivideo.com", "upos-sz-mirror08c.bilivideo.com", "upos-sz-mirrorhw.bilivideo.com",
            "upos-sz-estghw.bilivideo.com", "upos-sz-estgcos.bilivideo.com", "upos-sz-mirrorali.bilivideo.com",
            "upos-sz-mirrorcos.bilivideo.com", "upos-hz-mirrorakam.akamaized.net", "cn-hk-eq-01-09.bilivideo.com",
            "cn-jxnc-cmcc-bcache-06.bilivideo.com"]
    dns = {}
    for h in keys:
        d = dict(system=nslookup(h)[0], canonical=canonical(h))
        if isp: d["isp"] = nslookup(h, isp)[0]
        if DNS and DNS != isp: d["override"] = nslookup(h, DNS)[0]
        dns[h] = d
    rtt_targets = [("www.bilibili.com", 443), ("www.google.com", 443), ("8.8.8.8", 53), ("1.1.1.1", 53)]
    if isp: rtt_targets.append((isp, 53))
    data = dict(time=time.strftime("%Y-%m-%d %H:%M"), tz=time.strftime("%z"), country_arg=country,
                exit=dict(ip=ip.get("ip"), country=ip.get("country"), org=ip.get("org"), city=ip.get("city"),
                          err=ip.get("err")),
                login=login, system_dns=system_dns_server(), dns_override=DNS, isp_dns=isp,
                resolver_txt=re.findall(r'"([^"]+)"', txt),
                rtt_ms={h: tcp_rtt(h, p) for h, p in rtt_targets}, dns=dns)
    chk = dns_check()
    data["dns_check"] = {k: chk[k] for k in ("resolvers", "ecs", "ecs_country", "dns_ok", "dns_verdict")}
    print(("DNS 檢查：OK，" if chk["dns_ok"] else "⚠ DNS 檢查：") + chk["dns_verdict"])
    data["network"] = netinfo.link_info(ip.get("org") or "")
    data["vpn_check"] = netinfo.PRESET_VPN or netinfo.vpn_check()
    if data["vpn_check"].get("mobile") and not data["network"].get("kind_note"):
        data["network"]["kind_note"] = "ip-api 判斷為行動網路"
    print("VPN 檢查：" + ("⚠ " + "；".join(data["vpn_check"]["signals"]) if data["vpn_check"]["vpn"] else "未偵測到"))
    if not netinfo.PRESET_BW: print("測總頻寬（Cloudflare，約 20 秒）…", flush=True)
    data["bandwidth"] = netinfo.PRESET_BW or netinfo.bandwidth()
    n, bw = data["network"], data["bandwidth"]
    print(f"網路類型：{n['kind']}" + (f"（{n['kind_note']}）" if n.get("kind_note") else "")
          + (f"；Wi-Fi {n['wifi']}" if n.get("wifi") else ""))
    print(f"總頻寬：下載 {bw.get('down_mbps')} / 上傳 {bw.get('up_mbps')} Mbps，延遲 {bw.get('latency_ms')} ms"
          + (f"（{bw['err']}）" if bw.get("err") else ""))
    save("env.json", data)
    e = data["exit"]
    print(f"出口：{e['ip']} {e['country']} {e['org']}（{e['city']}）")
    print(f"登入：{'是' if login['login'] else '否'}（cookie 來源：{login['cookie_src']}）")
    print(f"系統 DNS：{data['system_dns']}；Google 看到的解析器：{data['resolver_txt']}"
          + (f"；節點改用 DNS {DNS} 解析" if DNS else ""))
    print("RTT(ms)：", data["rtt_ms"])
    for h, d in dns.items():
        diff = ""
        if isp: diff = "  （系統 vs ISP：" + ("相同" if set(d["system"]) == set(d["isp"]) else "不同") + "）"
        print(f"  {h:40} → {d['canonical']}  {d['system'][:3]}{diff}")
    if e.get("country") and e["country"].upper() != country.upper():
        print(f"⚠ 出口國家是 {e['country']}，與指定的 {country} 不符：可能開著 VPN／代理，或手機漫遊走母國出口。")
    if not login["login"]:
        print("⚠ 未登入（cookie 缺少或失效）：只能取得 ≤480P 的串流，與實際高畫質觀看不同。")
    return data


def gate(country, args):
    """all 的前置檢查：未登入 → exit 4；出口國家不符 → exit 5（除非使用者已同意）"""
    if not has("env.json"):
        cmd_env(country, args)
    env = load("env.json")
    allow_guest = setting(args, "allow_guest", False)
    if not env["login"]["login"]:
        env["login"] = login_status()  # 使用者可能剛換了 cookie
        save("env.json", env)
    if not env["login"]["login"] and not allow_guest:
        raise Stop(4, "未登入：只能測 ≤480P。請提供新的 BILI_COOKIE 後重跑，或加 --allow-guest 以 480P 繼續。")
    ex = (env["exit"].get("country") or "").upper()
    if ex and ex != country.upper() and not setting(args, "ignore_country_mismatch", False):
        raise Stop(5, f"出口國家是 {ex}，與指定的 {country} 不符（VPN／代理／漫遊？）。"
                      "確認後可加 --ignore-country-mismatch 繼續，或改用正確的國家代碼。")
    chk = env.get("dns_check") or {}
    if chk and not chk.get("dns_ok") and not DNS and not setting(args, "ignore_dns_mismatch", False):
        raise Stop(6, "DNS 解析器與所在地不一致：" + chk.get("dns_verdict", "") +
                      "。請改用當地 ISP 的 DNS（--dns <IP>），或確認後加 --ignore-dns-mismatch 繼續。")


def cmd_pool(country, args):
    quick = setting(args, "quick", False)
    prog = (lambda i, n: PROGRESS("pool", i, n)) if PROGRESS else None
    if not V.build_pool(path("pool.json"), DEADLINE and DEADLINE - 30, quick=quick, progress=prog):
        raise Partial("影片池未完成，再執行一次續跑")


def cmd_pick(country, args):
    if not has("pool.json") or not json.load(open(path("pool.json"), encoding="utf-8")).get("complete"):
        raise Stop(2, "影片池尚未完成，請先跑 pool")
    seed = setting(args, "seed", int(time.strftime("%Y%m%d%H%M")))
    n = setting(args, "limit_videos", None) or 10
    lg = login_status()["login"]
    V.pick(path("pool.json"), path("videos.json"), seed, n_test=n, logged_in=lg)
    print(f"種子 {seed}" + ("" if lg else "（未登入：畫質 ≤480P）"))


def cmd_ceiling(country, args):
    vids = load("videos.json")
    # 用快篩的熱門影片（最長那支，檔案夠大）量上限；不用細測影片，避免預熱細測影片的快取
    v = max(vids["screen"] or vids["test"], key=lambda v: v["dur"])
    url = stream_url(v)
    hosts = list(dict.fromkeys(["upos-sz-mirror08ct.bilivideo.com", "upos-sz-mirror08c.bilivideo.com",
                                "upos-sz-mirrorhw.bilivideo.com", "upos-sz-mirrorali.bilivideo.com",
                                "upos-sz-mirrorcos.bilivideo.com", host_of(url)]))
    pre_resolve(hosts)
    quick = setting(args, "quick", False)
    size = (2 if quick else 16) << 20
    single = {h: fetch(swap(url, h), size, timeout=15) for h in hosts}
    for h, r in single.items():
        print(f"  單連線 {h:40} {r.get('mbps')} Mbps ttfb={r.get('ttfb')} {r.get('err') or ''}")
    ok = sorted([h for h, r in single.items() if not r["err"]], key=lambda h: -single[h]["mbps"])[:2]
    if not ok:
        raise Stop(2, "所有節點單連線都失敗，無法量頻寬上限（網路不通或 cookie/影片問題）")
    res = {}
    for n in ((4,) if quick else (4, 8, 16, 24)):
        with ThreadPoolExecutor(n) as ex:
            rs = list(ex.map(lambda i: fetch(swap(url, ok[i % len(ok)]), size, timeout=15), range(n)))
        # 各連線自身速度加總（同時進行）；不用「總位元組 ÷ 總時間」，否則一條卡住的連線會拉低整體
        res[n] = round(sum(r.get("total_mbps", 0) for r in rs if not r.get("err")), 1)
        print(f"  {n:2} 連線合計 ≈ {res[n]} Mbps", flush=True)
    ceil = max(res.values())
    single_med = statistics.median([r["mbps"] for r in single.values() if not r["err"]])
    # 一條連線的典型速度：取「單連線中位數」與「4 連線時平均每條」較大者，
    # 但最多算到 PER_CONN_CAP（8K 高碼率）：播放用不到更快的速度，超過的節點被抹平成同一級也沒關係
    typical_raw = max(single_med, res[4] / 4)
    typical = min(typical_raw, PER_CONN_CAP)
    auto = max(1, min(8, int(0.5 * ceil / typical))) if typical > 0 else 1
    conc = args.conc or auto
    data = dict(time=time.strftime("%Y-%m-%d %H:%M"), video=v["bvid"], single=single, parallel=res, ceiling=ceil,
                single_median=round(single_med, 1), typical_per_conn_raw=round(typical_raw, 1),
                typical_per_conn=round(typical, 1), conc_auto=auto, conc=conc)
    save("ceiling.json", data)
    STATE["conc"] = conc
    print(f"頻寬上限 ≈ {ceil} Mbps；典型單連線 ≈ {typical_raw:.1f} Mbps"
          + (f"（以 8K 碼率上限 {PER_CONN_CAP} 計）" if typical < typical_raw else "") + f" → 自動並行數 {auto}"
          + (f"（使用者指定 {conc}）" if conc != auto else ""))


def get_conc(args):
    if args.conc: STATE["conc"] = args.conc
    if STATE.get("conc"): return STATE["conc"]
    return load("ceiling.json")["conc"]


def cmd_stage1(country, args):
    conc = get_conc(args)
    timeout = setting(args, "timeout", 10)
    lim = setting(args, "limit_nodes", None)
    # 預設不淘汰：三支都成功的節點全部往下走（冷門探測 → 細測）。舊版只留前 80 名，但前段有一半以上是
    # 「只能播熱門」的節點（細測回 403），真正能比較的節點被擠出去；現在改由冷門探測挑掉這些節點。
    # 兩個門檻只在手動指定時才用（例如想縮短測試時間）
    keep_top = setting(args, "keep_top", None)
    keep_ratio = setting(args, "keep_ratio", None)
    allnodes = nodes()
    if lim: allnodes = allnodes[:lim]
    meta = {n["host"]: n for n in allnodes}
    hosts = list(meta)
    urls = {v["bvid"]: stream_url(v) for v in load("videos.json")["screen"]}
    print(f"快篩：{len(hosts)} 節點 × {len(urls)} 支 × 2MB，並行 {conc}，逾時 {timeout}s")
    t0 = time.time()
    rs = run_matrix([(h, k, swap(u, h)) for h in hosts for k, u in urls.items()], conc, 2 << 20, "stage1", timeout)
    per = {}
    for h, k, r in rs: per.setdefault(h, {})[k] = r
    rows = []
    for h in hosts:
        ok = [r for r in per[h].values() if not r["err"] and r["bytes"] > 0]
        errs = [r["err"] for r in per[h].values() if r["err"]]
        rows.append(dict(host=h, source=meta[h].get("source"), n_ok=len(ok),
                         mbps=statistics.median([r["mbps"] for r in ok]) if len(ok) == len(urls) else None,
                         ttfb=statistics.median([r["ttfb"] for r in ok]) if ok else None, errs=errs))
    good = sorted([r for r in rows if r["mbps"] is not None], key=lambda r: -r["mbps"])
    keep_n = len(good)
    if good and keep_top is not None:
        # 手動指定時：保留前 keep_top 名，或速度 ≥ 第一名 keep_ratio 的全部（取兩者較多者）
        keep_n = max(keep_top, sum(1 for r in good if r["mbps"] >= (keep_ratio or 1) * good[0]["mbps"]))
    elif good and keep_ratio is not None:
        keep_n = sum(1 for r in good if r["mbps"] >= keep_ratio * good[0]["mbps"])
    keep = [r["host"] for r in good[:keep_n]]
    data = dict(time=time.strftime("%Y-%m-%d %H:%M"), conc=conc, timeout=timeout, keep_top=keep_top,
                keep_ratio=keep_ratio, n_nodes=len(hosts), rows=rows, keep=keep,
                raw=[dict(host=h, video=k, **r) for h, k, r in rs])
    save("stage1.json", data)
    print(f"完成；三支都成功 {len(good)} 個，保留 {len(keep)} 個")
    print("失敗原因：", Counter(e for r in rows for e in r["errs"]).most_common(8))
    for r in good[:15]: print(f"  {r['host']:45} {r['mbps']:7.2f} Mbps  ttfb {r['ttfb']} ms")


PROBE_BYTES = 1 << 20  # 冷門探測每個節點下載 1MB：403 會立刻回應；其他節點順便留下冷門片的 TTFB 與速度
# 細測每筆最多下載幾秒（從送出請求起算）就截斷，速度用已收到的部分計算。細測不再只取前 80 名後，
# 很慢的節點（< 5 Mbps，連 1080P 都不順）佔了細測大半時間（實測台灣 VPN 78%、新加坡 43%），原本的 30 秒太長
STAGE2_CAP = 8


def cmd_probe(country, args):
    """冷門探測：快篩通過的節點各抓 1 支低播放影片。回 403 的是「只能播熱門」的節點，不進細測；
    其他結果（成功、逾時…）一律照常進細測，由細測判斷好壞。舊的 videos.json 沒有探測片時直接沿用快篩的保留清單"""
    conc = get_conc(args)
    timeout = setting(args, "timeout", 10)
    s1 = load("stage1.json")
    pv = (load("videos.json").get("probe") or [None])[0]
    if not pv:
        save("probe.json", dict(time=time.strftime("%Y-%m-%d %H:%M"), video=None, keep=s1["keep"], blocked=[], rows=[]))
        print("沒有冷門探測影片（影片池缺中低播放影片），快篩通過的節點全部進細測")
        return
    url = stream_url(pv)
    print(f"冷門探測：{len(s1['keep'])} 節點 × 1 支（{pv['bvid']}，{V.cell_zh(pv['cell'])}）× "
          f"{PROBE_BYTES >> 20}MB，並行 {conc}")
    rs = run_matrix([(h, "probe", swap(url, h)) for h in s1["keep"]], conc, PROBE_BYTES, "probe", timeout)
    res = {h: r for h, _, r in rs}
    blocked = [h for h in s1["keep"] if res[h].get("err") == "HTTP 403"]
    keep = [h for h in s1["keep"] if h not in set(blocked)]
    rows = [dict(host=h, **{k: res[h].get(k) for k in ("st", "err", "ttfb", "mbps", "bytes", "cache")}) for h in s1["keep"]]
    save("probe.json", dict(time=time.strftime("%Y-%m-%d %H:%M"), video=pv["bvid"], cell=pv["cell"],
                            bytes=PROBE_BYTES, keep=keep, blocked=blocked, rows=rows))
    print(f"完成；回 403（只能播熱門）{len(blocked)} 個，進細測 {len(keep)} 個")
    print("其他結果：", Counter(r["err"] or "成功" for r in rows if r["err"] != "HTTP 403").most_common(6))


def cmd_stage2(country, args):
    conc = get_conc(args)
    timeout = setting(args, "timeout", 10)
    mb = setting(args, "mb", 4)
    keep = (load("probe.json") if has("probe.json") else load("stage1.json"))["keep"]
    lim = setting(args, "limit_nodes", None)
    if lim: keep = keep[:lim]
    vs = load("videos.json")["test"]
    urls = {v["bvid"]: stream_url(v) for v in vs}
    print(f"細測：{len(keep)} 節點 × {len(urls)} 支 × {mb}MB，並行 {conc}")
    rs = run_matrix([(h, k, swap(u, h)) for h in keep for k, u in urls.items()], conc, mb << 20, "stage2", timeout,
                    cap=STAGE2_CAP)
    data = dict(time=time.strftime("%Y-%m-%d %H:%M"), conc=conc, mb=mb, timeout=timeout, cap=STAGE2_CAP, keep=keep,
                raw=[dict(host=h, video=k, **r) for h, k, r in rs])
    save("stage2.json", data)
    print("細測完成")


# ── report ───────────────────────────────────────────────────
def short(h):
    s = h.replace(".bilivideo.com", "")
    return s.replace("upos-sz-mirror", "").replace("upos-sz-", "") if s.startswith("upos-sz-") else s


def rank_rows(s2, vids, ceil):
    cells = {v["bvid"]: v["cell"] for v in vids}
    by = {}
    for r in s2["raw"]: by.setdefault(r["host"], []).append(r)
    rows, failed = [], {}
    for h, rs in by.items():
        ok = [r for r in rs if not r["err"] and r["bytes"] > 0]
        if len(ok) < len(rs):  # 有任一支失敗就不列入排名
            failed[h] = Counter(r["err"] or "0 bytes" for r in rs if r not in ok)
            continue
        sp = [r["mbps"] for r in ok]
        # 未命中：標頭明示 MISS；看不出來時 TTFB > 該節點中位數 2 倍視為疑似未命中
        med_t = statistics.median(r["ttfb"] for r in ok)
        miss = [r for r in ok if r["cache"] == "MISS" or (r["cache"] is None and r["ttfb"] > 2 * med_t)]
        hit = [r for r in ok if r not in miss]
        rows.append(dict(host=h, mean=round(statistics.mean(sp), 2), sd=round(statistics.pstdev(sp), 2),
                         min=min(sp), max=max(sp), ttfb=med_t,
                         hit_mbps=round(statistics.mean([r["mbps"] for r in hit]), 2) if hit else None,
                         miss_n=len(miss), miss_ttfb=statistics.median([r["ttfb"] for r in miss]) if miss else None,
                         miss_cells=sorted({cells.get(r["video"], "?") for r in miss}),
                         mean_total=round(statistics.mean(r["total_mbps"] for r in ok), 2)))
    rows.sort(key=lambda r: -r["mean"])
    n = max(1, len(vids))
    top = next((r for r in rows if r["sd"] <= 0.5 * r["mean"]), None)  # 比較基準：最快的「穩定」節點
    for r in rows:
        if r["sd"] > 0.5 * r["mean"]:
            r["tier"] = "不穩定"  # 兩極：命中快取時極快、未命中極慢（海外 CDN 常見），平均值不具代表性
            continue
        # 與基準的平均差，是否落在兩者 n 支影片波動所估的 95% 區間內（≈ 2 × 平均差的標準誤）
        se = ((top["sd"] ** 2 + r["sd"] ** 2) / n) ** 0.5
        if r["mean"] >= 0.9 * ceil / s2["conc"] or top["mean"] - r["mean"] <= 2 * se:
            r["tier"] = "第一梯隊"
        elif r["mean"] >= 0.5 * top["mean"]:
            r["tier"] = "可用"
        else:
            r["tier"] = "差"
    for i, r in enumerate(rows, 1): r["rank"] = i
    hot_only = sorted(h for h, rs in by.items() if any(r["err"] == "HTTP 403" for r in rs))
    return rows, top, hot_only, failed


def recommend(rows, n=10, per_pool=2):
    """依 CDN 池分散的建議清單：只收「第一梯隊」與「可用」（不穩定、差都不列，不足 n 個就少列）；
    第一梯隊優先、其餘依平均速度；每池最多 per_pool 個"""
    order = [r for r in rows if r["tier"] == "第一梯隊"] + [r for r in rows if r["tier"] == "可用"]
    cnt, rec, skipped = Counter(), [], []
    for r in order:
        if len(rec) >= n: break
        if cnt[r["pool"]] >= per_pool:
            skipped.append(r); continue
        cnt[r["pool"]] += 1
        rec.append(r)
    # 預設：穩定（cv ≤ 0.3）的第一梯隊中，TTFB 不高（≤ 最低 TTFB×1.5 或 +150ms）且平均最快者；條件逐步放寬
    t1 = [r for r in rows if r["tier"] == "第一梯隊"]
    default = None
    if t1:
        lim = max(1.5 * min(r["ttfb"] for r in t1), min(r["ttfb"] for r in t1) + 150)
        for c in ([r for r in t1 if r["sd"] <= 0.3 * r["mean"] and r["ttfb"] <= lim],
                  [r for r in t1 if r["ttfb"] <= lim], t1):
            if c:
                default = max(c, key=lambda r: r["mean"]); break
    elif rec:
        default = rec[0]
    return rec, default, skipped


def custom_list(rows, default, n=10, per_pool=2):
    """寫進擴充「自訂節點列表」的 n 個節點（測速 GUI 發送後匯入）。跟 recommend() 的差別是列表要拿來備援：
    預設節點排第一，之後依 第一梯隊 → 可用 → 不穩定 → 差（同級依平均速度）往下取，每池最多 per_pool 個，
    寧可往後多收別的池也要湊到 n 個，某個池整個掛掉時還有其他池可以切"""
    tiers = ["第一梯隊", "可用", "不穩定", "差"]
    order = sorted(rows, key=lambda r: (tiers.index(r["tier"]) if r.get("tier") in tiers else len(tiers), -r["mean"]))
    if default:
        order = [default] + [r for r in order if r is not default]
    cnt, out = Counter(), []
    for r in order:
        if len(out) >= n: break
        if cnt[r["pool"]] >= per_pool: continue
        cnt[r["pool"]] += 1
        out.append(r["host"])
    return out


def fmt(x, d=1):
    return "-" if x is None else f"{x:.{d}f}"


def cmd_report(country, args):
    env, ceil_d, vids = load("env.json"), load("ceiling.json"), load("videos.json")
    s1, s2 = load("stage1.json"), load("stage2.json")
    pr = load("probe.json") if has("probe.json") else dict(video=None, keep=s1["keep"], blocked=[], rows=[])
    ceil = ceil_d["ceiling"]
    rows, top, hot_only, failed = rank_rows(s2, vids["test"], ceil)
    probe_403 = set(pr["blocked"])
    hot_only = sorted(set(hot_only) | probe_403)  # 冷門探測 403 與細測 403 都是「只能播熱門」
    meta = {n["host"]: n for n in nodes()}
    # CDN 池：執行時用 CNAME 與解析到的 IP 判斷。快篩測過的節點全部解析（失敗的也要），
    # 這樣 summary.json 每個節點都有 CNAME／IP，之後才驗證得了「同池會不會一起失敗」
    need = sorted({r["host"] for r in rows} | {r["host"] for r in s1["rows"]} |
                  {h for h, m in meta.items() if "project" in m.get("source", "")})
    with ThreadPoolExecutor(16) as ex:
        res = dict(zip(need, ex.map(resolve, need)))
    canon = {h: cn for h, (cn, _) in res.items()}
    pools = assign_pools(res)
    for r in rows:
        r["canonical"] = canon.get(r["host"])
        r["ips"] = res[r["host"]][1]
        r["pool"], r["pool_label"] = pools[r["host"]]
        r["source"] = meta.get(r["host"], {}).get("source", "?")
    rec, default, _ = recommend(rows)
    unstable = [r for r in rows if r["tier"] == "不穩定"]
    s1rows = {r["host"]: r for r in s1["rows"]}
    rank = {r["host"]: r for r in rows}
    hot_only_set = set(hot_only)

    def status(h):
        if h in rank:
            r = rank[h]
            return f"#{r['rank']} {r['tier']}（{r['mean']:.1f} Mbps，TTFB {r['ttfb']:.0f} ms）"
        if h in probe_403: return "只能播熱門影片（冷門探測 403）"
        if h in hot_only_set: return "只能播熱門影片（細測 403）"
        if h in failed: return "細測有失敗：" + "、".join(f"{k}×{v}" for k, v in failed[h].items())
        s = s1rows.get(h)
        if s is None: return "未測（--limit-nodes）"
        if s["mbps"] is None:
            return "快篩失敗：" + "、".join(f"{k}×{v}" for k, v in Counter(s["errs"]).items())
        return f"快篩淘汰（{s['mbps']:.1f} Mbps）"

    proj = [dict(host=h, name=m.get("name"), status=status(h), pool=pools[h][1])
            for h, m in meta.items() if "project" in m.get("source", "")]
    contention = bool(rows) and rows[0]["mean"] >= 0.8 * ceil / s2["conc"]
    # 每個節點的快篩與冷門探測結果（跨報告分析用：區分「快篩逾時」與「快篩通過但被淘汰」，
    # 也讓沒進細測的節點至少有熱門片速度與冷門片能不能播的紀錄）
    pr_rows = {r["host"]: r for r in pr.get("rows") or []}
    s1_nodes = []
    for r in s1["rows"]:
        cn, ips = res.get(r["host"], (None, []))
        d = dict(host=r["host"], mbps=r["mbps"], ttfb=r["ttfb"], n_ok=r["n_ok"], errs=dict(Counter(r["errs"])),
                 canonical=cn, ips=ips, pool=pools[r["host"]][0])
        p = pr_rows.get(r["host"])
        if p: d["probe"] = {k: p.get(k) for k in ("err", "ttfb", "mbps")}
        s1_nodes.append(d)

    def vinfo(v):
        """影片性質：分層（播放量 H/M/L × 發布 new/mid/old）、畫質 qn、編碼、播放數、發布時間（unix 秒）、長度（秒）、
        測試用串流宣告的碼率（bps）與寬高、幀率。舊版 videos.json 沒有碼率等欄位時為 None"""
        return dict(bvid=v["bvid"], cell=v["cell"], qn=v["qn"], codecid=v["codecid"], view=v["view"],
                    pub=v.get("pub"), dur=v.get("dur"), bandwidth=v.get("bandwidth"), width=v.get("width"),
                    height=v.get("height"), fps=v.get("fps"))

    def per_request(raw):
        """逐筆結果（每個節點 × 每支影片一筆），給跨報告分析用：細測有任一支失敗的節點不列入排名，
        但成功那幾支（例如只有低播放影片逾時）仍是有用的冷門片數據。成功的記 TTFB／速度／位元組／快取，失敗的只記錯誤"""
        out = []
        for r in raw:
            d = dict(host=r["host"], video=r["video"])
            if r.get("err"): d["err"] = r["err"]
            else: d.update(ttfb=r.get("ttfb"), mbps=r.get("mbps"), bytes=r.get("bytes"), cache=r.get("cache"))
            out.append(d)
        return out

    e = env["exit"]
    summary = dict(country=country, time=s2["time"], env=dict(exit=e, system_dns=env.get("system_dns"),
                   resolver_txt=env.get("resolver_txt"), dns_override=env.get("dns_override") or DNS,
                   login=env["login"]["login"], rtt_ms=env.get("rtt_ms"),
                   network=env.get("network"), bandwidth=env.get("bandwidth"), vpn_check=env.get("vpn_check")),
                   ceiling=ceil, conc=s2["conc"], conc_auto=ceil_d.get("conc_auto"), seed=vids["seed"],
                   stage1=dict(n_nodes=s1["n_nodes"], passed=sum(1 for r in s1["rows"] if r["mbps"] is not None),
                               kept=len(s1["keep"]), keep_top=s1.get("keep_top"), keep_ratio=s1.get("keep_ratio"),
                               probe=dict(video=pr.get("video"), bytes=pr.get("bytes"), tested=len(pr.get("rows") or []),
                                          blocked=len(probe_403), kept=len(pr["keep"])),
                               nodes=s1_nodes, raw=per_request(s1.get("raw") or [])),
                   stage2=dict(n_nodes=len(s2["keep"]), full_success=len(rows), mb=s2["mb"], cap=s2.get("cap", 30),
                               raw=per_request(s2.get("raw") or [])),
                   videos={k: [vinfo(v) for v in vids.get(k) or []] for k in ("screen", "test", "probe")},
                   default=default and default["host"], recommended=[r["host"] for r in rec],
                   custom_list=custom_list(rows, default),
                   rows=rows, hot_only=hot_only, unstable=[r["host"] for r in unstable],
                   failed={h: dict(c) for h, c in failed.items()}, project_nodes=proj, contention_warning=contention)
    save("summary.json", summary)

    L = []
    w = L.append
    w(f"# Bilibili 點播 CDN 測速報告：{country}（{s2['time']}）\n")
    w("## 結論\n")
    if default:
        w(f"- **建議預設節點：`{default['host']}`**（#{default['rank']}，{default['tier']}，"
          f"{default['mean']:.1f} Mbps ±{default['sd']:.1f}，TTFB {default['ttfb']:.0f} ms，{default['pool_label']}）")
    else:
        w("- 沒有任何節點在細測中全部成功，無法給出建議。")
    if rec:
        w("- 建議清單（依 CDN 池分散）：" + "、".join(f"`{short(r['host'])}`" for r in rec))
    w(f"- 單次量測，**只有「在不在前段／屬於哪個梯隊」可信，梯隊內的名次不可信**。")
    if contention:
        w(f"- ⚠ 第一名速度已接近「上限 ÷ 並行數」（{ceil / s2['conc']:.0f} Mbps），可能互搶頻寬；"
          "建議以較低並行數（`--conc`）重跑細測確認。")
    if (env.get("vpn_check") or {}).get("vpn"):
        w("- ⚠ 偵測到 VPN／代理：" + "；".join(env["vpn_check"]["signals"]) + "。結果可能不代表當地網路。")
    if not env["login"]["login"]:
        w("- ⚠ 測試時**未登入**，只測到 ≤480P，與實際高畫質觀看不同。")
    if e.get("country") and e["country"].upper() != country.upper():
        w(f"- ⚠ 出口國家為 {e['country']}，與指定的 {country} 不符。")
    w("")
    w("## 測試條件\n")
    w("| 項目 | 值 |\n|---|---|")
    w(f"| 測試時間 | 環境 {env['time']}（UTC{env.get('tz', '')}）→ 細測完成 {s2['time']} |")
    w(f"| 出口 | {e.get('ip')}，{e.get('country')} {e.get('city') or ''}，{e.get('org')} |")
    dns_txt = f"系統 DNS {env.get('system_dns')}；Google 看到的解析器 {'、'.join(env.get('resolver_txt') or []) or '-'}"
    if env.get("dns_override") or DNS: dns_txt += f"；**節點改用 {env.get('dns_override') or DNS} 解析**"
    w(f"| 解析器 | {dns_txt} |")
    w(f"| RTT | " + "、".join(f"{h} {v} ms" for h, v in (env.get("rtt_ms") or {}).items()) + " |")
    n, bw = env.get("network") or {}, env.get("bandwidth") or {}
    if n:
        wf = n.get("wifi") or {}
        wtxt = (f"；{wf.get('radio') or ''} 訊號 {wf.get('signal_pct')}%，連線速率 {wf.get('rx_mbps')}/{wf.get('tx_mbps')} Mbps"
                if wf else "")
        w(f"| 網路類型 | {n.get('kind')}{wtxt}" + (f"；{n['kind_note']}" if n.get("kind_note") else "") + " |")
    vc = env.get("vpn_check") or {}
    if vc:
        w("| VPN 檢查 | " + ("⚠ " + "；".join(vc.get("signals") or []) if vc.get("vpn") else "未偵測到 VPN／代理")
          + "（ip-api、proxycheck、本機網卡、時區） |")
    if bw:
        w(f"| 總頻寬（{bw.get('source') or 'cloudflare'}） | 下載 {bw.get('down_mbps')} Mbps、上傳 {bw.get('up_mbps')} Mbps、HTTPS 請求延遲 "
          f"{bw.get('latency_ms')} ms" + (f"（{bw['err']}）" if bw.get("err") else "") + " |")
    w(f"| 登入 | {'是（高畫質）' if env['login']['login'] else '否（≤480P）'} |")
    w(f"| 頻寬上限 | ≈ {ceil} Mbps（典型單連線 ≈ {ceil_d.get('typical_per_conn')} Mbps） |")
    w(f"| 並行數 | {s2['conc']}（自動 {ceil_d.get('conc_auto')}；規則：並行總量 ≤ 上限 50%，1–8） |")
    if s1.get("keep_top") is None and s1.get("keep_ratio") is None:
        keep_txt = "全部往下測（不淘汰）"
    else:
        keep_txt = (f"保留 {len(s1['keep'])}（前 {s1.get('keep_top') or '-'} 名或 ≥ 第一名 "
                    f"{int((s1.get('keep_ratio') or 0) * 100)}%，手動指定）")
    w(f"| 快篩 | {s1['n_nodes']} 節點 × {len(vids['screen'])} 支熱門 × 2MB；三支都成功 "
      f"{summary['stage1']['passed']}，{keep_txt} |")
    if pr.get("video"):
        w(f"| 冷門探測 | {len(pr['rows'])} 節點 × 1 支低播放 × {(pr.get('bytes') or PROBE_BYTES) >> 20}MB；"
          f"回 403（只能播熱門，不進細測）{len(probe_403)} 個 |")
    else:
        w("| 冷門探測 | 未執行（沒有中低播放的探測影片） |")
    w(f"| 細測 | {len(s2['keep'])} 節點 × {len(vids['test'])} 支 × {s2['mb']}MB（每筆最多 {s2.get('cap', 30)} 秒）；"
      f"全成功 {len(rows)} 個 |")
    w(f"| 挑片種子 | {vids['seed']} |\n")
    w("### 測試影片\n")
    w("| 用途 | BV | 分層 | 播放 | 發布 | 長度 | 畫質 | 編碼 | 碼率 Mbps |\n|---|---|---|---|---|---|---|---|---|")
    for k, lab in (("screen", "快篩"), ("test", "細測"), ("probe", "冷門探測")):
        for v in vids.get(k) or []:
            br = f"{v['bandwidth'] / 1e6:.1f}" if v.get("bandwidth") else "-"
            w(f"| {lab} | {v['bvid']} | {V.cell_zh(v['cell'])} | {v['view']:,} | "
              f"{time.strftime('%Y-%m-%d', time.localtime(v['pub']))} | {v['dur'] // 60}:{v['dur'] % 60:02d} | "
              f"{V.QN.get(v['qn'], v['qn'])} | {V.CODEC.get(v['codecid'], v['codecid'])} | {br} |")
    w("")
    w("## 前 10 名（排名 + 分級）\n")
    w("分級：與最快「穩定」節點的差距在兩者波動範圍內（≈2 倍標準誤）或接近「上限 ÷ 並行數」→ 第一梯隊；"
      "≥ 50% → 可用；其餘 → 差；±sd > 平均一半 → 不穩定（命中快取極快、未命中極慢）。\n")
    w("| # | 節點 | 平均 Mbps | ±sd | TTFB ms | 命中時 Mbps | 疑似未命中 | 分級 | CDN 池 | 來源 |")
    w("|---|---|---|---|---|---|---|---|---|---|")
    for r in rows[:10]:
        w(f"| {r['rank']} | `{r['host']}` | {r['mean']:.1f} | {r['sd']:.1f} | {r['ttfb']:.0f} | {fmt(r['hit_mbps'])} | "
          f"{r['miss_n']} | {r['tier']} | {r['pool_label']} | {r['source']} |")
    if not rows: w("| - | （沒有節點全部成功） | | | | | | | | |")
    w("")
    w("## 建議前 10 名與預設節點（依 CDN 池分散）\n")
    w("規則：只列「第一梯隊」與「可用」（不穩定、差不列，不足 10 個就少列）；第一梯隊優先，其餘依平均速度；"
      "同一 CDN 池（CNAME 相同，或 bcache 同 `cn-地點-電信-叢集` 家族；解析到完全相同 IP 組合的也合併）最多 2 個。"
      "預設 = 穩定、TTFB 低的第一梯隊中最快者。\n")
    if len(rec) < 10: w(f"> 符合條件的只有 {len(rec)} 個。\n")
    w("| # | 節點 | 平均 Mbps | TTFB ms | 原名次 | 分級 | CDN 池 |\n|---|---|---|---|---|---|---|")
    for i, r in enumerate(rec, 1):
        mark = " ★預設" if default and r["host"] == default["host"] else ""
        w(f"| {i} | `{r['host']}`{mark} | {r['mean']:.1f} | {r['ttfb']:.0f} | #{r['rank']} | {r['tier']} | {r['pool_label']} |")
    w("")
    w(f"## 只能播熱門影片的節點（{len(hot_only)} 個）\n")
    w(f"快篩（熱門片）成功，但一般／冷門片回 403：冷門探測擋下 {len(probe_403)} 個（不進細測），"
      f"細測才發現 {len(set(hot_only) - probe_403)} 個。只用熱門片測速會誤判這些節點。\n")
    w(("、".join(f"`{short(h)}`" for h in hot_only) or "（無）") + "\n")
    w(f"## 不穩定節點（{len(unstable)} 個）\n")
    if unstable:
        w("| 節點 | 平均 | 最低 | 最高 | ±sd | CDN 池 |\n|---|---|---|---|---|---|")
        for r in unstable:
            w(f"| `{r['host']}` | {r['mean']:.1f} | {r['min']:.1f} | {r['max']:.1f} | {r['sd']:.1f} | {r['pool_label']} |")
    else:
        w("（無）")
    w("")
    w("## 擴充內建節點現況（節點清單中 source 含 project 者）\n")
    if proj:
        w("| 節點 | 代號 | 結果 | CDN 池 |\n|---|---|---|---|")
        for p in proj:
            w(f"| `{p['host']}` | {p['name'] or '-'} | {p['status']} | {p['pool']} |")
    else:
        w("（節點清單中沒有擴充內建節點）")
    w("")
    nf = Counter(e for r in s1["rows"] for e in r["errs"])
    w("## 其他\n")
    w(f"- 快篩失敗原因：" + ("、".join(f"{k} ×{v}" for k, v in nf.most_common(6)) or "無"))
    pf = Counter(r["err"] or "成功" for r in pr.get("rows") or [] if r["err"] != "HTTP 403")
    if pf: w("- 冷門探測（403 以外）：" + "、".join(f"{k} ×{v}" for k, v in pf.most_common(6)) + "；這些節點照常進細測")
    w(f"- 細測有失敗（不列入排名）：{len(failed)} 個")
    w("- 快取標頭多數看不出命中與否且不可靠；「疑似未命中」= 標頭 MISS 或 TTFB > 該節點中位數 2 倍。")
    w("- 完整資料：`summary.json`（可跨國比較；`stage1.nodes` 是每個節點的快篩與冷門探測結果，"
      "`stage1.raw`／`stage2.raw` 是快篩與細測每個節點 × 每支影片的逐筆結果，細測沒進排名的節點也有）、"
      "`stage1.jsonl`／`probe.jsonl`／`stage2.jsonl`（逐筆）。")
    open(path("REPORT.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")

    print(f"{country}：上限 {ceil} Mbps，並行 {s2['conc']}，完整成功 {len(rows)} 個；只能播熱門 {len(hot_only)} 個")
    for r in rows[:10]:
        print(f"{r['rank']:2} {r['host']:45} {r['mean']:7.2f} ±{r['sd']:5.1f} ttfb {r['ttfb']:5.0f} {r['tier']}  {r['pool_label']}")
    print("建議（池分散）：", [short(r["host"]) for r in rec])
    print("預設：", default and default["host"])
    print("報告：", path("REPORT.md"))


def cmd_all(country, args):
    gate(country, args)
    if not (has("pool.json") and json.load(open(path("pool.json"), encoding="utf-8")).get("complete")):
        check_budget("pool", 60); print("== 影片池 =="); cmd_pool(country, args)
    if not has("videos.json"):
        check_budget("pick", 120); print("== 挑片 =="); cmd_pick(country, args)
    if not has("ceiling.json"):
        check_budget("ceiling", 330); print("== 頻寬上限 =="); cmd_ceiling(country, args)
    if not has("stage1.json"):
        check_budget("stage1", 90); print("== 快篩 =="); cmd_stage1(country, args)
    if not has("probe.json"):
        check_budget("probe", 60); print("== 冷門探測 =="); cmd_probe(country, args)
    if not has("stage2.json"):
        check_budget("stage2", 90); print("== 細測 =="); cmd_stage2(country, args)
    print("== 報告 =="); cmd_report(country, args)


def _ipinfo(ip=""):
    try:
        return json.load(urllib.request.urlopen(f"https://ipinfo.io/{ip + '/' if ip else ''}json", timeout=10))
    except Exception as e:
        return dict(err=str(e)[:80])


def dns_check():
    """偵測出口國家，並檢查 DNS 解析器是否在當地。
    踩過的坑：開 VPN 後系統 DNS 變成 Cloudflare 等公共解析器、且不帶 ECS，
    GeoDNS 節點（阿里、Akamai…）會被分到「解析器所在地」的機器，而不是使用者所在地的機器，測速結果失真。
    做法：查 o-o.myaddr.l.google.com 的 TXT，得到「替我們向 Google 權威 DNS 查詢的解析器出口 IP」與 ECS 子網，
    再查它們的國家，與出口國家比對。"""
    ex = _ipinfo()
    txt = re.findall(r'"([^"]+)"', _nslookup_raw(["-type=TXT", "o-o.myaddr.l.google.com."]))
    ecs = next((t.split()[-1] for t in txt if t.startswith("edns0-client-subnet")), None)
    resolvers = [t for t in txt if not t.startswith("edns0-client-subnet")]
    res_info = [dict(ip=r, **{k: _ipinfo(r).get(k) for k in ("country", "org")}) for r in resolvers[:2]]
    ecs_country = _ipinfo(ecs.split("/")[0]).get("country") if ecs else None
    c = (ex.get("country") or "").upper()
    res_countries = {(r.get("country") or "").upper() for r in res_info if r.get("country")}
    if ecs and ecs_country and ecs_country.upper() == c:
        verdict, ok = f"解析器帶 ECS（{ecs}，{ecs_country}），GeoDNS 會依你的所在地分配節點", True
    elif c and res_countries and res_countries <= {c}:
        verdict, ok = f"解析器在 {c}（與出口同國），GeoDNS 結果可代表當地", True
    else:
        verdict, ok = (f"解析器在 {'/'.join(sorted(res_countries)) or '未知'}、"
                       f"{'不帶 ECS' if not ecs else f'ECS={ecs}（{ecs_country}）'}，與出口 {c or '未知'} 不一致："
                       "GeoDNS 節點可能被分到錯的機器。建議改用當地 ISP 的 DNS（--dns <IP>）"), False
    return dict(exit=dict(ip=ex.get("ip"), country=ex.get("country"), org=ex.get("org"), city=ex.get("city"),
                          err=ex.get("err")),
                system_dns=system_dns_server(), resolvers=res_info, ecs=ecs, ecs_country=ecs_country,
                dns_ok=ok, dns_verdict=verdict)


def cmd_detect(args):
    """開始前偵測網路環境，給 Claude 拿去問使用者確認（不建立輸出目錄）"""
    d = dns_check()
    e = d["exit"]
    login = login_status()
    print(f"出口：{e.get('ip')}  國家 {e.get('country')}  {e.get('city') or ''}  {e.get('org')}")
    print(f"系統 DNS：{d['system_dns']}；替你查詢的解析器：" +
          ", ".join(f"{r['ip']}（{r.get('country')} {r.get('org') or ''}）" for r in d["resolvers"]) +
          (f"；ECS {d['ecs']}（{d['ecs_country']}）" if d["ecs"] else "；不帶 ECS"))
    print(("DNS 檢查：OK，" if d["dns_ok"] else "⚠ DNS 檢查：") + d["dns_verdict"])
    org = (e.get("org") or "").lower()
    if any(k in org for k in ("vpn", "hosting", "datacamp", "m247", "cloud", "digitalocean", "linode", "ovh")):
        print("⚠ 出口看起來是機房／VPN 網路，不代表當地家用使用者")
    print(f"登入：{'是' if login['login'] else '否（只能測 ≤480P）'}（cookie 來源：{login['cookie_src']}）")
    print(f"DETECTED_COUNTRY={(e.get('country') or '').upper()}")
    return d


CMDS = dict(all=cmd_all, env=cmd_env, pool=cmd_pool, pick=cmd_pick, ceiling=cmd_ceiling,
            stage1=cmd_stage1, probe=cmd_probe, stage2=cmd_stage2, report=cmd_report)


def main():
    global OUT, STATE, DEADLINE, DNS
    for s in (sys.stdout, sys.stderr):
        try: s.reconfigure(encoding="utf-8", errors="replace")  # Windows 管線輸出預設 cp950，印 ⚠ 會出錯
        except Exception: pass
    ap =argparse.ArgumentParser(description="Bilibili 點播 CDN 節點測速（單一國家）")
    ap.add_argument("cmd", choices=["detect"] + list(CMDS))
    ap.add_argument("country", nargs="?",
                    help="國家代碼，例如 JP、TW、SG；省略時依出口 IP 自動偵測（先用 detect 讓使用者確認）")
    ap.add_argument("--out", help="輸出目錄（預設 <cwd>/cdn-speedtest-results/<國家>-<時間>/，12 小時內未完成的會續用）")
    ap.add_argument("--new", action="store_true", help="強制開新的輸出目錄")
    ap.add_argument("--budget", type=float, help="本次最多執行秒數（同環境變數 BUDGET）")
    ap.add_argument("--conc", type=int, help="並行數（預設依頻寬上限自動決定）")
    ap.add_argument("--seed", type=int, help="挑片種子（預設為當下時間 YYYYMMDDHHMM）")
    ap.add_argument("--mb", type=int, help="細測每筆下載 MB（預設 4）")
    ap.add_argument("--timeout", type=int, help="每筆連線逾時秒數（預設 10）")
    ap.add_argument("--keep-top", type=int, help="快篩只保留前 N 名（預設不淘汰，通過的全部往下測）")
    ap.add_argument("--keep-ratio", type=float, help="快篩只保留 ≥ 第一名此比例的節點（預設不淘汰）")
    ap.add_argument("--isp-dns", help="當地 ISP 的 DNS（env 會比較系統 DNS 與它的解析結果）")
    ap.add_argument("--dns", help="節點網域改用此 DNS 解析（同環境變數 DNS；當地網路通常不需要）；"
                                  "doh = Google DNS-over-HTTPS 帶自己出口 IP 的 ECS")
    ap.add_argument("--allow-guest", action="store_true", default=None, help="未登入也繼續（只能 ≤480P）")
    ap.add_argument("--ignore-country-mismatch", action="store_true", default=None, help="出口國家不符也繼續")
    ap.add_argument("--ignore-dns-mismatch", action="store_true", default=None,
                    help="DNS 解析器與所在地不一致也繼續（例如確認當地本來就用公共 DNS）")
    ap.add_argument("--limit-nodes", type=int, help="（測試用）只測前 N 個節點")
    ap.add_argument("--limit-videos", type=int, help="（測試用）細測只挑 N 支影片")
    ap.add_argument("--quick", action="store_true", default=None,
                    help="（測試用）影片池只做少量搜尋、頻寬上限只用小檔案與 4 連線")
    args = ap.parse_args()
    if args.cmd == "detect":
        cmd_detect(args); sys.exit(0)
    country = (args.country or _ipinfo().get("country") or "").upper()
    if not country:
        print("ERROR: 無法偵測國家，請指定國家代碼"); sys.exit(2)
    if not args.country:
        print(f"未指定國家，依出口 IP 自動偵測為 {country}")
    OUT = resolve_out(country, args.out, args.new, args.cmd)
    os.makedirs(OUT, exist_ok=True)
    sp = os.path.join(OUT, "state.json")
    STATE = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else dict(country=country)
    if STATE.get("country", country) != country:
        print(f"輸出目錄 {OUT} 屬於 {STATE['country']}，與 {country} 不符"); sys.exit(2)
    if args.dns: DNS = args.dns
    DNS = DNS or STATE.get("dns")
    if DNS: STATE["dns"] = DNS
    if DNS == "doh": set_doh_ecs(_ipinfo().get("ip"))
    budget = args.budget if args.budget is not None else float(os.environ.get("BUDGET", "0") or 0)
    DEADLINE = time.time() + budget if budget > 0 else None
    print(f"輸出目錄：{OUT}", flush=True)
    code = 0
    try:
        CMDS[args.cmd](country, args)
    except Partial as e:
        print("PARTIAL:", e); code = 3
    except Stop as e:
        print(("STOP: " if e.code != 2 else "ERROR: ") + str(e)); code = e.code
    finally:
        json.dump(STATE, open(sp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    sys.exit(code)


if __name__ == "__main__":
    main()
