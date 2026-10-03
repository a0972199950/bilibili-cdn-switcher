# 打包 Bilibili CDN 測速 GUI 成單一 exe：<repo>\release\CDNSpeedTest.exe（發版產物都放 release/，npm run package 會一起打包擴充）
# 用法（PowerShell）：powershell -ExecutionPolicy Bypass -File tools\cdn-speedtest-app\build.ps1
# 需要：Python 3（含 tkinter）、config.json（複製 config.example.json，填入 Apps Script 網址與 token）
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path "$here\..\..").Path
$core = "$here\core"
$icon = "$root\assets\icons-prod\icon128.png"   # 正式版（src/icons 是開發版，右上有紅點）
$iconExe = "$root\assets\icon-master.png"        # exe 檔案圖示用 512px 原圖，各尺寸較清晰

if (-not (Test-Path "$here\config.json")) { throw "缺少 config.json：複製 config.example.json 並填入 upload_url / token" }
$cfg = Get-Content "$here\config.json" -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $cfg.upload_url) { Write-Warning "config.json 的 upload_url 是空的：打包出的 exe 無法自動發送報告" }

$py = (Get-Command python3 -ErrorAction SilentlyContinue)
if (-not $py) { $py = Get-Command python -ErrorAction Stop }
if (-not (Test-Path "$here\.venv")) { & $py.Source -m venv "$here\.venv" }
$vpy = "$here\.venv\Scripts\python.exe"
& $vpy -m pip install -q --disable-pip-version-check -r "$here\requirements.txt"
if ($LASTEXITCODE -ne 0) { throw "pip install 失敗" }

& $vpy -m PyInstaller --noconfirm --clean --onefile --windowed --name CDNSpeedTest `
    --paths "$core" --paths "$here" `
    --hidden-import speedtest --hidden-import bili --hidden-import videos --hidden-import netinfo `
    --hidden-import qrlogin --hidden-import i18n --hidden-import extdetect `
    --collect-all tkinterweb --collect-all tkinterweb_tkhtml `
    --add-data "$core\nodes.json;." --add-data "$here\config.json;." --add-data "$icon;." `
    --icon "$iconExe" `
    --distpath "$root\release" --workpath "$here\build" --specpath "$here\build" "$here\app.py"
if ($LASTEXITCODE -ne 0) { throw "PyInstaller 失敗" }
Write-Host "完成：$root\release\CDNSpeedTest.exe"
