/* eslint-disable */
// @ts-nocheck

const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const sessions = {};

const BASE_DISPLAY = 99;
const BASE_VNC = 5900;
const BASE_WS = 6080;

// ================= PORTAS POR PERFIL =================
function getPorts(profileId) {
  const hash = parseInt(
    crypto.createHash('md5').update(profileId).digest('hex').slice(0, 4),
    16
  );

  const slot = hash % 50;

  return {
    display: BASE_DISPLAY + slot,
    vncPort: BASE_VNC + slot,
    wsPort: BASE_WS + slot
  };
}

// ================= START SESSION =================
app.post('/session/start', async (req, res) => {
  const { profileId } = req.body;

  try {
    if (!profileId) throw new Error('profileId obrigatório');

    if (sessions[profileId]) {
      return res.json({ success: true });
    }

    const { display, vncPort, wsPort } = getPorts(profileId);

    console.log('🚀 START', profileId);

    // 1. Xvfb (display virtual)
    const xvfb = spawn('Xvfb', [
      `:${display}`,
      '-screen',
      '0',
      '1280x720x24',
      '-ac'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    // 2. Fluxbox (window manager)
    const fluxbox = spawn('fluxbox', [], {
      env: { ...process.env, DISPLAY: `:${display}` }
    });

    // 3. Chromium
    const chrome = spawn('chromium', [
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=1280,720',
      'https://www.google.com'
    ], {
      env: { ...process.env, DISPLAY: `:${display}` }
    });

    await new Promise(r => setTimeout(r, 2000));

    // 4. VNC
    const vnc = spawn('x11vnc', [
      '-display', `:${display}`,
      '-forever',
      '-nopw',
      '-rfbport', String(vncPort)
    ]);

    await new Promise(r => setTimeout(r, 2000));

    // 5. noVNC (web)
    const ws = spawn('websockify', [
      '--web', '/usr/share/novnc',
      String(wsPort),
      `localhost:${vncPort}`
    ]);

    sessions[profileId] = { xvfb, fluxbox, chrome, vnc, ws };

    const host = req.headers.host;
    const url = `https://${host}/novnc/${profileId}`;

    res.json({
      success: true,
      url
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================= NOVNC PAGE =================
app.get('/novnc/:profileId', (req, res) => {
  const { profileId } = req.params;
  const { wsPort } = getPorts(profileId);

  const host = req.headers.host;

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Browser ${profileId}</title>
  <script src="/novnc/vnc.html"></script>
</head>
<body style="margin:0">
  <iframe src="/vnc.html?host=${host}&port=${wsPort}" width="100%" height="100%"></iframe>
</body>
</html>
  `);
});

// ================= STATIC NOVNC =================
app.use('/novnc', express.static('/usr/share/novnc'));

// ================= HEALTH =================
app.get('/health', (req, res) => res.send('OK'));

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('🚀 Server rodando', PORT);
});
