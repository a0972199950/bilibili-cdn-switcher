#!/usr/bin/env python3
# ⚠️ 研究/測試用腳本，不是擴充的一部分，隨時可刪。用來回答：
#   PiliNara 節點清單裡「能播直播 fmp4」的節點，持續播放會不會比官方 ov 節點更順？
#   階段 1（篩選）：清單每個 host 拉最新 2 個 fmp4 分片，量首包時間與吞吐，留最快 TOP 個
#   階段 2（持續）：TOP 節點 + 官方 ov / ov-b，並行模擬 HLS 播放器 N 秒
#     播放器模型：先緩衝 3 片才起播（同 hls.js liveSyncDurationCount=3），
#     緩衝見底 = 卡頓一次，重新累積 1 片才續播；統計卡頓次數 / 總卡頓秒數
#
# 用法：python3 research/live-streaming-support/live-pilinara-nodes.py [直播間號|auto] [秒數=90] [TOP=8] [cdn_nodes.json]
#   頻寬有限（如走 VPN）時加 SEQ=1 改為逐一測，避免並行互搶頻寬：
#   SEQ=1 python3 research/live-streaming-support/live-pilinara-nodes.py 25828093 60 4
# 需要 .env.local 裡的 BILI_COOKIE。
import json, re, sys, time, threading, os, urllib.request, urllib.error, urllib.parse
from concurrent.futures import ThreadPoolExecutor

ROOM = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] != "auto" else None
SECS = int(sys.argv[2]) if len(sys.argv) > 2 else 90
TOP = int(sys.argv[3]) if len(sys.argv) > 3 else 8
NODES_PATH = sys.argv[4] if len(sys.argv) > 4 else os.path.join(
    os.path.dirname(__file__), "../../../PiliNara/assets/cdn_nodes.json")
cookie = ""
for line in open(".env.local", encoding="utf-8"):
    if line.startswith("BILI_COOKIE="):
        cookie = line.strip()[len("BILI_COOKIE="):]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36"
REF = "https://live.bilibili.com/"

def req(url, ck=False):
    h = {"User-Agent": UA, "Referer": REF}
    if ck: h["Cookie"] = cookie
    return urllib.request.Request(url, headers=h)

def api(url):
    return json.load(urllib.request.urlopen(req(url, True), timeout=15))

def swap(url, host):
    return re.sub(r"^https?://[^/]+", "https://" + host, url)

def fmp4_info(room):
    d = api("https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo"
            f"?room_id={room}&protocol=1&format=2&codec=0&qn=10000&platform=web")["data"]
    if d.get("live_status") != 1 or not d.get("playurl_info"): return None
    for s in d["playurl_info"]["playurl"]["stream"]:
        for f in s["format"]:
            if f["format_name"] == "fmp4":
                c = f["codec"][0]
                return [u["host"] + c["base_url"] + u["extra"] for u in c["url_info"]], c["current_qn"]
    return None

if ROOM is None:
    for r in api("https://api.live.bilibili.com/room/v1/room/get_user_recommend?page=1&page_size=30")["data"]:
        info = fmp4_info(r["roomid"])
        if info: ROOM = r["roomid"]; break
else:
    info = fmp4_info(ROOM)
urls, qn = info
official = [urllib.parse.urlparse(u).hostname for u in urls]
print(f"直播間 {ROOM}  qn={qn}  官方 fmp4 host = {official}")

def segs(m3u8_url, text):
    out, dur = [], None
    for line in text.splitlines():
        if line.startswith("#EXTINF:"): dur = float(line[8:].split(",")[0])
        elif line and not line.startswith("#"): out.append((urllib.parse.urljoin(m3u8_url, line), dur or 1.0, line))
    return out

# ── 階段 1：篩選 ───────────────────────────────────────────
def screen(host):
    u = swap(urls[0], host)
    try:
        t0 = time.time()
        txt = urllib.request.urlopen(req(u), timeout=6).read().decode()
        m3u8_ms = (time.time() - t0) * 1000
        ss = segs(u, txt)[-2:]
        nb, dt = 0, 0.0
        for su, _, _ in ss:
            t1 = time.time(); nb += len(urllib.request.urlopen(req(su), timeout=8).read()); dt += time.time() - t1
        return host, m3u8_ms, nb * 8 / dt / 1e6 if dt else 0
    except Exception:
        return host, None, None

