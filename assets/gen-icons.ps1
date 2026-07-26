# 產生擴充圖示：粉色圓角底 + 白色雙向箭頭（線路切換）
# 用法：pwsh -File assets/gen-icons.ps1
Add-Type -AssemblyName System.Drawing

$root   = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "src\icons"
New-Item -ItemType Directory -Force $outDir | Out-Null

$S = 512
$bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# --- rounded-rect background ---
$r = 112
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $r*2, $r*2, 180, 90)
$path.AddArc($S-$r*2, 0, $r*2, $r*2, 270, 90)
$path.AddArc($S-$r*2, $S-$r*2, $r*2, $r*2, 0, 90)
$path.AddArc(0, $S-$r*2, $r*2, $r*2, 90, 90)
$path.CloseFigure()

$brushBg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0,0)),
    (New-Object System.Drawing.Point($S,$S)),
    [System.Drawing.Color]::FromArgb(255, 255, 138, 176),
    [System.Drawing.Color]::FromArgb(255, 235, 90, 140))
$g.FillPath($brushBg, $path)

# --- arrows ---
function New-Arrow {
    param($tailX, $tipX, $cy, $t, $hh, $hl)
    $dir = if ($tipX -gt $tailX) { 1 } else { -1 }
    $neck = $tipX - $dir * $hl
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $pts = @(
        (New-Object System.Drawing.PointF($tailX, ($cy - $t/2))),
        (New-Object System.Drawing.PointF($neck,   ($cy - $t/2))),
        (New-Object System.Drawing.PointF($neck,   ($cy - $hh))),
        (New-Object System.Drawing.PointF($tipX,    $cy)),
        (New-Object System.Drawing.PointF($neck,   ($cy + $hh))),
        (New-Object System.Drawing.PointF($neck,   ($cy + $t/2))),
        (New-Object System.Drawing.PointF($tailX, ($cy + $t/2)))
    )
    $p.AddPolygon([System.Drawing.PointF[]]$pts)
    return $p
}

$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,255,255,255))
$shadow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(46,120,20,55))

$top = New-Arrow -tailX 92  -tipX 420 -cy 166 -t 52 -hh 84 -hl 100
$bot = New-Arrow -tailX 420 -tipX 92  -cy 346 -t 52 -hh 84 -hl 100

# soft drop shadow for depth
$g.TranslateTransform(0, 9)
$g.FillPath($shadow, $top); $g.FillPath($shadow, $bot)
$g.ResetTransform()

$g.FillPath($white, $top)
$g.FillPath($white, $bot)
$g.Dispose()

# --- downscale + save ---
foreach ($size in 16, 32, 48, 128) {
    $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $go = [System.Drawing.Graphics]::FromImage($out)
    $go.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $go.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $go.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $go.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $go.Clear([System.Drawing.Color]::Transparent)
    $go.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
    $go.Dispose()
    $out.Save((Join-Path $outDir "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
}
# 512 母檔留在 assets/，不進 src/（不需要打包進擴充）
$bmp.Save((Join-Path $PSScriptRoot "icon-master.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Get-ChildItem $outDir | Select-Object Name, Length
