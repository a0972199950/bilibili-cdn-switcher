# 把 docs/ 的截图等比缩放并加黑边，输出成指定尺寸。原图保留不动。
# 输出到 docs/store-<宽>x<高>/
#
# 用法：
#   pwsh -File assets/make-screenshots.ps1                      # 预设 1280x800（商店截图规格）
#   pwsh -File assets/make-screenshots.ps1 -Width 1200 -Height 600
#
# 注意：Chrome Web Store 的截图只接受 1280x800 或 640x400，其他尺寸会被挡下。
param(
    [int]$Width  = 1280,
    [int]$Height = 800
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root   = Split-Path -Parent $PSScriptRoot
$inDir  = Join-Path $root "docs"
$outDir = Join-Path $inDir ("store-{0}x{1}" -f $Width, $Height)
New-Item -ItemType Directory -Force $outDir | Out-Null

# 注意：PowerShell 变数名不分大小写，$W 与 $w 会是同一个变数，
# 所以画布尺寸与缩放後尺寸必须用完全不同的名字。
$canvasW = $Width
$canvasH = $Height

Get-ChildItem -LiteralPath $inDir -Filter *.png | ForEach-Object {
    $img = [System.Drawing.Image]::FromFile($_.FullName)

    # 等比缩放：取较小的缩放倍率，让整张图完整放进画布（contain）
    $scale = [Math]::Min($canvasW / $img.Width, $canvasH / $img.Height)
    $drawW = [int][Math]::Round($img.Width  * $scale)
    $drawH = [int][Math]::Round($img.Height * $scale)
    $x = [int](($canvasW - $drawW) / 2)
    $y = [int](($canvasH - $drawH) / 2)

    $canvas = New-Object System.Drawing.Bitmap($canvasW, $canvasH, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.Clear([System.Drawing.Color]::Black)
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle($x, $y, $drawW, $drawH)))
    $g.Dispose()

    $out = Join-Path $outDir $_.Name
    $canvas.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

    $bar = if ($x -gt 0) { "左右各 $x px" } elseif ($y -gt 0) { "上下各 $y px" } else { "无黑边" }
    "{0,-14} {1,4}x{2,-5} -> 内容 {3,4}x{4,-5} (x{5:N2})  {6,-14} {7,9:N0} B" -f `
        $_.Name, $img.Width, $img.Height, $drawW, $drawH, $scale, $bar, (Get-Item $out).Length

    $canvas.Dispose()
    $img.Dispose()
}
