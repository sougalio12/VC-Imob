Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RepositoryRoot = Split-Path -Parent $PSScriptRoot
$script:ProductionProjectRef = 'isbkhhobutbdtdtpaavn'
$script:LocalProjectId = 'vc-imob-local'
$script:LocalApiUrls = @('http://127.0.0.1:54321', 'http://localhost:54321')
$script:SupabaseCliVersion = '2.115.0'
$script:SupabaseLaunch = $null

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(ValueFromRemainingArguments)][string[]]$Arguments
    )

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Executable $($Arguments -join ' ')"
    }
}

function Assert-LocalRepository {
    $configPath = Join-Path $script:RepositoryRoot 'supabase/config.toml'
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw 'supabase/config.toml is missing.'
    }

    $config = Get-Content -LiteralPath $configPath -Raw
    if ($config -notmatch '(?m)^project_id\s*=\s*"vc-imob-local"\s*$') {
        throw 'Refusing to continue: config.toml is not the vc-imob-local project.'
    }

    if ((Resolve-Path -LiteralPath (Get-Location)).Path -ne (Resolve-Path -LiteralPath $script:RepositoryRoot).Path) {
        throw "Run this script from the repository root: $script:RepositoryRoot"
    }
}

function Assert-LocalUrl {
    param([Parameter(Mandatory)][string]$Url)

    $normalized = $Url.TrimEnd('/')
    if ($normalized -notin $script:LocalApiUrls -or $normalized.Contains($script:ProductionProjectRef)) {
        throw "REFUSING NON-LOCAL SUPABASE URL: $Url"
    }
}

function Assert-Tooling {
    $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCommand) {
        $dockerCandidate = Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'
        if (Test-Path -LiteralPath $dockerCandidate) {
            $env:PATH = "$(Split-Path -Parent $dockerCandidate);$env:PATH"
        }
    }

    foreach ($command in @('docker', 'node', 'npx')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "Required command not found: $command"
        }
    }

    Invoke-CheckedCommand docker version --format '{{.Server.Version}}'
    $env:SUPABASE_TELEMETRY_DISABLED = '1'
    $directSupabase = Get-Command supabase -ErrorAction SilentlyContinue
    if ($directSupabase) {
        $script:SupabaseLaunch = @{
            FilePath = $directSupabase.Source
            PrefixArguments = @()
        }
    } else {
        $script:SupabaseLaunch = @{
            FilePath = (Get-Command npx).Source
            PrefixArguments = @('--yes', "supabase@$($script:SupabaseCliVersion)")
        }
    }
    Invoke-SupabaseCommand --version
    Invoke-CheckedCommand node --version
}

function Invoke-SupabaseCommand {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)

    if (-not $script:SupabaseLaunch) {
        throw 'Supabase CLI launch configuration is not initialized. Run Assert-Tooling first.'
    }
    $allArguments = @($script:SupabaseLaunch.PrefixArguments) + @($Arguments)
    Invoke-CheckedCommand $script:SupabaseLaunch.FilePath @allArguments
}

function Invoke-LocalDatabaseReset {
    try {
        Invoke-SupabaseCommand db reset
        return
    } catch {
        $resetError = $_
        Write-Warning 'Supabase CLI reported a reset failure; checking whether this is the known delayed Storage healthcheck.'
        $storageContainer = "supabase_storage_$($script:LocalProjectId)"
        $databaseContainer = "supabase_db_$($script:LocalProjectId)"

        for ($attempt = 1; $attempt -le 180; $attempt++) {
            $storageHealth = & docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $storageContainer 2>$null
            $migrationApplied = & docker exec $databaseContainer psql -X -A -t -U postgres -d postgres -c "select count(*) from supabase_migrations.schema_migrations where version='20260827100000'" 2>$null
            if ($LASTEXITCODE -eq 0 -and $storageHealth -eq 'healthy' -and $migrationApplied.Trim() -eq '1') {
                Write-Warning 'Accepted the local reset after independent checks: Storage is healthy and the final automatic migration is recorded.'
                return
            }
            Start-Sleep -Seconds 1
        }

        throw $resetError
    }
}

function Get-LocalSupabaseEnvironment {
    $env:SUPABASE_TELEMETRY_DISABLED = '1'
    $allArguments = @($script:SupabaseLaunch.PrefixArguments) + @('status', '-o', 'env')
    $lines = & $script:SupabaseLaunch.FilePath @allArguments
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to read local Supabase status.'
    }

    $values = @{}
    foreach ($line in $lines) {
        if ($line -match '^([A-Z0-9_]+)="(.*)"$') {
            $values[$Matches[1]] = $Matches[2]
        }
    }

    foreach ($required in @('API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY')) {
        if (-not $values.ContainsKey($required) -or [string]::IsNullOrWhiteSpace($values[$required])) {
            throw "supabase status did not return $required."
        }
    }

    Assert-LocalUrl $values.API_URL
    return $values
}

