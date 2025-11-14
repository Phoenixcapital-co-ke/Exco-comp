# PowerShell script to install PM2 and set up Windows startup
# Run this script as Administrator

Write-Host "Installing PM2 globally..." -ForegroundColor Green
npm install -g pm2

Write-Host "`nSetting up PM2 startup script..." -ForegroundColor Green
pm2 startup

Write-Host "`nPM2 startup configured!" -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Start your app: npm run pm2:start" -ForegroundColor Cyan
Write-Host "2. Save PM2 process list: npm run pm2:save" -ForegroundColor Cyan
Write-Host "3. Your app will now auto-start on server reboot" -ForegroundColor Cyan

