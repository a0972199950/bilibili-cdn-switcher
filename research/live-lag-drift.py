#!/usr/bin/env python3
# ⚠️ 研究/測試用腳本，不是擴充的一部分，隨時可刪。用來回答：
#   「國內(cn) 到底幫不幫得上 SG 的直播？」——用回源慢的直接證據：媒體時間 vs 牆上時間的落後(drift)。
#
# 原理：FLV 每個 tag 帶一個媒體時間戳(ms)。持續拉流時：
#   media_elapsed = 最新tag時間戳 - 第一個tag時間戳   （收到多少「秒」的節目內容）
#   wall_elapsed  = 真實經過的秒數
#   drift = wall - media。節點回源/傳輸跟得上 → drift 幾乎不長；跟不上 → drift 持續變大＝掉隊、會緩衝。
#   ratio = media/wall，1.0=完美即時，<1.0=落後。
# 公平性：把同一集群的 ov(海外) 與 cn(國內) 用「同一 token、同一時間窗」並行拉，才不受時段網路波動影響。
#
# 用法：python3 research/live-lag-drift.py [秒數，預設120]
import json, urllib.request, subprocess, socket, time, re, sys, threading

cookie = subprocess.run(
    ["bash", "-c", "grep -o '^BILI_COOKIE=.*' .env.local | sed 's/^BILI_COOKIE=//'"],
    capture_output=True, text=True).stdout.strip()
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
DURATION = int(sys.argv[1]) if len(sys.argv) > 1 else 120

def api(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cookie": cookie,
                                               "Referer": "https://live.bilibili.com/"})
    return json.load(urllib.request.urlopen(req, timeout=15))

room = 545068
d = api(f"https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo"
        f"?room_id={room}&protocol=0&format=0&codec=0&qn=10000&platform=web")
cd = d["data"]["playurl_info"]["playurl"]["stream"][0]["format"][0]["codec"][0]
base, extra, assigned = cd["base_url"], cd["url_info"][0]["extra"], cd["url_info"][0]["host"]
fam = re.search(r'(?:ov|cn)-gotcha(\d+)', assigned).group(1)
exp = re.search(r'expires=(\d+)', extra)
print(f"房間 {room}  集群號 gotcha{fam}  測試時長 {DURATION}s")
if exp:
    left = int(exp.group(1)) - time.time()
    print(f"token 剩餘有效 ~{left:.0f}s" + ("  ⚠️不足測試時長，結果可能被截斷" if left < DURATION + 20 else ""))

# 候選：同集群的 ov / ovb / cn / cnb，先篩掉 DNS 不存在或非 200 的
def alive(host):
    try:
        socket.getaddrinfo(host.split("//")[1], 443)
    except Exception:
        return False
    try:
        req = urllib.request.Request(f"{host}{base}{extra}",
                                     headers={"User-Agent": UA, "Referer": "https://live.bilibili.com/"})
        r = urllib.request.urlopen(req, timeout=8)
        return r.read(3) == b"FLV"
    except Exception:
        return False

cand = [f"https://d1--ov-gotcha{fam}.bilivideo.com",
        f"https://d1--ov-gotcha{fam}b.bilivideo.com",
        f"https://d1--cn-gotcha{fam}.bilivideo.com",
        f"https://d1--cn-gotcha{fam}b.bilivideo.com"]
targets = [h for h in cand if alive(h)]
print("並行測試節點:", *[t.split('//')[1] for t in targets], "\n")

def read_exact(r, n, buf):
    while len(buf) < n:
        chunk = r.read(65536)
        if not chunk:
            return False
        buf += chunk
    return True

def stream_node(host, result):
    label = host.split("//")[1]
    req = urllib.request.Request(f"{host}{base}{extra}",
                                 headers={"User-Agent": UA, "Referer": "https://live.bilibili.com/"})
    timeline = []   # (wall_elapsed, media_elapsed_sec)
    total_bytes = 0
    try:
        r = urllib.request.urlopen(req, timeout=12)
        buf = bytearray()
        # FLV header(9) + PreviousTagSize0(4)
        if not read_exact(r, 9, buf):
            result[label] = {"err": "no header"}; return
        data_offset = int.from_bytes(buf[5:9], "big")
        need = data_offset + 4
        if not read_exact(r, need, buf):
            result[label] = {"err": "short"}; return
        del buf[:need]
        t0 = time.time()
        first_ts = None
        last_ts = 0
        while time.time() - t0 < DURATION:
            if not read_exact(r, 11, buf):
                break
            datasize = int.from_bytes(buf[1:4], "big")
            ts = int.from_bytes(buf[4:7], "big") | (buf[7] << 24)
            if not read_exact(r, 11 + datasize + 4, buf):
                break
            total_bytes += 11 + datasize + 4
            del buf[:11 + datasize + 4]
            if first_ts is None:
                first_ts = ts
            last_ts = ts
            wall = time.time() - t0
            media = (last_ts - first_ts) / 1000.0
            timeline.append((wall, media))
        result[label] = {"timeline": timeline, "bytes": total_bytes, "wall": time.time() - t0}
    except Exception as e:
        result[label] = {"err": f"{type(e).__name__}: {str(e)[:40]}", "timeline": timeline}

result = {}
threads = [threading.Thread(target=stream_node, args=(h, result)) for h in targets]
for t in threads: t.start()
for t in threads: t.join()

def analyze(label, res):
    print(f"── {label}")
    if "err" in res and not res.get("timeline"):
        print(f"   {res['err']}\n"); return
    tl = res["timeline"]
    if len(tl) < 3:
        print(f"   資料太少（{len(tl)} tags）{res.get('err','')}\n"); return
    wall = tl[-1][0]; media = tl[-1][1]
    ratio = media / wall if wall else 0
    end_drift = wall - media
    # 掉隊（stall）估計：以 1 秒為牆上窗，看該窗內媒體時間前進 < 0.25s 的窗數
    stall_secs = 0
    prev_w, prev_m = 0, 0
    for w, m in tl:
        if w - prev_w >= 1.0:
            if m - prev_m < 0.25:   # 這一牆上秒，節目幾乎沒前進
                stall_secs += 1
            prev_w, prev_m = w, m
    goodput = res["bytes"] / wall / 1048576 if wall else 0
    print(f"   牆上{wall:.0f}s 收到節目{media:.0f}s  即時率ratio={ratio:.3f} (1.0=完美)")
    print(f"   結束落後 drift={end_drift:.1f}s   疑似掉隊≈{stall_secs} 秒   平均goodput={goodput:.2f}MB/s")
    # drift 隨時間（每 ~20% 取樣）
    marks = [tl[int(len(tl)*p)-1] for p in (0.25, 0.5, 0.75, 1.0)]
    print("   drift 走勢:", "  ".join(f"{w:.0f}s→落後{w-m:.1f}s" for w, m in marks))
    if res.get("err"): print(f"   (提前結束: {res['err']})")
    print()
    return {"ratio": ratio, "drift": end_drift, "stall": stall_secs}

print("=" * 60)
stats = {}
for label in sorted(result):
    s = analyze(label, result[label])
    if s: stats[label] = s

print("== 判讀 ==")
print("ratio 越接近 1、drift 越不增長、掉隊秒數越少 → 越不會卡。")
print("比較同集群 ov vs cn：若 cn 的 ratio 更高/drift 更小 → 國內對你(SG)確實更穩，值得做切換。")
print("若兩者相近或 ov 更好 → 切國內沒實質幫助，直播功能不值得。")
