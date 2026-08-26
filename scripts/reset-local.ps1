[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot '_local-common.ps1')

Assert-LocalRepository
Assert-Tooling
Test-MigrationSourceParity
Get-LocalSupabaseEnvironment | Out-Null

Write-Host 'Resetting ONLY the local Supabase database...' -ForegroundColor Cyan
$env:SUPABASE_TELEMETRY_DISABLED = '1'
Invoke-SupabaseCommand db reset

Write-Host 'PASS Local database rebuilt from migrations. All prior local data was removed.' -ForegroundColor Green
