# /cdn-speedtest 影片池與挑片。
#   build_pool：熱門（popular，新且高播放）、入站必刷（precious，舊且高播放）、
#               各年份時間窗的 WBI 搜尋深頁（補中／低播放、新／舊）。只收 ≥ 120 秒的影片。
#               （每週必看 series API 會被風控 -352，不能用。）可分段續跑：已完成的搜尋記在 pool.json。
#   pick：快篩 3 支「當前熱門、播放量最高」影片 + 細測 10 支分層影片（播放 高/中/低 × 發布 近/中/遠 九格 + 1 支），
#         兩組不重複；每支在 1080P 以上隨機挑一個解析度（沒有 1080P 取最高）。種子固定、記錄在 videos.json。
import json, os, time, random, collections
from bili import api, wbi, view, dash_streams

QN = {127: "8K", 126: "杜比視界", 125: "HDR", 120: "4K", 116: "1080P60", 112: "1080P+", 80: "1080P",
      74: "720P60", 64: "720P", 32: "480P", 16: "360P", 6: "240P"}
CODEC = {7: "AVC", 12: "HEVC", 13: "AV1"}
CELL_ZH = {"H": "高播放", "M": "中播放", "L": "低播放", "new": "近", "mid": "中", "old": "遠"}


def cell_zh(c):
    a, b = c.split("-")
    return f"{CELL_ZH[a]}×{CELL_ZH[b]}"


def _secs(d):
    if isinstance(d, int):
        return d
    s = 0
    for x in str(d).split(":"):
        s = s * 60 + int(x)
    return s


def _searches(now):
    """(key, keyword, begin_ts, page, max_view) 清單，順序固定"""
    out = []
    recent = time.localtime(now - 86400 * 12)
    for kw in ["录屏", "练习", "vlog", "教程", "翻唱"]:
        for y, m, d in ((2013, 3, 1), (2016, 3, 1), (2019, 3, 1), (2022, 3, 1), (2024, 3, 1),
                        (recent.tm_year, recent.tm_mon, recent.tm_mday)):
            for pg in (5, 25):
                b = int(time.mktime((y, m, d, 0, 0, 0, 0, 0, -1)))
                out.append((f"{kw}|{b}|{pg}", kw, b, pg, None))
    # 補「舊／中 × 低播放」：更深頁、只收 < 1 萬播放
    for kw in ["录屏", "练习", "日常", "游戏", "实况", "测试", "作业", "弹奏"]:
        for y, m in ((2014, 6), (2015, 6), (2017, 6), (2018, 9), (2020, 6), (2021, 9), (2023, 6)):
            for pg in (30, 45):
                b = int(time.mktime((y, m, 1, 0, 0, 0, 0, 0, -1)))
                out.append((f"{kw}|{b}|{pg}|L", kw, b, pg, 1e4))
    return out


def build_pool(path, deadline=None, quick=False, progress=None):
    """回傳 True=完成、False=時間到（已存進度，再跑一次續跑）。quick=True 只抓熱門＋必刷＋少量搜尋（測試用）；
    progress(已完成, 總數) 選用，給 GUI 顯示進度"""
    st = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else dict(done=[], complete=False, videos={})
    if st.get("complete"):
        return True
    pool, done = st["videos"], set(st["done"])
    now = time.time()

    def add(bvid, v, pub, dur, src, max_view=None):
        dur = _secs(dur)
        if bvid in pool or dur < 120 or (max_view is not None and v >= max_view):
            return
        pool[bvid] = dict(bvid=bvid, view=v, pub=pub, dur=dur, src=src)

    def save(complete=False):
        st.update(done=sorted(done), complete=complete, videos=pool)
        json.dump(st, open(path, "w", encoding="utf-8"), ensure_ascii=False)

    if "popular" not in done:
        for x in api("https://api.bilibili.com/x/web-interface/popular?ps=50&pn=1")["data"]["list"]:
            add(x["bvid"], x["stat"]["view"], x["pubdate"], x["duration"], "popular")
        done.add("popular")
    if "precious" not in done:
        try:
            for x in api("https://api.bilibili.com/x/web-interface/popular/precious?page_size=100&page=1")["data"]["list"]:
                add(x["bvid"], x["stat"]["view"], x["pubdate"], x["duration"], "precious")
        except Exception as e:
            print("  precious 失敗（略過）：", e)
        done.add("precious")
    save()
    todo = [s for s in _searches(now) if s[0] not in done]
    if quick:
        todo = todo[4::25][:4]  # 測試用：抽幾組有結果機會較大的搜尋
    errs = 0
    for i, (key, kw, b, pg, mv) in enumerate(todo):
        if deadline and time.time() > deadline:
            save()
            print(f"  影片池：時間到，已完成 {len(done)} 組搜尋，再執行一次續跑")
            return False
        try:
            def q(page):
                r = api(wbi("https://api.bilibili.com/x/web-interface/wbi/search/type",
                            {"search_type": "video", "keyword": kw, "order": "pubdate",
                             "pubtime_begin_s": b, "pubtime_end_s": b + 86400 * 10, "page": page}))
                if r.get("code") not in (0, None):
                    raise RuntimeError(f"code {r.get('code')}")  # -352 等風控
                return r.get("data") or {}
            d = q(pg)
            np = d.get("numPages") or 0
            if not d.get("result") and 1 <= np < pg:  # 時間窗內影片不多、頁數不夠深：改取最後一頁
                time.sleep(1.2)
                d = q(np)
            for x in d.get("result") or []:
                add(x["bvid"], x["play"], x["pubdate"], x["duration"], f"search{time.localtime(b).tm_year}", mv)
            done.add(key)
        except Exception as e:
            errs += 1
            print("  search err", kw, pg, str(e)[:60])
            done.add(key)  # 失敗也不重試，避免卡在風控
        if progress: progress(i + 1, len(todo))
        if i % 20 == 19:
            save()
            print(f"  影片池：{len(done)} 組搜尋，{len(pool)} 支影片", flush=True)
        time.sleep(1.2)
    save(complete=True)
    c = collections.Counter("-".join(_cell(v, now)) for v in pool.values())
    print(f"  影片池完成：{len(pool)} 支；各格數量 {dict(sorted(c.items()))}；搜尋失敗 {errs} 次")
    return True


