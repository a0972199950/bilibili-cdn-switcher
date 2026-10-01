#!/usr/bin/env python3
# ⚠️ 研究/測試用腳本，不是擴充的一部分，隨時可刪。用來回答：
#   擴充 src/cdn-list.json 裡「點播順」的節點（08c 等），拿來播直播能不能用？一樣順嗎？
#   1) 點播基準：每個節點拉 av170001 的 DASH 分段 8MB，量吞吐
#   2) 直播可用性：同一直播間的 flv / ts / fmp4 換成該節點，看 HTTP 狀態
#   3) 直播持續播放：fmp4 可用的節點 + 官方 ov / 同號 cn，並行模擬 HLS 播放 N 秒，
#      算分片吞吐、即時比（收到節目秒/牆上秒）、緩衝見底次數
#
# 用法：python3 research/live-streaming-support/live-vod-nodes.py [直播間號=自動挑有 fmp4 的] [秒數=60]
# 需要 .env.local 裡的 BILI_COOKIE。
import json, re, sys, time, threading, urllib.request, urllib.error, urllib.parse, os

ROOM = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] != "auto" else None
SECS = int(sys.argv[2]) if len(sys.argv) > 2 else 60
cookie = ""
for line in open(".env.local", encoding="utf-8"):
    if line.startswith("BILI_COOKIE="):
        cookie = line.strip()[len("BILI_COOKIE="):]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36"
NODES = [o["value"] for o in json.load(open(os.path.join(os.path.dirname(__file__), "../../src/cdn-list.json"),
                                            encoding="utf-8"))["options"] if "." in o["value"]]

def req(url, ref, extra=None, cookie_on=False):
    h = {"User-Agent": UA, "Referer": ref, **(extra or {})}
    if cookie_on: h["Cookie"] = cookie
    return urllib.request.Request(url, headers=h)

def api(url, ref):
    return json.load(urllib.request.urlopen(req(url, ref, cookie_on=True), timeout=15))

def swap(url, host):
    return re.sub(r"^https?://[^/]+", "https://" + host, url)

def status(url, ref):
    try:
        r = urllib.request.urlopen(req(url, ref), timeout=8); r.read(16); return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception as e: return type(e).__name__

# ── 1) 點播基準 ─────────────────────────────────────────────
v = api("https://api.bilibili.com/x/web-interface/view?aid=170001", "https://www.bilibili.com/")["data"]
p = api(f"https://api.bilibili.com/x/player/playurl?avid=170001&cid={v['cid']}&fnval=16&qn=80",
        "https://www.bilibili.com/")["data"]
vod_url = p["dash"]["video"][0]["baseUrl"]

def vod_speed(host):
    try:
        t0 = time.time()
        r = urllib.request.urlopen(req(swap(vod_url, host), "https://www.bilibili.com/",
                                       {"Range": "bytes=0-8388607"}), timeout=20)
        b = r.read(); dt = time.time() - t0
        return f"{len(b) * 8 / dt / 1e6:5.1f} Mbps"
    except urllib.error.HTTPError as e: return f"HTTP {e.code}"
    except Exception as e: return type(e).__name__

# ── 2) 直播可用性 ──────────────────────────────────────────
def live_variants(room):
    d = api("https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo"
            f"?room_id={room}&protocol=0,1&format=0,1,2&codec=0&qn=10000&platform=web",
            "https://live.bilibili.com/")["data"]
    if d.get("live_status") != 1 or not d.get("playurl_info"): return None
    out = {}
    for s in d["playurl_info"]["playurl"]["stream"]:
        for f in s["format"]:
            c = f["codec"][0]; ui = c["url_info"][0]
            out[f["format_name"]] = ui["host"] + c["base_url"] + ui["extra"]
    return out

