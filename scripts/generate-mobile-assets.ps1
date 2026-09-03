$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$icon = Join-Path $root 'crm/icons/icon-512.png'
$maskable = Join-Path $root 'crm/icons/icon-maskable-512.png'

function Write-ResizedPng([string]$source, [string]$destination, [int]$width, [int]$height) {
    if (Test-Path -LiteralPath $destination) { return }
    $input = [System.Drawing.Image]::FromFile($source)
    try {
        $bitmap = New-Object System.Drawing.Bitmap($width, $height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::FromArgb(11, 11, 11))
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($input, 0, 0, $width, $height)
            $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    } finally { $input.Dispose() }
}

$densities = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($entry in $densities.GetEnumerator()) {
    $folder = Join-Path $root "android/app/src/main/res/mipmap-$($entry.Key)"
    Write-ResizedPng $icon (Join-Path $folder 'vc_imob_launcher.png') $entry.Value $entry.Value
    Write-ResizedPng $icon (Join-Path $folder 'vc_imob_launcher_round.png') $entry.Value $entry.Value
    Write-ResizedPng $maskable (Join-Path $folder 'vc_imob_foreground.png') ($entry.Value * 2) ($entry.Value * 2)
}

Write-ResizedPng $icon (Join-Path $root 'ios/App/App/Assets.xcassets/AppIcon.appiconset/VCImobAppIcon.png') 1024 1024

$splashTargets = @(Get-ChildItem (Join-Path $root 'android/app/src/main/res') -Recurse -Filter 'splash.png')
$splashTargets += @(Get-ChildItem (Join-Path $root 'ios/App/App/Assets.xcassets/Splash.imageset') -Filter 'splash-*.png')
foreach ($target in $splashTargets) {
    $existing = [System.Drawing.Image]::FromFile($target.FullName)
    try { $width = $existing.Width; $height = $existing.Height } finally { $existing.Dispose() }
    $name = if ($target.Directory.Name -eq 'Splash.imageset') { "vc-imob-$($target.Name)" } else { 'vc_imob_splash.png' }
    Write-ResizedPng $maskable (Join-Path $target.Directory.FullName $name) $width $height
}

Write-Output 'Assets mobile derivados da identidade oficial foram atualizados.'
