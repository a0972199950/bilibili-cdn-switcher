#!/usr/bin/env python3
# Xcode 打包 Safari 擴充時執行（擴充 target 的「Safari Extension Name」build phase）。
#
# App Store 不允許名稱含 bilibili（Guideline 4.1(c)），且 App Store 上的名稱要和安裝後顯示的一致（2.3.8）。
# 其他瀏覽器的名稱要保留「for bilibili」，所以 src/_locales 不動，只改 .appex 裡複製出來的那份：
# extName（擴充功能清單）、popupHeaderTitle（popup 標題）、extActionTitle（工具列按鈕提示）都換成 App 名稱。
# 名稱要跟 Xcode 的 CFBundleDisplayName（含 InfoPlist.strings）以及 App Store Connect 上的 App 名稱一致。
#
# 用法：python3 safari-ext-name.py <.appex 裡的 _locales 目錄>
import json
import os
import sys

EN = "BiBoost - Speedup for Bili"
NAMES = {
    "zh_TW": "嗶速 - 海外B站加速",
    "zh_CN": "哔速 - 海外B站加速",
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
    name = NAMES.get(locale, EN)
    for key in ("extName", "popupHeaderTitle", "extActionTitle"):
        messages[key]["message"] = name
    with open(path, "w", encoding="utf-8") as f:
        json.dump(messages, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{locale}: extName / popupHeaderTitle / extActionTitle -> {name}")
