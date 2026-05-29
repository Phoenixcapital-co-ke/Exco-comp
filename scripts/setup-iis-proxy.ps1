# Configure IIS reverse proxy: dashboard.phoenixcapitalkenya.com -> http://127.0.0.1:3000
# Run in PowerShell AS ADMINISTRATOR on the Windows Server.

$ErrorActionPreference = 'Stop'

$SiteName = 'dashboard.phoenixcapitalkenya.com'
$AppRoot = 'C:\Apps\exco'
$BackendUrl = 'http://127.0.0.1:3000/{R:1}'
$PublicUrl = 'https://dashboard.phoenixcapitalkenya.com'

Write-Host "=== Exco IIS reverse proxy setup ===" -ForegroundColor Green

# --- 1. Node app on 3000 ---
Set-Location $AppRoot

$local = curl.exe -s http://127.0.0.1:3000/api/system/status 2>$null
if ($local -match 'maintenance') {
    Write-Host "[OK] Node responds on :3000 -> $local" -ForegroundColor Green
} else {
    Write-Host "[WARN] Node not responding on :3000 — starting pm2..." -ForegroundColor Yellow
    pm2 delete exco -s 2>$null
    pm2 delete exco-dashboard -s 2>$null
    npm run pm2:start
    pm2 save
    Start-Sleep -Seconds 3
    $local = curl.exe -s http://127.0.0.1:3000/api/system/status
    if ($local -notmatch 'maintenance') {
        Write-Host "[FAIL] Still no response on :3000. Check: pm2 logs exco-dashboard" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Node now on :3000" -ForegroundColor Green
}

# --- 2. Production .env keys ---
$envFile = Join-Path $AppRoot '.env'
if (Test-Path $envFile) {
    $content = Get-Content $envFile -Raw
    $envUpdates = @{
        PORT           = '3000'
        NODE_ENV       = 'production'
        APP_BASE_URL   = $PublicUrl
        COOKIE_SECURE  = 'true'
    }
    foreach ($key in $envUpdates.Keys) {
        $val = $envUpdates[$key]
        if ($content -match "(?m)^$key=") {
            $content = $content -replace "(?m)^$key=.*", "$key=$val"
        } else {
            $content = $content.TrimEnd() + "`r`n$key=$val`r`n"
        }
    }
    Set-Content $envFile $content.TrimEnd() -Encoding UTF8 -NoNewline
    Add-Content $envFile '' -Encoding UTF8
    pm2 restart exco-dashboard --update-env 2>$null
    pm2 restart exco --update-env 2>$null
    Write-Host "[OK] .env updated (PORT, APP_BASE_URL, COOKIE_SECURE)" -ForegroundColor Green
}

# --- 3. web.config in IIS site folder ---
Import-Module WebAdministration -ErrorAction Stop

$site = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
if (-not $site) {
    Write-Host "[FAIL] IIS site '$SiteName' not found. Create it in IIS Manager first." -ForegroundColor Red
    Get-Website | Format-Table Name, State, PhysicalPath -AutoSize
    exit 1
}

$sitePath = $site.physicalPath
Write-Host "IIS site path: $sitePath" -ForegroundColor Cyan

$webConfigSrc = Join-Path $AppRoot 'web.config'
$webConfigDst = Join-Path $sitePath 'web.config'

if (-not (Test-Path $webConfigSrc)) {
    Write-Host "[FAIL] Missing $webConfigSrc — git pull in $AppRoot first." -ForegroundColor Red
    exit 1
}

Copy-Item $webConfigSrc $webConfigDst -Force
Write-Host "[OK] Copied web.config -> $webConfigDst" -ForegroundColor Green

Select-String -Path $webConfigDst -Pattern '127\.0\.0\.1:\d+' | ForEach-Object { Write-Host "  $($_.Line.Trim())" }

# --- 4. Enable ARR proxy (server level) ---
$proxyEnabled = $false
try {
    $proxySection = Get-WebConfiguration -Filter '/system.webServer/proxy' -PSPath 'MACHINE/WEBROOT/APPHOST'
    if ($proxySection.enabled -ne 'True') {
        Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter '/system.webServer/proxy' -Name 'enabled' -Value 'True'
        Write-Host "[OK] ARR proxy enabled" -ForegroundColor Green
    } else {
        Write-Host "[OK] ARR proxy already enabled" -ForegroundColor Green
    }
    $proxyEnabled = $true
} catch {
    Write-Host "[WARN] Could not set ARR proxy automatically." -ForegroundColor Yellow
    Write-Host "  In IIS Manager: server node -> Application Request Routing -> Server Proxy Settings -> Enable proxy" -ForegroundColor Yellow
}

# --- 5. Restart site ---
Stop-Website -Name $SiteName -ErrorAction SilentlyContinue
Start-Website -Name $SiteName
Write-Host "[OK] Site restarted" -ForegroundColor Green

# --- 6. Test public URL ---
Start-Sleep -Seconds 2
Write-Host ""
Write-Host "Testing $PublicUrl/api/system/status ..." -ForegroundColor Cyan
$public = curl.exe -sk "$PublicUrl/api/system/status"
Write-Host "Response: $public"

if ($public -match 'maintenance') {
    Write-Host ""
    Write-Host "SUCCESS — site is live at $PublicUrl" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Still not working. Manual checks:" -ForegroundColor Red
    Write-Host "  1. IIS Manager -> URL Rewrite -> rule Rewrite URL must be: $BackendUrl"
    Write-Host "  2. ARR -> Enable proxy (if not done above)"
    Write-Host "  3. iisreset"
    Write-Host "  4. Paste: Get-Content '$webConfigDst'"
    if (-not $proxyEnabled) { exit 1 }
}
