# Quick Start Guide - Production Deployment

## Prerequisites Checklist
- [ ] Windows Server with Remote Desktop access
- [ ] Node.js v18+ installed
- [ ] Domain name (for HTTPS) OR Public IP address
- [ ] Firewall access to configure ports

## Step-by-Step Deployment

### 1. Install Node.js and Dependencies

```powershell
# Verify Node.js is installed
node --version
npm --version

# Navigate to project directory
cd C:\path\to\Exco

# Install dependencies
npm install

# Install PM2 globally
npm install -g pm2
```

### 2. Build the Application

```powershell
npm run build
```

This creates the `dist/` folder with production files.

### 3. Set Up Auto-Start

```powershell
# Open PowerShell as Administrator
# Install PM2 startup
pm2 startup

# Follow the instructions - PM2 will give you a command to run
# Copy and paste that command, then press Enter

# Start the app
npm run pm2:start

# Save the process list (so it auto-starts on reboot)
npm run pm2:save
```

### 4. Configure HTTPS (Choose One)

#### Option A: Caddy (Easiest - Auto SSL)

1. **Download Caddy**: [caddyserver.com/download](https://caddyserver.com/download)
2. **Extract to** `C:\caddy\`
3. **Edit `Caddyfile`** - Replace `your-domain.com` with your domain
4. **Start Caddy**:
   ```powershell
   C:\caddy\caddy.exe run
   ```
5. **Set Caddy to auto-start** (use Task Scheduler or create Windows Service)

#### Option B: Nginx (More Control)

1. **Download Nginx**: [nginx.org/en/download.html](https://nginx.org/en/download.html)
2. **Extract to** `C:\nginx\`
3. **Copy `nginx.conf`** to `C:\nginx\conf\nginx.conf`
4. **Update domain and SSL paths** in nginx.conf
5. **Install SSL certificate** (Let's Encrypt with Certbot)
6. **Start Nginx**:
   ```powershell
   C:\nginx\nginx.exe
   ```

### 5. Configure Firewall

```powershell
# Open PowerShell as Administrator
New-NetFirewallRule -DisplayName "Exco Dashboard HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Exco Dashboard HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
```

### 6. Access Your App

- **With domain**: `https://your-domain.com`
- **Direct (no HTTPS)**: `http://your-server-ip:3001` (not recommended)

## Common Commands

```powershell
# View app status
pm2 status

# View logs
npm run pm2:logs

# Restart app
npm run pm2:restart

# Stop app
npm run pm2:stop

# Update and rebuild
git pull                    # If using git
npm run build              # Rebuild React app
npm run pm2:restart        # Restart with new build
```

## Troubleshooting

### App won't start
```powershell
# Check if port is in use
netstat -ano | findstr :3001

# Check PM2 logs
npm run pm2:logs

# Check PM2 status
pm2 status
```

### Can't access from outside
1. Check firewall rules
2. Verify domain DNS points to server IP
3. Check router port forwarding (if behind router)
4. Test with: `telnet your-server-ip 443`

### HTTPS not working
1. Verify domain DNS is correct
2. Check Caddy/Nginx logs
3. Ensure ports 80 and 443 are open
4. Wait for Let's Encrypt certificate (can take a few minutes)

## Next Steps

- Read the full [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions
- Set up regular database backups
- Configure monitoring and alerts
- Review security recommendations in DEPLOYMENT.md

---

**Need Help?** Check `DEPLOYMENT.md` for detailed troubleshooting and advanced configuration.

