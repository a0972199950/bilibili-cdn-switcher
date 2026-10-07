#!/usr/bin/env python3
# Xcode 打包 Safari 擴充時執行（擴充 target 的「Safari Extension Name」build phase）。
#
# App Store 不允許名稱含 bilibili（Guideline 4.1(c)），且 App Store 上的名稱要和安裝後顯示的一致（2.3.8）。
# 其他瀏覽器的名稱要保留「for bilibili」，所以 src/_locales 不動，只改 .appex 裡複製出來的那份 extName。
# 名稱要跟 Xcode 的 CFBundleDisplayName（含 InfoPlist.strings）以及 App Store Connect 上的 App 名稱一致。
#
# 用法：python3 safari-ext-name.py <.appex 裡的 _locales 目錄>
import json
import os
import sys

EN = "Overseas Video Speedup for Bili"
NAMES = {
    "zh_TW": "海外影片加速 for B站",
    "zh_CN": "海外视频加速 for B站",
    "en": EN,
    "ja": EN,
    "ko": EN,
}

locales_dir = sys.argv[1]
for locale in sorted(os.listdir(locales_dir)):
    path = os.path.join(locales_dir, locale, "messages.json")
    if not os.path.isfile(path):
        continue
    with open(path, encoding="utf-8") as f:
        messages = json.load(f)
    messages["extName"]["message"] = NAMES.get(locale, EN)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(messages, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{locale}: extName -> {messages['extName']['message']}")
