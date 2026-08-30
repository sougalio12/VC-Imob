[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
    & node --test tests/phase-f1/kanban.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'F.1 behavior tests failed.' }
    if ($env:PGLITE_PACKAGE) {
        & node --test tests/phase-f1/database.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'F.1 embedded PostgreSQL tests failed.' }
    } else {
        Write-Warning 'F.1 PostgreSQL tests NOT RUN: set PGLITE_PACKAGE to local @electric-sql/pglite 0.5.8 package. See docs/phase-f1.md.'
    }
} finally { Pop-Location }
