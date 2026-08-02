# 打包 src/ 成 Chrome / Firefox Web Store 可上傳的 zip，輸出到 dist/
# 用法：pwsh -File build.ps1                 # Chrome + Firefox 都打包
#       pwsh -File build.ps1 -Browser chrome # 只打包 Chrome
#       pwsh -File build.ps1 -Browser firefox
param(
  [ValidateSet("chrome", "firefox", "all")]
  [string]$Browser = "all"
)
$ErrorActionPreference = "Stop"

$root      = $PSScriptRoot
$src       = Join-Path $root "src"
$dist      = Join-Path $root "dist"
$iconsProd = Join-Path $root "assets\icons-prod"

function Read-ManifestVersion([string]$manifestPath) {
  # 用 UTF-8 讀，避免 PS 5.1 把中文讀成亂碼
  $manifest = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  return $manifest
}

function Build-Target([string]$name, [string]$manifestFile) {
  $manifestPath = Join-Path $src $manifestFile
  $manifest = Read-ManifestVersion $manifestPath
  $version = $manifest.version

  New-Item -ItemType Directory -Force $dist | Out-Null
  $zip = Join-Path $dist "bilibili-cdn-switcher-$name-$version.zip"
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }

  # manifest.json 必須在 zip 最上層；用暫存資料夾把該瀏覽器的 manifest 換上去再壓縮
  $stage = Join-Path $dist "_stage-$name"
  if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  New-Item -ItemType Directory -Force $stage | Out-Null

  Get-ChildItem -LiteralPath $src |
    Where-Object { $_.Name -ne "manifest.json" -and $_.Name -ne "manifest.firefox.json" } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse }
  Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $stage "manifest.json")

  # src/icons/ 平常放的是「開發版」（帶紅點角標，方便跟已安裝的正式版分辨）
  # 打包上架用的 zip 一律換成 assets/icons-prod/ 底下的正式版圖示
  if (Test-Path $iconsProd) {
    Get-ChildItem -LiteralPath $iconsProd -Filter "*.png" |
      ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage "icons") -Force }
  } else {
    Write-Warning "找不到 $iconsProd，zip 內会是 src/icons/ 目前的图示（可能是开发版）。请先执行 pwsh -File assets/gen-icons.ps1。"
  }

  # 不能用 Compress-Archive 或 ZipFile.CreateFromDirectory：Windows PowerShell 5.1 用的
  # .NET Framework 在压子资料夹（如 icons/）时有个已知 bug —— central directory 的档名会正规化
  # 成 `/`，但每个档案前面的 local file header 却还是留着 `\`，两边不一致。多数解压工具只看
  # central directory 所以看起来没事，但 Firefox 的验证器是读 local header，一样会打回
  # 「Invalid file name in archive」。改成手动逐一 CreateEntry，档名自己先正规化成 `/`
  # 再传进去，local/central 两边都会是同一个字串，不会有这个不一致的问题。
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zipStream = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
  $archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
      $relative = $_.FullName.Substring($stage.Length + 1) -replace '\\', '/'
      $entry = $archive.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
      $entryStream = $entry.Open()
      try {
        $fileStream = [System.IO.File]::OpenRead($_.FullName)
        try { $fileStream.CopyTo($entryStream) } finally { $fileStream.Dispose() }
      } finally { $entryStream.Dispose() }
    }
  } finally {
    $archive.Dispose()
    $zipStream.Dispose()
  }
  Remove-Item -LiteralPath $stage -Recurse -Force

  $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
  Write-Host "`n$($manifest.name) [$name]  v$version" -ForegroundColor Cyan
  $z.Entries | ForEach-Object { "  {0,-24} {1,7} B" -f $_.FullName, $_.Length }
  $z.Dispose()
  Write-Host "-> $zip  ($((Get-Item $zip).Length) B)`n" -ForegroundColor Green
}

if ($Browser -eq "all") {
  $chromeVersion = (Read-ManifestVersion (Join-Path $src "manifest.json")).version
  $firefoxVersion = (Read-ManifestVersion (Join-Path $src "manifest.firefox.json")).version
  if ($chromeVersion -ne $firefoxVersion) {
    Write-Warning "manifest.json ($chromeVersion) 与 manifest.firefox.json ($firefoxVersion) 版本号不一致，请先同步。"
  }
}

if ($Browser -eq "chrome" -or $Browser -eq "all") { Build-Target "chrome" "manifest.json" }
if ($Browser -eq "firefox" -or $Browser -eq "all") { Build-Target "firefox" "manifest.firefox.json" }
