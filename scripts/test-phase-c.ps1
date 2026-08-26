[CmdletBinding()]
param(
    [switch]$SkipEdgeFunction,
    [switch]$KeepData
)

. (Join-Path $PSScriptRoot '_local-common.ps1')

Assert-LocalRepository
Assert-Tooling
Test-MigrationSourceParity
$local = Get-LocalSupabaseEnvironment

$headers = @{
    apikey = $local.SERVICE_ROLE_KEY
    Authorization = "Bearer $($local.SERVICE_ROLE_KEY)"
    'Content-Type' = 'application/json'
}
$testEmails = @(
    'phase-c-owner-a@example.com',
    'phase-c-manager-a@example.com',
    'phase-c-agent-a1@example.com',
    'phase-c-agent-a2@example.com',
    'phase-c-disabled-a@example.com',
    'phase-c-owner-b@example.com'
)
$userIds = @{}
$backgroundProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$cleanupRequired = $false
$testExitCode = 1

function Invoke-LocalAdminApi {
    param(
        [Parameter(Mandatory)][ValidateSet('GET', 'POST', 'DELETE')][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [object]$Body
    )

    Assert-LocalUrl $local.API_URL
    $parameters = @{
        Method = $Method
        Uri = "$($local.API_URL)$Path"
        Headers = $headers
    }
    if ($null -ne $Body) {
        $parameters.Body = $Body | ConvertTo-Json -Depth 8 -Compress
    }
    return Invoke-RestMethod @parameters
}

function Remove-ExistingTestUsers {
    $page = Invoke-LocalAdminApi -Method GET -Path '/auth/v1/admin/users?page=1&per_page=1000'
    foreach ($user in @($page.users)) {
        if ($user.email -and $testEmails.Contains($user.email.ToLowerInvariant())) {
            Invoke-LocalAdminApi -Method DELETE -Path "/auth/v1/admin/users/$($user.id)" | Out-Null
        }
    }
}

function New-TestPassword {
    $bytes = New-Object byte[] 24
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return "Local!$([Convert]::ToBase64String($bytes).Replace('/', 'A').Replace('+', 'B').TrimEnd('='))"
}

function New-LocalTestUser {
    param([Parameter(Mandatory)][string]$Email, [Parameter(Mandatory)][string]$Password)

    $company = if ($Email -eq 'phase-c-owner-b@example.com') { '[PHASE_C_TEST] Organization B' } else { "[PHASE_C_TEST] Bootstrap $Email" }
    $created = Invoke-LocalAdminApi -Method POST -Path '/auth/v1/admin/users' -Body @{
        email = $Email
        password = $Password
        email_confirm = $true
        user_metadata = @{
            full_name = $Email.Split('@')[0]
            company_name = $company
        }
    }
    if (-not $created.id) { throw "Auth Admin API did not return an id for $Email" }
    $userIds[$Email] = [string]$created.id
}

function Wait-HttpEndpoint {
    param([Parameter(Mandatory)][string]$Url, [int]$Attempts = 30)

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 | Out-Null
            return
        } catch {
            if ($attempt -eq $Attempts) { throw "Endpoint did not become ready: $Url" }
            Start-Sleep -Milliseconds 500
        }
    }
}

function Wait-LocalEdgeFunction {
    param([Parameter(Mandatory)][string]$Url, [int]$Attempts = 60)

    Assert-LocalUrl $local.API_URL
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Method OPTIONS -Uri $Url -Headers @{ Origin = 'http://127.0.0.1:4173' } -TimeoutSec 2
            if ($response.StatusCode -eq 204) { return }
        } catch {
            if ($attempt -eq $Attempts) { throw "Local Edge Function did not become ready: $Url" }
            Start-Sleep -Milliseconds 500
        }
    }
}

function Start-HiddenProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$ArgumentList,
        [Parameter(Mandatory)][string]$LogPrefix
    )

    $localDirectory = Join-Path $script:RepositoryRoot 'supabase/.local'
    New-Item -ItemType Directory -Force -Path $localDirectory | Out-Null
    $stdout = Join-Path $localDirectory "$LogPrefix.out.log"
    $stderr = Join-Path $localDirectory "$LogPrefix.err.log"
    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $script:RepositoryRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $backgroundProcesses.Add($process)
    return $process
}

