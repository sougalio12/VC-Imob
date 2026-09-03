[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot
try {
    & node --test tests/phase-g/phase-g.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Phase G tests failed.' }
} finally {
    Pop-Location
}
