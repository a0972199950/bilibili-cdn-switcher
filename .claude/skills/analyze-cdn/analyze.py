# 跨報告分析某國家的 CDN 測速結果，產生「預設節點候選 + 剩餘節點清單」的分析報告給使用者讀。只用 Python 標準函式庫，不改任何專案檔案。
#
# 用法（在 repo 根目錄執行）：
#   python -I analyze.py <國家代碼> [--root cdn-speedtest-results] [--cdn-list src/cdn-list.json]
#                        [--exclude rid,...] [--include rid,...] [--out <目錄>]
#
# 輸出 <out>/<國家>-<yyyymmdd-HHMM>.md（分析報告）與同名 .json（建議清單，給之後更新 cdn-list.json 用），
# 最後一行印 OUTPUT <md 路徑>。--out 預設 <root>/_analysis（gitignored）。報告不含出口 IP。
#
# 目標（依序）：
#   1. 預設節點：在「還沒有依 ISP 選節點」的功能前，最大化使用者剛安裝時預設就能順暢播 4K 的機率
#      → 每個節點算「市占加權覆蓋率」= Σ(ISP 市占 × 該 ISP 線路中能跑 4K 的比例) ÷ Σ(有報告的 ISP 市占)。
#        全部 ISP 的全部線路都達標（覆蓋 100%）的節點是第一順位；沒有就依覆蓋率退而求其次。
#        覆蓋率同級者再要求穩定（無不穩定／失敗紀錄、速度波動小），最後依平均速度排序，列多個候選並說明原因。
#      市占來自 isp-share.json（網路統計），不是從報告數量推。
#   2. 剩餘 9 個節點：讓同國任何 ISP 的使用者都能在清單裡找到適合自己的節點
#      → 依市占輪流從每個 ISP 的第一梯隊取最好的；同一 ISP 內「冗餘」的不重複取；重複的節點跳過。
#        冗餘 = 在該 ISP 的報告裡達標結論一致率 ≥ REDUN_AGREE（兩者都有結論的報告 ≥ REDUN_MIN_N 份）；
#        資料不足時退回「同機房」（cn-*／ec-* 去末碼的前綴）當先驗。
#        全國層面不用前綴分池：跨報告真正一起好一起壞的是 ISP 陣營，由「每個 ISP 都取到」處理。
import argparse, glob, json, math, os, random, re, statistics, sys
from collections import Counter, defaultdict
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")

TOP_N = 10          # 清單總數（預設 1 + 剩餘 9）
FOURK_MBPS = 25     # B 站 4K 串流約 15–25 Mbps，單連線 25 Mbps 當「跑得動 4K」的門檻
PASS_Q = 0.9        # 4K 達成度 ≥ 0.9（≈ 22.5 Mbps）就算達標，容忍量測誤差
UNKNOWN_CREDIT = 0.5  # 沒進細測、也沒有快篩紀錄的報告：不知道好壞，算一半（舊版 GUI 只細測快篩前 80 名，沒進不代表慢，但也不能證明行）。
                      # 只在該 ISP 至少有一條線路量到時才給；整個 ISP 都沒量到 = 0
CV_MAX = 0.3        # 預設的穩定條件：各報告 sd/平均 的中位數 ≤ 0.3
TTFB_MAX = 1000     # 預設的穩定條件：中位 TTFB ≤ 1000 ms
BOOT = 500
T1_MIN = 0.8        # ISP 內第一梯隊：分數至少要有該 ISP 基準節點的 80%
REDUN_MIN_N = 3     # 同 ISP 內判斷兩節點是否冗餘：至少要有幾份報告兩者都有結論
REDUN_AGREE = 0.9   # 達標結論一致率 ≥ 90% → 對這家 ISP 是冗餘的，只取一個
PARTIAL_OK_MIN = 0.8  # 新版報告 stage2.raw：細測 10 支裡成功 ≥ 80%、失敗都是逾時類（沒有 403）→「部分失敗」，
                      # 速度用成功那幾支算、分級最多到「可用」（×0.5，比照不穩定）；達標一律算 0（預設要最不會出錯）。
                      # 成功率更低或有 403 → 照舊算失敗
PEAK = range(19, 24)
GOOD = ("第一梯隊", "可用")
MOBILE_AD = re.compile(r"Remote NDIS|Mobile Broadband|WWAN|Cellular|\bLTE\b|Android|iPhone|Apple Mobile", re.I)
WIFI_AD = re.compile(r"802\.11|Wireless|Wi-?Fi|WLAN", re.I)
WIRED_AD = re.compile(r"802\.3|Ethernet|乙太|GbE|Gigabit|\bI2\d\d", re.I)
HERE = os.path.dirname(os.path.abspath(__file__))


def short(h): return h.replace(".bilivideo.com", "")


def cluster(h):
    """機房前綴：cn-*／ec-* 去掉最後的編號（cn-hbwh-fx-01-xx → cn-hbwh-fx-01），其餘每個節點自成一個。
    同機房 = 同一條路徑，對同一家 ISP 表現幾乎相同（單份報告內速度離散度 0.02–0.1、達標結論 80–100% 一致），
    所以在資料不足時當「冗餘」的先驗；也是故障單位（機房離線）的分散依據。
    注意它對「跨 ISP 一起好一起壞」沒有預測力（不同機房的 cn-hbwh／cn-sdjn／cn-bj-se 跨報告 100% 同好同壞），全國層面不拿它分池"""
    s = short(h)
    return re.sub(r"-\d+$", "", s) if re.match(r"^(cn|ec)-", s) else s


# ── 讀取 ─────────────────────────────────────────────────────
def net_kind(n):
    kind, ad = n.get("kind") or "未知", n.get("adapter") or ""
    if not ad: return kind, False
    fixed = ("行動網路" if MOBILE_AD.search(ad) else "Wi-Fi" if WIFI_AD.search(ad) else
             "有線" if WIRED_AD.search(ad) else kind)
    if fixed.startswith("行動") and kind.startswith("行動"): fixed = kind
    return fixed, fixed != kind


def top_stable(rows):
    """各報告的比較基準：最快的「穩定」節點（sd ≤ 平均一半），與 speedtest.py 的分級基準相同"""
    for r in rows:
        if r["sd"] <= 0.5 * r["mean"]: return r["mean"]
    return max((r["mean"] for r in rows), default=0) or 1