nodes = json.load(open(NODES_PATH, encoding="utf-8"))
hosts = list(dict.fromkeys(official + [h for hs in nodes.values() for h in hs]))
print(f"\n== 階段 1：篩選 {len(hosts)} 個 host ==")
with ThreadPoolExecutor(24) as ex:
    sc = [r for r in ex.map(screen, hosts) if r[1] is not None]
sc.sort(key=lambda r: -r[2])
print(f"可播 fmp4：{len(sc)} 個。前 15 名（吞吐）：")
for h, ms, mbps in sc[:15]:
    print(f"   {h:42} m3u8 {ms:6.0f}ms  分片 {mbps:6.1f} Mbps{'  ← 官方' if h in official else ''}")
for h, ms, mbps in sc:
    if h in official and (h, ms, mbps) not in sc[:15]:
        print(f"   {h:42} m3u8 {ms:6.0f}ms  分片 {mbps:6.1f} Mbps  ← 官方（名次 {sc.index((h, ms, mbps)) + 1}）")

# ── 階段 2：持續播放 ───────────────────────────────────────
START_SEGS = 3

def play(host, res):
    base = swap(urls[0], host)
    seen = set(); nbytes = 0; dl = 0.0; ttff = None; errs = 0; first_round = True
    t_start = time.time()
    play_at = None   # 這段連續播放的起點（牆上時間）
    media = 0.0      # 起播後（含起播前緩衝）收到的節目秒數
    pre = 0          # 起播前已收片數
    stalls = 0; stall_secs = 0.0
    while time.time() - t_start < SECS:
        try:
            txt = urllib.request.urlopen(req(base), timeout=8).read().decode()
        except Exception:
            errs += 1; time.sleep(1); continue
        ss = segs(base, txt)
        if first_round:  # 只從最新 START_SEGS 片開始，像播放器跳到直播邊緣
            for _, _, key in ss[:-START_SEGS]: seen.add(key)
            first_round = False
        for su, dur, key in ss:
            if key in seen: continue
            seen.add(key)
            t1 = time.time()
            try: b = urllib.request.urlopen(req(su), timeout=10).read()
            except Exception: errs += 1; continue
            now = time.time(); dl += now - t1; nbytes += len(b)
            if play_at is None:
                pre += 1; media += dur
                if pre >= START_SEGS: play_at = now; ttff = now - t_start
                continue
            buf = media - (now - play_at)  # 這片到達前還剩多少緩衝
            if buf < 0:                    # 已見底：卡了 -buf 秒，從這片重新起播
                stalls += 1; stall_secs += -buf; play_at = now; media = dur
            else:
                media += dur
        time.sleep(0.5)
    wall = time.time() - t_start
    res[host] = dict(mbps=nbytes * 8 / dl / 1e6 if dl else 0, stalls=stalls, stall_secs=stall_secs,
                     ttff=ttff, errs=errs, wall=wall)

def row(label, r, mark=""):
    tf = f"{r['ttff']:.1f}s" if r["ttff"] else "-"
    print(f"{label:42} {r['mbps']:6.1f}Mbps {tf:>6} {r['stalls']:4} {r['stall_secs']:6.1f} {r['errs']:4}{mark}", flush=True)

HEAD = f"{'節點':42} {'分片吞吐':>9} {'起播':>6} {'卡頓':>4} {'卡頓秒':>6} {'錯誤':>4}"
if os.environ.get("SEQ"):
    # 逐一模式：頻寬有限（如 VPN）時並行會互搶，改成一次只播一個，
    # 每個候選前後都穿插官方 ov，讓兩者處在相近時段
    others = [h for h, _, _ in sc[:TOP] if h not in official]
    print(f"\n== 階段 2（逐一）：每個 {SECS}s，官方 {official[0]} 與 {len(others)} 個候選交替 ==")
    print(HEAD)
    res = {}; play(official[0], res); row(official[0], res[official[0]], "  ← 官方")
    for h in others:
        res = {}; play(h, res); row(h, res[h])
        res = {}; play(official[0], res); row(official[0], res[official[0]], "  ← 官方")
else:
    cands = list(dict.fromkeys(official + [h for h, _, _ in sc[:TOP]]))
    print(f"\n== 階段 2：並行持續播放 {SECS}s：{len(cands)} 個節點 ==")
    res = {}
    ths = [threading.Thread(target=play, args=(h, res)) for h in cands]
    [t.start() for t in ths]; [t.join() for t in ths]
    print(HEAD)
    for h in sorted(cands, key=lambda h: (res[h]["stall_secs"], -res[h]["mbps"])):
        row(h, res[h], "  ← 官方" if h in official else "")
