# 跨報告分析某國家的 CDN 測速結果：國家特徵、離群報告／極端值（個案還是通案）、樣本是否足夠，
# 以及依 CDN 池分散的建議前 10 名與預設節點。只用 Python 標準函式庫，不改任何專案檔案。
#
# 用法（在 repo 根目錄執行）：
#   python -I analyze.py <國家代碼> [--root cdn-speedtest-results] [--cdn-list src/cdn-list.json]
#                        [--exclude rid,...] [--include rid,...] [--out <目錄>]
#
# 輸出 <out>/<國家>-<yyyymmdd-HHMM>.md（分析報告）與同名 .json（建議清單，給之後更新 cdn-list.json 用），
# 最後一行印 OUTPUT <md 路徑>。--out 預設 <root>/_analysis（gitignored）。報告不含出口 IP。
#
# --exclude：人工判斷後要排除的報告編號（rid）；--include：強制納入被自動排除的報告。
import argparse, glob, json, math, os, random, re, statistics, sys
from collections import Counter, defaultdict
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")

GOOD = ("第一梯隊", "可用")
TOP_N, PER_POOL, BOOT = 10, 2, 1000
T1_MIN = 0.8  # 跨報告第一梯隊：分數至少要有基準節點的 80%
MAJOR_LINES = 3  # 幾條線路以上的 ISP 單獨成群
OTHER = "其他"
PEAK = range(19, 24)  # 當地晚間尖峰
# 重新判斷網路類型：GUI 舊版用「LTE」比對網卡名稱，會把「Realtek」有線網卡誤判成行動網路
MOBILE_AD = re.compile(r"Remote NDIS|Mobile Broadband|WWAN|Cellular|\bLTE\b|Android|iPhone|Apple Mobile", re.I)
WIFI_AD = re.compile(r"802\.11|Wireless|Wi-?Fi|WLAN", re.I)
WIRED_AD = re.compile(r"802\.3|Ethernet|乙太|GbE|Gigabit|\bI2\d\d", re.I)


# ── 讀取 ─────────────────────────────────────────────────────
def net_kind(n):
    kind, ad = n.get("kind") or "未知", n.get("adapter") or ""
    if not ad: return kind, False
    fixed = ("行動網路" if MOBILE_AD.search(ad) else "Wi-Fi" if WIFI_AD.search(ad) else
             "有線" if WIRED_AD.search(ad) else kind)
    if fixed.startswith("行動") and kind.startswith("行動"): fixed = kind
    return fixed, fixed != kind and not (fixed.startswith("行動") and kind.startswith("行動"))


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
        reps.append(dict(
            rid=base.rsplit("-", 1)[1], base=base, time=t,
            hour=int(t[11:13]) if re.match(r"\d{4}-\d\d-\d\d \d\d", t) else None,
            city=ex.get("city") or ipapi.get("city") or "?", asn=asn,
            isp=ipapi.get("isp") or org.partition(" ")[2] or org, as_name=org.partition(" ")[2] if org.startswith("AS") else "",
            kind=kind, kind_fixed=kind_fixed, ipapi_mobile=ipapi.get("mobile"),
            down=(env.get("bandwidth") or {}).get("down_mbps"), ceiling=d.get("ceiling") or 0,
            conc=d.get("conc"), conc_auto=d.get("conc_auto"), contention=d.get("contention_warning"),
            dns=env.get("dns_override"), login=env.get("login"),
            s1_n=(d.get("stage1") or {}).get("n_nodes"), s1_passed=(d.get("stage1") or {}).get("passed"),
            s2_n=(d.get("stage2") or {}).get("n_nodes"), full=(d.get("stage2") or {}).get("full_success") or 0,
            rows={r["host"]: r for r in rows}, ref=top_stable(rows),
            failed=d.get("failed") or {}, hot_only=set(d.get("hot_only") or []),
            default=d.get("default"), _ip=ex.get("ip") or "", _adapter=(env.get("network") or {}).get("adapter") or ""))
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


# ── 單份報告中的節點狀態 → 分數 ─────────────────────────────────
def state(rep, host):
    """(狀態, 分數 0–1)。第一梯隊 = 1（梯隊內名次不可信，不再細分）；可用／差 = 平均 ÷ 該報告基準；
    不穩定 = 一半（快取命中才快，冷門片會卡）；細測失敗／只能播熱門／沒通過快篩 = 0"""
    r = rep["rows"].get(host)
    if r:
        if r["tier"] == "第一梯隊": return r["tier"], 1.0
        rel = min(r["mean"] / rep["ref"], 1.0)
        return r["tier"], rel * (0.5 if r["tier"] == "不穩定" else 1)
    if host in rep["hot_only"]: return "只能播熱門", 0.0
    if host in rep["failed"]: return "細測失敗", 0.0
    return "未進細測", 0.0


def wilson_lb(k, n, z=1.96):
    if not n: return 0.0
    p = k / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


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


# ── 依分數取前 10（每池最多 2 個；一致性檢查用） ─────────────────
def pick(order, pool, banned):
    cnt, out = Counter(), []
    for h in order:
        if len(out) >= TOP_N: break
        if h in banned or cnt[pool(h)] >= PER_POOL: continue
        cnt[pool(h)] += 1
        out.append(h)
    return out