def load_reports(root, cc):
    reps = []
    for f in sorted(glob.glob(os.path.join(root, cc, "**", "*-summary.json"), recursive=True)):
        base = os.path.basename(f)[:-len("-summary.json")]
        if base.startswith("TEST-"): continue
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception as e:
            print("! 無法讀取", f, e); continue
        if d.get("country") != cc or not d.get("rows"): continue
        env = d.get("env") or {}
        ex, vpn = env.get("exit") or {}, env.get("vpn_check") or {}
        ipapi = vpn.get("ipapi") or {}
        org = ex.get("org") or ipapi.get("as") or "?"
        asn = org.split()[0] if org.startswith("AS") else org
        kind, kind_fixed = net_kind(env.get("network") or {})
        rows = sorted(d["rows"], key=lambda r: -r["mean"])
        t = d.get("time") or ""
        # 沒進細測的節點是「快篩失敗」（確定不行）還是「快篩通過但被淘汰」（不知道）：
        # 新版 GUI 的 stage1.nodes 每個節點都有；舊版只有 project_nodes（擴充內建節點）的狀態文字
        s1_fail, s1_mbps, probe_err = set(), {}, set()
        for x in (d.get("stage1") or {}).get("nodes") or []:
            if x.get("mbps") is None: s1_fail.add(x["host"])
            else: s1_mbps[x["host"]] = x["mbps"]
            if (x.get("probe") or {}).get("err"): probe_err.add(x["host"])  # 冷門片探測失敗（403／逾時）
        for p in d.get("project_nodes") or []:
            st_ = p.get("status") or ""
            if st_.startswith("快篩失敗"): s1_fail.add(p["host"])
            m = re.match(r"快篩淘汰（([\d.]+) Mbps）", st_)
            if m: s1_mbps.setdefault(p["host"], float(m.group(1)))
        # 新版報告的細測逐筆（stage2.raw）：有任一支失敗的節點不在 rows，但成功那幾支仍有用。
        # 成功率 ≥ PARTIAL_OK_MIN 且失敗都不是 403 → 部分失敗（記速度）；否則照舊是「細測失敗」。
        # 也順便算每個節點冷門片（cache miss）的平均速度，報告裡顯示用
        raw2 = (d.get("stage2") or {}).get("raw") or []
        partial, miss_mbps = {}, {}
        if raw2:
            by = defaultdict(list)
            for x in raw2: by[x["host"]].append(x)
            row_hosts = {r["host"] for r in rows}
            for h, xs in by.items():
                ok = [x for x in xs if not x.get("err") and x.get("mbps") is not None]
                miss = [x["mbps"] for x in ok if "miss" in str(x.get("cache") or "").lower()]
                if miss: miss_mbps[h] = statistics.mean(miss)
                if h in row_hosts or not ok or len(ok) == len(xs): continue
                errs = Counter(x["err"] for x in xs if x.get("err"))
                if any("403" in e for e in errs): continue
                if len(ok) / len(xs) < PARTIAL_OK_MIN: continue
                ms = [x["mbps"] for x in ok]
                partial[h] = dict(n_ok=len(ok), n=len(xs), mean=statistics.mean(ms),
                                  sd=statistics.pstdev(ms) if len(ms) > 1 else 0.0,
                                  ttfb=statistics.median(x["ttfb"] for x in ok if x.get("ttfb") is not None) if any(x.get("ttfb") is not None for x in ok) else None,
                                  errs=dict(errs))
        reps.append(dict(
            rid=base.rsplit("-", 1)[1], base=base, dir=os.path.dirname(f), time=t,
            ts=datetime.strptime(t, "%Y-%m-%d %H:%M") if re.match(r"\d{4}-\d\d-\d\d \d\d:\d\d$", t) else None,
            hour=int(t[11:13]) if re.match(r"\d{4}-\d\d-\d\d \d\d", t) else None,
            city=ex.get("city") or ipapi.get("city") or "?", asn=asn,
            isp=ipapi.get("isp") or org.partition(" ")[2] or org,
            as_name=org.partition(" ")[2] if org.startswith("AS") else "",
            kind=kind, kind_fixed=kind_fixed,
            down=(env.get("bandwidth") or {}).get("down_mbps"), ceiling=d.get("ceiling") or 0,
            conc=d.get("conc"), conc_auto=d.get("conc_auto"), contention=d.get("contention_warning"),
            dns=env.get("dns_override"), login=env.get("login"),
            s1_n=(d.get("stage1") or {}).get("n_nodes"), s1_passed=(d.get("stage1") or {}).get("passed"),
            full=(d.get("stage2") or {}).get("full_success") or 0,
            rows={r["host"]: r for r in rows}, ref=top_stable(rows),
            failed=d.get("failed") or {}, hot_only=set(d.get("hot_only") or []), s1_fail=s1_fail, s1_mbps=s1_mbps, probe_err=probe_err,
            partial=partial, miss_mbps=miss_mbps,
            new_fmt=bool((d.get("stage1") or {}).get("nodes")) or bool(raw2),
            _ip=ex.get("ip") or "", _adapter=(env.get("network") or {}).get("adapter") or ""))
    assign_lines(reps)
    return reps


def assign_lines(reps):
    """同一條線路（同 ISP 且同出口 IP，或同 /24 且同網卡）的重複測試標成同一個 L 編號。
    線路才是獨立樣本：同一戶測 3 次不等於 3 個使用者。IP 只在記憶體裡比對，不寫進報告。"""
    keys = []
    for r in sorted(reps, key=lambda r: r["time"]):
        p24 = r["_ip"].rsplit(".", 1)[0] if r["_ip"].count(".") == 3 else r["_ip"]
        hit = next((k for k in keys if k[0] == r["asn"] and r["_ip"] and
                    (k[1] == r["_ip"] or (k[2] == p24 and k[3] == r["_adapter"]))), None)
        if not hit:
            hit = (r["asn"], r["_ip"], p24, r["_adapter"], f"L{len(keys) + 1}")
            keys.append(hit)
        r["line"] = hit[4]
    for r in reps: del r["_ip"], r["_adapter"]


# ── 市占 ─────────────────────────────────────────────────────
def load_share(cc):
    try:
        all_ = json.load(open(os.path.join(HERE, "isp-share.json"), encoding="utf-8"))
    except Exception:
        return None
    return all_.get(cc)


def share_lookup(share_cfg, asn, isp_name):
    """(市占, 對應到的市占名稱或 None)。對不到的 ISP 用 other_each"""
    if not share_cfg: return None, None
    for x in share_cfg.get("isps", []):
        for m in x.get("match", []):
            if m.upper() == asn.upper() or (not m.upper().startswith("AS") and m.lower() in (isp_name or "").lower()):
                return x["share"], x["name"]
    return share_cfg.get("other_each", 0.03), None


# ── 單份報告中的節點狀態 ─────────────────────────────────────
def state(rep, host):
    """(狀態, 分數 0–1)。第一梯隊 = 1；可用／差 = 平均 ÷ 該報告基準；不穩定 = 一半；失敗／只能播熱門／快篩失敗 = 0；未進細測 = 0"""
    r = rep["rows"].get(host)
    if r:
        if r["tier"] == "第一梯隊": return r["tier"], 1.0
        rel = min(r["mean"] / rep["ref"], 1.0)
        return r["tier"], rel * (0.5 if r["tier"] == "不穩定" else 1)
    if host in rep["hot_only"]: return "只能播熱門", 0.0
    p = rep["partial"].get(host)
    if p:  # 新版報告：細測部分失敗（成功 ≥ 80%、非 403）。速度用成功那幾支，比照不穩定打五折，再乘成功率
        rel = min(p["mean"] / rep["ref"], 1.0)
        return f"部分失敗 {p['n_ok']}/{p['n']}", rel * 0.5 * p["n_ok"] / p["n"]
    if host in rep["failed"]: return "細測失敗", 0.0
    if host in rep["s1_fail"]: return "快篩失敗", 0.0
    if host in rep["probe_err"]: return "冷門片探測失敗", 0.0
    if host in rep["s1_mbps"]: return f"快篩淘汰 {rep['s1_mbps'][host]:.0f} Mbps", 0.0
    return "未進細測", 0.0