function Get-LocalDatabaseContainer {
    $containers = @(& docker ps --filter "name=supabase_db_$($script:LocalProjectId)" --format '{{.Names}}')
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inspect Docker containers.'
    }

    $container = $containers | Where-Object { $_ -eq "supabase_db_$($script:LocalProjectId)" } | Select-Object -First 1
    if (-not $container) {
        throw "Local database container not found: supabase_db_$($script:LocalProjectId)"
    }
    return $container
}

function Invoke-LocalSqlFile {
    param([Parameter(Mandatory)][string]$Path)

    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if (-not $resolved.StartsWith((Resolve-Path -LiteralPath $script:RepositoryRoot).Path, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "SQL file is outside this repository: $resolved"
    }

    $container = Get-LocalDatabaseContainer
    Get-Content -LiteralPath $resolved -Raw | & docker exec -i $container psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
    if ($LASTEXITCODE -ne 0) {
        throw "Local SQL failed: $resolved"
    }
}

function Test-MigrationSourceParity {
    $pairs = [ordered]@{
        'supabase/20260824_initial_crm.sql' = 'supabase/migrations/20260824000000_initial_crm.sql'
        'supabase/20260825_grant_authenticated_crm.sql' = 'supabase/migrations/20260825001000_authenticated_crm_grants.sql'
        'supabase/20260825_add_site_lead_capture.sql' = 'supabase/migrations/20260825002000_site_lead_rate_limit.sql'
        'supabase/20260825_add_site_lead_deduplication.sql' = 'supabase/migrations/20260825003000_site_lead_capture.sql'
        'supabase/20260825_secure_lead_relationships.sql' = 'supabase/migrations/20260825004000_secure_lead_relationships.sql'
        'supabase/20260825_10_saas_core.sql' = 'supabase/migrations/20260825100000_saas_core.sql'
        'supabase/20260825_20_plans_entitlements.sql' = 'supabase/migrations/20260825200000_plans_entitlements.sql'
        'supabase/20260825_30_billing_foundation.sql' = 'supabase/migrations/20260825300000_billing_foundation.sql'
        'supabase/20260825_40_organization_sites.sql' = 'supabase/migrations/20260825400000_organization_sites.sql'
        'supabase/20260825_50_lead_interests.sql' = 'supabase/migrations/20260825500000_lead_interests.sql'
        'supabase/20260825_60_team_foundation.sql' = 'supabase/migrations/20260825600000_team_foundation.sql'
        'supabase/20260825_70_active_memberships_rpc.sql' = 'supabase/migrations/20260825700000_active_memberships_rpc.sql'
        'supabase/20260825_80_phase_c_helpers.sql' = 'supabase/migrations/20260825800000_phase_c_helpers.sql'
        'supabase/20260825_81_phase_c_membership_bootstrap.sql' = 'supabase/migrations/20260825810000_phase_c_membership_bootstrap.sql'
        'supabase/20260825_82_phase_c_integrity_prepare.sql' = 'supabase/migrations/20260825820000_phase_c_integrity_prepare.sql'
        'supabase/20260825_85_phase_c_rls_activation.sql' = 'supabase/migrations/20260825850000_phase_c_rls_activation.sql'
        'supabase/20260825_86_phase_c_leads_insert_returning_fix.sql' = 'supabase/migrations/20260825860000_phase_c_leads_insert_returning_fix.sql'
        'supabase/20260826_00_phase_d_team_management.sql' = 'supabase/migrations/20260826000000_phase_d_team_management.sql'
        'supabase/20260827_00_phase_e_billing.sql' = 'supabase/migrations/20260827000000_phase_e_billing.sql'
        'supabase/20260827_10_property_ad_submissions.sql' = 'supabase/migrations/20260827100000_property_ad_submissions.sql'
    }

    foreach ($pair in $pairs.GetEnumerator()) {
        $source = Join-Path $script:RepositoryRoot $pair.Key
        $migration = Join-Path $script:RepositoryRoot $pair.Value
        if (-not (Test-Path -LiteralPath $source) -or -not (Test-Path -LiteralPath $migration)) {
            throw "Missing migration parity pair: $($pair.Key) -> $($pair.Value)"
        }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $migration).Hash) {
            throw "Automatic migration differs from historical source: $($pair.Value)"
        }
    }

    $automaticNames = Get-ChildItem -LiteralPath (Join-Path $script:RepositoryRoot 'supabase/migrations') -File -Filter '*.sql' | Select-Object -ExpandProperty Name
    if ($automaticNames -match 'phase_c_diagnostics|rollback_legacy_rls|_83_|_84_') {
        throw 'Diagnostic 83 or rollback 84 was found in the automatic migration chain.'
    }
}
