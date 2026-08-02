# 產生擴充圖示：粉色圓角底 + 白色雙向箭頭（線路切換）
# 同時產生兩份：
#   src/icons/           開發版（多一個紅色圓點角標），Load unpacked 時讀到的就是這份，方便跟已安裝的正式版分辨
#   assets/icons-prod/    正式版（無角標），build.ps1 打包 zip 時會換成這份
# 用法：pwsh -File assets/gen-icons.ps1
Add-Type -AssemblyName System.Drawing

$root       = Split-Path -Parent $PSScriptRoot
$devOutDir  = Join-Path $root "src\icons"
$prodOutDir = Join-Path $root "assets\icons-prod"
New-Item -ItemType Directory -Force $devOutDir  | Out-Null
New-Item -ItemType Directory -Force $prodOutDir | Out-Null

$S = 512

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

function New-IconMaster {
    param([bool]$IsDev)

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

    if ($IsDev) {
        $badgeR = 92
        $cx = $S - $badgeR - 16
        $cy = $badgeR + 16
        $badgeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 220, 20, 20))
        $whitePen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 16)
        $g.FillEllipse($badgeBrush, ($cx - $badgeR), ($cy - $badgeR), ($badgeR*2), ($badgeR*2))
        $g.DrawEllipse($whitePen, ($cx - $badgeR), ($cy - $badgeR), ($badgeR*2), ($badgeR*2))
        $badgeBrush.Dispose()
        $whitePen.Dispose()
    }

    $g.Dispose()
    return $bmp
}

function Save-IconSet {
    param([System.Drawing.Bitmap]$Master, [string]$OutDir)

    foreach ($size in 16, 32, 48, 128) {
        $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $go = [System.Drawing.Graphics]::FromImage($out)
        $go.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $go.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $go.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $go.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $go.Clear([System.Drawing.Color]::Transparent)
        $go.DrawImage($Master, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
        $go.Dispose()
        $out.Save((Join-Path $OutDir "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $out.Dispose()
    }
}

$prodMaster = New-IconMaster -IsDev $false
$devMaster  = New-IconMaster -IsDev $true

Save-IconSet -Master $prodMaster -OutDir $prodOutDir
Save-IconSet -Master $devMaster  -OutDir $devOutDir

# 512 母檔（正式版，無角標）留在 assets/，不進 src/（不需要打包進擴充）
$prodMaster.Save((Join-Path $PSScriptRoot "icon-master.png"), [System.Drawing.Imaging.ImageFormat]::Png)

$prodMaster.Dispose()
$devMaster.Dispose()

Write-Host "`n開發版（含角標，src/icons/ 平常載入未封裝用的就是這份）：" -ForegroundColor Yellow
Get-ChildItem $devOutDir | Select-Object Name, Length
Write-Host "`n正式版（無角標，build.ps1 打包 zip 時會換成這份）：" -ForegroundColor Green
Get-ChildItem $prodOutDir | Select-Object Name, Length