def q_of(rep, h):
    """4K 達成度 0–1；None = 不知道（沒進細測、也沒有快篩失敗紀錄：舊版 GUI 只細測快篩前 80 名，沒進不代表慢）。
    = 單連線平均速度 ÷ min(25 Mbps, 該報告最快穩定節點)，最多 1（整條線路都慢時以它做得到的最快速度為目標）。
    被「上限 ÷ 並行數」卡住的視為至少這麼快。不穩定（sd > 平均一半）、細測失敗、部分失敗、快篩失敗、只能播熱門、冷門片探測失敗 = 0
    （部分失敗有速度紀錄，但預設要最不會出錯，所以達標仍算 0；分級那邊會給它「可用」級的分數）。
    沒進細測但有快篩速度（新版 GUI 的 stage1.nodes、或 project_nodes 的「快篩淘汰（x Mbps）」）→ 用快篩速度算（弱證據，熱門片 2MB，偏樂觀）"""
    r = rep["rows"].get(h)
    if r:
        if r["sd"] > 0.5 * r["mean"]: return 0.0
        v, cap = r["mean"], rep["ceiling"] / max(rep["conc"] or 1, 1)
        if v >= 0.9 * cap: v = max(v, cap)
        return min(v / (min(FOURK_MBPS, rep["ref"]) or FOURK_MBPS), 1.0)
    if h in rep["hot_only"] or h in rep["failed"] or h in rep["partial"] or h in rep["s1_fail"] or h in rep["probe_err"]: return 0.0
    if h in rep["s1_mbps"]: return min(rep["s1_mbps"][h] / (min(FOURK_MBPS, rep["ref"]) or FOURK_MBPS), 1.0)
    return None


def ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    rk = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]: j += 1
        for k in range(i, j + 1): rk[order[k]] = (i + j) / 2
        i = j + 1
    return rk


def spearman(a, b):
    ra, rb = ranks(a), ranks(b)
    ma, mb = statistics.mean(ra), statistics.mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else 0.0


