const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8913;

app.use(express.json());
app.use(express.static(__dirname));

// CORS for local testing
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// No-cache for HTML
function noCache(res){
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
}

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'User App', dir: __dirname });
});

// Serve shared favicon from project root
app.get(['/favicon.ico','/KloudyAiChatFavicon.png'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'KloudyAiChatFavicon.png'));
});

// -------- Auth (in-memory demo) --------
// In-memory user store keyed by email; each user can also login by phone or username
const users = new Map();

// Seed demo users
users.set('agent1@ufc.local', {
  email: 'agent1@ufc.local', username: 'agent1', phone: '+17025550101',
  password: 'agentpass', role: 'admin',
  securityQuestion: 'favorite_color', securityAnswer: 'blue',
  failedAttempts: 0, lockedUntil: 0
});
users.set('user1@ufc.local', {
  email: 'user1@ufc.local', username: 'user1', phone: '+17025550102',
  password: 'userpass', role: 'client',
  securityQuestion: 'pet_name', securityAnswer: 'buddy',
  failedAttempts: 0, lockedUntil: 0
});

function findUserByIdentifier(identifier) {
  const id = (identifier || '').toLowerCase();
  for (const [, u] of users) {
    if ((u.email || '').toLowerCase() === id || (u.username || '').toLowerCase() === id || (u.phone || '').toLowerCase() === id) {
      return u;
    }
  }
  return null;
}

app.post('/api/auth/login', async (req, res) => {
  const { identifier, password, captcha = {} } = req.body || {};
  // Simple math captcha check (a + b === answer)
  const a = Number(captcha.a), b = Number(captcha.b), answer = Number(captcha.answer);
  if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(answer) && a + b === answer)) {
    return res.status(400).json({ success: false, error: 'Captcha failed' });
  }

  const user = findUserByIdentifier(identifier);
  if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil > now) {
    return res.status(423).json({ success: false, error: 'Account locked. Try later.', lockedUntil: user.lockedUntil });
  }

  if (user.password === password) {
    user.failedAttempts = 0;
    user.lockedUntil = 0;
    return res.json({ success: true, role: user.role, email: user.email, username: user.username, phone: user.phone });
  }

  user.failedAttempts = (user.failedAttempts || 0) + 1;
  if (user.failedAttempts >= 7) {
    // Lock account for 15 minutes
    user.lockedUntil = now + 15 * 60 * 1000;
  }
  return res.status(401).json({ success: false, error: 'Invalid credentials', attempts: user.failedAttempts, lockedUntil: user.lockedUntil || 0 });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, phone, username, password, role = 'client', securityQuestion, securityAnswer } = req.body || {};
  if (!email || !password || !securityQuestion || !securityAnswer) return res.status(400).json({ error: 'Missing fields' });
  if (users.has(email)) return res.status(409).json({ error: 'User already exists' });
  const user = { email, phone, username, password, role, securityQuestion, securityAnswer, failedAttempts: 0, lockedUntil: 0 };
  users.set(email, user);
  res.json({ success: true, role });
});

// Forgot password: step 1 - get security question
app.post('/api/auth/forgot', (req, res) => {
  const { identifier } = req.body || {};
  const user = findUserByIdentifier(identifier);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, securityQuestion: user.securityQuestion });
});

// Forgot password: step 2 - reset
app.post('/api/auth/reset', (req, res) => {
  const { identifier, securityAnswer, newPassword } = req.body || {};
  const user = findUserByIdentifier(identifier);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  if ((user.securityAnswer || '').toLowerCase().trim() !== (securityAnswer || '').toLowerCase().trim()) {
    return res.status(401).json({ success: false, error: 'Security answer incorrect' });
  }
  user.password = newPassword;
  user.failedAttempts = 0;
  user.lockedUntil = 0;
  res.json({ success: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true });
});
// --------------------------------------------------

// Simple chat proxy to local Ollama (role-tailored in client)
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const response = await axios.post('http://127.0.0.1:11434/api/generate', {
      model: 'llama3.3:latest',
      prompt: message,
      stream: false
    }, { timeout: 30000 });
    res.json({ response: response.data.response });
  } catch (e) {
    res.status(503).json({ error: 'AI unavailable', details: e.message });
  }
});

app.post('/api/voice/auto-trigger', async (req, res) => {
  // Forward to API if feature enabled; otherwise accept
  try {
    const r = await axios.post('http://127.0.0.1:7010/api/voice/auto-trigger', req.body, { timeout: 5000 });
    res.json(r.data);
  } catch (e) {
    res.json({ success: true, queued: true, local: true });
  }
});

// Routes
app.get('/', (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/login.html', (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/user-app.html', (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'user-app.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 User App running on http://0.0.0.0:${PORT}`);
  console.log(`📁 Serving from: ${__dirname}`);
  console.log(`🔗 Access: http://localhost:${PORT}`);
});
