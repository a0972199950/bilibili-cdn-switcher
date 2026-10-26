#!/bin/bash
# 打包 Bilibili CDN 測速 GUI 的 Mac 版：<repo>/release/CDNSpeedTest-mac.zip（裡面是 CDNSpeedTest.app，Intel 與 Apple Silicon 通用）
# 用法：bash tools/cdn-speedtest-app/build-mac.sh
# 需要：python.org 的 Python 3.13 universal2 安裝檔（自帶 Tk 8.6；Homebrew 的 Python 只有本機架構、Tk 9 跑不動 tkinterweb），
#       config.json（複製 config.example.json，填入 Apps Script 網址與 token）。可用環境變數 PYTHON 指定其他 Python。
# 簽章：預設 ad-hoc，朋友第一次開要按右鍵 →「打開」。設了 CDNST_SIGN_IDENTITY（例如 "Developer ID Application: …"）時
#       改用 Developer ID 由內而外簽章（hardened runtime＋timestamp）。實測 arm64、x86_64（Rosetta）都不需要任何
#       entitlements（Tkhtml、Pillow、HTTPS、子程序都正常），所以不加；之後加了用到 JIT／ctypes callback 的套件再補。
#       之後要公證（.github/workflows/speedtest-mac.yml：notarytool submit → stapler staple → 重新壓 zip）。
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
core="$here/core"
icon="$root/assets/icons-prod/icon128.png"   # 視窗用正式版（src/icons 是開發版，右上有紅點）
icon_app="$root/assets/icon-master.png"       # App 圖示用 512px 原圖，PyInstaller 會用 Pillow 轉成 .icns
py="${PYTHON:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13}"
venv="$here/.venv"
work="$here/build/mac"
app="$root/release/CDNSpeedTest.app"
zip="$root/release/CDNSpeedTest-mac.zip"

[ -f "$here/config.json" ] || { echo "缺少 config.json：複製 config.example.json 並填入 upload_url / token" >&2; exit 1; }
"$py" -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("upload_url") else 1)' "$here/config.json" ||
  echo "警告：config.json 的 upload_url 是空的，打包出的 App 無法自動發送報告" >&2
[ "$(lipo -archs "$py" 2>/dev/null)" = "x86_64 arm64" ] ||
  { echo "$py 不是 universal2（請裝 python.org 的 macOS 64-bit universal2 安裝檔，或用 PYTHON 指定）" >&2; exit 1; }
ver="$(sed -n 's/^APP_VERSION = "\([^"]*\)".*/\1/p' "$here/app.py")"
[ -n "$ver" ] || { echo "app.py 找不到 APP_VERSION" >&2; exit 1; }

[ -x "$venv/bin/python" ] || "$py" -m venv "$venv"
vpy="$venv/bin/python"
"$vpy" -m pip install -q --disable-pip-version-check -r "$here/requirements.txt"

# PyInstaller 打 universal2 時每個二進位檔都要同時有兩種架構，PyPI 上 Pillow、Tkhtml 只有分開的 arm64／x86_64 wheel：
# 各下載一份解開，把同一路徑的 .so／.dylib 用 lipo 合成 universal2，蓋掉 venv 裡（本機架構）的那份
whl="$work/wheels"
site="$("$vpy" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
rm -rf "$whl"; mkdir -p "$whl"
for pkg in pillow tkinterweb-tkhtml; do
  pin="$pkg==$("$vpy" -m pip show "$pkg" | sed -n 's/^Version: //p')"
  "$vpy" -m pip install -q --disable-pip-version-check --force-reinstall --no-deps "$pin"   # 先還原成單一架構
  for arch in arm64 x86_64; do
    [ $arch = arm64 ] && plat=(--platform macosx_11_0_arm64) ||
      plat=(--platform macosx_10_13_x86_64 --platform macosx_10_9_x86_64 --platform macosx_10_6_x86_64)
    "$vpy" -m pip download -q --disable-pip-version-check --no-deps --only-binary=:all: --python-version 3.13 \
      "${plat[@]}" -d "$whl/$arch-whl" "$pin"
  done
done
for arch in arm64 x86_64; do for w in "$whl/$arch-whl"/*.whl; do unzip -qo "$w" -d "$whl/$arch"; done; done
(cd "$whl/arm64" && find . -type f \( -name '*.so' -o -name '*.dylib' \)) | while read -r f; do
  [ -f "$whl/x86_64/$f" ] || { echo "x86_64 wheel 缺少 $f" >&2; exit 1; }
  lipo -create "$whl/arm64/$f" "$whl/x86_64/$f" -output "$site/$f"
done

rm -rf "$app" "$zip"
"$vpy" -m PyInstaller --noconfirm --clean --windowed --onedir --target-arch universal2 --name CDNSpeedTest \
  --osx-bundle-identifier com.johnh.cdnspeedtest \
  --paths "$core" --paths "$here" \
  --hidden-import speedtest --hidden-import bili --hidden-import videos --hidden-import netinfo \
  --hidden-import qrlogin --hidden-import i18n --hidden-import extdetect --hidden-import updater --hidden-import lottery_text \
  --collect-all tkinterweb --collect-all tkinterweb_tkhtml \
  --add-data "$core/nodes.json:." --add-data "$here/config.json:." --add-data "$icon:." \
  --icon "$icon_app" \
  --distpath "$root/release" --workpath "$work" --specpath "$work" "$here/app.py"
rm -rf "$root/release/CDNSpeedTest"   # onedir 的中間產物，.app 裡已經有一份

plist="$app/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$ver" "$plist"
plutil -replace CFBundleVersion -string "$ver" "$plist"
plutil -replace CFBundleDisplayName -string "CDN SpeedTest" "$plist"
plutil -replace LSMinimumSystemVersion -string "11.0" "$plist"
plutil -replace NSHighResolutionCapable -bool true "$plist"
if [ -n "${CDNST_SIGN_IDENTITY:-}" ]; then
  # 由內而外：先簽 App 裡每個 Mach-O（.so、.dylib、Python 等，不含主程式），最後簽整個 App（主程式＋Info.plist）
  sign=(codesign --force --options runtime --timestamp --sign "$CDNST_SIGN_IDENTITY")
  main="$app/Contents/MacOS/CDNSpeedTest"
  find "$app/Contents" -type f ! -path "$main" -print0 | while IFS= read -r -d '' f; do
    if file -b "$f" | grep -q 'Mach-O'; then "${sign[@]}" "$f"; fi
  done
  find "$app/Contents" -type d -name '*.framework' -print0 | while IFS= read -r -d '' f; do "${sign[@]}" "$f"; done
  "${sign[@]}" "$app"
  codesign --verify --strict --deep "$app"
else
  codesign --force --deep --sign - "$app"   # 改了 Info.plist，重新 ad-hoc 簽章
fi
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
echo "完成：${zip}（v${ver}，$(du -h "$zip" | cut -f1)）"
