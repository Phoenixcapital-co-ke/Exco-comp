# PowerShell script to install PM2 globally
# Note: For Windows auto-start, use setup-windows-startup.ps1 instead
# Run this script as Administrator

Write-Host "Installing PM2 globally..." -ForegroundColor Green
npm install -g pm2

Write-Host "`nPM2 installed successfully!" -ForegroundColor Green
Write-Host "`nNote: PM2's 'startup' command doesn't work on Windows." -ForegroundColor Yellow
Write-Host "To set up auto-start, run:" -ForegroundColor Yellow
Write-Host "  .\scripts\setup-windows-startup.ps1" -ForegroundColor Cyan
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Set up Windows auto-start: .\scripts\setup-windows-startup.ps1" -ForegroundColor Cyan
Write-Host "2. Start your app: npm run pm2:start" -ForegroundColor Cyan
Write-Host "3. Save PM2 process list: npm run pm2:save" -ForegroundColor Cyan