# ── 分析 ─────────────────────────────────────────────────────
def analyze(reps, cdn, cc, share_cfg):
    opts = {o["value"]: o for o in cdn.get("options", []) if o.get("value") != "backup"}
    pools_lab = cdn.get("pools", {})
    row_pool = {}
    for rep in reps:
        for h, r in rep["rows"].items(): row_pool.setdefault(h, r.get("pool_label"))

    def pool_label(h):
        k = (opts.get(h) or {}).get("pool")
        if k: return (pools_lab.get(k) or {}).get("zh_TW", k)
        return row_pool.get(h) or "?"

    hosts = sorted({h for rep in reps for h in rep["rows"]} | {h for rep in reps for h in rep["failed"]})
    n = len(reps)
    S = {h: [state(rep, h) for rep in reps] for h in hosts}
    vec = {h: [x for _, x in S[h]] for h in hosts}
    Q = {h: [q_of(rep, h) for rep in reps] for h in hosts}

    # 線路
    lines = defaultdict(list)
    for i, rep in enumerate(reps): lines[rep["line"]].append(i)
    line_ids = list(lines)
    L = len(line_ids)
    asn_of_line = {l: reps[ix[0]]["asn"] for l, ix in lines.items()}
    wt = [1 / len(lines[rep["line"]]) for rep in reps]

    def wmean(xs, idx=None):
        idx = range(n) if idx is None else idx
        tw = sum(wt[i] for i in idx)
        return sum(xs[i] * wt[i] for i in idx) / tw if tw else 0.0

    # ISP 與市占
    isps = sorted({r["asn"] for r in reps})
    isp_name = {r["asn"]: r["isp"] for r in reps}
    as_name = {r["asn"]: r["as_name"] for r in reps}
    isp_lines = {a: [l for l in line_ids if asn_of_line[l] == a] for a in isps}
    isp_reps = {a: [i for i, r in enumerate(reps) if r["asn"] == a] for a in isps}
    share, share_name = {}, {}
    for a in isps:
        share[a], share_name[a] = share_lookup(share_cfg, a, isp_name[a])
        if share[a] is None: share[a] = 1.0 / len(isps)  # 沒有市占資料：一人一票
    for nm, cnt in Counter(v for v in share_name.values() if v).items():
        if cnt > 1:  # 同一家 ISP 對到多個 ASN（例如遠傳 + Seednet）：市占平分
            for a in isps:
                if share_name[a] == nm: share[a] /= cnt
    isp_order = sorted(isps, key=lambda a: (-share[a], -len(isp_lines[a]), a))
    total_share = sum(share.values())

    # 每節點 × 每線路：達標比例（該線路已知報告中 q ≥ PASS_Q 的比例）、達成度中位、速度中位；None = 該線路不知道
    def line_vals(h, l):
        """該線路對這個節點：達標比例（已知報告中 q ≥ PASS_Q 算 1、沒量到算 UNKNOWN_CREDIT）、已知／未知份數、速度、未達標的報告"""
        ks = [Q[h][i] for i in lines[l] if Q[h][i] is not None]
        n_all = len(lines[l])
        mb = [reps[i]["rows"][h]["mean"] if h in reps[i]["rows"] else reps[i]["partial"][h]["mean"]
              for i in lines[l] if h in reps[i]["rows"] or h in reps[i]["partial"]]  # 部分失敗：成功那幾支的平均
        return dict(pass_rate=(sum(q >= PASS_Q for q in ks) + UNKNOWN_CREDIT * (n_all - len(ks))) / n_all,
                    pass_min=sum(q >= PASS_Q for q in ks) / n_all,  # 未知算 0 的保守值
                    n_known=len(ks), n_unknown=n_all - len(ks),
                    mbps=statistics.median(mb) if mb else None,
                    fails=[reps[i]["rid"] for i in lines[l] if Q[h][i] is not None and Q[h][i] < PASS_Q])

    LV = {h: {l: line_vals(h, l) for l in line_ids} for h in hosts}

    def coverage(h, li):
        """li = 線路清單（重抽樣時可重複）→ (覆蓋率, 已知市占比例, 各 ISP {pass_rate, n_known, n_lines, n_unknown, fails})。
        覆蓋率 = Σ 市占 × 該 ISP 各線路達標比例的平均 ÷ Σ 有報告的 ISP 市占。
        該 ISP 有量到的線路中，沒量到的報告算 UNKNOWN_CREDIT（不知道好壞）；整個 ISP 都沒量到 → 0（不能證明它在那家 ISP 行）"""
        per, cov, cov_min, known = {}, 0.0, 0.0, 0.0
        tot = sum(share[a] for a in isps if any(asn_of_line[l] == a for l in li)) or 1
        for a in isps:
            ls = [l for l in li if asn_of_line[l] == a]
            if not ls: continue
            vals = [LV[h][l] for l in ls]
            nk = sum(v["n_known"] > 0 for v in vals)
            pr = statistics.mean(v["pass_rate"] for v in vals) if nk else 0.0
            pm = statistics.mean(v["pass_min"] for v in vals)
            per[a] = dict(pass_rate=pr, pass_min=pm, n_known=nk, n_lines=len(ls), n_unknown=sum(v["n_unknown"] for v in vals),
                          fails=[(l, LV[h][l]["fails"]) for l in ls if LV[h][l]["fails"]])
            cov += share[a] * pr
            cov_min += share[a] * pm
            if nk: known += share[a]
        per["_min"] = cov_min / tot
        return cov / tot, known / tot, per

    # 節點統計
    st = {}
    for h in hosts:
        tiers = [s for s, _ in S[h]]
        present = [rep["rows"][h] for rep in reps if h in rep["rows"]] + [rep["partial"][h] for rep in reps if h in rep["partial"]]
        lm = [LV[h][l]["mbps"] for l in line_ids if LV[h][l]["mbps"]]
        cov, known, per = coverage(h, line_ids)
        st[h] = dict(score=wmean(vec[h]), good_rate=wmean([t in GOOD for t in tiers]), cov_min=per.pop("_min"),
                     t1_rate=wmean([t == "第一梯隊" for t in tiers]),
                     n_unstable=tiers.count("不穩定"), n_hot=tiers.count("只能播熱門"),
                     n_fail=tiers.count("細測失敗") + tiers.count("快篩失敗"), n_absent=tiers.count("未進細測"),
                     n_partial=sum(t.startswith("部分失敗") for t in tiers),
                     miss_mbps=statistics.median([rep["miss_mbps"][h] for rep in reps if h in rep["miss_mbps"]]) if any(h in rep["miss_mbps"] for rep in reps) else None,
                     n_present=len(present),
                     mbps=statistics.mean(lm) if lm else None, mbps_min=min(lm) if lm else None,
                     ttfb=statistics.median(r["ttfb"] for r in present) if present else None,
                     cv=statistics.median(r["sd"] / r["mean"] for r in present if r["mean"]) if present else None,
                     cov=cov, known=known, per=per, cluster=cluster(h), pool_label=pool_label(h), in_opts=h in opts)
    banned = {h for h in hosts if st[h]["n_hot"]}  # 403 只能播熱門：冷門片直接播不了，一律不列

    def stable_issues(h):
        s, out = st[h], []
        if s["n_unstable"]: out.append(f"不穩定 {s['n_unstable']} 份")
        if s["n_fail"]: out.append(f"失敗 {s['n_fail']} 份")
        if s["n_partial"]: out.append(f"部分失敗 {s['n_partial']} 份")
        if s["cv"] is not None and s["cv"] > CV_MAX: out.append(f"速度波動大（sd/平均 {s['cv']:.2f}）")
        if s["ttfb"] is not None and s["ttfb"] > TTFB_MAX: out.append(f"TTFB {s['ttfb']:.0f} ms")
        return out

    for h in hosts: st[h]["issues"] = stable_issues(h)

    # ── 預設候選：覆蓋率 → 穩定 → 平均速度
    def rank_default(li):
        """→ (階段, [(host, cov, known, per)])。階段 'full' = 有節點在所有 ISP 的所有已知線路都達標；否則 'weighted'"""
        rows = []
        for h in hosts:
            if h in banned: continue
            cov, known, per = coverage(h, li)
            per.pop("_min", None)
            if known == 0: continue
            rows.append((h, cov, known, per))
        full = [r for r in rows if r[1] >= 0.999 and all(p["n_unknown"] == 0 for p in r[3].values())]
        stage = "full" if full else "weighted"
        cand = full if full else rows
        cand.sort(key=lambda r: (-round(r[1], 2), bool(st[r[0]]["issues"]), -(st[r[0]]["mbps"] or 0)))
        return stage, cand

    stage, cand = rank_default(line_ids)
    default = cand[0][0] if cand else None

    # ── ISP 內分級（比照單份報告：以該 ISP 分數最高的節點為基準，逐線路配對比較）
    lv = {h: {l: statistics.mean(vec[h][i] for i in lines[l]) for l in line_ids} for h in hosts}

    def tiers_for(li):
        m = len(li)
        sc = {h: sum(lv[h][l] for l in li) / m for h in hosts}
        ok = [h for h in hosts if h not in banned and sc[h] > 0]
        if not ok: return {h: "差" for h in hosts}, sc
        b = max(ok, key=lambda h: sc[h])
        tier = {}
        for h in hosts:
            if h in banned: tier[h] = "只能播熱門"; continue
            unst = sum(any(S[h][i][0] == "不穩定" for i in lines[l]) for l in li)
            pres = sum(any(h in reps[i]["rows"] for i in lines[l]) for l in li)
            if pres >= 2 and unst >= 0.5 * pres: tier[h] = "不穩定"; continue
            d = [lv[b][l] - lv[h][l] for l in li]
            se = statistics.stdev(d) / math.sqrt(m) if m > 1 else 0.0
            if sc[h] >= T1_MIN * sc[b] and sum(d) / m <= 2 * se + 1e-9: tier[h] = "第一梯隊"
            elif sc[h] >= 0.5 * sc[b]: tier[h] = "可用"
            else: tier[h] = "差"
        return tier, sc

    isp_tier, isp_sc = {}, {}
    for a in isps: isp_tier[a], isp_sc[a] = tiers_for(isp_lines[a])

    # ── 剩餘 9 個：依市占輪流從每個 ISP 的第一梯隊取最好的；同 ISP 內「冗餘」的不重複取；已選過的跳過
    def redundant(h, b, rep_ix):
        """對某家 ISP（rep_ix = 該 ISP 的報告索引），h 與已選的 b 是否冗餘 → (是否, 依據)。
        兩者都有結論的報告 ≥ REDUN_MIN_N 份：達標結論一致率 ≥ REDUN_AGREE 就是冗餘；
        不足：退回同機房前綴當先驗（同機房對同一 ISP 幾乎同表現，且不去重的代價大於去重錯的代價）"""
        both = [(Q[h][i] >= PASS_Q, Q[b][i] >= PASS_Q) for i in rep_ix if Q[h][i] is not None and Q[b][i] is not None]
        if len(both) >= REDUN_MIN_N:
            k = sum(x == y for x, y in both)
            pp = sum(x and y for x, y in both)
            if pp == 0:  # 兩者在這家 ISP 從沒同時達標過：「都不行」不算同一個東西，退回機房前綴
                same = cluster(h) == cluster(b)
                return same, f"{len(both)} 份都沒同時達標，用機房前綴" + ("（同機房）" if same else "")
            return k / len(both) >= REDUN_AGREE, f"達標結論一致 {k}/{len(both)}、同時達標 {pp} 份"
        same = cluster(h) == cluster(b)
        return same, f"共同量到只有 {len(both)} 份，用機房前綴" + ("（同機房）" if same else "")

    def pick_rest(dflt, order, tiers, scs, rep_ix, log=None):
        """冗餘比對的對象是清單裡所有已選節點（含預設、含別家 ISP 選的），判準用這家 ISP 自己的數據：
        對這家 ISP 來說，清單裡已經有一個等價的節點，再放一個就是浪費名額"""
        out, logged = [], set()
        chosen = [dflt] if dflt else []
        for t in ("第一梯隊", "可用"):
            rnd = 0
            while len(out) < TOP_N - 1:
                rnd += 1
                got = False
                for a in order:
                    if len(out) >= TOP_N - 1: break
                    ranked = sorted((h for h in hosts if tiers[a][h] == t), key=lambda h: (-scs[a][h], -(st[h]["mbps"] or 0)))
                    for h in ranked:
                        if h in chosen or h in banned: continue
                        dup = next(((b, why) for b in chosen for ok, why in [redundant(h, b, rep_ix[a])] if ok), None)
                        if dup:
                            if log is not None and (a, h) not in logged:
                                logged.add((a, h))
                                log.append((rnd, t, a, h, f"跳過：對 {a} 與清單已有的 `{short(dup[0])}` 冗餘（{dup[1]}）"))
                            continue
                        out.append(h); chosen.append(h); got = True
                        if log is not None: log.append((rnd, t, a, h, f"選入（{a} 第 {rnd} 輪，{t}，分數 {scs[a][h]:.2f}）"))
                        break
                if not got: break
        return out

    pick_log = []
    rest = pick_rest(default, isp_order, isp_tier, isp_sc, isp_reps, pick_log)
    nodes = ([default] if default else []) + rest

    # ── bootstrap：以線路重抽，看預設與清單的穩定度
    rng = random.Random(0)
    dflt_cnt, sel_cnt = Counter(), Counter()
    if L >= 2:
        for _ in range(BOOT):
            li = [line_ids[rng.randrange(L)] for _ in range(L)]
            _, c = rank_default(li)
            d = c[0][0] if c else None
            dflt_cnt[d] += 1
            present = {asn_of_line[l] for l in li}
            tiers, scs, rix = {}, {}, {}
            for a in present:
                al = [l for l in li if asn_of_line[l] == a]
                tiers[a], scs[a] = tiers_for(al)
                rix[a] = [i for l in al for i in lines[l]]
            sel_cnt.update(pick_rest(d, [a for a in isp_order if a in present], tiers, scs, rix))
            if d: sel_cnt[d] += 1
    boot = {h: sel_cnt[h] / BOOT for h in hosts} if L >= 2 else {h: float(h in nodes) for h in hosts}
    dflt_rate = {h: dflt_cnt[h] / BOOT for h in hosts} if L >= 2 else {h: float(h == default) for h in hosts}

    # ── 報告一致性（離群檢查）：各報告 vs「其他線路」的共識
    cons = []
    for i, rep in enumerate(reps):
        others = [j for j in range(n) if reps[j]["line"] != rep["line"]]
        if len({reps[j]["line"] for j in others}) < 2:
            cons.append(dict(rho=None, overlap=None)); continue
        oth = {h: wmean(vec[h], others) for h in hosts}
        rho = spearman([vec[h][i] for h in hosts], [oth[h] for h in hosts])
        own = [h for h in sorted(hosts, key=lambda h: -vec[h][i]) if h not in banned][:10]
        oth_top = [h for h in sorted(hosts, key=lambda h: -oth[h]) if h not in banned][:10]
        cons.append(dict(rho=rho, overlap=len(set(own) & set(oth_top))))

    return dict(hosts=hosts, S=S, vec=vec, Q=Q, st=st, LV=LV, lines=lines, line_ids=line_ids, L=L, asn_of_line=asn_of_line,
                isps=isps, isp_order=isp_order, isp_name=isp_name, as_name=as_name, isp_lines=isp_lines, isp_reps=isp_reps,
                share=share, share_name=share_name, total_share=total_share,
                stage=stage, cand=cand, default=default, isp_tier=isp_tier, isp_sc=isp_sc,
                rest=rest, nodes=nodes, pick_log=pick_log, boot=boot, dflt_rate=dflt_rate, banned=banned, cons=cons, wmean=wmean)


