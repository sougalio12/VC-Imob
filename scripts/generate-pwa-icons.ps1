$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'ios/App/App/Assets.xcassets/AppIcon.appiconset/VCImobAppIcon.png'
$source = [System.Drawing.Bitmap]::FromFile($sourcePath)

function Find-OfficialMarkBounds([System.Drawing.Bitmap]$bitmap) {
    $left = $bitmap.Width
    $top = $bitmap.Height
    $right = -1
    $bottom = -1
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
        for ($x = 0; $x -lt $bitmap.Width; $x++) {
            $pixel = $bitmap.GetPixel($x, $y)
            if (($pixel.R + $pixel.G + $pixel.B) -gt 120) {
                if ($x -lt $left) { $left = $x }
                if ($x -gt $right) { $right = $x }
                if ($y -lt $top) { $top = $y }
                if ($y -gt $bottom) { $bottom = $y }
            }
        }
    }
    if ($right -lt $left -or $bottom -lt $top) { throw 'Área institucional clara não encontrada no asset oficial.' }
    $size = [Math]::Max($right - $left + 1, $bottom - $top + 1)
    [System.Drawing.Rectangle]::new($left, $top, $size, $size)
}

function Write-PwaIcon([string]$destination, [int]$size) {
    $bounds = Find-OfficialMarkBounds $source
    $bounds.Inflate(-4, -4)
    $sample = $source.GetPixel($bounds.Left + 4, $bounds.Top + 4)
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear($sample)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $markSize = [Math]::Round($size * 0.75)
        $offset = [Math]::Floor(($size - $markSize) / 2)
        $target = [System.Drawing.Rectangle]::new($offset, $offset, $markSize, $markSize)
        $graphics.DrawImage($source, $target, $bounds, [System.Drawing.GraphicsUnit]::Pixel)
        $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

try {
    Write-PwaIcon (Join-Path $root 'crm/icons/icon-512.png') 512
    Write-PwaIcon (Join-Path $root 'crm/icons/icon-maskable-512.png') 512
    Write-PwaIcon (Join-Path $root 'crm/icons/icon-192.png') 192
    Write-PwaIcon (Join-Path $root 'crm/icons/apple-touch-icon.png') 180
} finally {
    $source.Dispose()
}

Write-Output 'Ícones PWA derivados fielmente do asset oficial, sem moldura externa.'
