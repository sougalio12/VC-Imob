[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  $behavior=@(
    'tests/phase-f/f2-agenda.test.mjs','tests/phase-f/f3-matching.test.mjs',
    'tests/phase-f/f4-scoring.test.mjs','tests/phase-f/f5-dashboard.test.mjs',
    'tests/phase-f/f6-automations.test.mjs','tests/phase-f/f7-quality.test.mjs',
    'tests/phase-f/advanced.test.mjs'
  )
  & node --test $behavior
  if($LASTEXITCODE -ne 0){throw 'Phase F behavior tests failed.'}
  if($env:PGLITE_PACKAGE){
    & node --test tests/phase-f/database.test.mjs
    if($LASTEXITCODE -ne 0){throw 'Phase F database tests failed.'}
  } else { Write-Warning 'Phase F database tests NOT RUN: set PGLITE_PACKAGE to @electric-sql/pglite 0.5.8.' }
} finally { Pop-Location }