# ── 報告品質 ─────────────────────────────────────────────────
def quality_flags(rep):
    """(嚴重, 提示)。嚴重 = 量測本身有問題，自動排除"""
    hard, soft = [], []
    if rep["s1_passed"] is not None and rep["s1_passed"] < 30:
        hard.append(f"快篩只有 {rep['s1_passed']}/{rep['s1_n']} 個節點通過（多半是 DNS 或網路異常，不是節點本身慢）")
    if rep["ceiling"] and rep["ceiling"] < 30: hard.append(f"頻寬上限只有 {rep['ceiling']:.0f} Mbps")
    # 細測成功少但快篩正常：多半是這家網路對多數節點就是 403／逾時（例如台灣 TBC），是真實體驗，不排除，只提示排名基礎薄
    if rep["full"] < 15 and not hard: soft.append(f"細測只有 {rep['full']} 個節點全部成功，排名基礎薄（分級名次不可信，達標與否仍可用）")
    if rep["login"] is False: soft.append("未登入（只測到 ≤480P）")
    if rep["dns"]: soft.append(f"節點網域改用 {rep['dns']} 解析")
    if rep["conc"] and rep["conc_auto"] and rep["conc"] != rep["conc_auto"]:
        soft.append(f"並行數手動設為 {rep['conc']}（自動為 {rep['conc_auto']}）")
    if rep["contention"]: soft.append("第一名接近「上限 ÷ 並行數」，可能互搶頻寬")
    if rep["kind_fixed"]: soft.append(f"網路類型更正為「{rep['kind']}」（GUI 誤判）")
    return hard, soft


def test_hints(rep, reps_all):
    """量測設定的客觀事實（只列出，不判斷是不是測試；由 Claude 判讀後問使用者要不要刪）。
    只看量測設定本身：同一條線路短時間內重複多次、並行數手動改過、未登入。
    不同出口網段／網卡／城市 = 不同使用者，不是測試；細測成功少、403 多是網路的真實體驗，也不是測試"""
    out = []
    same = [r for r in reps_all if r["line"] == rep["line"] and r["rid"] != rep["rid"] and r["ts"] and rep["ts"]
            and abs((r["ts"] - rep["ts"]).total_seconds()) <= 86400]
    if len(same) >= 2: out.append(f"同線路 24 小時內另有 {len(same)} 份")
    if rep["conc"] and rep["conc_auto"] and rep["conc"] != rep["conc_auto"]: out.append("並行數手動設定")
    if rep["login"] is False: out.append("未登入")
    return out


# ── 報告 ─────────────────────────────────────────────────────
def fmt(x, d=0, suf=""):
    return "-" if x is None else f"{x:.{d}f}{suf}"


def pct(x): return "-" if x is None else f"{x * 100:.0f}%"


