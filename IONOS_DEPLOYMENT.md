# IONOS Server Deployment Guide

Complete step-by-step guide to deploy the Phoenix Capital Dashboard on your IONOS Windows Server.

## Prerequisites

Before starting, ensure you have:
- Remote Desktop access to the server (IP: 212.227.242.64)
- Administrator credentials
- Git repository URL: `https://github.com/Phoenix-Capital/Exco-comp.git`

---

## Step 1: Connect to Server

1. Open **Remote Desktop Connection** on your local machine
2. Enter server IP: `212.227.242.64`
3. Login as **Administrator** with your password
4. Once connected, open **PowerShell as Administrator**

---

## Step 2: Install Required Software

### Install Node.js (if not already installed)

1. Download Node.js LTS from: https://nodejs.org/
2. Run the installer (choose "Add to PATH" option)
3. Verify installation:
   ```powershell
   node --version
   npm --version
   ```
   Should show versions like `v20.x.x` and `10.x.x`

### Install Git (if not already installed)

1. Download Git for Windows: https://git-scm.com/download/win
2. Run installer (use default options)
3. Verify installation:
   ```powershell
   git --version
   ```

### Install PM2 (Process Manager)

```powershell
npm install -g pm2
pm2 --version
```

---

## Step 3: Clone the Repository

1. Navigate to where you want the project (e.g., `C:\Projects` or `C:\Users\Administrator\Documents`)
2. Clone the repository:
   ```powershell
   cd C:\Users\Administrator\Documents
   git clone https://github.com/Phoenix-Capital/Exco-comp.git Exco
   cd Exco
   ```

---

## Step 4: Install Dependencies

```powershell
npm install
```

This will install all required packages including:
- `jsonwebtoken` and `cookie-parser` (for authentication)
- `better-sqlite3` (database)
- `express` (server)
- All React/Vite dependencies

---

## Step 5: Set Environment Variables

Set the JWT secret for secure authentication:

```powershell
setx JWT_SECRET "your-super-secret-random-string-min-32-characters" /M
setx AUTH_TOKEN_TTL_HOURS "24" /M
```

**Important:** 
- Replace `your-super-secret-random-string-min-32-characters` with a strong random string
- Use `/M` flag to set system-wide (requires admin PowerShell)
- Close and reopen PowerShell for changes to take effect

**Generate a secure secret:**
```powershell
# Option 1: Use Node.js to generate
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 6: Create Database Directory

```powershell
mkdir data
```

The database file (`data/app.db`) will be created automatically on first run.

---

## Step 7: Build the Frontend

```powershell
npm run build
```

This creates the `dist/` folder with the production-ready frontend.

---

## Step 8: Test the Application

Before setting up PM2, test that everything works:

```powershell
node server.js
```

You should see:
```
Server listening on http://0.0.0.0:3001
Production mode: Serving app at http://localhost:3001
```

Press `Ctrl+C` to stop the server.

---

## Step 9: Set Up PM2 (Process Manager)

### Start the application with PM2

```powershell
pm2 start server.js --name exco-dashboard
```

### Save PM2 configuration

```powershell
pm2 save
```

### Set up PM2 to start on Windows boot

```powershell
pm2 startup
```

This will output a command - **copy and run that command** (it will be something like):
```powershell
pm2 startup systemd -u Administrator --hp C:\Users\Administrator
```

### Verify PM2 is running

```powershell
pm2 list
pm2 logs exco-dashboard
```

You should see the server running and logs showing it's listening on port 3001.

---

## Step 10: Configure Windows Firewall

Allow incoming connections on port 3001:

```powershell
New-NetFirewallRule -DisplayName "Exco Dashboard" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow
```

---

## Step 11: Verify Deployment

1. **From the server itself:**
   - Open browser: `http://localhost:3001`
   - You should see the login page

2. **From your local machine (if firewall allows):**
   - Open browser: `http://212.227.242.64:3001`
   - You should see the login page

---

## Step 12: Initial Data Setup

### Create an Admin User

The app needs at least one user to login. You can:

1. **Option A: Use the Users page** (if you can access it)
   - Login with an existing admin account
   - Go to `/data/users`
   - Create a new admin user

2. **Option B: Create user via database** (if no users exist)
   ```powershell
   # Stop PM2 first
   pm2 stop exco-dashboard
   
   # Create user via Node.js script (you'll need to create this)
   # Or manually insert into SQLite database
   ```

### Run Initial Data Ingestion

Once logged in as admin:
1. Navigate to `/data/overview`
2. Click "Refresh All Data" to fetch initial data from Loandisk API

---

## Step 13: (Optional) Set Up Cloudflare Tunnel

If you want external access without exposing port 3001 directly:

1. Download `cloudflared` for Windows
2. Authenticate: `cloudflared tunnel login`
3. Create tunnel: `cloudflared tunnel create phoenix-capital`
4. Configure `config.yml`:
   ```yaml
   tunnel: phoenix-capital
   credentials-file: C:\Users\Administrator\.cloudflared\<tunnel-id>.json
   
   ingress:
     - hostname: yourdomain.com
       service: http://localhost:3001
     - service: http_status:404
   ```
5. Run tunnel: `cloudflared tunnel run phoenix-capital`
6. Set up as Windows service (see TUNNEL_SETUP.md for details)

---

## Troubleshooting

### PM2 not starting on boot
- Run `pm2 startup` again and follow the output command
- Check Windows Task Scheduler for PM2 entries

### Port 3001 already in use
```powershell
netstat -ano | findstr :3001
# Find the PID, then:
taskkill /PID <pid> /F
```

### Database errors
- Ensure `data/` directory exists and is writable
- Check file permissions on `data/app.db`

### JWT errors
- Verify `JWT_SECRET` is set: `echo %JWT_SECRET%`
- Restart PM2 after setting environment variables: `pm2 restart exco-dashboard`

### View logs
```powershell
pm2 logs exco-dashboard --lines 100
pm2 logs exco-dashboard --err
```

### Restart application
```powershell
pm2 restart exco-dashboard
```

### Stop application
```powershell
pm2 stop exco-dashboard
```

### Delete from PM2
```powershell
pm2 delete exco-dashboard
```

---

## Useful Commands Reference

```powershell
# PM2 Management
pm2 list                    # Show all processes
pm2 logs exco-dashboard     # View logs
pm2 restart exco-dashboard  # Restart app
pm2 stop exco-dashboard     # Stop app
pm2 delete exco-dashboard   # Remove from PM2

# Git Operations
git pull origin master      # Update code
npm run build              # Rebuild frontend
pm2 restart exco-dashboard # Restart after updates

# Environment
echo %JWT_SECRET%          # Check JWT secret
echo %AUTH_TOKEN_TTL_HOURS% # Check token TTL
```

---

## Security Checklist

- [ ] JWT_SECRET is set to a strong random value
- [ ] Windows Firewall configured correctly
- [ ] Database file (`data/app.db`) has proper permissions
- [ ] PM2 is running as intended user
- [ ] Regular backups of `data/app.db` are scheduled
- [ ] Cloudflare Tunnel configured (if using external access)

---

## Next Steps After Deployment

1. Create admin user account
2. Configure branches in `/data/branches`
3. Add loan officers in `/data/loan-officers`
4. Run initial data ingestion
5. Create user accounts for team members with appropriate roles
6. Set up automated backups for the database

---

## Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs exco-dashboard`
2. Check Windows Event Viewer for system errors
3. Verify all environment variables are set
4. Ensure Node.js and npm are up to date

