#!/usr/bin/env python3
# ⚠️ 研究/測試用腳本，不是擴充的一部分，隨時可刪。
# 場景A：高碼率直播「連續播放」綜合穩定度 —— 海外(ov) vs 國內(cn) 並行對比。
# 指標：
#   ratio=收到節目秒/牆上秒 (1.0=完美即時)；drift 走勢(是否越落越多)；掉隊秒；goodput；
#   以及「絕對直播延遲」：同時連 ov/cn，比第一個 FLV tag 的媒體時間線位置，誰更靠前＝離直播源更近。
# 用法：python3 research/live-hbr-sustained.py [每房秒數=60] [room1 room2 ...]
import json, urllib.request, subprocess, socket, time, re, sys, threading, statistics

cookie = subprocess.run(["bash","-c","grep -o '^BILI_COOKIE=.*' .env.local | sed 's/^BILI_COOKIE=//'"],
                        capture_output=True, text=True).stdout.strip()
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
args=[a for a in sys.argv[1:]]
DUR=int(args[0]) if args and args[0].isdigit() else 60
ROOMS=[int(a) for a in args if a.isdigit()][1:] or [1703958289, 31405244, 23899847]

def api(u):
    req=urllib.request.Request(u, headers={"User-Agent":UA,"Cookie":cookie,"Referer":"https://live.bilibili.com/"})
    return json.load(urllib.request.urlopen(req, timeout=15))

def playinfo(room):
    d=api(f"https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id={room}&protocol=0&format=0&codec=0&qn=10000&platform=web")
    cd=d["data"]["playurl_info"]["playurl"]["stream"][0]["format"][0]["codec"][0]
    return cd["base_url"], cd["url_info"][0]["extra"], cd["url_info"][0]["host"]

def alive(host, base, extra):
    try: socket.getaddrinfo(host.split("//")[1],443)
    except: return False
    try:
        r=urllib.request.urlopen(urllib.request.Request(f"{host}{base}{extra}",
            headers={"User-Agent":UA,"Referer":"https://live.bilibili.com/"}), timeout=8)
        return r.read(3)==b"FLV"
    except: return False

def stream(host, base, extra, T0, out):
    label=host.split("//")[1]
    try:
        r=urllib.request.urlopen(urllib.request.Request(f"{host}{base}{extra}",
            headers={"User-Agent":UA,"Referer":"https://live.bilibili.com/"}), timeout=12)
        buf=bytearray()
        def rd(n):
            while len(buf)<n:
                c=r.read(65536)
                if not c: return False
                buf.extend(c)
            return True
        if not rd(9): out[label]={"err":"hdr"}; return
        do=int.from_bytes(buf[5:9],"big")
        if not rd(do+4): out[label]={"err":"short"}; return
        del buf[:do+4]
        first_ts=None; first_wall=None; last_ts=0; total=0; tl=[]; t0=time.time()
        while time.time()-t0<DUR:
            if not rd(11): break
            ds=int.from_bytes(buf[1:4],"big"); ts=int.from_bytes(buf[4:7],"big")|(buf[7]<<24)
            if not rd(11+ds+4): break
            total+=11+ds+4; del buf[:11+ds+4]
            if first_ts is None: first_ts=ts; first_wall=time.time()-T0
            last_ts=ts; tl.append((time.time()-t0,(last_ts-first_ts)/1000.0))
        out[label]={"tl":tl,"bytes":total,"wall":time.time()-t0,
                    "abs_pos": (first_ts/1000.0 - first_wall) if first_ts is not None else None}
    except Exception as e:
        out[label]={"err":type(e).__name__}

def run_room(room):
    print(f"\n{'='*62}\nroom {room}  (連續 {DUR}s)")
    try: base,extra,assigned=playinfo(room)
    except Exception as e: print("  playinfo 失敗",e); return None
    fam=re.search(r'(?:ov|cn)-gotcha(\d+)',assigned).group(1)
    variants=[f"https://d1--ov-gotcha{fam}.bilivideo.com", f"https://d1--cn-gotcha{fam}.bilivideo.com"]
    targets=[h for h in variants if alive(h,base,extra)]
    print(f"  集群{fam}  節點:", *[t.split('//')[1] for t in targets])
    out={}; T0=time.time()
    ths=[threading.Thread(target=stream,args=(h,base,extra,T0,out)) for h in targets]
    for t in ths: t.start()
    for t in ths: t.join()
    room_stats={}
    for label in sorted(out):
        res=out[label]
        if "err" in res or len(res.get("tl",[]))<3:
            print(f"  {label}: 失敗/資料少 {res.get('err','')}"); continue
        tl=res["tl"]; wall=tl[-1][0]; media=tl[-1][1]
        ratio=media/wall if wall else 0; drift=wall-media
        stalls=0; pw=pm=0
        for w,m in tl:
            if w-pw>=1.0:
                if m-pm<0.25: stalls+=1
                pw,pm=w,m
        gp=res["bytes"]/wall/1048576 if wall else 0
        mbps=res["bytes"]*8/media/1e6 if media>0.5 else 0
        marks=[tl[int(len(tl)*p)-1] for p in (0.33,0.66,1.0)]
        tag="ov海外" if "ov-" in label else "cn國內"
        print(f"  [{tag}] {label}")
        print(f"     ratio={ratio:.3f} 掉隊≈{stalls}s goodput={gp:.2f}MB/s 碼率≈{mbps:.1f}Mbps")
        print(f"     drift走勢:", "  ".join(f"{w:.0f}s→{w-m:+.1f}s" for w,m in marks))
        room_stats[tag]={"ratio":ratio,"stalls":stalls,"abs_pos":res.get("abs_pos")}
    # 絕對延遲對比
    if "ov海外" in room_stats and "cn國內" in room_stats:
        a=room_stats["ov海外"]["abs_pos"]; b=room_stats["cn國內"]["abs_pos"]
        if a is not None and b is not None:
            lead = b-a  # cn - ov，正=cn更靠近直播源(延遲更低)
            who = "cn國內更靠近直播源" if lead>0 else "ov海外更靠近直播源"
            print(f"  ▶ 絕對直播延遲差: cn 相對 ov {lead:+.1f}s  ({who} {abs(lead):.1f}s)")
    return room_stats

print(f"高碼率連續播放測試  房間={ROOMS}")
allstats=[]
for room in ROOMS:
    s=run_room(room)
    if s: allstats.append(s)

print(f"\n{'='*62}\n== 綜合判讀 ==")
for tag in ["ov海外","cn國內"]:
    rs=[s[tag]["ratio"] for s in allstats if tag in s]
    st=[s[tag]["stalls"] for s in allstats if tag in s]
    if rs:
        print(f"  {tag}: 平均ratio={statistics.mean(rs):.3f}  平均掉隊={statistics.mean(st):.1f}s  (n={len(rs)})")
print("ratio 更接近1、掉隊更少、絕對延遲更低 → 該側更適合。")
