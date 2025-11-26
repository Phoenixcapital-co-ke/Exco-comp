# Tunnel Setup Guide - Quick Access Without Port Forwarding

## Option 1: Cloudflare Tunnel (Recommended - Free, HTTPS, Custom Domain)

### Step 1: Install Cloudflare Tunnel (cloudflared)

**On Windows:**
1. Download from: https://github.com/cloudflare/cloudflared/releases
2. Download `cloudflared-windows-amd64.exe`
3. Rename to `cloudflared.exe`
4. Place in `C:\cloudflared\` or your project directory

### Step 2: Login to Cloudflare

```powershell
cd C:\cloudflared
.\cloudflared.exe tunnel login
```

This will open a browser - login with your Cloudflare account (or create one for free).

### Step 3: Create a Tunnel

```powershell
.\cloudflared.exe tunnel create phoenix-capital
```

This creates a tunnel named "phoenix-capital" and saves credentials.

### Step 4: Configure the Tunnel

Create a config file: `C:\cloudflared\config.yml`

```yaml
tunnel: phoenix-capital
credentials-file: C:\Users\Administrator\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: phoenixcapital.nyamao.me
    service: http://localhost:3001
  - service: http_status:404
```

**Note:** Replace `<tunnel-id>` with the actual tunnel ID from Step 3.

### Step 5: Route DNS

```powershell
.\cloudflared.exe tunnel route dns phoenix-capital phoenixcapital.nyamao.me
```

### Step 6: Run the Tunnel

```powershell
.\cloudflared.exe tunnel run phoenix-capital
```

Or run as a service:
```powershell
.\cloudflared.exe service install
.\cloudflared.exe service start
```

### Step 7: Test

Visit: `https://phoenixcapital.nyamao.me`

---

## Option 2: ngrok (Easiest - Quick Setup)

### Step 1: Sign Up

1. Go to: https://ngrok.com
2. Sign up for a free account
3. Get your authtoken from the dashboard

### Step 2: Download ngrok

1. Download from: https://ngrok.com/download
2. Extract `ngrok.exe` to `C:\ngrok\` or your project directory

### Step 3: Authenticate

```powershell
cd C:\ngrok
.\ngrok.exe config add-authtoken YOUR_AUTHTOKEN
```

### Step 4: Start Tunnel

```powershell
.\ngrok.exe http 3001 --domain=phoenixcapital.nyamao.me
```

**Note:** Custom domains require a paid ngrok plan. Free tier gives you a random URL like `https://abc123.ngrok.io`

### Step 5: Test

Visit the URL shown by ngrok (or your custom domain if paid).

---

## Option 3: LocalTunnel (Free, No Signup)

### Step 1: Install

```powershell
npm install -g localtunnel
```

### Step 2: Start Tunnel

```powershell
lt --port 3001 --subdomain phoenixcapital
```

**Note:** Subdomain may not be available. Free tier gives random URLs.

---

## Recommendation

**Use Cloudflare Tunnel** because:
- ✅ Free
- ✅ Works with your custom domain (`phoenixcapital.nyamao.me`)
- ✅ Automatic HTTPS
- ✅ No port forwarding needed
- ✅ Can run as Windows service
- ✅ More reliable than ngrok free tier

**Quick Start with Cloudflare:**
1. Install cloudflared
2. Run: `cloudflared tunnel login`
3. Run: `cloudflared tunnel create phoenix-capital`
4. Create config.yml (see above)
5. Run: `cloudflared tunnel route dns phoenix-capital phoenixcapital.nyamao.me`
6. Run: `cloudflared tunnel run phoenix-capital`

Your app will be accessible at `https://phoenixcapital.nyamao.me` immediately!