if ROOM is None:
    rec = api("https://api.live.bilibili.com/room/v1/room/get_user_recommend?page=1&page_size=30",
              "https://live.bilibili.com/")["data"]
    for r in rec:
        lv = live_variants(r["roomid"])
        if lv and "fmp4" in lv: ROOM, LV = r["roomid"], lv; break
else:
    LV = live_variants(ROOM)
fmp4 = LV["fmp4"]
orig_host = urllib.parse.urlparse(fmp4).hostname
n = re.search(r"gotcha(\d+)", orig_host).group(1)
print(f"直播間 {ROOM}；fmp4 官方 host = {orig_host}\n")

print(f"{'節點':42} {'點播 8MB':>10} | {'flv':>6} {'ts':>6} {'fmp4':>6}")
fmp4_ok = []
for h in NODES:
    row = [status(swap(LV[k], h), "https://live.bilibili.com/") if k in LV else "-" for k in ("flv", "ts", "fmp4")]
    print(f"{h:42} {vod_speed(h):>10} | {row[0]!s:>6} {row[1]!s:>6} {row[2]!s:>6}")
    if row[2] == 200: fmp4_ok.append(h)

# ── 3) 直播持續播放（並行模擬 HLS 播放器）─────────────────────
def play(host, res):
    base = swap(fmp4, host)
    seen, durs, got_media, nbytes, dl_time = set(), {}, 0.0, 0, 0.0
    start = time.time(); first = None; underruns = 0; low = None; errs = 0
    while time.time() - start < SECS:
        try:
            txt = urllib.request.urlopen(req(base, "https://live.bilibili.com/"), timeout=8).read().decode()
        except Exception:
            errs += 1; time.sleep(1); continue
        dur = None
        for line in txt.splitlines():
            if line.startswith("#EXTINF:"): dur = float(line[8:].split(",")[0])
            elif line and not line.startswith("#"):
                if line in seen: continue
                seen.add(line)
                if first is None and len(seen) < 3: continue  # 只從最新幾片開始，像播放器一樣
                t0 = time.time()
                try:
                    b = urllib.request.urlopen(req(urllib.parse.urljoin(base, line), "https://live.bilibili.com/"),
                                               timeout=10).read()
                except Exception:
                    errs += 1; continue
                dl_time += time.time() - t0; nbytes += len(b); got_media += dur or 1.0
                if first is None: first = time.time()
                buf = got_media - (time.time() - first)   # 播放器緩衝量（秒）
                low = buf if low is None else min(low, buf)
                if buf < 0: underruns += 1; first = time.time() - got_media  # 見底後從當下重新開始播
        time.sleep(0.5)
    wall = time.time() - (first or start)
    res[host] = dict(mbps=nbytes * 8 / dl_time / 1e6 if dl_time else 0, rate=nbytes * 8 / wall / 1e6 if wall else 0,
                     ratio=got_media / wall if wall else 0, under=underruns, low=low, errs=errs)

cands = [orig_host, f"d1--cn-gotcha{n}.bilivideo.com"] + [h for h in fmp4_ok if h not in (orig_host,)]
cands = list(dict.fromkeys(cands))
print(f"\n== 直播 fmp4 持續播放 {SECS}s（並行）：{len(cands)} 個節點 ==")
res = {}
ths = [threading.Thread(target=play, args=(h, res)) for h in cands]
[t.start() for t in ths]; [t.join() for t in ths]
print(f"{'節點':42} {'分片吞吐':>9} {'即時比':>6} {'見底':>4} {'最低緩衝':>8} {'錯誤':>4}")
for h in cands:
    r = res.get(h)
    if not r: continue
    low = f"{r['low']:.1f}s" if r["low"] is not None else "-"
    print(f"{h:42} {r['mbps']:6.1f}Mbps {r['ratio']:6.2f} {r['under']:4} {low:>8} {r['errs']:4}")
print("\n即時比 ≈1 = 跟得上直播；見底 = 模擬播放器緩衝耗盡（會卡）次數。分片吞吐 = 下載當下的速度。")
