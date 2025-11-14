# PowerShell script to build and start the app in production mode
# Run this from the project root directory

Write-Host "Building React app for production..." -ForegroundColor Green
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Exiting." -ForegroundColor Red
    exit 1
}

Write-Host "`nStarting app with PM2..." -ForegroundColor Green
npm run pm2:start

Write-Host "`nSaving PM2 process list..." -ForegroundColor Green
npm run pm2:save

Write-Host "`nApp started successfully!" -ForegroundColor Green
Write-Host "View logs with: npm run pm2:logs" -ForegroundColor Cyan
Write-Host "Check status with: pm2 status" -ForegroundColor Cyan

