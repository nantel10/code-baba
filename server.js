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
    const twilio = require('twilio');
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
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

// Generate random code
function generateCode(prefix, length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix + '-';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Load or create config
let config;
if (fs.existsSync(CONFIG_FILE)) {
  config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} else {
  config = {
    groupCode: generateCode('BABA'),
    adminCode: generateCode('ADMIN', 8)
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Generate VAPID keys if not exists
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
let vapidKeys;
if (fs.existsSync(VAPID_FILE)) {
  vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
}

webpush.setVapidDetails(
  'mailto:admin@code-baba.com',
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

// Check if name is unique (case-insensitive)
function isNameUnique(name, excludeId = null) {
  const subscriptions = loadSubscriptions();
  const lowerName = name.toLowerCase().trim();
  
  for (const [id, sub] of Object.entries(subscriptions)) {
    if (excludeId && id === excludeId) continue;
    if (sub.name.toLowerCase().trim() === lowerName) {
      return false;
    }
  }
  return true;
}

// API: Get public VAPID key
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// API: Verify invite code
app.post('/api/verify-code', (req, res) => {
  const { code } = req.body;
  const upperCode = code?.toUpperCase();
  
  if (upperCode === config.groupCode || upperCode === config.adminCode) {
    res.json({ valid: true, isAdmin: upperCode === config.adminCode });
  } else {
    res.json({ valid: false });
  }
});

// API: Check if name is available
app.post('/api/check-name', (req, res) => {
  const { name } = req.body;
  
  if (!name || name.trim().length === 0) {
    return res.json({ available: false, error: 'Name is required' });
  }
  
  const available = isNameUnique(name);
  res.json({ available, error: available ? null : 'This name is already taken' });
});

// API: Subscribe to notifications (join group)
app.post('/api/subscribe', (req, res) => {
  const { subscription, name, code, phone } = req.body;
  
  // Verify the group code
  const upperCode = code?.toUpperCase();
  if (upperCode !== config.groupCode && upperCode !== config.adminCode) {
    return res.status(403).json({ error: 'Invalid group code' });
  }
  
  // Check if name is unique
  if (!isNameUnique(name)) {
    return res.status(400).json({ error: 'This name is already taken. Please choose a different name.' });
  }
  
  const subscriptions = loadSubscriptions();
  const id = Date.now().toString();
  
  // Format phone number (add +1 if needed for US numbers)
  let formattedPhone = null;
  if (phone) {
    formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.length === 10) {
      formattedPhone = '+1' + formattedPhone;
    } else if (formattedPhone.length > 0 && !formattedPhone.startsWith('+')) {
      formattedPhone = '+' + formattedPhone;
    }
  }
  
  subscriptions[id] = {
    name: name.trim(),
    subscription,
    phone: formattedPhone || null,
    joinedAt: new Date().toISOString(),
    isAdmin: upperCode === config.adminCode
  };
  
  saveSubscriptions(subscriptions);
  
  console.log(`✅ ${name} joined the group!${formattedPhone ? ' (SMS: ' + formattedPhone + ')' : ''}`);
  res.json({ success: true, id, isAdmin: upperCode === config.adminCode });
});

// API: Login (verify existing member)
app.post('/api/login', (req, res) => {
  const { name, code } = req.body;
  
  const upperCode = code?.toUpperCase();
  if (upperCode !== config.groupCode && upperCode !== config.adminCode) {
    return res.status(403).json({ error: 'Invalid code' });
  }
  
  const subscriptions = loadSubscriptions();
  const lowerName = name.toLowerCase().trim();
  
  // Find member by name
  for (const [id, sub] of Object.entries(subscriptions)) {
    if (sub.name.toLowerCase().trim() === lowerName) {
      return res.json({ 
        success: true, 
        id, 
        name: sub.name,
        isAdmin: sub.isAdmin,
        phone: sub.phone
      });
    }
  }
  
  res.status(404).json({ error: 'Member not found. Please join first or check your name.' });
});

// API: Logout (just clears client-side, but we can track if needed)
app.post('/api/logout', (req, res) => {
  res.json({ success: true });
});

// API: Admin - Add new member
app.post('/api/admin/members', (req, res) => {
  const adminCode = req.headers['x-admin-code'];
  if (adminCode !== config.adminCode) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { name, phone, isAdmin } = req.body;
  
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  if (!isNameUnique(name)) {
    return res.status(400).json({ error: 'This name is already taken' });
  }
  
  const subscriptions = loadSubscriptions();
  const id = Date.now().toString();
  
  // Format phone number
  let formattedPhone = null;
  if (phone) {
    formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.length === 10) {
      formattedPhone = '+1' + formattedPhone;
    } else if (formattedPhone.length > 0 && !formattedPhone.startsWith('+')) {
      formattedPhone = '+' + formattedPhone;
    }
  }
  
  subscriptions[id] = {
    name: name.trim(),
    subscription: null,
    phone: formattedPhone || null,
    joinedAt: new Date().toISOString(),
    isAdmin: isAdmin || false
  };
  
  saveSubscriptions(subscriptions);
  
  console.log(`✅ Admin added member: ${name}`);
  res.json({ success: true, id, member: subscriptions[id] });
});

// API: Admin - Update member
app.put('/api/admin/members/:id', (req, res) => {
  const adminCode = req.headers['x-admin-code'];
  if (adminCode !== config.adminCode) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { id } = req.params;
  const { name, phone, isAdmin } = req.body;
  
  const subscriptions = loadSubscriptions();
  
  if (!subscriptions[id]) {
    return res.status(404).json({ error: 'Member not found' });
  }
  
  if (name && name.trim().length > 0) {
    // Check if new name is unique (excluding current member)
    if (!isNameUnique(name, id)) {
      return res.status(400).json({ error: 'This name is already taken' });
    }
    subscriptions[id].name = name.trim();
  }
  
  if (phone !== undefined) {
    let formattedPhone = null;
    if (phone) {
      formattedPhone = phone.replace(/\D/g, '');
      if (formattedPhone.length === 10) {
        formattedPhone = '+1' + formattedPhone;
      } else if (formattedPhone.length > 0 && !formattedPhone.startsWith('+')) {
        formattedPhone = '+' + formattedPhone;
      }
    }
    subscriptions[id].phone = formattedPhone || null;
  }
  
  if (isAdmin !== undefined) {
    subscriptions[id].isAdmin = isAdmin;
  }
  
  saveSubscriptions(subscriptions);
  
  console.log(`✅ Admin updated member: ${subscriptions[id].name}`);
  res.json({ success: true, member: subscriptions[id] });
});

// API: Admin - Delete member
app.delete('/api/admin/members/:id', (req, res) => {
  const adminCode = req.headers['x-admin-code'];
  if (adminCode !== config.adminCode) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const { id } = req.params;
  const subscriptions = loadSubscriptions();
  
  if (!subscriptions[id]) {
    return res.status(404).json({ error: 'Member not found' });
  }
  
  const memberName = subscriptions[id].name;
  delete subscriptions[id];
  saveSubscriptions(subscriptions);
  
  console.log(`🗑️ Admin deleted member: ${memberName}`);
  res.json({ success: true });
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
      
      if (error.statusCode === 404 || error.statusCode === 410) {
        deadSubscriptions.push(id);
      }
    }
  }
  
  // Clean up dead subscriptions (but keep the member)
  if (deadSubscriptions.length > 0) {
    for (const id of deadSubscriptions) {
      if (subscriptions[id]) {
        subscriptions[id].subscription = null;
      }
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

// API: Get members (admin only)
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
