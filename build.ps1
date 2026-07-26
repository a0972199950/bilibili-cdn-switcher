# 打包 src/ 成 Chrome Web Store 可上傳的 zip，輸出到 dist/
# 用法：pwsh -File build.ps1
$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$src  = Join-Path $root "src"
$dist = Join-Path $root "dist"

# 版本號直接讀 manifest（用 UTF-8 讀，避免 PS 5.1 把中文讀成亂碼）
$manifestPath = Join-Path $src "manifest.json"
$manifest = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$version = $manifest.version

New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist "bilibili-cdn-switcher-$version.zip"
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }

# manifest.json 必須在 zip 最上層，所以壓 src/ 底下的內容而非 src/ 本身
$items = Get-ChildItem -LiteralPath $src | ForEach-Object { $_.FullName }
Compress-Archive -LiteralPath $items -DestinationPath $zip

Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead($zip)
Write-Host "`n$($manifest.name)  v$version" -ForegroundColor Cyan
$z.Entries | ForEach-Object { "  {0,-24} {1,7} B" -f $_.FullName, $_.Length }
$z.Dispose()
Write-Host "`n-> $zip  ($((Get-Item $zip).Length) B)`n" -ForegroundColor Green
