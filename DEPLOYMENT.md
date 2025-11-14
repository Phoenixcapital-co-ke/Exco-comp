# Production Deployment Guide

This guide will help you deploy the Exco Dashboard to a Windows Server with HTTPS, auto-start, and external access.

## Prerequisites

1. **Windows Server** (accessible via Remote Desktop)
2. **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
3. **Domain name** (optional but recommended for HTTPS) OR **Public IP address**
4. **Firewall access** to configure ports

## Step 1: Install Dependencies

### On the Windows Server (via RDP):

1. **Install Node.js**
   - Download and install from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version` and `npm --version`

2. **Clone/Copy your project** to the server
   ```powershell
   # If using git
   git clone <your-repo-url>
   cd Exco
   
   # Or copy the project folder to the server
   ```

3. **Install project dependencies**
   ```powershell
   npm install
   ```

4. **Install PM2 globally** (process manager)
   ```powershell
   npm install -g pm2
   ```

## Step 2: Build the Application

```powershell
npm run build
```

This creates a `dist/` folder with the production-ready React app.

## Step 3: Set Up Auto-Start with PM2

### Option A: Using the provided script (Recommended)

1. **Open PowerShell as Administrator**
2. **Run the startup installation script:**
   ```powershell
   .\scripts\install-pm2-startup.ps1
   ```
3. **Follow the instructions** - PM2 will generate a command for you to run
4. **Start your app:**
   ```powershell
   npm run pm2:start
   ```
5. **Save the PM2 process list:**
   ```powershell
   npm run pm2:save
   ```

### Option B: Manual PM2 Setup

```powershell
# Install PM2 startup
pm2 startup

# Start the app
npm run pm2:start

# Save the process list
npm run pm2:save
```

## Step 4: Configure HTTPS with Reverse Proxy

You have two options for HTTPS:

### Option A: Caddy (Recommended - Easiest)

Caddy automatically handles SSL certificates from Let's Encrypt.

1. **Download Caddy for Windows**
   - Visit [caddyserver.com/download](https://caddyserver.com/download)
   - Download the Windows version
   - Extract to `C:\caddy\` or your preferred location

2. **Configure Caddy**
   - Edit `Caddyfile` in your project root
   - Replace `your-domain.com` with your actual domain
   - If you don't have a domain, see the alternative configuration in `Caddyfile`

3. **Start Caddy**
   ```powershell
   # From the project root
   C:\caddy\caddy.exe run
   ```

4. **Set Caddy to auto-start** (create a Windows Service or use Task Scheduler)

### Option B: Nginx (More Control)

1. **Install Nginx for Windows**
   - Download from [nginx.org/en/download.html](https://nginx.org/en/download.html)
   - Extract to `C:\nginx\`

2. **Configure Nginx**
   - Use the provided `nginx.conf` configuration
   - Update domain name and SSL certificate paths

3. **Install SSL Certificate**
   - Use Let's Encrypt with Certbot or another certificate authority
   - Place certificates in `C:\nginx\ssl\`

4. **Start Nginx**
   ```powershell
   C:\nginx\nginx.exe
   ```

## Step 5: Configure Firewall

Allow incoming connections on:
- **Port 80** (HTTP - for Let's Encrypt verification)
- **Port 443** (HTTPS)
- **Port 3001** (Only if accessing directly, not needed with reverse proxy)

```powershell
# Open PowerShell as Administrator
New-NetFirewallRule -DisplayName "Exco Dashboard HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Exco Dashboard HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
```

## Step 6: Configure Domain (If Using)

1. **Point your domain** to your server's public IP address
   - Create an A record: `your-domain.com` → `your-server-ip`
   - Wait for DNS propagation (can take up to 48 hours, usually much faster)

2. **Verify DNS**
   ```powershell
   nslookup your-domain.com
   ```

## Step 7: Access Your Application

- **With domain**: `https://your-domain.com`
- **With IP (no HTTPS)**: `http://your-server-ip:3001` (not recommended for production)
- **Local**: `http://localhost:3001`

## Useful Commands

### PM2 Management
```powershell
npm run pm2:start      # Start the app
npm run pm2:stop       # Stop the app
npm run pm2:restart    # Restart the app
npm run pm2:logs       # View logs
pm2 status             # Check status
pm2 monit              # Monitor in real-time
```

### Application Updates
```powershell
# Pull latest code (if using git)
git pull

# Rebuild the app
npm run build

# Restart the app
npm run pm2:restart
```

### View Logs
```powershell
# PM2 logs
npm run pm2:logs

# Or view log files directly
Get-Content .\logs\pm2-out.log -Tail 50
Get-Content .\logs\pm2-error.log -Tail 50
```

## Troubleshooting

### App won't start
1. Check if port 3001 is already in use: `netstat -ano | findstr :3001`
2. Check PM2 logs: `npm run pm2:logs`
3. Verify Node.js version: `node --version` (should be v18+)

### HTTPS not working
1. Verify domain DNS is pointing to your server
2. Check Caddy/Nginx logs for errors
3. Ensure ports 80 and 443 are open in firewall
4. Verify SSL certificate was issued (check Caddy/Nginx logs)

### Can't access from outside network
1. Verify firewall rules are correct
2. Check router port forwarding (if behind a router)
3. Verify your server's public IP address
4. Test with: `telnet your-server-ip 443`

### App crashes on reboot
1. Verify PM2 startup is configured: `pm2 startup`
2. Check PM2 saved processes: `pm2 list`
3. Review Windows Event Viewer for errors

## Security Recommendations

1. **Change default admin password** in the Users management page
2. **Use strong passwords** for all user accounts
3. **Keep Node.js and dependencies updated**: `npm update`
4. **Regular backups** of `data/app.db` database
5. **Monitor logs** regularly for suspicious activity
6. **Use firewall rules** to restrict access if possible
7. **Consider VPN** for additional security layer

## Backup Strategy

### Database Backup
```powershell
# Create a backup script (backup-db.ps1)
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item "data\app.db" "backups\app_$timestamp.db"
```

### Schedule Regular Backups
Use Windows Task Scheduler to run the backup script daily.

## Support

For issues or questions:
1. Check PM2 logs: `npm run pm2:logs`
2. Check application logs in `logs/` folder
3. Review this deployment guide
4. Check server.js console output

---

**Last Updated**: 2025-01-XX

