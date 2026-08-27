[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
if ((Resolve-Path -LiteralPath (Get-Location)).Path -ne (Resolve-Path -LiteralPath $repositoryRoot).Path) {
    throw "Run this script from the repository root: $repositoryRoot"
}

Write-Host '=== VC Imob local validation ===' -ForegroundColor Cyan
& node --check (Join-Path $PSScriptRoot 'local-property-server.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Local property fixture has invalid JavaScript syntax.' }
& node --check (Join-Path $repositoryRoot 'tests/phase-c/02_run_phase_c_tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Phase C runner has invalid JavaScript syntax.' }
& node --check (Join-Path $repositoryRoot 'tests/phase-d/run-phase-d-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Phase D runner has invalid JavaScript syntax.' }
$frontendScripts = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'crm/js') -Filter '*.js' -File
foreach ($script in $frontendScripts) { & node --check $script.FullName; if ($LASTEXITCODE -ne 0) { throw "Invalid frontend JavaScript: $($script.Name)" } }

& (Join-Path $PSScriptRoot 'setup-local.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Local setup failed.' }

& (Join-Path $PSScriptRoot 'test-phase-c.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Phase C local test failed.' }

& (Join-Path $PSScriptRoot 'test-phase-d.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Phase D local test failed.' }

& git diff --check
if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed.' }
Write-Host 'PASS Phase C regression' -ForegroundColor Green
Write-Host 'PASS Phase D tests' -ForegroundColor Green
Write-Host '0 failed' -ForegroundColor Green
