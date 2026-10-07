# 把 Gmail 下載的 CDN 測速附件驗證、去重後歸檔到 cdn-speedtest-results/<國家>/<base>/。只用 Python 標準函式庫。
#
# 用法（在 repo 根目錄執行）：
#   python -I collect.py known  <results 根目錄>               # 印出本機已有的報告編號（rid），空白分隔
#   python -I collect.py import <附件目錄> <results 根目錄> [--dry]
#
# import 會逐份印出「+ 新增」或「- 略過（原因）」，最後一行是
#   RESULT {"trash": [...rid], "keep": [...rid]}
# trash = 信可以移到垃圾桶（已歸檔、重複、無效、VPN、測試模式）；keep = 信要留著讓人查（附件不齊、無法解析）。
# 非 --dry 時，處理完會刪掉附件目錄裡所有符合測速附件檔名的暫存檔（不動其他檔案）。
import hashlib, json, os, re, shutil, sys

sys.stdout.reconfigure(encoding="utf-8")

# {TEST-}{國家}-{yyyyMMdd}-{HHmm}-{rid}-{REPORT|summary}[_{MCP 加的 uuid}].{md|json}
NAME = re.compile(r"^((?:TEST-)?([A-Z]{2}|XX)-\d{8}-\d{4}-([0-9a-f]{8}))-(REPORT|summary)(?:_[0-9a-f-]{36})?\.(md|json)$")


def fingerprint(d):
    """同一次測速的指紋：同一份結果重送時 rid 會不同，但國家、時間、出口 IP、挑片種子、結果列都一樣"""
    ip = ((d.get("env") or {}).get("exit") or {}).get("ip")
    rows = hashlib.sha1(json.dumps(d.get("rows"), sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return (d.get("country"), d.get("time"), ip, d.get("seed"), rows)


def invalid_reason(d, report):
    if not isinstance(d, dict): return "summary 不是物件"
    for k in ("country", "time", "default", "rows"):
        if not d.get(k): return f"summary 缺 {k}"
    if not (d.get("stage2") or {}).get("full_success"): return "細測沒有任何節點全成功"
    vpn = (d.get("env") or {}).get("vpn_check") or {}
    if vpn.get("vpn"): return "偵測到 VPN／代理：" + "、".join(vpn.get("signals") or [])
    if not report.strip() or not re.search(r"^# ", report, re.M): return "REPORT.md 空白或格式不對"
    return None


def scan_existing(root):
    """本機已有結果（含舊的頂層目錄與國家子目錄）→ (rid 集合, 指紋 → base)"""
    rids, prints = set(), {}
    for dirpath, _, files in os.walk(root):
        for f in files:
            m = NAME.match(f)
            if not m or m.group(4) != "summary": continue
            rids.add(m.group(3))
            try:
                prints[fingerprint(json.load(open(os.path.join(dirpath, f), encoding="utf-8")))] = m.group(1)
            except Exception:
                pass
    return rids, prints


def cmd_known(root):
    print(" ".join(sorted(scan_existing(root)[0])) if os.path.isdir(root) else "")


def cmd_import(src, root, dry):
    rids, prints = scan_existing(root) if os.path.isdir(root) else (set(), {})
    groups = {}
    for f in os.listdir(src):
        m = NAME.match(f)
        if m: groups.setdefault(m.group(1), {})[m.group(4)] = os.path.join(src, f)

    trash, keep = [], []
    def skip(base, rid, why, keep_mail=False):
        print("-", base, why)
        (keep if keep_mail else trash).append(rid)

    # base 以國家開頭、接著是時間，排序後同國家較早送出的那份先佔指紋
    for base in sorted(groups):
        g, m = groups[base], NAME.match(base + "-summary.json")
        cc, rid = m.group(2), m.group(3)
        if base.startswith("TEST-"): skip(base, rid, "測試模式報告"); continue
        if rid in rids: skip(base, rid, "報告編號已存在"); continue
        if "summary" not in g or "REPORT" not in g: skip(base, rid, "附件不齊", True); continue
        try:
            d = json.load(open(g["summary"], encoding="utf-8"))
            report = open(g["REPORT"], encoding="utf-8").read()
        except Exception as e:
            skip(base, rid, f"附件無法解析：{e}", True); continue
        why = invalid_reason(d, report)
        if why: skip(base, rid, why); continue
        fp = fingerprint(d)
        if fp in prints: skip(base, rid, f"與 {prints[fp]} 內容相同（重複送出）"); continue

        prints[fp] = base
        rids.add(rid)
        out = os.path.join(root, d["country"], base)
        if not dry:
            os.makedirs(out, exist_ok=True)
            shutil.copyfile(g["summary"], os.path.join(out, f"{base}-summary.json"))
            shutil.copyfile(g["REPORT"], os.path.join(out, f"{base}-REPORT.md"))
        city = ((d.get("env") or {}).get("exit") or {}).get("city") or ""
        print("+", base, d["country"], city, d["default"])
        trash.append(rid)

    if not dry:
        for f in os.listdir(src):
            if NAME.match(f): os.remove(os.path.join(src, f))
    print("RESULT " + json.dumps({"trash": trash, "keep": keep}))


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["known"] and len(a) == 2: cmd_known(a[1])
    elif a[:1] == ["import"] and len(a) in (3, 4): cmd_import(a[1], a[2], "--dry" in a)
    else: sys.exit("用法：collect.py known <results 根目錄> | collect.py import <附件目錄> <results 根目錄> [--dry]")
