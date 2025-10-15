const express = require('express');
const { requireFeature } = require('../config/flags');

const router = express.Router();

// In-memory placeholder; replace with DB table later (...)
const notifications = [];

router.get('/', requireFeature('FEATURE_NOTIFICATIONS'), (req, res) => {
  res.json({ notifications });
});

router.post('/publish', requireFeature('FEATURE_NOTIFICATIONS'), (req, res) => {
  const { type = 'task', title = 'Notification', payload = {}, audience = 'admins' } = req.body || {};
  const n = { id: `${Date.now()}`, type, title, payload, audience, createdAt: new Date().toISOString(), claimedBy: null };
  notifications.push(n);
  res.json({ success: true, notification: n });
});

router.post('/accept', requireFeature('FEATURE_AGENT_ASSIGNMENT'), (req, res) => {
  const { id, agentId = 'agent_placeholder' } = req.body || {};
  const n = notifications.find(x => x.id === id);
  if (!n) return res.status(404).json({ error: 'Not found' });
  if (n.claimedBy) return res.status(409).json({ error: 'Already claimed', claimedBy: n.claimedBy });
  n.claimedBy = agentId;
  res.json({ success: true, notification: n });
});

module.exports = router;