# ── 分析 ─────────────────────────────────────────────────────
def analyze(reps, cdn, cc, primary=None):
    opts = {o["value"]: o for o in cdn.get("options", []) if o.get("value") != "backup"}
    pools_lab = cdn.get("pools", {})
    row_pool = {}
    for rep in reps:
        for h, r in rep["rows"].items(): row_pool.setdefault(h, (r.get("pool"), r.get("pool_label")))

    def pool(h):
        return (opts.get(h) or {}).get("pool") or row_pool.get(h, (h,))[0] or h

    def pool_label(h):
        k = (opts.get(h) or {}).get("pool")
        if k: return (pools_lab.get(k) or {}).get("zh_TW", k)
        return row_pool.get(h, (None, h))[1] or h

    hosts = sorted({h for rep in reps for h in rep["rows"]})
    n = len(reps)
    S = {h: [state(rep, h) for rep in reps] for h in hosts}  # 每節點 × 每份報告
    vec = {h: [x for _, x in S[h]] for h in hosts}
    # 權重：同一條線路的多份報告合起來算 1 份（先平均再參與計算）
    lines = defaultdict(list)
    for i, rep in enumerate(reps): lines[rep["line"]].append(i)
    wt = [1 / len(lines[rep["line"]]) for rep in reps]
    L = len(lines)

    def wmean(xs, idx=None):
        idx = range(n) if idx is None else idx
        tw = sum(wt[i] for i in idx)
        return sum(xs[i] * wt[i] for i in idx) / tw if tw else 0.0

    st = {}
    for h in hosts:
        tiers = [s for s, _ in S[h]]
        present = [rep["rows"][h] for rep in reps if h in rep["rows"]]
        good_rate = wmean([t in GOOD for t in tiers])
        st[h] = dict(score=wmean(vec[h]), good_rate=good_rate, good_lb=wilson_lb(good_rate * L, L),
                     t1_rate=wmean([t == "第一梯隊" for t in tiers]), n_unstable=tiers.count("不穩定"),
                     n_hot=tiers.count("只能播熱門"), n_fail=tiers.count("細測失敗"), n_absent=tiers.count("未進細測"),
                     mbps=statistics.median(r["mean"] for r in present) if present else None,
                     ttfb=statistics.median(r["ttfb"] for r in present) if present else None,
                     cv=statistics.median(r["sd"] / r["mean"] for r in present if r["mean"]) if present else None,
                     pool=pool(h), pool_label=pool_label(h), in_opts=h in opts)
    banned = {h for h in hosts if st[h]["n_hot"]}  # 403 只能播熱門：冷門片會直接播不了，不列入
    order = sorted(hosts, key=lambda h: (-st[h]["score"], -st[h]["good_lb"], st[h]["ttfb"] or 1e9))

    # ── 線路層級的資料（分級、重抽樣都以線路為單位）
    line_ids = list(lines)
    lv = {h: [statistics.mean(vec[h][i] for i in lines[l]) for l in line_ids] for h in hosts}
    unst_l = {h: {k for k, l in enumerate(line_ids) if any(S[h][i][0] == "不穩定" for i in lines[l])} for h in hosts}
    pres_l = {h: {k for k, l in enumerate(line_ids) if any(h in reps[i]["rows"] for i in lines[l])} for h in hosts}
    # 跨報告「不穩定」：進了細測的線路中，一半以上是不穩定（快取命中才快）
    agg_unstable = {h for h in hosts if len(pres_l[h]) >= 2 and len(unst_l[h]) >= 0.5 * len(pres_l[h])}

    def tiers_for(li):
        """li = 線路索引（重抽樣時可重複）→ (跨報告分級, 分數)。比照單份報告的分級：
        以分數最高的節點為基準（排除只能播熱門、跨報告不穩定），逐線路配對比較：
        平均差距在 2 倍標準誤內、且分數 ≥ 基準 T1_MIN 倍 → 第一梯隊（後者避免「某 ISP 極好、其他 ISP 為 0」
        這種變異大的節點只因標準誤大就混進第一梯隊）；分數 ≥ 基準一半 → 可用；其餘 → 差"""
        m = len(li)
        sc = {h: sum(lv[h][k] for k in li) / m for h in hosts}
        ok = [h for h in hosts if h not in banned and h not in agg_unstable and sc[h] > 0]
        tier = {}
        if not ok: return {h: "差" for h in hosts}, sc
        b = max(ok, key=lambda h: sc[h])
        for h in hosts:
            if h in banned: tier[h] = "只能播熱門"; continue
            if h in agg_unstable: tier[h] = "不穩定"; continue
            d = [lv[b][k] - lv[h][k] for k in li]
            se = statistics.stdev(d) / math.sqrt(m) if m > 1 else 0.0
            if sc[h] >= T1_MIN * sc[b] and sum(d) / m <= 2 * se + 1e-9: tier[h] = "第一梯隊"
            elif sc[h] >= 0.5 * sc[b]: tier[h] = "可用"
            else: tier[h] = "差"
        return tier, sc

    # ── 分群：每家主要 ISP（≥ MAJOR_LINES 條線路）一群，其餘線路合併成「其他」。各群自己分級，再取聯集：
    #    在任一群是第一梯隊 → 第一梯隊；否則任一群可用 → 可用。這樣「對某群使用者是第一梯隊」的節點不會被別群的 0 分拉下來
    asn_of = [reps[lines[l][0]]["asn"] for l in line_ids]
    line_cnt = Counter(asn_of)
    major = [a for a, c in line_cnt.most_common() if c >= MAJOR_LINES]
    if primary and primary not in major and line_cnt.get(primary, 0) >= 2:
        major.insert(0, primary)  # 指定的主要 ISP 只要有 2 條線路就單獨成群
    if primary and primary not in line_cnt: primary = None

    def group_of(k):
        return asn_of[k] if asn_of[k] in major else OTHER

    def grouped_tiers(li):
        """li → (各群分級 {群: {host: tier}}, 各群分數, 聯集分級, 整體分數)"""
        gt, gs = {}, {}
        for g in major + [OTHER]:
            gl = [k for k in li if group_of(k) == g]
            if gl: gt[g], gs[g] = tiers_for(gl)
        m = len(li)
        sc = {h: sum(lv[h][k] for k in li) / m for h in hosts}
        tier = {}
        for h in hosts:
            ts = [gt[g][h] for g in gt]
            tier[h] = ("只能播熱門" if h in banned else "不穩定" if h in agg_unstable else
                       "第一梯隊" if "第一梯隊" in ts else "可用" if "可用" in ts else "差")
        return gt, gs, tier, sc

    def select(gt, gs, tier, sc):
        """建議清單（與 /cdn-speedtest 單份報告的規則相同，但分群）：先取第一梯隊、再取可用；
        主要 ISP（primary）那一群的先排（依該群分數），其餘依整體分數；同一個 CDN 池（叢集）最多 PER_POOL 個，
        剩下的名額讓給其他池；不穩定、差不列（不足 TOP_N 就少列）"""
        out, cnt = [], Counter()
        for t in ("第一梯隊", "可用"):
            pri = [h for h in hosts if primary in gt and gt[primary][h] == t and tier[h] == t]
            pri.sort(key=lambda h: (-gs[primary][h], -sc[h]))
            rest = [h for h in hosts if tier[h] == t and h not in pri]
            rest.sort(key=lambda h: (-sc[h], -(st[h]["mbps"] or 0)))
            for h in pri + rest:
                if len(out) >= TOP_N: break
                if cnt[pool(h)] >= PER_POOL: continue
                cnt[pool(h)] += 1
                out.append(h)
        return out

    def default_for(lst, gt, gs, tier, sc, li):
        """預設（比照單份報告）：清單中的第一梯隊（有 primary 時限 primary 那一群的第一梯隊），
        沒有不穩定紀錄、速度穩定（各報告 sd/平均 的中位數 ≤ 0.3）、TTFB 不高（≤ 最低×1.5 或 +150ms）的分數最高者；條件逐步放寬"""
        if primary in gt:
            t1 = [h for h in lst if gt[primary][h] == "第一梯隊"] or [h for h in lst if gt[primary][h] == "可用"]
            sc = gs[primary]
            li = [k for k in li if group_of(k) == primary]
        else:
            t1 = [h for h in lst if tier[h] == "第一梯隊"]
        t1 = t1 or lst
        if not t1: return None
        tt = {h: st[h]["ttfb"] for h in t1 if st[h]["ttfb"] is not None}
        lim = max(1.5 * min(tt.values()), min(tt.values()) + 150) if tt else float("inf")
        stable = [h for h in t1 if not any(k in unst_l[h] for k in li)]
        for c in ([h for h in stable if tt.get(h, 1e9) <= lim and (st[h]["cv"] or 0) <= 0.3],
                  [h for h in stable if tt.get(h, 1e9) <= lim], [h for h in t1 if tt.get(h, 1e9) <= lim], t1):
            if c: return max(c, key=lambda h: (sc[h], st[h]["mbps"] or 0))  # 同分（單份報告都是 1）看速度

    all_li = list(range(L))
    gt0, gs0, tier, sc0 = grouped_tiers(all_li)
    for h in hosts:
        st[h]["tier"] = tier[h]
        st[h]["t1_groups"] = [g for g in gt0 if gt0[g][h] == "第一梯隊"]
        st[h]["ok_groups"] = [g for g in gt0 if gt0[g][h] == "可用"]
    top = select(gt0, gs0, tier, sc0)
    default = default_for(top, gt0, gs0, tier, sc0, all_li)
    group_lines = {g: sum(group_of(k) == g for k in all_li) for g in gt0}

    # bootstrap：以線路為單位重抽，看每個節點進清單、當預設的機率（樣本少時會明顯不穩）
    rng = random.Random(0)
    sel, dflt = Counter(), Counter()
    if L >= 2:
        for _ in range(BOOT):
            li = [rng.randrange(L) for _ in range(L)]
            gt, gs, t, sc = grouped_tiers(li)
            lst = select(gt, gs, t, sc)
            sel.update(lst)
            dflt[default_for(lst, gt, gs, t, sc, li)] += 1
    boot = {h: sel[h] / BOOT for h in hosts} if L >= 2 else {h: float(h in top) for h in hosts}

    # 各 ISP：同樣規則只用該 ISP 的線路算分級與預設（給之後「依 ISP 選預設」用），並標樣本是否足夠
    by_isp = defaultdict(list)
    for i, rep in enumerate(reps): by_isp[rep["asn"]].append(i)
    isp_lines = {a: len({reps[i]["line"] for i in ix}) for a, ix in by_isp.items()}

    def single(li):
        t, sc = tiers_for(li)
        out, cnt = [], Counter()
        for tt_ in ("第一梯隊", "可用"):
            for h in sorted((h for h in hosts if t[h] == tt_), key=lambda h: (-sc[h], -(st[h]["mbps"] or 0))):
                if len(out) >= TOP_N: break
                if cnt[pool(h)] >= PER_POOL: continue
                cnt[pool(h)] += 1
                out.append(h)
        g = {"_": t}
        return t, sc, out, default_for(out, g, {"_": sc}, t, sc, li)

    isp = {}
    for a in sorted(by_isp, key=lambda a: -isp_lines[a]):
        li = [k for k in all_li if asn_of[k] == a]
        t, sc, lst, d = single(li)
        agree = None
        if len(li) >= 2:
            c = Counter()
            for _ in range(BOOT // 4):
                lb = [li[rng.randrange(len(li))] for _ in li]
                c[single(lb)[3]] += 1
            agree = c[d] / (BOOT // 4)
        isp[a] = dict(lines=len(li), reports=len(by_isp[a]), tier=t, sc=sc, top=lst, default=d, agree=agree)
    isp_sc = {a: isp[a]["sc"] for a in major}

    def list_quality(lst, idx=None):
        """清單對各報告的「最佳、次佳」分數平均（診斷用：這份清單對各 ISP 的使用者有沒有好選擇）"""
        idx = range(n) if idx is None else idx
        b = [sorted((vec[h][i] for h in lst), reverse=True) + [0, 0] for i in range(n)]
        return wmean([x[0] for x in b], idx), wmean([x[1] for x in b], idx)

    # 報告一致性：各報告 vs 「其他線路」的共識（同線路的其他報告也拿掉，不然會互相背書），以及拿掉這條線路後清單變多少
    cons = []
    for i, rep in enumerate(reps):
        others_ix = [j for j in range(n) if reps[j]["line"] != rep["line"]]
        if len({reps[j]["line"] for j in others_ix}) < 2:
            cons.append(dict(rho=None, overlap=None, loo_change=None)); continue
        others = {h: wmean(vec[h], others_ix) for h in hosts}
        rho = spearman([vec[h][i] for h in hosts], [others[h] for h in hosts])
        gt, gs, t, sc = grouped_tiers([k for k, l in enumerate(line_ids) if l != rep["line"]])
        loo_top = select(gt, gs, t, sc)
        own = pick(sorted(hosts, key=lambda h: -vec[h][i]), pool, banned)
        cons.append(dict(rho=rho, overlap=len(set(own) & set(pick(sorted(hosts, key=lambda h: -others[h]), pool, banned))),
                         loo_change=len(set(top) - set(loo_top)), loo_top=loo_top))
    return dict(hosts=hosts, S=S, st=st, order=order, top=top, default=default, boot=boot, dflt=dflt,
                cons=cons, banned=banned, pool=pool, pool_label=pool_label, opts=opts, vec=vec, wmean=wmean,
                lines=lines, L=L, by_isp=by_isp, isp_lines=isp_lines, major=major, isp_sc=isp_sc, isp=isp,
                list_quality=list_quality, tier=tier, primary=primary, groups=gt0, group_lines=group_lines, gs=gs0)


def quality_flags(rep):
    """(嚴重, 提示) 兩組。嚴重 = 這份報告的量測本身有問題，自動排除"""
    hard, soft = [], []
    if rep["s1_passed"] is not None and rep["s1_passed"] < 30:
        hard.append(f"快篩只有 {rep['s1_passed']}/{rep['s1_n']} 個節點通過（多半是 DNS 或網路異常，不是節點本身慢）")
    if rep["full"] < 15: hard.append(f"細測只有 {rep['full']} 個節點全部成功，排名基礎太薄")
    if rep["ceiling"] and rep["ceiling"] < 30: hard.append(f"頻寬上限只有 {rep['ceiling']:.0f} Mbps")
    if rep["login"] is False: soft.append("未登入（只測到 ≤480P）")
    if rep["dns"]: soft.append(f"節點網域改用 {rep['dns']} 解析")
    if rep["conc"] and rep["conc_auto"] and rep["conc"] != rep["conc_auto"]:
        soft.append(f"並行數手動設為 {rep['conc']}（自動為 {rep['conc_auto']}）")
    if rep["contention"]: soft.append("第一名接近「上限 ÷ 並行數」，可能互搶頻寬（頂端節點會被抹平成同一級）")
    if rep["kind_fixed"]: soft.append(f"網路類型更正為「{rep['kind']}」（GUI 誤判）")
    return hard, soft


def classify_outlier(i, reps, A):
    """離群報告是個案還是通案：看同 ISP「其他線路」的報告是否也有同樣的排名特徵"""
    me = reps[i]
    peers = [j for j, r in enumerate(reps) if r["asn"] == me["asn"] and r["line"] != me["line"]]
    same = [j for j, r in enumerate(reps) if j != i and r["line"] == me["line"]]
    hosts, vec = A["hosts"], A["vec"]
    c = A["cons"][i]["rho"]
    tail = ""
    if same:
        sr = statistics.mean(spearman([vec[h][i] for h in hosts], [vec[h][j] for h in hosts]) for j in same)
        tail = f"；同線路另外 {len(same)} 份與它相關 {sr:.2f}（{'可重現' if sr >= 0.5 else '同一條線路自己也不穩定'}）"
    if not peers: return f"無法判斷（這個 ISP 只有這一條線路）{tail}"
    pl = len({reps[j]["line"] for j in peers})
    pr = statistics.mean(spearman([vec[h][i] for h in hosts], [vec[h][j] for h in hosts]) for j in peers)
    if pr >= c + 0.1:
        return f"**ISP 通案**：與同 ISP 其他 {pl} 條線路的相關（{pr:.2f}）明顯高於與整體共識（{c:.2f}）{tail}"
    return f"**個案**：同 ISP 其他 {pl} 條線路沒有同樣的排名（相關 {pr:.2f}，與整體共識 {c:.2f}）{tail}"


def concentration(ix, reps, A):
    """一組事件（ix = 發生的報告）是個案、ISP 通案、尖峰通案、普遍現象還是零星。全部以線路數計"""
    n = len(reps)
    ev = {reps[i]["line"] for i in ix}
    k = len(ev)
    if k == 1:
        return "個案" + (f"（同一條線路 {len(ix)} 份）" if len(ix) > 1 else "")
    all_lines = {r["line"] for r in reps}
    groups = [(f"ISP 通案：{a} {reps[all_ix[0]]['isp']}", {reps[j]["line"] for j in all_ix}) for a, all_ix in A["by_isp"].items()]
    groups.append(("尖峰通案：晚間 19–24 時", {reps[j]["line"] for j in range(n) if reps[j]["hour"] in PEAK}))
    best = None
    for lab, g in groups:
        inn = len(ev & g)
        if inn < 2 or len(g) == len(all_lines): continue
        r_in, r_out = inn / len(g), (k - inn) / (len(all_lines) - len(g))
        if r_in >= 0.4 and r_in - r_out >= 0.3 and (not best or r_in - r_out > best[0]):
            best = (r_in - r_out, f"**{lab}**（{inn}/{len(g)} 條線路；其他 {k - inn}/{len(all_lines) - len(g)} 條）")
    if best: return best[1]
    isps = Counter(reps[i]["asn"] for i in ix)
    if k >= 3 and len(isps) >= 2: return f"**普遍現象**（{k} 條線路、{len(isps)} 家 ISP）"
    return "零星（" + "、".join(f"{a}×{c}" for a, c in isps.most_common()) + "）"


# ── 報告 ─────────────────────────────────────────────────────
def fmt(x, d=0, suf=""):
    return "-" if x is None else f"{x:.{d}f}{suf}"


def pct(x): return "-" if x is None else f"{x * 100:.0f}%"


def short(h): return h.replace(".bilivideo.com", "")


def write(cc, reps_all, excluded, reps, A, cdn, out_dir):
    st, top, boot, n = A["st"], A["top"], A["boot"], len(reps)
    cname = next((c for c in cdn.get("countries", []) if c["code"] == cc), None)
    current = cname["nodes"] if cname else []
    out = []
    w = out.append
    wmean, NL = A["wmean"], A["L"]
    now = datetime.now()
    w(f"# {cc} CDN 節點跨報告分析（{now:%Y-%m-%d %H:%M}）\n")
    w(f"> 自動產生：`.claude/skills/analyze-cdn/analyze.py`。納入 {n} 份（{NL} 條線路）、排除 {len(excluded)} 份。"
      "「判讀」一節由 Claude 讀完數據後補寫。**本報告不改任何專案檔案**；要不要更新 `src/cdn-list.json` 由你決定。\n")
    w("「線路」= 同 ISP 且同出口 IP（或同網段、同網卡）的報告視為同一條線路重複測試，合起來只算 1 個樣本；"
      "下面的分數、比例、重抽樣都以線路為單位。\n")

    # 樣本
    isp_l = {a: A["isp_lines"][a] for a in A["by_isp"]}
    isp_name = {r["asn"]: r["isp"] for r in reps}
    as_name = {r["asn"]: r["as_name"] for r in reps}
    kinds = Counter(r["kind"] for r in reps)
    peak = sum(r["hour"] in PEAK for r in reps if r["hour"] is not None)
    big = max(isp_l.values()) / NL if NL else 0
    w("## 1. 樣本是否足夠\n")
    if n == 0:
        w("**沒有可用的報告。**\n")
    else:
        lvl = ("**樣本不足**：少於 3 條線路，排名幾乎等於單次量測，只能當參考，不建議據此更新節點庫" if NL < 3 else
               "**樣本偏少**：3–5 條線路，前段大致可信，後段名次容易變動" if NL < 6 else
               "**樣本尚可**：6 條線路以上")
        w(f"- {lvl}。")
        notes = []
        if len(isp_l) < 3: notes.append(f"只涵蓋 {len(isp_l)} 家 ISP")
        if big > 0.5 and NL >= 3: notes.append(f"最大 ISP 佔 {big:.0%} 的線路，結果偏向該 ISP")
        if n > NL: notes.append(f"{n - NL} 份是同一條線路的重複測試（已合併計算）")
        if peak == 0: notes.append("沒有晚間尖峰（19–24 時）的樣本")
        elif peak == n: notes.append("全部都是晚間尖峰的樣本")
        if notes: w("- 偏差：" + "；".join(notes) + "。")
        if NL >= 2:
            stab = [boot[h] for h in top]
            w(f"- 以線路重抽樣（bootstrap {BOOT} 次）時，建議的 {len(top)} 個節點進前 10 的機率中位數 **{statistics.median(stab):.0%}**"
              f"（≥ 80% 很穩、50–80% 尚可、< 50% 代表再多幾條線路名單就可能換人）。")
        w("")
        w(f"- ISP（{len(isp_l)} 家）：" + "、".join(
            f"{a} {isp_name[a]}" + (f"〔AS 名稱：{as_name[a]}〕" if as_name[a] and as_name[a].lower() != isp_name[a].lower() else "") +
            f"（{len(A['by_isp'][a])} 份／{isp_l[a]} 條線路）" for a in sorted(isp_l, key=lambda a: -isp_l[a])))
        w("  - ISP 名稱取自 ip-api 的 `isp`（IP 註冊的公司名）；AS 名稱是 ipinfo 的 `org`（GUI 信件標題用這個），兩者對同一個 ASN。")
        w(f"- 城市：" + "、".join(f"{k}（{v}）" for k, v in Counter(r["city"] for r in reps).most_common()))
        w(f"- 網路類型：" + "、".join(f"{k}（{v}）" for k, v in kinds.most_common()) +
          ("（已依網卡名稱更正 GUI 的誤判）" if any(r["kind_fixed"] for r in reps) else ""))
        w(f"- 測試時段：晚間尖峰 {peak} 份、其他 {n - peak} 份")
        dn = [r["down"] for r in reps if r["down"]]
        if dn: w(f"- 總頻寬（Cloudflare 下載）：中位數 {statistics.median(dn):.0f} Mbps（{min(dn):.0f}–{max(dn):.0f}）")
        w("")

    # 報告清單
    w("## 2. 報告清單與離群檢查\n")
    w("「相關」= 這份報告的節點分數與「其他線路」共識的 Spearman 相關；「重疊」= 這份自己的前 10 名與共識前 10 名重疊幾個；"
      "「影響」= 拿掉這條線路後，整體前 10 名換掉幾個。\n")
    w("| 報告 | 線路 | 時間 | 城市 | ISP | 網路 | 上限 Mbps | 並行 | 細測成功 | 相關 | 重疊 | 影響 | 狀態 |")
    w("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    idx = {r["rid"]: i for i, r in enumerate(reps)}
    for r in sorted(reps_all, key=lambda r: r["time"]):
        c = A["cons"][idx[r["rid"]]] if r["rid"] in idx else {}
        stt = "納入" if r["rid"] in idx else "**排除**"
        w(f"| {r['rid']} | {r['line']} | {r['time']} | {r['city']} | {r['asn']} {r['isp'][:24]} | {r['kind'][:4]} | {r['ceiling']:.0f} | "
          f"{r['conc']} | {r['full']} | {fmt(c.get('rho'), 2)} | {fmt(c.get('overlap'))} | {fmt(c.get('loo_change'))} | {stt} |")
    w("")
    rhos = [c["rho"] for c in A["cons"] if c["rho"] is not None]
    flagged = []
    if rhos:
        med = statistics.median(rhos)
        mad = statistics.median(abs(x - med) for x in rhos) * 1.4826
        # 比中位數低 2 個 MAD（標準差的穩健估計）以上，或低於 0.2（幾乎不相關）就算離群；MAD 很小時至少低 0.15
        cut = max(min(med - 2 * mad, med - 0.15), 0.2)
        w(f"報告間一致性：相關中位數 {med:.2f}（≥ 0.6 代表各份報告大致同意哪些節點好）。"
          f"離群 = 相關 < {cut:.2f}，或自己的前 10 名與共識只重疊 ≤ 3 個。\n")
        for i, c in enumerate(A["cons"]):
            if c["rho"] is not None and (c["rho"] < cut or (c["overlap"] is not None and c["overlap"] <= 3)):
                flagged.append(i)
    if NL == 2:
        a_, b_ = list(A["lines"].values())
        r2 = spearman([wmean(A["vec"][h], a_) for h in A["hosts"]], [wmean(A["vec"][h], b_) for h in A["hosts"]])
        w(f"只有 2 條線路，無法判斷誰是離群；兩條線路的排名相關 {r2:.2f}"
          "（≥ 0.6 大致一致，< 0.3 代表兩邊結論不同，更需要第 3 條線路）。\n")
    w("### 離群報告\n")
    any_note = False
    for r in sorted(reps_all, key=lambda r: r["time"]):
        hard, soft = quality_flags(r)
        i = idx.get(r["rid"])
        is_out = i is not None and i in flagged
        if not (hard or is_out or r["rid"] in excluded): continue
        any_note = True
        w(f"- **{r['rid']}**（{r['line']}，{r['time']}，{r['city']}，{r['asn']} {r['isp']}）")
        for x in hard: w(f"  - ⛔ {x}")
        for x in soft: w(f"  - {x}")
        if is_out:
            c = A["cons"][i]
            w(f"  - 排名與其他線路不一致（相關 {c['rho']:.2f}、前 10 重疊 {c['overlap']}）→ {classify_outlier(i, reps, A)}")
            w(f"  - 這份自己的前 3 名：" + "、".join(
                f"`{short(h)}`" for h in sorted(A["hosts"], key=lambda h: -A["vec"][h][i])[:3]))
            w(f"  - 拿掉這條線路，整體前 10 名會換掉 {c['loo_change']} 個" + (
                "：" + "、".join(f"`{short(h)}`" for h in sorted(set(top) - set(c['loo_top']))) if c["loo_change"] else ""))
        if r["rid"] in excluded: w(f"  - 處置：**排除**（{excluded[r['rid']]}）")
        else: w("  - 處置：納入")
    if not any_note: w("沒有離群或量測有問題的報告。")
    w("")
    w("其他提示（不影響納入）：")
    for r in sorted(reps_all, key=lambda r: r["time"]):
        _, soft = quality_flags(r)
        if soft and r["rid"] not in excluded and not (r["rid"] in idx and idx[r["rid"]] in flagged):
            w(f"- {r['rid']}：" + "；".join(soft))
    w("")

    # 特徵
    w("## 3. 國家特徵\n")
    pools = defaultdict(list)
    for h in A["hosts"]: pools[st[h]["pool"]].append(h)
    prow = []
    for p, hs in pools.items():
        best = [max(A["vec"][h][i] for h in hs) for i in range(n)]
        prow.append((wmean(best), wmean([b >= 0.5 for b in best]), p, hs))
    prow.sort(key=lambda x: -x[0])
    w("### CDN 池表現（每份報告取該池最好的節點）\n")
    w("| CDN 池 | 平均分數 | 有可用節點的線路比例 | 測過的節點數 |" + "".join(f" {a} |" for a in A["major"]))
    w("|---|---|---|---|" + "---|" * len(A["major"]))
    for s, g, p, hs in prow[:15]:
        per = "".join(f" {wmean([max(A['vec'][h][i] for h in hs) for i in range(n)], A['by_isp'][a]):.2f} |" for a in A["major"])
        w(f"| {st[hs[0]]['pool_label']} | {s:.2f} | {g:.0%} | {len(hs)} |{per}")
    w("")
    # 各 ISP 偏好
    multi = [a for a in A["by_isp"] if len(A["by_isp"][a]) >= 2]
    if multi:
        w("### 各 ISP 的最佳節點（2 份以上的 ISP）\n")
        for a in sorted(multi, key=lambda a: -isp_l[a]):
            ix = A["by_isp"][a]
            sc = {h: wmean(A["vec"][h], ix) for h in A["hosts"]}
            best = [h for h in sorted(A["hosts"], key=lambda h: -sc[h]) if h not in A["banned"]][:5]
            note = "（同一條線路，只能代表那一戶）" if isp_l[a] == 1 else ""
            w(f"- {a} {isp_name[a]}（{len(ix)} 份／{isp_l[a]} 條線路）{note}：" +
              "、".join(f"`{short(h)}` {sc[h]:.2f}" for h in best))
        w("")
    # 常見失效
    w("### 常見失效\n")
    hot = sorted(h for h in A["hosts"] if st[h]["n_hot"])
    fam = Counter(st[h]["pool_label"] for h in hot)
    if hot: w(f"- 只能播熱門（403，冷門片播不了，一律不建議）：{len(hot)} 個節點，" +
              "、".join(f"{k}（{v}）" for k, v in fam.most_common(6)))
    errs = Counter()
    for r in reps:
        for h, e in r["failed"].items():
            if h not in r["hot_only"]:
                for k in e: errs[re.sub(r"\[Errno \d+\] ", "", k)[:30]] += 1
    if errs: w("- 細測失敗原因（不含 403）：" + "、".join(f"{k}×{v}" for k, v in errs.most_common(5)))
    w("")

    # 極端值
    w("## 4. 節點極端值\n")
    w("「爆發」= 少數報告拿第一梯隊、其他報告大多不行（只列目前清單裡的、或爆發 2 份以上的）；"
      "「崩潰」= 建議清單裡的節點在某些報告失效或分數 < 0.3。歸類（以線路計）：只有 1 條線路 → **個案**；"
      "集中在某 ISP（該 ISP ≥ 40% 的線路、且比其他 ISP 高 30 個百分點以上）→ **ISP 通案**；集中在晚間尖峰 → **尖峰通案**；"
      "3 條線路以上且橫跨多家 ISP → **普遍現象**（節點本身時好時壞）；其餘 → **零星**。\n")
    ext = 0
    for h in A["order"][:80]:
        s = st[h]
        if NL < 4: break
        hi = [i for i in range(n) if A["S"][h][i][0] == "第一梯隊"]
        lo = [i for i in range(n) if A["vec"][h][i] < 0.3]
        if s["good_rate"] <= 0.3 and hi and (h in current or len(hi) >= 2):
            kind, ix = "爆發", hi
        elif h in top and lo and len(lo) <= n / 2:
            kind, ix = "崩潰", lo
        else:
            continue
        detail = "、".join(f"{reps[i]['rid']}（{reps[i]['asn']}）{A['S'][h][i][0]}" for i in ix[:6]) + ("…" if len(ix) > 6 else "")
        w(f"- `{short(h)}` {kind} {len(ix)}/{n} 份：{detail} → {concentration(ix, reps, A)}")
        ext += 1
    if not ext: w("沒有明顯的極端值。" if NL >= 4 else "少於 4 條線路，無法區分極端值與一般波動。")
    over = [(r["rid"], h, x["mean"]) for r in reps for h, x in r["rows"].items() if r["ceiling"] and x["mean"] > r["ceiling"] * 1.05]
    if over:
        w("\n超過該報告頻寬上限的量測值（量測異常，已照常計分但請留意）：" +
          "、".join(f"{rid} `{short(h)}` {m:.0f} Mbps" for rid, h, m in over[:8]))
    w("")

    # 建議
    w(f"## 5. 建議前 {TOP_N} 名\n")
    w("**單一節點分數** = 各線路的平均（每份報告中第一梯隊 = 1、可用／差 = 平均速度 ÷ 該報告最快穩定節點、"
      "不穩定再打五折、失效或沒進細測 = 0）。\n")
    gl = A["group_lines"]
    w("**分群**：" + "、".join(f"{g}（{c} 條線路）" for g, c in gl.items()) +
      f"。每家 ≥ {MAJOR_LINES} 條線路的 ISP 單獨成群，其餘線路合併成「{OTHER}」；各群自己分級，再取聯集"
      "（在任一群是第一梯隊 → 第一梯隊；否則任一群可用 → 可用），所以「對某群使用者是第一梯隊」的節點不會被別群的 0 分拉下來。\n")
    w("**跨報告分級**（每群內，比照單份報告）：以分數最高的節點為基準，逐線路配對比較，平均差距在 2 倍標準誤內 → 第一梯隊；"
      f"但分數要 ≥ 基準的 {T1_MIN:.0%}（避免只在某家 ISP 極好、其他 ISP 為 0 的節點因變異大而混進來）；"
      "分數 ≥ 基準一半 → 可用；其餘 → 差。進了細測的線路有一半以上是「不穩定」→ 不穩定；任一份 403「只能播熱門」→ 不列。"
      "同分（例如只有 1 份報告時都是 1）依中位速度排。\n")
    pr = A["primary"]
    w(f"**挑法**：先取第一梯隊" + (f"（主要 ISP {pr} 那一群的第一梯隊排最前、依該群分數；其餘依整體分數）" if pr else "、依分數排序") +
      f"，同一個 CDN 池（叢集）最多 {PER_POOL} 個，剩下的名額讓給其他池；"
      "第一梯隊不足 10 個才補「可用」；不穩定、差不列（不足 10 個就少列）。"
      "可用率括號內是 95% Wilson 下界（樣本越少越低）；入選率 = 以線路重抽樣時仍進清單的比例；不穩定、失效 = 報告份數。\n")
    mj = A["major"]
    w("| # | 節點 | CDN 池 | 分級（哪一群） | 分數 | " + "".join(f"{a} | " for a in mj) +
      "第一梯隊比例 | 可用率（下界） | 不穩定 | 失效／未進細測 | 中位 Mbps | 中位 TTFB | 入選率 | 目前清單 |")
    w("|---|---|---|---|---|" + "---|" * len(mj) + "---|---|---|---|---|---|---|---|")
    lst = ([A["default"]] if A["default"] else []) + [h for h in top if h != A["default"]]
    for i, h in enumerate(lst, 1):
        s = st[h]
        mark = " ⭐" if h == A["default"] else ""
        cur = f"#{current.index(h) + 1}" if h in current else "新增"
        src = s["t1_groups"] if s["tier"] == "第一梯隊" else s["ok_groups"] if s["tier"] == "可用" else []
        w(f"| {i} | `{h}`{mark} | {s['pool_label']} | {s['tier']}{'（' + '、'.join(src) + '）' if src else ''} | {s['score']:.2f} | " +
          "".join(f"{A['isp_sc'][a][h]:.2f} | " for a in mj) +
          f"{pct(s['t1_rate'])} | {pct(s['good_rate'])}（{pct(s['good_lb'])}） | "
          f"{s['n_unstable']} | {s['n_fail'] + s['n_absent']} | {fmt(s['mbps'])} | {fmt(s['ttfb'])} | {pct(A['boot'][h])} | {cur} |")
    w("")
    nt = Counter(st[h]["tier"] for h in A["hosts"])
    w(f"跨報告分級統計：第一梯隊 {nt['第一梯隊']} 個、可用 {nt['可用']} 個、不穩定 {nt['不穩定']} 個、差 {nt['差']} 個、"
      f"只能播熱門 {nt['只能播熱門']} 個。" + ("清單有用到「可用」補位。" if any(st[h]["tier"] == "可用" for h in top) else "") + "\n")
    if A["default"]:
        d = A["default"]
        dd = ""
        if A["dflt"]:
            tot = sum(A["dflt"].values())
            dd = "；重抽樣時被選為預設的比例：" + "、".join(f"`{short(h)}` {c / tot:.0%}" for h, c in A["dflt"].most_common(3) if h)
        w(f"**建議預設：`{d}`**（第一梯隊比例 {pct(st[d]['t1_rate'])}、中位 TTFB {fmt(st[d]['ttfb'])} ms、不穩定 {st[d]['n_unstable']} 次{dd}）\n")
        if pr:
            bad = [g for g in A["groups"] if g != pr and A["groups"][g][d] in ("差", "不穩定")]
            if bad:
                w(f"⚠ 預設是依主要 ISP {pr} 選的；對 {'、'.join(bad)} 這些群它是「{'／'.join(sorted({A['groups'][g][d] for g in bad}))}」。"
                  "這些 ISP 的使用者剛安裝時會拿到慢或連不上的節點，擴充的自動備援只會換到 B 站自己的備援網址，"
                  "要靠使用者手動測速（或擴充日後的安裝後自動測速）才會改選。\n")
    t1_out = [h for h in A["order"] if st[h]["tier"] == "第一梯隊" and h not in top]
    if t1_out:
        w("第一梯隊但被同池名額擋下：" + "、".join(f"`{short(h)}` {st[h]['score']:.2f}（{st[h]['pool_label']}）" for h in t1_out[:8]) + "\n")
    un = sorted((h for h in A["hosts"] if st[h]["tier"] == "不穩定"), key=lambda h: -st[h]["score"])
    if un:
        w("跨報告不穩定（不列）：" + "、".join(f"`{short(h)}` {st[h]['score']:.2f}" for h in un[:8]) + "\n")
    miss = [h for h in top if not st[h]["in_opts"]]
    if miss: w("⚠ 不在 `cdn-list.json` 的 `options` 裡，更新時要一併新增：" + "、".join(f"`{h}`" for h in miss) + "\n")

    # 清單對各 ISP 的覆蓋（診斷）
    lq = A["list_quality"]
    groups = [("全部", None)] + [(f"{a}", A["by_isp"][a]) for a in mj]
    w("清單對各 ISP 的覆蓋（每份報告在清單裡找得到的最佳／次佳節點分數的平均，1 = 都有第一梯隊可選）：\n")
    w("| 清單 | " + " | ".join(g for g, _ in groups) + " |")
    w("|---|" + "---|" * len(groups))
    rows = [("建議清單", lst)] + ([("目前清單", current)] if current else [])
    for lab, l in rows:
        w(f"| {lab} | " + " | ".join("{:.2f}／{:.2f}".format(*lq([h for h in l if h in A['vec']], ix)) for _, ix in groups) + " |")
    w("")

    # 各 ISP 的預設（之後依 ISP 選預設用）
    w("### 各 ISP 的建議預設（依 ISP 選預設用）\n")
    w("同樣的分級與挑法，只用該 ISP 的線路計算。樣本以該 ISP 的線路數判斷（< 3 不足、3–5 偏少、≥ 6 尚可）；"
      "「預設穩定度」= 以該 ISP 的線路重抽樣時，選出同一個預設的比例。\n")
    w("| ISP | 報告／線路 | 樣本 | 建議預設 | 預設穩定度 | 清單前 3 | 與全國預設相同 |")
    w("|---|---|---|---|---|---|---|")
    for a, x in A["isp"].items():
        lvl = "不足" if x["lines"] < 3 else "偏少" if x["lines"] < 6 else "尚可"
        top3 = [h for h in x["top"] if h != x["default"]][:3]
        w(f"| {a} {isp_name[a][:28]} | {x['reports']}／{x['lines']} | {lvl} | `{short(x['default']) if x['default'] else '-'}` | "
          f"{pct(x['agree'])} | {'、'.join(f'`{short(h)}`' for h in top3)} | {'是' if x['default'] == A['default'] else '否'} |")
    w("")

    # 與目前清單比較
    w("## 6. 與目前 `src/cdn-list.json` 比較\n")
    if not cname:
        w(f"`cdn-list.json` 還沒有 {cc} 這個國家。新增時要補 `dial`（國際電話區碼）與五語 `name`。\n")
    else:
        w("| 目前 # | 節點 | 分數 | 第一梯隊 | 可用率 | 建議 |")
        w("|---|---|---|---|---|---|")
        for i, h in enumerate(current, 1):
            s = st.get(h)
            if not s:
                w(f"| {i} | `{h}` | - | - | - | 移除？（沒有任何報告進細測） |"); continue
            v = "保留" if h in top else ("移除（只能播熱門）" if h in A["banned"] else "移除")
            if h == A["default"]: v += "（建議預設）"
            elif i == 1 and A["default"]: v += "，不再當預設"
            w(f"| {i} | `{h}` | {s['score']:.2f} | {pct(s['t1_rate'])} | {pct(s['good_rate'])} | {v} |")
        add = [h for h in top if h not in current]
        w("")
        w(f"新增：" + ("、".join(f"`{h}`" for h in add) if add else "無") + "\n")

    w("## 7. 判讀\n")
    w("<!-- CLAUDE: 依第 1–6 節寫結論（離群報告的處置理由、極端值是個案還是通案、樣本是否足以更新、建議的清單與預設）。 -->\n")

    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.join(out_dir, f"{cc}-{now:%Y%m%d-%H%M}")
    open(stem + ".md", "w", encoding="utf-8").write("\n".join(out))
    json.dump(dict(country=cc, generated=f"{now:%Y-%m-%d %H:%M}", n_reports=n, n_lines=NL,
                   included=[r["rid"] for r in reps], excluded=excluded,
                   default=A["default"], nodes=([A["default"]] if A["default"] else []) + [h for h in top if h != A["default"]],
                   current=current, not_in_options=miss, primary_isp=A["primary"], groups=A["group_lines"],
                   isp_defaults={k: dict(default=x["default"], lines=x["lines"], agree=x["agree"]) for k, x in A["isp"].items()},
                   stats={h: dict(score=round(st[h]["score"], 3), good_rate=round(st[h]["good_rate"], 3),
                                  t1_rate=round(st[h]["t1_rate"], 3), boot=round(A["boot"][h], 3)) for h in top}),
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
    ap.add_argument("--primary-isp", help="主要 ISP 的 ASN（如 AS3462）；省略時讀 primary-isp.json 的該國設定")
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
    primary = a.primary_isp
    if primary is None:
        try:
            primary = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "primary-isp.json"),
                                     encoding="utf-8")).get(cc)
        except Exception:
            primary = None
    A = analyze(reps, cdn, cc, primary)
    md = write(cc, reps_all, excluded, reps, A, cdn, a.out or os.path.join(a.root, "_analysis"))
    print(f"{cc}：納入 {len(reps)} 份、排除 {len(excluded)} 份")
    for rid, why in excluded.items(): print(f"  排除 {rid}：{why}")
    print("主要 ISP：", A["primary"] or "（未指定）", " 分群：", A["group_lines"])
    print("建議預設：", A["default"])
    for i, h in enumerate(A["top"], 1):
        s = A["st"][h]
        print(f"  {i:2} {h:42} 分數 {s['score']:.2f} 可用率 {s['good_rate']:.0%} 入選率 {A['boot'][h]:.0%}")
    print("OUTPUT", md)


if __name__ == "__main__":
    main()