def write(cc, reps_all, excluded, reps, A, cdn, share_cfg, out_dir):
    st, n, NL = A["st"], len(reps), A["L"]
    isp_name, as_name, share = A["isp_name"], A["as_name"], A["share"]
    cname = next((c for c in cdn.get("countries", []) if c["code"] == cc), None)
    current = cname["nodes"] if cname else []
    out = []
    w = out.append
    now = datetime.now()

    def isp_lab(a, n_=28):
        nm = A["share_name"].get(a)
        return f"{a} {(nm or isp_name[a])[:n_]}"

    w(f"# {cc} CDN 節點跨報告分析（{now:%Y-%m-%d %H:%M}）\n")
    w(f"> 自動產生：`.claude/skills/analyze-cdn/analyze.py`。納入 {n} 份（{NL} 條線路、{len(A['isps'])} 家 ISP）、排除 {len(excluded)} 份。"
      "「判讀」一節由 Claude 讀完數據後補寫。**本報告不改任何專案檔案**；要不要更新 `src/cdn-list.json`、要不要刪除異常報告，都由你決定。\n")
    w("「線路」= 同 ISP 且同出口 IP（或同網段、同網卡）的報告視為同一條線路的重複測試，合起來算 1 個樣本。"
      f"「達標」= 單連線平均速度 ≥ {PASS_Q:.0%} × min({FOURK_MBPS} Mbps, 該報告最快穩定節點)，也就是跑得動 4K；"
      "不穩定（sd > 平均一半）、細測失敗、快篩失敗、只能播熱門（403）都算不達標；沒進細測又沒有快篩失敗紀錄 = 不知道（不算好也不算壞）。\n")

    # 1. 樣本與市占
    w("## 1. 樣本與 ISP 市占\n")
    lvl = ("**樣本不足**（< 3 條線路）：結論幾乎等於單次量測，仍給建議，但要當參考" if NL < 3 else
           "**樣本偏少**（3–5 條線路）：前段大致可信，後段名次容易變動" if NL < 6 else
           "**樣本尚可**（≥ 6 條線路）")
    w(f"- {lvl}。")
    if n > NL: w(f"- {n - NL} 份是同一條線路的重複測試（已合併）。")
    nf = sum(r["new_fmt"] for r in reps)
    if nf: w(f"- {nf} 份是新版報告（有 `stage1.nodes`／`stage2.raw`）：快篩通過的節點全部細測、有失敗的節點也有逐筆紀錄，"
             f"所以沒有「未知」、可以區分「部分失敗」；其餘 {n - nf} 份是舊版，退回原本的判讀方式。")
    peak = sum(r["hour"] in PEAK for r in reps if r["hour"] is not None)
    w(f"- 測試時段：晚間尖峰（19–24 時）{peak} 份、其他 {n - peak} 份。" + ("**沒有尖峰樣本**。" if peak == 0 else ""))
    kinds = Counter(r["kind"] for r in reps)
    w("- 網路類型：" + "、".join(f"{k}（{v}）" for k, v in kinds.most_common()) + "；城市：" +
      "、".join(f"{k}（{v}）" for k, v in Counter(r["city"] for r in reps).most_common()))
    if share_cfg:
        w(f"- 市占資料：`isp-share.json` {cc}（{share_cfg.get('asof', '?')}）。來源：" + "；".join(share_cfg.get("sources", [])))
        if share_cfg.get("asof") and share_cfg["asof"][:4].isdigit() and now.year - int(share_cfg["asof"][:4]) >= 2:
            w("  - ⚠ 市占資料超過 2 年，建議先 WebSearch 更新。")
    else:
        w(f"- ⚠ `isp-share.json` 沒有 {cc} 的市占資料，各 ISP 暫以相同權重計算。**請先 WebSearch 補齊再重跑**，覆蓋率才有意義。")
    w("")
    w("| ISP（ASN） | 市占 | 市占對應 | 報告／線路 | 樣本 | 城市 |")
    w("|---|---|---|---|---|---|")
    for a in A["isp_order"]:
        nl = len(A["isp_lines"][a])
        lv_ = "不足" if nl < 3 else "偏少" if nl < 6 else "尚可"
        nm = A["share_name"].get(a)
        w(f"| {a} {isp_name[a][:30]}" + (f"〔{as_name[a][:24]}〕" if as_name[a] and as_name[a].lower() not in isp_name[a].lower() else "") +
          f" | {pct(share[a])} | {nm or ('⚠ 未對應，用 other_each' if share_cfg else '無市占資料，等權重')} | {len(A['isp_reps'][a])}／{nl} | {lv_} | " +
          "、".join(k for k, _ in Counter(reps[i]["city"] for i in A["isp_reps"][a]).most_common(3)) + " |")
    w(f"\n有報告的 ISP 市占合計 {pct(A['total_share'])}（覆蓋率的分母）。")
    if share_cfg:
        missing = [x["name"] for x in share_cfg.get("isps", []) if x["name"] not in A["share_name"].values()]
        if missing: w("沒有報告的主要 ISP：" + "、".join(missing) + "（這些使用者的體驗完全未知，是最值得補的樣本）。")
    w("")

    # 2. 報告清單
    w("## 2. 報告清單、異常與量測設定\n")
    w("「相關」= 這份報告的節點分數與其他線路共識的 Spearman 相關；「重疊」= 自己的前 10 與共識前 10 重疊幾個（ISP 偏好不同時重疊本來就低，只供參考）。"
      "⛔ = 量測本身壞掉，已自動排除；「量測設定提示」只是客觀事實（並行數手動、未登入、同線路短時間重複），腳本不下「是不是測試」的結論，**由 Claude 對照 REPORT.md 判讀後問使用者要不要刪除資料夾**。\n")
    idx = {r["rid"]: i for i, r in enumerate(reps)}
    rhos = [c["rho"] for c in A["cons"] if c["rho"] is not None]
    cut = 0.2
    if rhos:
        med = statistics.median(rhos)
        mad = statistics.median(abs(x - med) for x in rhos) * 1.4826
        cut = max(min(med - 2 * mad, med - 0.15), 0.2)  # 比中位數低 2 個 MAD 以上、或低於 0.2 就算離群
    w(f"報告間一致性：相關中位數 {fmt(statistics.median(rhos) if rhos else None, 2)}；離群 = 相關 < {cut:.2f}。\n")
    w("| 報告 | 線路 | 時間 | ISP | 城市 | 網路 | 上限 | 並行 | 細測成功 | 相關 | 重疊 | 狀態 | 量測設定提示 |")
    w("|---|---|---|---|---|---|---|---|---|---|---|---|---|")

    def outlier_kind(i):
        r, c = reps[i], A["cons"][i]
        peers = [j for j, x in enumerate(reps) if x["asn"] == r["asn"] and x["line"] != r["line"]]
        if not peers: return "unknown", "無法判斷（這個 ISP 只有這一條線路）"
        pr = statistics.mean(spearman([A["vec"][h][i] for h in A["hosts"]], [A["vec"][h][j] for h in A["hosts"]]) for j in peers)
        if pr >= c["rho"] + 0.1: return "isp", f"**ISP 通案**（與同 ISP 其他線路的相關 {pr:.2f} 明顯高於與整體 {c['rho']:.2f}；代表該 ISP 的真實體驗，不要排除）"
        return "single", f"**個案**（同 ISP 其他線路不這樣，相關 {pr:.2f}）"

    ask_delete = []
    for r in sorted(reps_all, key=lambda r: r["time"]):
        hard, soft = quality_flags(r)
        hints = test_hints(r, reps_all)
        c = A["cons"][idx[r["rid"]]] if r["rid"] in idx else {}
        rho = c.get("rho")
        outl = rho is not None and rho < cut
        okind = outlier_kind(idx[r["rid"]])[0] if outl else None
        stt = "**排除**" if r["rid"] in excluded else ("離群" if outl else "納入")
        if r["rid"] in excluded or hints or (outl and okind != "isp"): ask_delete.append((r, hard, hints, outl))
        notes = [f"⛔ {x}" for x in hard] + [f"設定：{x}" for x in hints] + soft
        w(f"| {r['rid']} | {r['line']} | {r['time'][5:]} | {r['asn']} {r['isp'][:18]} | {r['city']} | {r['kind'][:4]} | {r['ceiling']:.0f} | "
          f"{r['conc']}{'' if r['conc'] == r['conc_auto'] or not r['conc_auto'] else '手'} | {r['full']}{'（+' + str(len(r['partial'])) + ' 部分）' if r['partial'] else ''} | {fmt(rho, 2)} | {fmt(c.get('overlap'))} | {stt} | "
          + "；".join(notes) + " |")
    w("")
    w("### 要問使用者的報告（已排除、量測設定特殊、個案離群）\n")
    w("「ISP 通案」的離群不列在這裡：那是該 ISP 使用者的真實體驗，要保留。\n")
    if not ask_delete: w("沒有異常或量測設定特殊的報告。")
    for r, hard, hints, outl in ask_delete:
        why = []
        if r["rid"] in excluded: why.append(f"已排除：{excluded[r['rid']]}")
        if hints: why.append("量測設定：" + "、".join(hints))
        if outl:
            c = A["cons"][idx[r["rid"]]]
            why.append(f"離群（相關 {c['rho']:.2f}、前 10 重疊 {c['overlap']}）→ {outlier_kind(idx[r['rid']])[1]}")
        w(f"- **{r['rid']}**（{r['line']}，{r['time']}，{r['asn']} {r['isp']}，{r['city']}）：" + "；".join(why))
        w(f"  - 資料夾：`{r['dir'].replace(os.sep, '/')}`")
    w("")

    # 3. 預設候選
    w("## 3. 預設節點候選\n")
    w("**目標**：在還沒有「依 ISP 選節點」之前，讓使用者剛安裝時預設就能順暢播 4K 的機率最大。"
      "**覆蓋率** = Σ（ISP 市占 × 該 ISP 各線路達標比例的平均）÷ Σ（有報告的 ISP 市占）。每份報告達標算 1、不達標算 0、"
      f"沒進細測但有快篩速度的用快篩速度判斷（弱證據）、完全沒量到的算 {UNKNOWN_CREDIT}（不知道好壞，且只在該 ISP 至少有一條線路量到時才給；整個 ISP 都沒量到算 0）。"
      "同一線路多份報告取平均，所以單筆極端值只佔該線路的一部分，不會直接否決。"
      "「已知」欄 = 至少量到一條線路的 ISP 市占合計。注意第 4 節的分級分數把沒進細測算 0（與單份報告一致），所以同一節點可能「覆蓋率高、該 ISP 分級卻是差」，"
      "代表它在該 ISP 常常沒進細測，要靠補樣本（新版 GUI 的快篩會記錄所有節點）釐清。\n")
    if A["stage"] == "full":
        w(f"**第一步成立**：有節點在所有 ISP 的所有報告都達標、沒有未知（覆蓋 100%）。以下候選先排沒有穩定疑慮的，再依平均速度排序。\n")
    else:
        w("**第一步不成立**：沒有節點在所有 ISP 都達標。改依覆蓋率排序（市占高的 ISP 權重大），同覆蓋率者先排沒有穩定疑慮的、再依平均速度。"
          "預設對覆蓋不到的 ISP 使用者會慢或連不上，要靠擴充第一支影片的自動測速換掉。\n")
    w(f"穩定條件：無「不穩定」與「失敗」紀錄、速度波動（sd/平均中位）≤ {CV_MAX}、TTFB ≤ {TTFB_MAX} ms。「當預設比例」= 以線路重抽樣 {BOOT} 次時它被選為第 1 的比例。\n")
    ord_ = A["isp_order"]
    w("| # | 節點 | 機房 | 覆蓋率 | 保守覆蓋 | 已知 | " + "".join(f"{a} | " for a in ord_) + "平均 Mbps | 最低線路 Mbps | 冷門片 Mbps | TTFB | 穩定疑慮 | 當預設比例 | 目前清單 |")
    w("|---|---|---|---|---|---|" + "---|" * len(ord_) + "---|---|---|---|---|---|---|")
    for i, (h, cov, known, per) in enumerate(A["cand"][:10], 1):
        s = st[h]
        cells = ""
        for a in ord_:
            p = per.get(a)
            cells += ("- | " if not p else f"{pct(p['pass_rate'])}（{p['n_known']}/{p['n_lines']}" + (f"，未知 {p['n_unknown']}" if p["n_unknown"] else "") + "） | ")
        cur = f"#{current.index(h) + 1}" if h in current else "—"
        w(f"| {i} | `{short(h)}`{' ⭐' if h == A['default'] else ''} | {s['cluster']} | **{pct(cov)}** | {pct(s['cov_min'])} | {pct(known)} | {cells}"
          f"{fmt(s['mbps'])} | {fmt(s['mbps_min'])} | {fmt(s['miss_mbps'])} | {fmt(s['ttfb'])} | {'、'.join(s['issues']) or '無'} | {pct(A['dflt_rate'][h])} | {cur} |")
    w("\n「保守覆蓋」= 沒量到的報告一律算 0 時的覆蓋率，只計有實證達標的部分；覆蓋率與保守覆蓋差距大，代表這個節點靠「未知」撐場。"
      "「冷門片 Mbps」= 新版報告逐筆紀錄中 cache miss 那幾支的平均（舊版沒有，顯示 -），比整體平均更接近看冷門影片的體驗。"
      "各 ISP 欄：達標比例（有量到的線路數／該 ISP 線路數，未知 = 沒量到的報告份數）。\n")
    w("### 入選原因與未達標明細\n")
    for i, (h, cov, known, per) in enumerate(A["cand"][:5], 1):
        s = st[h]
        okisp = [a for a in ord_ if per.get(a) and per[a]["pass_rate"] >= 0.999]
        w(f"{i}. **`{short(h)}`**（{s['pool_label']}）：覆蓋 {pct(cov)}；全部達標的 ISP：" +
          ("、".join(isp_lab(a, 14) for a in okisp) or "無") +
          f"；平均 {fmt(s['mbps'])} Mbps（最慢線路 {fmt(s['mbps_min'])}）、TTFB {fmt(s['ttfb'])} ms" +
          ("；穩定疑慮：" + "、".join(s["issues"]) if s["issues"] else "；無不穩定／失敗紀錄"))
        for a in ord_:
            p = per.get(a)
            if not p: continue
            if p["n_known"] == 0:
                w(f"   - {isp_lab(a, 14)}：{p['n_lines']} 條線路都沒量到 → 算 0"); continue
            if p["fails"] or p["n_unknown"]:
                det = []
                for l, rids in p["fails"]:
                    lvv = A["LV"][h][l]
                    tag = ("單筆波動（同線路其他報告達標）" if lvv["n_known"] > len(rids) else
                           "線路個案（同 ISP 其他線路達標）" if len(p["fails"]) == 1 and p["n_known"] >= 2 else "")
                    det.append(f"{l}：" + "、".join(f"{rid}（{A['S'][h][idx[rid]][0]}）" for rid in rids) + (f" → {tag}" if tag else ""))
                if p["n_unknown"]: det.append(f"沒量到 {p['n_unknown']} 份（算 {UNKNOWN_CREDIT}）")
                w(f"   - {isp_lab(a, 14)} 達標 {pct(p['pass_rate'])}：" + "；".join(det))
    w("")

    # 4. 各 ISP 第一梯隊與輪取
    w("## 4. 剩餘 9 個節點：各 ISP 輪取\n")
    w("每家 ISP 只用自己的線路分級（以該 ISP 分數最高的節點為基準，差距在 2 倍標準誤內且分數 ≥ 基準 80% → 第一梯隊；≥ 一半 → 可用）。"
      "依市占順序輪流取每家第一梯隊中最好的一個，再取第二好的，直到 9 個；已被選過的跳過；第一梯隊取完才用「可用」補。\n")
    w(f"**同一 ISP 內冗餘的不重複取**：兩個節點在該 ISP 的報告裡達標結論一致率 ≥ {REDUN_AGREE:.0%}（兩者都有結論的報告 ≥ {REDUN_MIN_N} 份）就視為冗餘，只取一個；"
      "比對對象是清單裡所有已選節點（含預設與別家 ISP 選的），判準用這家 ISP 自己的數據。共同量到的報告不足時，退回「同機房」（cn-*／ec-* 去末碼的前綴）當先驗：同機房對同一家 ISP 走同一條路徑，表現幾乎相同；"
      "不去重會把名額花在等價節點上，去重錯了只是改取同梯隊的另一個，代價不對稱。"
      "全國層面**不用**機房分池：跨報告真正一起好一起壞的是 ISP 陣營（不同機房的 cn-hbwh／cn-sdjn／cn-bj-se 在台灣 100% 同好同壞），由每個 ISP 都取到來保證多樣性。\n")
    w("### 各 ISP 第一梯隊（前 6）\n")
    for a in ord_:
        t, sc = A["isp_tier"][a], A["isp_sc"][a]
        t1 = sorted((h for h in A["hosts"] if t[h] == "第一梯隊"), key=lambda h: -sc[h])
        nl = len(A["isp_lines"][a])
        w(f"- {isp_lab(a)}（{nl} 條線路，市占 {pct(share[a])}）：" +
          ("、".join(f"`{short(h)}` {sc[h]:.2f}" for h in t1[:6]) or "無") + (f"（共 {len(t1)} 個）" if len(t1) > 6 else ""))
    w("\n### 輪取過程\n")
    for rnd, t, a, h, why in A["pick_log"]:
        w(f"- {isp_lab(a, 14)} → `{short(h)}`：{why}")
    if len(A["rest"]) < TOP_N - 1:
        w(f"\n⚠ 第一梯隊與可用都取完仍只有 {len(A['rest'])} 個，清單不足 {TOP_N} 個。")
    w("")

    # 5. 清單
    w(f"## 5. 建議清單（{len(A['nodes'])} 個，第 1 個是預設）\n")
    w("| # | 節點 | 機房 | CDN 池 | 來自 | 覆蓋率 | " + "".join(f"{a} 分級 | " for a in ord_) + "平均 Mbps | TTFB | 入選率 | 目前清單 |")
    w("|---|---|---|---|---|---|" + "---|" * len(ord_) + "---|---|---|---|")
    src = {h: f"{a} 第 {rnd} 輪" for rnd, t, a, h, why in A["pick_log"] if why.startswith("選入")}
    for i, h in enumerate(A["nodes"], 1):
        s = st[h]
        cur = f"#{current.index(h) + 1}" if h in current else "新增"
        cells = "".join(f"{A['isp_tier'][a][h][:2]} | " for a in ord_)
        w(f"| {i} | `{h}`{' ⭐' if h == A['default'] else ''} | {s['cluster']} | {s['pool_label']} | {'預設' if h == A['default'] else src.get(h, '')} | "
          f"{pct(s['cov'])} | {cells}{fmt(s['mbps'])} | {fmt(s['ttfb'])} | {pct(A['boot'][h])} | {cur} |")
    w("\n入選率 = 以線路重抽樣時仍進清單的比例（< 50% 代表再多幾條線路就可能換人）。\n")
    # 覆蓋：每家 ISP 在清單裡最好的節點
    w("### 清單對各 ISP 的照顧\n")
    w("| ISP | 清單中第一梯隊數 | 清單中最佳節點（該 ISP 分數） | 目前清單最佳 |")
    w("|---|---|---|---|")
    for a in ord_:
        t, sc = A["isp_tier"][a], A["isp_sc"][a]
        inl = [h for h in A["nodes"] if h in sc]
        best = max(inl, key=lambda h: sc[h]) if inl else None
        curb = [h for h in current if h in sc]
        cb = max(curb, key=lambda h: sc[h]) if curb else None
        w(f"| {isp_lab(a)} | {sum(t[h] == '第一梯隊' for h in inl)} | " +
          (f"`{short(best)}` {sc[best]:.2f}（{t[best]}）" if best else "-") + " | " +
          (f"`{short(cb)}` {sc[cb]:.2f}（{t[cb]}）" if cb else "-") + " |")
    w("")
    miss = [h for h in A["nodes"] if not st[h]["in_opts"]]
    if miss: w("⚠ 不在 `cdn-list.json` 的 `options` 裡，更新時要一併新增：" + "、".join(f"`{h}`" for h in miss) + "\n")

    # 6. 與目前清單比較
    w("## 6. 與目前 `src/cdn-list.json` 比較\n")
    if not cname:
        w(f"`cdn-list.json` 還沒有 {cc} 這個國家。新增時要補 `dial`（國際電話區碼）與五語 `name`。\n")
    else:
        w("| 目前 # | 節點 | 覆蓋率 | 平均 Mbps | 建議 |")
        w("|---|---|---|---|---|")
        for i, h in enumerate(current, 1):
            s = st.get(h)
            if not s:
                w(f"| {i} | `{h}` | - | - | 移除？（沒有任何報告量到） |"); continue
            v = "保留" if h in A["nodes"] else ("移除（只能播熱門）" if h in A["banned"] else "移除")
            if h == A["default"]: v += "（建議預設）"
            elif i == 1 and A["default"]: v += "，不再當預設"
            w(f"| {i} | `{h}` | {pct(s['cov'])} | {fmt(s['mbps'])} | {v} |")
        add = [h for h in A["nodes"] if h not in current]
        w("\n新增：" + ("、".join(f"`{h}`" for h in add) if add else "無") + "\n")

    w("## 7. 判讀\n")
    w("<!-- CLAUDE: 依第 1–6 節寫結論：預設與理由、要問使用者刪不刪的報告、極端值的處置、各 ISP 是否都有照顧到、樣本缺口。 -->\n")

    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.join(out_dir, f"{cc}-{now:%Y%m%d-%H%M}")
    open(stem + ".md", "w", encoding="utf-8").write("\n".join(out))
    json.dump(dict(country=cc, generated=f"{now:%Y-%m-%d %H:%M}", n_reports=n, n_lines=NL,
                   included=[r["rid"] for r in reps], excluded=excluded,
                   ask_delete=[dict(rid=r["rid"], dir=r["dir"].replace(os.sep, "/"), excluded=r["rid"] in excluded, hints=hints, outlier=outl)
                               for r, hard, hints, outl in ask_delete],
                   stage=A["stage"], default=A["default"],
                   default_candidates=[dict(host=h, coverage=round(cov, 3), coverage_min=round(st[h]["cov_min"], 3), known=round(known, 3), mbps=st[h]["mbps"],
                                            issues=st[h]["issues"], boot=round(A["dflt_rate"][h], 3)) for h, cov, known, per in A["cand"][:10]],
                   nodes=A["nodes"], current=current, not_in_options=miss,
                   isp_share={a: dict(share=share[a], name=A["share_name"].get(a), lines=len(A["isp_lines"][a])) for a in A["isps"]}),
              open(stem + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return stem + ".md"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("country")
    ap.add_argument("--root", default="cdn-speedtest-results")
    ap.add_argument("--cdn-list", default="src/cdn-list.json")
    ap.add_argument("--exclude", default="")
    ap.add_argument("--include", default="")
    ap.add_argument("--out")
    a = ap.parse_args()
    cc = a.country.upper()
    reps_all = load_reports(a.root, cc)
    if not reps_all: sys.exit(f"{a.root}/{cc} 底下沒有報告")
    cdn = json.load(open(a.cdn_list, encoding="utf-8"))
    man_ex = {x.strip() for x in a.exclude.split(",") if x.strip()}
    man_in = {x.strip() for x in a.include.split(",") if x.strip()}
    excluded = {}
    for r in reps_all:
        hard, _ = quality_flags(r)
        if r["rid"] in man_ex: excluded[r["rid"]] = "人工排除"
        elif hard and r["rid"] not in man_in: excluded[r["rid"]] = "量測本身有問題：" + "；".join(hard)
    reps = [r for r in reps_all if r["rid"] not in excluded]
    if not reps: sys.exit("全部報告都被排除")
    share_cfg = load_share(cc)
    A = analyze(reps, cdn, cc, share_cfg)
    md = write(cc, reps_all, excluded, reps, A, cdn, share_cfg, a.out or os.path.join(a.root, "_analysis"))
    print(f"{cc}：納入 {len(reps)} 份（{A['L']} 條線路）、排除 {len(excluded)} 份；市占資料：{'有' if share_cfg else '無（等權重）'}")
    for rid, why in excluded.items(): print(f"  排除 {rid}：{why}")
    print(f"預設階段：{'第一步（全 ISP 達標）' if A['stage'] == 'full' else '退路（市占加權覆蓋率）'}  預設：{A['default']}")
    for i, h in enumerate(A["nodes"], 1):
        s = A["st"][h]
        print(f"  {i:2} {h:42} 覆蓋 {s['cov']:.0%} 平均 {fmt(s['mbps'])} Mbps 入選率 {A['boot'][h]:.0%}")
    print("OUTPUT", md)


if __name__ == "__main__":
    main()
