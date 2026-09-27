#!/usr/bin/env python3
# ⚠️ 研究/測試用腳本，不是擴充的一部分，隨時可刪。用來回答：
#   Q3: 直播卡不卡，是不是只看 TTFB？
# 做法：對同一集群的 ov(海外) 與 cn(國內) 節點，各持續拉流 ~15 秒，
#      以 1 秒為窗記錄吞吐，看：TTFB、平均吞吐、最低 1 秒窗吞吐、低於碼率的「疑似卡頓」窗數、抖動(CV)。
#      → 若某節點 TTFB 很好但中途吞吐掉到碼率以下 → 證明「只看 TTFB」不夠。
#
# 用法：python3 research/live-smoothness.py
import json, urllib.request, subprocess, socket, time, re, statistics

cookie = subprocess.run(
    ["bash", "-c", "grep -o '^BILI_COOKIE=.*' .env.local | sed 's/^BILI_COOKIE=//'"],
    capture_output=True, text=True).stdout.strip()
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"

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
print(f"本次集群號 = gotcha{fam}\n")

WINDOW = 1.0      # 每秒一個吞吐窗
DURATION = 15.0   # 每個節點測 15 秒

def sustained(host):
    url = f"{host}{base}{extra}"
    hn = host.split("//")[1]
    try:
        socket.getaddrinfo(hn, 443)
    except Exception:
        return None
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://live.bilibili.com/"})
    t0 = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=8)
        first = r.read(4)
        ttfb = (time.time() - t0) * 1000
        if first[:3] != b"FLV":
            return {"err": "非FLV"}
        windows = []          # 每秒吞吐 (MB/s)
        got = len(first)
        wstart = time.time()
        end = wstart + DURATION
        wbytes = got
        while time.time() < end:
            b = r.read(65536)
            if not b:
                break
            wbytes += len(b)
            if time.time() - wstart >= WINDOW:
                windows.append(wbytes / (time.time() - wstart) / 1048576)
                wbytes = 0
                wstart = time.time()
        return {"ttfb": ttfb, "windows": windows}
    except urllib.error.HTTPError as e:
        return {"err": f"HTTP{e.code}"}
    except Exception as e:
        return {"err": type(e).__name__}

def report(label, host, res):
    print(f"── {label}: {host}")
    if res is None:
        print("   DNS 不存在\n"); return None
    if "err" in res:
        print(f"   {res['err']}\n"); return None
    w = res["windows"]
    avg = statistics.mean(w) if w else 0
    lo = min(w) if w else 0
    cv = (statistics.pstdev(w) / avg * 100) if avg else 0
    # 原畫碼率粗估：用平均吞吐當基準比較「最低窗 vs 平均」，抓穩定度
    print(f"   TTFB={res['ttfb']:.0f}ms  平均={avg:.2f}MB/s  最低1秒窗={lo:.2f}MB/s  抖動CV={cv:.0f}%")
    print(f"   每秒吞吐: {['%.2f'%x for x in w]}\n")
    return {"avg": avg, "lo": lo, "cv": cv, "ttfb": res["ttfb"]}

print(f"每個節點持續拉 {DURATION:.0f} 秒，1 秒一窗：\n")
ov = report("海外 ov", f"https://d1--ov-gotcha{fam}.bilivideo.com", sustained(f"https://d1--ov-gotcha{fam}.bilivideo.com"))
cn = report("國內 cn", f"https://d1--cn-gotcha{fam}.bilivideo.com", sustained(f"https://d1--cn-gotcha{fam}.bilivideo.com"))

print("== 結論觀察 ==")
print("TTFB 只反映『第一個位元組多快到』；卡頓要看『能否持續穩定 ≥ 碼率』。")
print("看上面：最低1秒窗、抖動CV 才是持續穩定度指標——TTFB 好但這兩項差，照樣會卡。")
