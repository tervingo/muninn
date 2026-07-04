# Genera los iconos de la app (favicon, PWA, maskable, apple-touch-icon) a partir de
# public/muninn.png, usando System.Drawing (Windows, sin dependencias npm).
#
#   powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
#
# - favicon / iconos "any": fondo transparente, logo centrado.
# - maskable (Android) y apple-touch-icon (iOS): fondo opaco con el color del tema y
#   margen de seguridad (iOS compone la transparencia sobre negro y recorta esquinas).

Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot '..\public'
$bytes = [System.IO.File]::ReadAllBytes((Join-Path $dir 'muninn.png'))
$ms = New-Object System.IO.MemoryStream(,$bytes)
$src = [System.Drawing.Image]::FromStream($ms)
$bg = [System.Drawing.Color]::FromArgb(255, 30, 30, 46)  # #1e1e2e

function Make($name, $size, $frac, $opaque) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if ($opaque) { $g.Clear($bg) } else { $g.Clear([System.Drawing.Color]::Transparent) }
  $content = $size * $frac
  $scale = $content / [Math]::Max($src.Width, $src.Height)
  $w = $src.Width * $scale; $h = $src.Height * $scale
  $g.DrawImage($src, ([float](($size - $w) / 2)), ([float](($size - $h) / 2)), ([float]$w), ([float]$h))
  $g.Dispose()
  $bmp.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "generado $name (${size}x${size})"
}

Make 'favicon-48.png'           48  0.96 $false
Make 'pwa-192x192.png'          192 0.96 $false
Make 'pwa-512x512.png'          512 0.96 $false
Make 'pwa-maskable-512x512.png' 512 0.72 $true
Make 'apple-touch-icon.png'     180 0.86 $true

$src.Dispose(); $ms.Dispose()
Write-Output 'OK'
