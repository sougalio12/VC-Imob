[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot '_local-common.ps1')

Assert-LocalRepository
Assert-Tooling
Test-MigrationSourceParity

Write-Host 'Starting the isolated local Supabase stack...' -ForegroundColor Cyan
$env:SUPABASE_TELEMETRY_DISABLED = '1'
Invoke-SupabaseCommand start

Write-Host 'Rebuilding the local database from the automatic migration chain...' -ForegroundColor Cyan
Invoke-SupabaseCommand db reset

$local = Get-LocalSupabaseEnvironment
Write-Host "PASS Local Supabase is ready at $($local.API_URL)" -ForegroundColor Green
Write-Host 'No remote project, production data, or remote SQL was accessed.' -ForegroundColor Green
