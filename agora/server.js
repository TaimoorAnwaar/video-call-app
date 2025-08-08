require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Token generation endpoint
app.post('/api/token', (req, res) => {
  const { channelName, uid } = req.body || {};
  if (!channelName) {
    return res.status(400).json({ error: 'channelName is required' });
  }

  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate) {
    return res.status(500).json({ error: 'Server not configured with AGORA_APP_ID and AGORA_APP_CERTIFICATE' });
  }

  const uidStr = uid ? String(uid) : String(Math.floor(Math.random() * 10_000_000));
  const role = RtcRole.PUBLISHER;
  const expireTimeSeconds = 60 * 60; // 1 hour
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTs = currentTimestamp + expireTimeSeconds;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      Number(uidStr),
      role,
      privilegeExpireTs
    );
    res.json({ token, uid: Number(uidStr), appId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate token', details: err.message });
  }
});

// Serve SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});


