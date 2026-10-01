#!/usr/bin/env python3
# ⚠️ 研究/測試用腳本，不是擴充的一部分，隨時可刪。用來回答：
#   PiliNara 允許把直播 host 換成「任意節點」（含點播 cn-xxx / upos / 外建 gotcha），
#   這跟我們「token 只認同集群號的 cn/ov/b」的結論衝突嗎？
#   做法：照 PiliNara 的 getRoomPlayInfo 參數（protocol=0,1 / format=0,1,2 / codec=0,1）
#   拿到每一種串流變體（flv / ts-hls / fmp4-hls × avc/hevc），把 host 換成 PiliNara
#   內建節點清單裡的每一個 host，看能不能真的拿到媒體資料。
#
# 用法：python3 research/live-streaming-support/live-any-node-probe.py [房間數=2] [cdn_nodes.json 路徑]
# 需要 .env.local 裡的 BILI_COOKIE。
import json, re, sys, os, urllib.request, urllib.error, urllib.parse, collections
from concurrent.futures import ThreadPoolExecutor

N_ROOMS = int(sys.argv[1]) if len(sys.argv) > 1 else 2
NODES_PATH = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    os.path.dirname(__file__), "../../../PiliNara/assets/cdn_nodes.json")

cookie = ""
for line in open(".env.local", encoding="utf-8"):
    if line.startswith("BILI_COOKIE="):
        cookie = line.strip()[len("BILI_COOKIE="):]
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
HDR = {"User-Agent": UA, "Referer": "https://live.bilibili.com/"}

def api(url):
    req = urllib.request.Request(url, headers={**HDR, "Cookie": cookie})
    return json.load(urllib.request.urlopen(req, timeout=15))

def variants(room):
    """回傳 [(名稱, base_url, extra, 原始 hosts)]，照 PiliNara 的請求參數"""
    d = api("https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo"
            f"?room_id={room}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web")
    out = []
    for s in d["data"]["playurl_info"]["playurl"]["stream"]:
        for f in s["format"]:
            for c in f["codec"]:
                name = f"{s['protocol_name']}/{f['format_name']}/{c['codec_name']}"
                infos = c["url_info"]
                out.append((name, c["base_url"], infos[0]["extra"], [u["host"] for u in infos]))
    return out

def fetch_head(url, n=2048):
    req = urllib.request.Request(url, headers=HDR)
    try:
        r = urllib.request.urlopen(req, timeout=6)
        return r.status, r.read(n), urllib.parse.urlparse(r.geturl()).hostname
    except urllib.error.HTTPError as e:
        return e.code, b"", None
    except Exception as e:
        return type(e).__name__, b"", None

def probe(url):
    """回傳 (結果, 細節)；結果 ∈ OK / 狀態碼 / 例外名"""
    st, body, final = fetch_head(url)
    if st != 200:
        return str(st), ""
    if body[:3] == b"FLV":
        return "OK", f"FLV final={final}"
    if body.startswith(b"#EXTM3U"):
        # m3u8 拿到不代表能播，再抓第一個分片 / init 段
        text = body.decode("utf-8", "replace")
        m = re.search(r'#EXT-X-MAP:URI="([^"]+)"', text)
        seg = m.group(1) if m else next(
            (l for l in text.splitlines() if l and not l.startswith("#")), None)
        if not seg:
            return "m3u8-empty", ""
        seg_url = urllib.parse.urljoin(url, seg)
        st2, body2, _ = fetch_head(seg_url, 512)
        if st2 == 200 and body2:
            return "OK", f"m3u8+seg final={final}"
        return f"m3u8-ok/seg-{st2}", ""
    return "200-not-media", repr(body[:20])

nodes = json.load(open(NODES_PATH, encoding="utf-8"))
host_region = {h: r for r, hs in nodes.items() for h in hs}

rec = api("https://api.live.bilibili.com/room/v1/room/get_user_recommend?page=1&page_size=15")["data"]
rooms = [r["roomid"] for r in rec if r.get("roomid")][:N_ROOMS]
print(f"測試房間: {rooms}；節點清單 {len(host_region)} 個 host / {len(nodes)} 區\n")

grand = collections.Counter()
for room in rooms:
    for name, base, extra, orig_hosts in variants(room):
        print(f"== room {room}  {name} ==")
        print(f"   API 給的 host: {', '.join(h.replace('https://', '') for h in orig_hosts)}")
        # 先測原始 host 當基準，再測所有清單 host
        tests = [(h.replace("https://", ""), "API原始") for h in orig_hosts]
        tests += [(h, host_region[h]) for h in host_region]
        with ThreadPoolExecutor(32) as ex:
            results = list(ex.map(lambda t: (t, probe(f"https://{t[0]}{base}{extra}")), tests))
        by_region = collections.defaultdict(collections.Counter)
        ok_hosts = []
        for (host, region), (res, detail) in results:
            by_region[region][res] += 1
            if res == "OK" and region != "API原始":
                ok_hosts.append((region, host, detail))
                grand[region] += 1
        for region, cnt in sorted(by_region.items(), key=lambda kv: -kv[1]["OK"]):
            print(f"   {region:6} {dict(cnt)}")
        print(f"   → 清單中可用: {len(ok_hosts)} 個")
        for region, host, detail in ok_hosts:
            print(f"      ✅ [{region}] {host}  {detail}")
        print()

print("== 各區「可用次數」總計（跨房間/變體）==")
for region, n in grand.most_common():
    print(f"   {region}: {n}")
