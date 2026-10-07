#!/usr/bin/env python3
# 查 App Store Connect 上這個 App 最近上傳的 build 與 TestFlight 狀態（給 .github/workflows/asc-status.yml 用）。
# 讀環境變數 ASC_ISSUER_ID、ASC_KEY_ID、ASC_KEY_P8（.p8 內容），只讀不寫。
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt  # PyJWT（workflow 會先 pip install pyjwt cryptography）

BUNDLE_ID = "com.johnh.bilibili-cdn-switcher"
API = "https://api.appstoreconnect.apple.com"

token = jwt.encode(
    {"iss": os.environ["ASC_ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 600, "aud": "appstoreconnect-v1"},
    os.environ["ASC_KEY_P8"],
    algorithm="ES256",
    headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"},
)


def get(path, **params):
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} {path}: {e.read().decode()[:500]}")
        sys.exit(1)


apps = get("/v1/apps", **{"filter[bundleId]": BUNDLE_ID})["data"]
if not apps:
    print(f"找不到 bundle id {BUNDLE_ID} 的 App")
    sys.exit(1)
app = apps[0]
print(f"App: {app['attributes']['name']} (id {app['id']})")

versions = get(f"/v1/apps/{app['id']}/appStoreVersions", limit=10)["data"]
print("\n== App Store 版本 ==")
for v in versions:
    a = v["attributes"]
    print(f"{a['platform']:6} {a['versionString']:8} {a.get('appVersionState') or a.get('appStoreState')}")

builds = get(
    "/v1/builds",
    **{
        "filter[app]": app["id"],
        "sort": "-uploadedDate",
        "limit": 10,
        "include": "preReleaseVersion,buildBetaDetail",
    },
)
included = {(i["type"], i["id"]): i for i in builds.get("included", [])}
print("\n== 最近上傳的 build ==")
for b in builds["data"]:
    a = b["attributes"]
    rel = b["relationships"]
    pre = included.get(("preReleaseVersions", (rel["preReleaseVersion"]["data"] or {}).get("id")), {}).get("attributes", {})
    beta = included.get(("buildBetaDetails", (rel["buildBetaDetail"]["data"] or {}).get("id")), {}).get("attributes", {})
    print(
        f"{pre.get('platform', '?'):6} {pre.get('version', '?'):8} build {a['version']:4} "
        f"上傳 {a['uploadedDate']}  處理狀態 {a['processingState']}  過期 {a['expired']}  "
        f"內部測試 {beta.get('internalBuildState')}  外部測試 {beta.get('externalBuildState')}"
    )

groups = get(f"/v1/apps/{app['id']}/betaGroups", limit=20)["data"]
print("\n== TestFlight 測試群組 ==")
if not groups:
    print("（沒有任何測試群組）")
for g in groups:
    a = g["attributes"]
    testers = get(f"/v1/betaGroups/{g['id']}/betaTesters", limit=50)["data"]
    print(f"{a['name']}  內部群組 {a['isInternalGroup']}  測試員 {len(testers)} 人")