def _cell(v, now):
    vb = "H" if v["view"] >= 1e6 else "M" if v["view"] >= 1e4 else "L"
    age = (now - v["pub"]) / 86400
    return vb, "new" if age < 30 else "mid" if age < 365 * 3 else "old"


def pick(pool_path, out_path, seed, n_test=10, n_screen=3, logged_in=True):
    rng = random.Random(seed)
    now = time.time()
    pool = list(json.load(open(pool_path, encoding="utf-8"))["videos"].values())
    used = set()

    def resolve(v):
        try:
            d = view(v["bvid"])
            ss = dash_streams(v["bvid"], d["cid"])
        except Exception as e:
            print("  skip", v["bvid"], str(e)[:60])
            return None
        ss = [x for x in ss if any("/upgcxcode/" in u for u in [x.get("baseUrl", "")] + (x.get("backupUrl") or []))]
        if not ss:
            print("  skip", v["bvid"], "沒有 upgcxcode 網址")
            return None
        # 只在 1080P（qn 80）以上隨機；影片沒有 1080P 時取最高畫質的那些串流
        hi = [x for x in ss if x["id"] >= 80] or [x for x in ss if x["id"] == max(y["id"] for y in ss)]
        s = rng.choice(hi)
        return dict(bvid=v["bvid"], cid=d["cid"], title=d["title"], view=d["stat"]["view"], pub=d["pubdate"],
                    dur=d["duration"], cell="-".join(_cell(dict(view=d["stat"]["view"], pub=d["pubdate"]), now)),
                    qn=s["id"], codecid=s["codecid"], choices=sorted({(x["id"], x["codecid"]) for x in ss}))

    def take(cands, n):
        out = []
        rng.shuffle(cands)
        for v in cands:
            if len(out) >= n:
                break
            if v["bvid"] in used:
                continue
            r = resolve(v)
            time.sleep(0.5)
            if r:
                used.add(v["bvid"])
                out.append(r)
        return out

    # 快篩：當前熱門清單裡播放量最高的 3 支（幾乎確定所有節點都有快取）
    hot = sorted([v for v in pool if v["src"] == "popular"], key=lambda v: -v["view"])
    screen = []
    for v in hot:
        if len(screen) >= n_screen:
            break
        r = resolve(v)
        if r:
            used.add(v["bvid"])
            screen.append(r)
    # 細測：九格各 1 支，缺格與第 10 支由中播放補
    test = []
    for a in "HML":
        for b in ("new", "mid", "old"):
            if len(test) >= n_test:
                break
            test += take([v for v in pool if _cell(v, now) == (a, b)], 1)
    test += take([v for v in pool if _cell(v, now)[0] == "M"], n_test - len(test))
    test += take(list(pool), n_test - len(test))
    out = dict(seed=seed, picked_at=time.strftime("%Y-%m-%d %H:%M"), logged_in=logged_in, screen=screen, test=test)
    json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for k in ("screen", "test"):
        print(f"== {'快篩' if k == 'screen' else '細測'} ==")
        for v in out[k]:
            print(f"  {v['bvid']} {cell_zh(v['cell'])} view={v['view']:>10} "
                  f"{time.strftime('%Y-%m-%d', time.localtime(v['pub']))} {v['dur']:>5}s "
                  f"{QN.get(v['qn'], v['qn'])} {CODEC.get(v['codecid'], v['codecid'])}  {v['title'][:24]}")
    return out
