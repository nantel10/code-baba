const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Twilio configuration (set these in Railway environment variables)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
  try {
    twilioClient = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    console.log('✅ Twilio SMS enabled');
  } catch (err) {
    console.log('⚠️ Twilio error:', err.message);
  }
} else {
  console.log('⚠️ Twilio not configured - add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER to environment variables');
}

// Data file paths
const DATA_DIR = './data';
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize or load VAPID keys
function getOrCreateVapidKeys() {
  if (fs.existsSync(CONFIG_FILE)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (config.vapidKeys) {
      return config.vapidKeys;
    }
  }
  
  // Generate new VAPID keys
  const vapidKeys = webpush.generateVAPIDKeys();
  const config = {
    vapidKeys,
    groupCode: generateGroupCode(),
    adminCode: generateAdminCode()
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log('\n🔑 New configuration generated!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Group invite code: ${config.groupCode}`);
  console.log(`Admin code (for sending): ${config.adminCode}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  return vapidKeys;
}

function generateGroupCode() {
  return 'BABA-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateAdminCode() {
  return 'ADMIN-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

function getConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
  return null;
}

// Initialize VAPID keys
const vapidKeys = getOrCreateVapidKeys();
const config = getConfig();

webpush.setVapidDetails(
  'mailto:family@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Load/save subscriptions
function loadSubscriptions() {
  if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
    return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8'));
  }
  return {};
}

function saveSubscriptions(subs) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2));
}

// Load/save messages
function loadMessages() {
  if (fs.existsSync(MESSAGES_FILE)) {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  }
  return [];
}

function saveMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

// API: Get public VAPID key
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// API: Verify group code
app.post('/api/verify-code', (req, res) => {
  const { code } = req.body;
  if (code === config.groupCode) {
    res.json({ valid: true, type: 'group' });
  } else if (code === config.adminCode) {
    res.json({ valid: true, type: 'admin' });
  } else {
    res.json({ valid: false });
  }
});

// API: Subscribe to notifications
app.post('/api/subscribe', (req, res) => {
  const { subscription, name, code, phone } = req.body;
  
  // Verify the group code
  if (code !== config.groupCode && code !== config.adminCode) {
    return res.status(403).json({ error: 'Invalid group code' });
  }
  
  const subscriptions = loadSubscriptions();
  const id = Date.now().toString();
  
  // Format phone number (add +1 if needed for US numbers)
  let formattedPhone = null;
  if (phone) {
    formattedPhone = phone.replace(/\D/g, ''); // Remove non-digits
    if (formattedPhone.length === 10) {
      formattedPhone = '+1' + formattedPhone;
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+' + formattedPhone;
    }
  }
  
  subscriptions[id] = {
    name,
    subscription,
    phone: formattedPhone,
    joinedAt: new Date().toISOString(),
    isAdmin: code === config.adminCode
  };
  
  saveSubscriptions(subscriptions);
  
  console.log(`✅ ${name} joined the group!${formattedPhone ? ' (SMS: ' + formattedPhone + ')' : ''}`);
  res.json({ success: true, id, isAdmin: code === config.adminCode });
});

// API: Send a message (admin only)
app.post('/api/send', async (req, res) => {
  const { message, adminCode, senderName } = req.body;
  
  if (adminCode !== config.adminCode) {
    return res.status(403).json({ error: 'Invalid admin code' });
  }
  
  const subscriptions = loadSubscriptions();
  const messages = loadMessages();
  
  // Save message
  const newMessage = {
    id: Date.now().toString(),
    text: message,
    sender: senderName || 'Admin',
    sentAt: new Date().toISOString()
  };
  messages.unshift(newMessage);
  
  // Keep only last 50 messages
  if (messages.length > 50) {
    messages.length = 50;
  }
  saveMessages(messages);
  
  // Send push notifications
  const payload = JSON.stringify({
    title: `📢 ${senderName || 'Code-Baba'}`,
    body: message,
    timestamp: newMessage.sentAt
  });
  
  const results = { sent: 0, failed: 0, noSubscription: 0 };
  const deadSubscriptions = [];
  
  for (const [id, sub] of Object.entries(subscriptions)) {
    // Skip members without push subscription (e.g., iPhone users not on home screen)
    if (!sub.subscription) {
      results.noSubscription++;
      console.log(`⏭️ Skipped ${sub.name} (no push subscription)`);
      continue;
    }
    
    try {
      await webpush.sendNotification(sub.subscription, payload);
      results.sent++;
      console.log(`📨 Sent to ${sub.name}`);
    } catch (error) {
      console.error(`❌ Failed to send to ${sub.name}:`, error.message);
      results.failed++;
      
      // If subscription is expired/invalid, mark for removal
      if (error.statusCode === 404 || error.statusCode === 410) {
        deadSubscriptions.push(id);
      }
    }
  }
  
  // Clean up dead subscriptions
  if (deadSubscriptions.length > 0) {
    for (const id of deadSubscriptions) {
      delete subscriptions[id];
    }
    saveSubscriptions(subscriptions);
  }
  
  // Send SMS notifications via Twilio
  const smsResults = { sent: 0, failed: 0 };
  
  if (twilioClient) {
    for (const [id, sub] of Object.entries(subscriptions)) {
      if (sub.phone) {
        try {
          await twilioClient.messages.create({
            body: `🧙 Code-Baba from ${senderName || 'Admin'}: ${message}`,
            from: TWILIO_PHONE_NUMBER,
            to: sub.phone
          });
          smsResults.sent++;
          console.log(`📱 SMS sent to ${sub.name} (${sub.phone})`);
        } catch (error) {
          console.error(`❌ SMS failed to ${sub.name}:`, error.message);
          smsResults.failed++;
        }
      }
    }
  }
  
  res.json({ success: true, message: newMessage, results, smsResults });
});

// API: Get recent messages
app.get('/api/messages', (req, res) => {
  const messages = loadMessages();
  res.json(messages);
});

// API: Get family members (admin only)
app.get('/api/members', (req, res) => {
  const adminCode = req.headers['x-admin-code'];
  if (adminCode !== config.adminCode) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const subscriptions = loadSubscriptions();
  const members = Object.entries(subscriptions).map(([id, sub]) => ({
    id,
    name: sub.name,
    phone: sub.phone || null,
    hasPhone: !!sub.phone,
    hasPush: !!sub.subscription,
    joinedAt: sub.joinedAt,
    isAdmin: sub.isAdmin
  }));
  
  res.json(members);
});

// Serve the app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🧙 Code-Baba running at http://localhost:${PORT}`);
  console.log('\nShare these codes with your group:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`👥 Group invite code: ${config.groupCode}`);
  console.log(`🔐 Admin code (for you): ${config.adminCode}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
