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

& (Join-Path $PSScriptRoot 'setup-local.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Local setup failed.' }

& (Join-Path $PSScriptRoot 'test-phase-c.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Phase C local test failed.' }

Write-Host 'PASS Local database is reproducible and the Phase C suite passed.' -ForegroundColor Green
