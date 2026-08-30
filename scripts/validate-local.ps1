[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
if ((Resolve-Path -LiteralPath (Get-Location)).Path -ne (Resolve-Path -LiteralPath $repositoryRoot).Path) {
    throw "Run this script from the repository root: $repositoryRoot"
}

Write-Host '=== VC Imob local validation ===' -ForegroundColor Cyan
& node --test (Join-Path $repositoryRoot 'tests/public-site.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Public site tests failed.' }
& node --check (Join-Path $PSScriptRoot 'local-property-server.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Local property fixture has invalid JavaScript syntax.' }
& node --check (Join-Path $repositoryRoot 'tests/phase-c/02_run_phase_c_tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Phase C runner has invalid JavaScript syntax.' }
& node --check (Join-Path $repositoryRoot 'tests/phase-d/run-phase-d-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Phase D runner has invalid JavaScript syntax.' }
& node --check (Join-Path $repositoryRoot 'tests/phase-e/run-phase-e-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Phase E runner has invalid JavaScript syntax.' }
& node --check (Join-Path $repositoryRoot 'tests/property-ad/run-property-ad-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Property-ad runner has invalid JavaScript syntax.' }
& node --check (Join-Path $repositoryRoot 'scripts/local-email-mock-server.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Local e-mail mock has invalid JavaScript syntax.' }
$frontendScripts = @(
    Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'js') -Filter '*.js' -File
    Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'crm/js') -Filter '*.js' -File
)
foreach ($script in $frontendScripts) { & node --check $script.FullName; if ($LASTEXITCODE -ne 0) { throw "Invalid frontend JavaScript: $($script.Name)" } }
$powershellScripts = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' -File
foreach ($script in $powershellScripts) {
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw "Invalid PowerShell syntax: $($script.Name): $($errors[0].Message)" }
}

& (Join-Path $PSScriptRoot 'setup-local.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Local setup failed.' }

& (Join-Path $PSScriptRoot 'test-phase-c.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Phase C local test failed.' }

& (Join-Path $PSScriptRoot 'test-phase-d.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Phase D local test failed.' }

& (Join-Path $PSScriptRoot 'test-phase-e.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Phase E local test failed.' }

& (Join-Path $PSScriptRoot 'test-property-ad.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Property-ad local test failed.' }

& git diff --check
if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed.' }
Write-Host 'PASS Phase C regression' -ForegroundColor Green
Write-Host 'PASS Phase D tests' -ForegroundColor Green
Write-Host 'PASS Phase E tests' -ForegroundColor Green
Write-Host 'PASS Property-ad tests' -ForegroundColor Green
Write-Host '0 failed' -ForegroundColor Green
