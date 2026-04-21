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

    // já existe sessão
    if (sessions[profileId]) {
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;

      return res.json({
        success: true,
        url: `${protocol}://${host}/novnc/${profileId}`
      });
    }

    const { display, vncPort, wsPort } = getPorts(profileId);

    console.log(`🚀 START SESSION: ${profileId} (display :${display}, VNC ${vncPort}, WS ${wsPort})`);

    // 1. Xvfb
    const xvfb = spawn('Xvfb', [
      `:${display}`,
      '-screen',
      '0',
      '1280x720x24',
      '-ac'
    ]);
    xvfb.on('error', err => console.error(`[Xvfb] erro:`, err));
    xvfb.stderr?.on('data', d => console.log(`[Xvfb stderr]`, d.toString()));

    await new Promise(r => setTimeout(r, 2000));

    // 2. Fluxbox
    const fluxbox = spawn('fluxbox', [], {
      env: { ...process.env, DISPLAY: `:${display}` }
    });
    fluxbox.on('error', err => console.error(`[Fluxbox] erro:`, err));

    // 3. Chromium
    const chrome = spawn('chromium', [
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=1280,720',
      'https://www.google.com'
    ], {
      env: { ...process.env, DISPLAY: `:${display}` }
    });
    chrome.on('error', err => console.error(`[Chrome] erro:`, err));

    await new Promise(r => setTimeout(r, 3000));

    // 4. VNC
    const vnc = spawn('x11vnc', [
      '-display', `:${display}`,
      '-forever',
      '-shared',
      '-rfbport', String(vncPort),
      '-nopw',
      '-norc'
    ]);
    vnc.on('error', err => console.error(`[x11vnc] erro:`, err));
    vnc.stdout?.on('data', d => console.log(`[x11vnc stdout]`, d.toString().slice(0, 100)));
    vnc.stderr?.on('data', d => console.log(`[x11vnc stderr]`, d.toString().slice(0, 100)));

    sessions[profileId] = {
      xvfb,
      fluxbox,
      chrome,
      vnc,
      vncPort
    };

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;

    return res.json({
      success: true,
      url: `${protocol}://${host}/novnc/${profileId}`
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
  try { s.fluxbox.kill(); } catch {}
  try { s.xvfb.kill(); } catch {}

  delete sessions[profileId];

  res.json({ success: true });
});

// ================= NOVNC =================
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
app.get('/health', (req, res) => res.send('OK'));

// ================= WS TUNNEL =================
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
    console.error(`[WS] Sessão não encontrada: ${profileId}`);
    socket.writeHead(404);
    socket.end();
    return;
  }

  console.log(`[WS] Conectando ${profileId} para VNC porta ${session.vncPort}`);

  const target = net.createConnection(session.vncPort, '127.0.0.1', () => {
    console.log(`[WS] VNC conectado! Upgrading protocol...`);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n' +
      '\r\n'
    );

    target.write(head);
    target.pipe(socket);
    socket.pipe(target);
  });

  target.on('error', (err) => {
    console.error(`[WS] Erro VNC:`, err.message);
    socket.writeHead(500);
    socket.end('Connection error');
  });
  socket.on('error', (err) => {
    console.error(`[WS] Erro socket:`, err.message);
    target.destroy();
  });
});

// ================= START =================
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server rodando na porta', PORT);
});
