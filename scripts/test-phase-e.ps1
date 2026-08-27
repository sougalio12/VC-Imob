[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot '_local-common.ps1')
Assert-LocalRepository
Assert-Tooling
Test-MigrationSourceParity
$local=Get-LocalSupabaseEnvironment
$bytes=New-Object byte[] 24; $generator=[System.Security.Cryptography.RandomNumberGenerator]::Create()
try{$generator.GetBytes($bytes)}finally{$generator.Dispose()}
$env:PHASE_E_CONFIRM='RUN_ON_LOCAL_ONLY'; $env:SUPABASE_URL=$local.API_URL; $env:SUPABASE_ANON_KEY=$local.ANON_KEY; $env:SUPABASE_SERVICE_ROLE_KEY=$local.SERVICE_ROLE_KEY
$env:PHASE_E_TEST_PASSWORD="Local!$([Convert]::ToBase64String($bytes).Replace('/', 'A').Replace('+', 'B').TrimEnd('='))"
try {
 Invoke-LocalSqlFile (Join-Path $script:RepositoryRoot 'tests/phase-e/01_prepare_test_helpers.sql')
 & node (Join-Path $script:RepositoryRoot 'tests/phase-e/run-phase-e-tests.mjs')
 if ($LASTEXITCODE -ne 0) { throw "Phase E suite failed with exit code $LASTEXITCODE." }
 Write-Host 'PASS Phase E tests.' -ForegroundColor Green
} finally {
 Invoke-LocalSqlFile (Join-Path $script:RepositoryRoot 'tests/phase-e/03_cleanup_test_data.sql')
 foreach($name in @('PHASE_E_CONFIRM','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','PHASE_E_TEST_PASSWORD')){Remove-Item "Env:$name" -ErrorAction SilentlyContinue}
}
