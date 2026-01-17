# 🧙 Code-Baba

Instant notifications for your crew. You send a message, everyone gets a push notification.

## How It Works

1. **You** get an admin code - only you can send messages
2. **Group members** get an invite code - they can receive notifications
3. Everyone installs the PWA on their phone
4. When you send a message, everyone gets a push notification

## Quick Start (Local Testing)

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The server will display your codes:
```
🧙 Code-Baba running at http://localhost:3000

Share these codes with your group:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 Group invite code: BABA-ABC123
🔐 Admin code (for you): ADMIN-XYZ789
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Note:** Push notifications only work over HTTPS (except localhost). For real use, deploy to a hosting service.

---

## Deploy to the Internet (Free Options)

### Option 1: Railway (Recommended - Easiest)

1. Go to [railway.app](https://railway.app) and sign up
2. Click "New Project" → "Deploy from GitHub repo"
3. Connect your GitHub and push this code to a repo
4. Railway auto-detects Node.js and deploys
5. Go to Settings → Networking → Generate Domain
6. Your app is live at `https://your-app.up.railway.app`

### Option 2: Render

1. Go to [render.com](https://render.com) and sign up
2. Click "New" → "Web Service"
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Click "Create Web Service"

### Option 3: Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login and deploy
fly auth login
fly launch
fly deploy
```

---

## How to Use

### For You (Admin)

1. Open your deployed app URL
2. Enter your name and the **Admin code**
3. Allow notifications when prompted
4. Send messages from the dashboard

### For Group Members

1. Share the app URL and **Group invite code**
2. They open the link on their phone
3. Enter their name and the invite code
4. Allow notifications
5. Add to home screen (optional but recommended)

---

## Adding to Home Screen

### iPhone/iPad
1. Open the app in Safari
2. Tap the Share button
3. Tap "Add to Home Screen"

### Android
1. Open the app in Chrome
2. Tap the three dots menu
3. Tap "Add to Home screen"

---

## Files Structure

```
code-baba/
├── server.js           # Main server with API endpoints
├── package.json        # Dependencies
├── public/
│   ├── index.html      # The app UI
│   ├── sw.js           # Service worker for notifications
│   ├── manifest.json   # PWA manifest
│   └── icons/          # App icons
└── data/               # Created automatically
    ├── config.json     # Your codes and VAPID keys
    ├── subscriptions.json  # Group members
    └── messages.json   # Message history
```

---

## Customization

### Regenerate codes
Delete `data/config.json` and restart the server

### Add more admins
Share your admin code with trusted members

---

## Troubleshooting

### Notifications not working?
1. Must be served over HTTPS
2. Check notification permissions in browser/phone settings
3. Check DevTools → Application → Service Workers

### Someone's not receiving notifications?
1. Have them rejoin with their code
2. Subscriptions can expire after ~30 days of inactivity

---

Enjoy staying connected! 🧙✨
