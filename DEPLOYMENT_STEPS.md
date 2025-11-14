# Step-by-Step Deployment Guide
## From Your Laptop to Windows Server

Follow these steps in order to deploy your app successfully.

---

## Phase 1: Prepare Your Code (On Your Laptop)

### Step 1.1: Verify Everything is Ready

```powershell
# Navigate to your project
cd C:\Users\Administrator\Documents\analysis\Exco\Exco

# Make sure you have the latest code
git status  # If using git, check for uncommitted changes

# Verify the build works locally (optional test)
npm run build
```

**Note**: If the build works, you're ready. If not, fix any errors first.

### Step 1.2: Commit and Push (If Using Git)

```powershell
# If you have uncommitted changes
git add .
git commit -m "Prepare for production deployment"
git push
```

---

## Phase 2: Transfer Code to Server

### Option A: Using Remote Desktop + Copy/Paste (Easiest)

1. **Connect to your Windows Server via Remote Desktop**
2. **On your laptop**: Open File Explorer and navigate to:
   ```
   C:\Users\Administrator\Documents\analysis\Exco\Exco
   ```
3. **Copy the entire `Exco` folder** (Ctrl+C)
4. **On the server**: Open Remote Desktop, navigate to where you want the app (e.g., `C:\Apps\`)
5. **Paste the folder** (Ctrl+V)
6. **Wait for the transfer to complete**

### Option B: Using Git (If Server Has Git)

1. **On the server** (via Remote Desktop), open PowerShell
2. **Navigate to where you want the app**:
   ```powershell
   cd C:\Apps
   ```
3. **Clone your repository**:
   ```powershell
   git clone <your-repo-url>
   cd Exco
   ```

### Option C: Using Network Share or USB Drive

1. **Copy the `Exco` folder** to a network share or USB drive
2. **On the server**, copy from the share/USB to `C:\Apps\Exco`

---

## Phase 3: Set Up Server Environment

### Step 3.1: Install Node.js (If Not Already Installed)

1. **On the server** (via Remote Desktop), open a web browser
2. **Download Node.js**: Go to [nodejs.org](https://nodejs.org/)
3. **Download the Windows Installer** (LTS version recommended)
4. **Run the installer** and follow the prompts
5. **Verify installation**:
   ```powershell
   # Open PowerShell
   node --version
   npm --version
   ```
   You should see version numbers (e.g., v20.x.x and 10.x.x)

### Step 3.2: Navigate to Project Directory

```powershell
# Open PowerShell on the server
cd C:\Apps\Exco  # Or wherever you copied the project
```

### Step 3.3: Install Project Dependencies

```powershell
# Install all npm packages
npm install

# This may take a few minutes. Wait for it to complete.
```

### Step 3.4: Install PM2 Globally

```powershell
# Install PM2 (process manager)
npm install -g pm2

# Verify installation
pm2 --version
```

---

## Phase 4: Build the Application

### Step 4.1: Build React App for Production

```powershell
# Make sure you're in the project directory
cd C:\Apps\Exco

# Build the app
npm run build
```

**What happens**: This creates a `dist/` folder with optimized production files.

**Expected output**: You should see:
```
✓ built in X.XXs
```

**If you see errors**: Fix them before proceeding. Common issues:
- Missing dependencies: Run `npm install` again
- Build errors: Check the error messages

### Step 4.2: Verify Build Output

```powershell
# Check if dist folder was created
dir dist

# You should see files like index.html, assets/, etc.
```

---

## Phase 5: Set Up Auto-Start with PM2

### Step 5.1: Configure PM2 Startup

```powershell
# Open PowerShell as Administrator (Right-click PowerShell → Run as Administrator)
cd C:\Apps\Exco

# Set up PM2 to start on Windows boot
pm2 startup
```

**Important**: PM2 will output a command like:
```
[PM2] To setup the Startup Script, copy/paste the following command:
pm2 startup
```

**Actually, it will give you a specific command** - copy and paste that exact command, then press Enter.

### Step 5.2: Start the Application with PM2

```powershell
# Start the app
npm run pm2:start

# You should see:
# [PM2] Starting ecosystem.config.cjs
# [PM2] Process launched
```

### Step 5.3: Save PM2 Configuration

```powershell
# Save the current process list so it auto-starts on reboot
npm run pm2:save

# You should see:
# [PM2] Saving current process list...
# [PM2] Successfully saved in C:\Users\...\AppData\Roaming\pm2\pm2.json
```

### Step 5.4: Verify It's Running

```powershell
# Check PM2 status
pm2 status

# You should see your app listed as "online"

# View logs
npm run pm2:logs

# Press Ctrl+C to exit logs view
```

### Step 5.5: Test the Application Locally

1. **On the server**, open a web browser
2. **Navigate to**: `http://localhost:3001`
3. **You should see your dashboard** (login page or dashboard)

**If it works**: Great! Move to Phase 6.
**If it doesn't work**: Check the logs with `npm run pm2:logs` and troubleshoot.

---

## Phase 6: Configure HTTPS (Choose One Method)

### Option A: Caddy (Recommended - Easiest)

#### Step 6A.1: Download Caddy

1. **On the server**, open a web browser
2. **Go to**: [caddyserver.com/download](https://caddyserver.com/download)
3. **Select**: Windows, amd64
4. **Download** the zip file
5. **Extract** to `C:\caddy\`

#### Step 6A.2: Configure Caddy

1. **On the server**, navigate to your project:
   ```powershell
   cd C:\Apps\Exco
   ```

2. **Edit `Caddyfile`** (use Notepad or any text editor):
   ```powershell
   notepad Caddyfile
   ```

3. **Replace `your-domain.com`** with your actual domain name:
   ```
   your-actual-domain.com {
       reverse_proxy localhost:3001
   }
   ```

4. **Save and close** the file

#### Step 6A.3: Start Caddy

```powershell
# Navigate to Caddy directory
cd C:\caddy

# Start Caddy (it will run in the foreground)
.\caddy.exe run --config C:\Apps\Exco\Caddyfile
```

**First time**: Caddy will automatically get an SSL certificate from Let's Encrypt. This may take 1-2 minutes.

**You should see**: 
```
serving initial configuration
```

#### Step 6A.4: Set Caddy to Auto-Start

**Option 1: Using Task Scheduler (Recommended)**

1. **Open Task Scheduler** (search for it in Windows)
2. **Create Basic Task**:
   - Name: "Caddy Web Server"
   - Trigger: "When the computer starts"
   - Action: "Start a program"
   - Program: `C:\caddy\caddy.exe`
   - Arguments: `run --config C:\Apps\Exco\Caddyfile`
   - Start in: `C:\caddy`
3. **Check "Run with highest privileges"**
4. **Finish**

**Option 2: Using NSSM (Windows Service Wrapper)**

1. **Download NSSM**: [nssm.cc/download](https://nssm.cc/download)
2. **Extract** to `C:\nssm\`
3. **Open PowerShell as Administrator**:
   ```powershell
   cd C:\nssm\win64
   .\nssm.exe install Caddy
   ```
4. **Fill in the form**:
   - Path: `C:\caddy\caddy.exe`
   - Startup directory: `C:\caddy`
   - Arguments: `run --config C:\Apps\Exco\Caddyfile`
5. **Click "Install service"**
6. **Start the service**:
   ```powershell
   .\nssm.exe start Caddy
   ```

### Option B: Nginx (More Control)

#### Step 6B.1: Download Nginx

1. **On the server**, open a web browser
2. **Go to**: [nginx.org/en/download.html](https://nginx.org/en/download.html)
3. **Download** the Windows version
4. **Extract** to `C:\nginx\`

#### Step 6B.2: Configure Nginx

1. **Copy `nginx.conf`** from your project to `C:\nginx\conf\nginx.conf`
2. **Edit the file** and update:
   - `your-domain.com` → your actual domain
   - SSL certificate paths (if you have them)

3. **Get SSL Certificate** (Let's Encrypt):
   - Use Certbot or another tool
   - Place certificates in `C:\nginx\ssl\`

#### Step 6B.3: Start Nginx

```powershell
cd C:\nginx
.\nginx.exe
```

---

## Phase 7: Configure Firewall

### Step 7.1: Open Required Ports

```powershell
# Open PowerShell as Administrator
# Allow HTTP (port 80)
New-NetFirewallRule -DisplayName "Exco Dashboard HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow

# Allow HTTPS (port 443)
New-NetFirewallRule -DisplayName "Exco Dashboard HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
```

### Step 7.2: Verify Firewall Rules

```powershell
# Check if rules were created
Get-NetFirewallRule -DisplayName "*Exco*"
```

---

## Phase 8: Configure Domain (If Using)

### Step 8.1: Point Domain to Server

1. **Log into your domain registrar** (where you bought the domain)
2. **Go to DNS settings**
3. **Create an A record**:
   - Name: `@` (or leave blank for root domain)
   - Type: `A`
   - Value: Your server's public IP address
   - TTL: 3600 (or default)

4. **Optional**: Create a `www` record:
   - Name: `www`
   - Type: `A`
   - Value: Your server's public IP address

### Step 8.2: Verify DNS

```powershell
# On the server or your laptop
nslookup your-domain.com

# You should see your server's IP address
```

**Wait**: DNS propagation can take up to 48 hours, but usually happens within minutes to a few hours.

---

## Phase 9: Test Everything

### Step 9.1: Test Local Access

1. **On the server**, open a web browser
2. **Navigate to**: `http://localhost:3001`
3. **Should see**: Your dashboard/login page

### Step 9.2: Test HTTPS Access

1. **From your laptop** (or any computer), open a web browser
2. **Navigate to**: `https://your-domain.com`
3. **Should see**: Your dashboard with a secure connection (lock icon)

**If you see SSL errors**: 
- Wait a few minutes (Let's Encrypt certificate generation)
- Check Caddy/Nginx logs
- Verify DNS is pointing to your server

### Step 9.3: Test Auto-Start

1. **Restart the server**:
   ```powershell
   Restart-Computer
   ```

2. **Wait for the server to reboot** (2-5 minutes)

3. **Connect via Remote Desktop** again

4. **Check if PM2 started the app**:
   ```powershell
   pm2 status
   ```

5. **Check if Caddy/Nginx is running**:
   - For Caddy: Check Task Scheduler or service status
   - For Nginx: Check if `nginx.exe` is running

6. **Test access**: `https://your-domain.com` should still work

---

## Phase 10: Final Verification

### Checklist

- [ ] App builds successfully (`npm run build`)
- [ ] PM2 is running the app (`pm2 status` shows "online")
- [ ] App accessible locally (`http://localhost:3001`)
- [ ] HTTPS reverse proxy is running (Caddy or Nginx)
- [ ] Firewall ports 80 and 443 are open
- [ ] Domain DNS points to server IP
- [ ] App accessible via HTTPS from outside (`https://your-domain.com`)
- [ ] Auto-start works (tested after server reboot)

---

## Common Issues & Solutions

### Issue: "Port 3001 already in use"
**Solution**:
```powershell
# Find what's using the port
netstat -ano | findstr :3001

# Kill the process (replace PID with the number from above)
taskkill /PID <PID> /F

# Restart PM2
npm run pm2:restart
```

### Issue: "Cannot find module"
**Solution**:
```powershell
# Reinstall dependencies
npm install

# Rebuild
npm run build

# Restart
npm run pm2:restart
```

### Issue: "SSL certificate not working"
**Solution**:
1. Verify DNS is correct: `nslookup your-domain.com`
2. Check Caddy/Nginx logs
3. Ensure ports 80 and 443 are open
4. Wait 5-10 minutes for Let's Encrypt

### Issue: "Can't access from outside network"
**Solution**:
1. Check firewall rules: `Get-NetFirewallRule -DisplayName "*Exco*"`
2. Verify router port forwarding (if behind router)
3. Test with: `telnet your-server-ip 443`

---

## Maintenance Commands

```powershell
# View app status
pm2 status

# View logs
npm run pm2:logs

# Restart app
npm run pm2:restart

# Update code (if using git)
git pull
npm run build
npm run pm2:restart

# Stop app
npm run pm2:stop

# Start app
npm run pm2:start
```

---

## You're Done! 🎉

Your app should now be:
- ✅ Running on the server
- ✅ Accessible via HTTPS
- ✅ Auto-starting on reboot
- ✅ Accessible from anywhere

**Access your app**: `https://your-domain.com`

---

**Need Help?** Check the logs:
- PM2 logs: `npm run pm2:logs`
- Caddy logs: `C:\caddy\logs\` (if configured)
- Nginx logs: `C:\nginx\logs\`

