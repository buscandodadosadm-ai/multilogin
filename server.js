/* eslint-disable */
// @ts-nocheck

const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const net = require('net');

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
      return res.json({
        success: true,
        url: `/novnc/${profileId}`
      });
    }

    const { display, vncPort, wsPort } = getPorts(profileId);

    console.log('🚀 START SESSION:', profileId);

    // 1. Xvfb
    const xvfb = spawn('Xvfb', [
      `:${display}`,
      '-screen',
      '0',
      '1280x720x24',
      '-ac'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    // 2. Window manager
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
      '-shared',
      '-rfbport', String(vncPort),
      '-nopw'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    // 5. WebSocket proxy interno
    const ws = spawn('websockify', [
      String(wsPort),
      `localhost:${vncPort}`
    ]);

    sessions[profileId] = {
      xvfb,
      fluxbox,
      chrome,
      vnc,
      ws,
      wsPort
    };

    res.json({
      success: true,
      url: `/novnc/${profileId}`
    });

  } catch (err) {
    console.error('❌ ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================= STOP =================
app.post('/session/stop', async (req, res) => {
  const { profileId } = req.body;

  const s = sessions[profileId];
  if (!s) return res.json({ success: true });

  try { s.chrome.kill(); } catch {}
  try { s.vnc.kill(); } catch {}
  try { s.ws.kill(); } catch {}
  try { s.fluxbox.kill(); } catch {}
  try { s.xvfb.kill(); } catch {}

  delete sessions[profileId];

  res.json({ success: true });
});

// ================= NOVNC UI =================
app.get('/novnc/:profileId', (req, res) => {
  const { profileId } = req.params;
  const session = sessions[profileId];

  if (!session) {
    return res.send('Sessão não encontrada');
  }

  const host = req.headers.host;

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Browser ${profileId}</title>
  <style>
    body { margin:0; background:#000; }
  </style>
  <script type="module">
    import RFB from '/novnc/core/rfb.js';

    const rfb = new RFB(
      document.body,
      'wss://${host}/ws/${profileId}'
    );

    rfb.scaleViewport = true;
    rfb.resizeSession = true;
  </script>
</head>
<body></body>
</html>
  `);
});

// ================= STATIC NOVNC =================
app.use('/novnc', express.static('/usr/share/novnc'));

// ================= HEALTH =================
app.get('/health', (req, res) => {
  res.send('OK');
});

// ================= WS TUNNEL (CRÍTICO) =================
const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/ws\/([^/?]+)/);

  if (!match) {
    socket.destroy();
    return;
  }

  const profileId = match[1];
  const session = sessions[profileId];

  if (!session) {
    socket.destroy();
    return;
  }

  const target = net.createConnection(session.wsPort, '127.0.0.1', () => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n\r\n'
    );

    target.write(head);
    target.pipe(socket);
    socket.pipe(target);
  });

  target.on('error', () => socket.destroy());
  socket.on('error', () => target.destroy());
});

// ================= START =================
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server rodando na porta', PORT);
});