try {
    Write-Host 'Creating six synthetic users through the LOCAL Auth Admin API...' -ForegroundColor Cyan
    $cleanupRequired = $true
    Remove-ExistingTestUsers
    $password = New-TestPassword
    foreach ($email in $testEmails) {
        New-LocalTestUser -Email $email -Password $password
    }

    Write-Host 'Preparing isolated Phase C organizations and memberships...' -ForegroundColor Cyan
    Invoke-LocalSqlFile (Join-Path $script:RepositoryRoot 'tests/phase-c/01_prepare_test_data.sql')

    $loginHeaders = @{
        apikey = $local.ANON_KEY
        'Content-Type' = 'application/json'
    }
    $loginBody = @{
        email = 'phase-c-owner-a@example.com'
        password = $password
    } | ConvertTo-Json -Compress
    $ownerSession = Invoke-RestMethod -Method POST -Uri "$($local.API_URL)/auth/v1/token?grant_type=password" -Headers $loginHeaders -Body $loginBody
    if (-not $ownerSession.access_token) { throw 'Unable to authenticate the synthetic owner A.' }

    $membershipHeaders = @{
        apikey = $local.ANON_KEY
        Authorization = "Bearer $($ownerSession.access_token)"
        'Content-Type' = 'application/json'
    }
    $ownerMemberships = Invoke-RestMethod -Method POST -Uri "$($local.API_URL)/rest/v1/rpc/get_my_active_memberships" -Headers $membershipHeaders -Body '{}'
    $organizationId = @($ownerMemberships)[0].organization_id
    if (-not $organizationId) { throw 'Unable to resolve Organization A through get_my_active_memberships().' }

    $env:PHASE_C_CONFIRM = 'RUN_ON_LOCAL_ONLY'
    $env:SUPABASE_URL = $local.API_URL
    $env:SUPABASE_ANON_KEY = $local.ANON_KEY
    $env:SUPABASE_SERVICE_ROLE_KEY = $local.SERVICE_ROLE_KEY
    $env:PHASE_C_TEST_PASSWORD = $password

    if (-not $SkipEdgeFunction) {
        $catalog = Get-Content -LiteralPath (Join-Path $script:RepositoryRoot 'data/imoveis.json') -Raw | ConvertFrom-Json
        $property = @($catalog) | Where-Object {
            $_.ativo -eq $true -and [string]$_.codigo -match '^[A-Za-z0-9-]{3,32}$'
        } | Select-Object -First 1
        if (-not $property) { throw 'No active synthetic-testable property exists in data/imoveis.json.' }

        Write-Host 'Starting local property fixture and site-lead Edge Function...' -ForegroundColor Cyan
        Start-HiddenProcess -FilePath (Get-Command node).Source -ArgumentList @('scripts/local-property-server.mjs') -LogPrefix 'property-server' | Out-Null
        Wait-HttpEndpoint 'http://127.0.0.1:4173/data/imoveis.json'

        $envPath = Join-Path $script:RepositoryRoot 'supabase/.local/site-lead.env'
        @(
            "SITE_LEAD_ORGANIZATION_ID=$organizationId"
            'SITE_LEAD_ALLOWED_ORIGINS=http://127.0.0.1:4173'
            'SITE_LEAD_RATE_LIMIT_SALT=local-phase-c-rate-limit-only'
            'SITE_PUBLIC_URL=http://host.docker.internal:4173'
        ) | Set-Content -LiteralPath $envPath -Encoding utf8

        $serveArguments = @($script:SupabaseLaunch.PrefixArguments) + @('functions', 'serve', 'site-lead', '--env-file', $envPath)
        Start-HiddenProcess -FilePath $script:SupabaseLaunch.FilePath -ArgumentList $serveArguments -LogPrefix 'site-lead' | Out-Null

        $env:PHASE_C_SITE_LEAD_URL = "$($local.API_URL)/functions/v1/site-lead"
        $env:PHASE_C_SITE_ORIGIN = 'http://127.0.0.1:4173'
        $env:PHASE_C_PROPERTY_CODE = [string]$property.codigo
        Wait-LocalEdgeFunction $env:PHASE_C_SITE_LEAD_URL
    } else {
        Remove-Item Env:PHASE_C_SITE_LEAD_URL -ErrorAction SilentlyContinue
        Remove-Item Env:PHASE_C_SITE_ORIGIN -ErrorAction SilentlyContinue
        Remove-Item Env:PHASE_C_PROPERTY_CODE -ErrorAction SilentlyContinue
    }

    Write-Host 'Running Phase C security suite against 127.0.0.1 only...' -ForegroundColor Cyan
    & node (Join-Path $script:RepositoryRoot 'tests/phase-c/02_run_phase_c_tests.mjs')
    $testExitCode = $LASTEXITCODE
    if ($testExitCode -ne 0) { throw "Phase C suite failed with exit code $testExitCode." }

    Write-Host 'PASS All requested Phase C local tests passed.' -ForegroundColor Green
} finally {
    foreach ($process in $backgroundProcesses) {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }

    if ($cleanupRequired -and -not $KeepData) {
        Write-Host 'Cleaning synthetic local test data...' -ForegroundColor Cyan
        Invoke-LocalSqlFile (Join-Path $script:RepositoryRoot 'tests/phase-c/03_cleanup_test_data.sql')
    } elseif ($KeepData) {
        Write-Warning 'Synthetic test data was intentionally preserved locally because -KeepData was supplied.'
    }

    foreach ($name in @('PHASE_C_CONFIRM', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PHASE_C_TEST_PASSWORD', 'PHASE_C_SITE_LEAD_URL', 'PHASE_C_SITE_ORIGIN', 'PHASE_C_PROPERTY_CODE')) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
}
