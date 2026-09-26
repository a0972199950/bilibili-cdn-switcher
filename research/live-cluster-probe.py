#!/usr/bin/env python3
# ⚠️ 研究/測試用腳本，不是擴充的一部分，隨時可刪。用來回答：
#   Q1: 直播節點 host 的 "b" 後綴是不是 backup？（看 API 回傳裡的排序與共現）
#   Q2: 每次調 getRoomPlayInfo 拿到的集群號（gotchaNN）是不是都不同？跟房間有沒有關係？
#
# 用法：python3 research/live-cluster-probe.py
# 需要 .env.local 裡的 BILI_COOKIE（跟截圖腳本共用）。
import json, urllib.request, subprocess, time, re, collections

cookie = subprocess.run(
    ["bash", "-c", "grep -o '^BILI_COOKIE=.*' .env.local | sed 's/^BILI_COOKIE=//'"],
    capture_output=True, text=True).stdout.strip()
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"

def api(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cookie": cookie,
                                               "Referer": "https://live.bilibili.com/"})
    return json.load(urllib.request.urlopen(req, timeout=15))

def play_info(room):
    d = api(f"https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo"
            f"?room_id={room}&protocol=0&format=0&codec=0&qn=10000&platform=web")
    cd = d["data"]["playurl_info"]["playurl"]["stream"][0]["format"][0]["codec"][0]
    return cd["url_info"]  # list of {host, extra, stream_ttl}

# 拿幾個在線直播間
rec = api("https://api.live.bilibili.com/room/v1/room/get_user_recommend?page=1&page_size=15")["data"]
rooms = [r["roomid"] for r in rec if r.get("roomid")][:3]
print("測試房間:", rooms, "\n")

# ── Q1: b 後綴的角色 ─────────────────────────────────────────────
print("== Q1: url_info 裡 host 的排序與 b 後綴 ==")
sample = play_info(rooms[0])
for i, h in enumerate(sample):
    print(f"  [{i}] host={h['host']}")
    print(f"      stream_ttl={h.get('stream_ttl')}  extra長度={len(h.get('extra',''))}")
hosts = [h["host"] for h in sample]
non_b = [h for h in hosts if not re.search(r'gotcha\d+b\.', h)]
b_ones = [h for h in hosts if re.search(r'gotcha\d+b\.', h)]
print(f"  → 非 b 節點在前: {non_b}")
print(f"  → b 節點在後:   {b_ones}")
print("  （若非 b 恆為 index0、b 恆為後續，且兩者同集群號，則 b = 同集群的次要/備份邊緣）\n")

# ── Q2: 集群號每次是否不同 ───────────────────────────────────────
print("== Q2: 同房間多次調 API 的集群號分佈 ==")
for room in rooms:
    seq = []
    for _ in range(12):
        try:
            ui = play_info(room)
            m = re.search(r'(?:ov|cn)-gotcha(\d+)', ui[0]["host"])
            seq.append(m.group(1) if m else "?")
        except Exception as e:
            seq.append("err")
        time.sleep(0.3)
    cnt = collections.Counter(seq)
    print(f"  room {room}: 序列={seq}")
    print(f"             分佈={dict(cnt)}  不同號數={len(cnt)}")
print("\n（若同房間多次出現多個不同號 → 每次分配會變；若恆為同號 → 綁房間/會話）")
