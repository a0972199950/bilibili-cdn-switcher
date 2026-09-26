#!/usr/bin/env python3
# ⚠️ 研究/測試用腳本，不是擴充的一部分，隨時可刪。
# 場景B：模擬「刷直播」——每個直播看3秒就切下一個，連切N次，比 海外(ov) vs 國內(cn) 的 TTFB。
# TTFB = 從發出請求到收到第一個 FLV media tag 的時間（含 DNS+連線+TLS+首位元組，近似「點開到第一幀」）。
# 每切一次也會重新調 getRoomPlayInfo，一併記錄該 API 延遲（真實切台成本的一部分）。
# 用法：python3 research/live-surf-ttfb.py [每台停留秒=3] [room1 room2 ...]
import json, urllib.request, subprocess, socket, time, re, sys, statistics

cookie = subprocess.run(["bash","-c","grep -o '^BILI_COOKIE=.*' .env.local | sed 's/^BILI_COOKIE=//'"],
                        capture_output=True, text=True).stdout.strip()
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
args=sys.argv[1:]
DWELL=int(args[0]) if args and args[0].isdigit() else 3
ROOMS=[int(a) for a in args if a.isdigit()][1:] or [
    1703958289, 31405244, 23899847, 1854316557, 545068,
    26966466, 27632810, 1919212636, 31751478, 25355395]

def api(u):
    req=urllib.request.Request(u, headers={"User-Agent":UA,"Cookie":cookie,"Referer":"https://live.bilibili.com/"})
    return json.load(urllib.request.urlopen(req, timeout=15))

def ttfb(host, base, extra):
    # 回傳 (ttfb_ms 或 None, 狀態字)
    hn=host.split("//")[1]
    try: socket.getaddrinfo(hn,443)
    except: return None,"DNS✗"
    req=urllib.request.Request(f"{host}{base}{extra}",headers={"User-Agent":UA,"Referer":"https://live.bilibili.com/"})
    t0=time.time()
    try:
        r=urllib.request.urlopen(req,timeout=8)
        buf=bytearray()
        def rd(n):
            while len(buf)<n:
                c=r.read(65536)
                if not c: return False
                buf.extend(c)
            return True
        if not rd(9) or buf[:3]!=b"FLV": return None,"非FLV"
        do=int.from_bytes(buf[5:9],"big")
        if not rd(do+4): return None,"short"
        del buf[:do+4]
        # 讀到第一個 media tag
        if not rd(11): return None,"noTag"
        ds=int.from_bytes(buf[1:4],"big")
        if not rd(11+ds+4): return None,"noTag"
        first=(time.time()-t0)*1000
        # 停留 DWELL 秒模擬觀看
        t1=time.time()
        while time.time()-t1<DWELL:
            if not rd(len(buf)+65536): break
            del buf[:]
        return first,"ok"
    except urllib.error.HTTPError as e: return None,f"HTTP{e.code}"
    except Exception as e: return None,type(e).__name__[:8]

print(f"刷直播 TTFB 測試：{len(ROOMS)}台，每台停留{DWELL}s，海外 vs 國內\n")
print(f"{'#':>2} {'room':>11} {'api_ms':>7} {'ov-TTFB':>9} {'cn-TTFB':>9}  勝方")
ov_list=[]; cn_list=[]; api_list=[]
for i,room in enumerate(ROOMS,1):
    ta=time.time()
    try:
        d=api(f"https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id={room}&protocol=0&format=0&codec=0&qn=10000&platform=web")
        cd=d["data"]["playurl_info"]["playurl"]["stream"][0]["format"][0]["codec"][0]
        base,extra,assigned=cd["base_url"],cd["url_info"][0]["extra"],cd["url_info"][0]["host"]
    except Exception as e:
        print(f"{i:>2} {room:>11}  playinfo失敗 {type(e).__name__}"); continue
    api_ms=(time.time()-ta)*1000; api_list.append(api_ms)
    fam=re.search(r'(?:ov|cn)-gotcha(\d+)',assigned).group(1)
    ov,ovs=ttfb(f"https://d1--ov-gotcha{fam}.bilivideo.com",base,extra)
    cn,cns=ttfb(f"https://d1--cn-gotcha{fam}.bilivideo.com",base,extra)
    if ov: ov_list.append(ov)
    if cn: cn_list.append(cn)
    win = "—"
    if ov and cn: win = "cn快" if cn<ov else "ov快"
    ovv=f"{ov:.0f}" if ov else ovs
    cnv=f"{cn:.0f}" if cn else cns
    print(f"{i:>2} {room:>11} {api_ms:>7.0f} {ovv:>9} {cnv:>9}  {win}")

def summ(name,lst):
    if not lst: print(f"  {name}: 無有效樣本"); return
    print(f"  {name}: 平均={statistics.mean(lst):.0f}ms 中位={statistics.median(lst):.0f}ms "
          f"最好={min(lst):.0f} 最差={max(lst):.0f} (n={len(lst)})")
print(f"\n== 綜合(切台 TTFB) ==")
summ("api getRoomPlayInfo", api_list)
summ("ov 海外", ov_list)
summ("cn 國內", cn_list)
if ov_list and cn_list:
    diff=statistics.mean(ov_list)-statistics.mean(cn_list)
    print(f"  → 平均 cn 比 ov {'快' if diff>0 else '慢'} {abs(diff):.0f}ms"
          f"（刷直播時每切一次的首幀差距；切台越頻繁越有感）")
