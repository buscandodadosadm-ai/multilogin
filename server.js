/* eslint-disable */
// @ts-nocheck
// Este arquivo é para deploy no Railway (Node.js), não faz parte do frontend React.
const express = require('express');
const { execSync, spawn } = require('child_process');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const SECRET = process.env.SERVICE_SECRET;
const BASE_PORT_VNC = 5900;
const BASE_PORT_WS  = 6080;

const sessions = {};

function auth(req, res, next) {
  const key = req.headers['x-service-secret'];
  if (!SECRET || key !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function getPorts(profileId) {
  const hash = parseInt(crypto.createHash('md5').update(profileId).digest('hex').slice(0, 4), 16);
  const slot = hash % 50;
  const display  = 10 + slot;
  const vncPort  = BASE_PORT_VNC + slot;
  const wsPort   = BASE_PORT_WS  + slot;
  return { display, vncPort, wsPort };
}

function parseProxy(proxyRaw) {
  if (!proxyRaw) return null;
  const parts = proxyRaw.split(':');
  if (parts.length === 2) return { host: parts[0], port: parts[1], user: null, pass: null };
  if (parts.length === 4) return { host: parts[0], port: parts[1], user: parts[2], pass: parts[3] };
  return null;
}

function findChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const c of candidates) {
    if (!c) continue;
    try { execSync(`test -f "${c}"`, { stdio: 'ignore' }); return c; } catch (e) {}
  }
  // fallback: search ms-playwright
  try {
    const found = execSync('find /ms-playwright -name "chrome" -type f 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch (e) {}
  return null;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// noVNC static files installed via apt-get into /usr/share/novnc
const noVncPath = '/usr/share/novnc';
app.use('/novnc-static', express.static(noVncPath));
console.log('noVNC static files served from', noVncPath);

// noVNC viewer page for a specific profile
app.get('/novnc/:profileId', (req, res) => {
  const session = sessions[req.params.profileId];
  if (!session) return res.status(404).send('Session not found or not started yet.');

  const host = req.headers.host || 'localhost';
  const wsUrl = `wss://${host}/ws/${req.params.profileId}`;

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Browser - ${req.params.profileId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a1a; overflow: hidden; width: 100vw; height: 100vh; }
    #screen { width: 100%; height: 100%; }
  </style>
  <script type="module">
    import RFB from '/novnc-static/core/rfb.js';
    const screen = document.getElementById('screen');
    let rfb;
    function connect() {
      rfb = new RFB(screen, '${wsUrl}', { credentials: {} });
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.addEventListener('disconnect', (e) => {
        console.log('VNC disconnected, retrying in 2s', e.detail);
        setTimeout(connect, 2000);
      });
    }
    connect();
  </script>
</head>
<body>
  <div id="screen"></div>
</body>
</html>`);
});

// Start a browser session
app.post('/session/start', auth, async (req, res) => {
  const { profileId, proxyRaw, proxyType, userAgent, timezone, language, canvasSeed, webglSeed, cookies } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId required' });

  // Kill existing session
  if (sessions[profileId]) {
    try { killSession(profileId); } catch (e) {}
    await wait(800);
  }

  const { display, vncPort, wsPort } = getPorts(profileId);
  const proxy = parseProxy(proxyRaw);

  // 1. Start Xvfb
  const xvfbProcess = spawn('Xvfb', [`:${display}`, '-screen', '0', '1280x720x24', '-ac'], {
    detached: false, stdio: 'ignore'
  });
  await wait(1500);

  try {
    // 2. Find Chromium binary
    const chromiumPath = findChromium();
    if (!chromiumPath) throw new Error('Chromium not found on this machine');
    console.log('Using chromium:', chromiumPath);

    // 3. Build Chromium args
    const chromeArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      `--lang=${language || 'pt-BR'}`,
      '--window-size=1280,720',
      '--window-position=0,0',
      '--start-maximized',
      `--user-agent=${userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}`,
    ];

    if (proxy) {
      const scheme = proxyType === 'socks5' ? 'socks5' : 'http';
      chromeArgs.push(`--proxy-server=${scheme}://${proxy.host}:${proxy.port}`);
    }

    chromeArgs.push('https://www.google.com');

    const chromeEnv = {
      ...process.env,
      DISPLAY: `:${display}`,
      TZ: timezone || 'America/Sao_Paulo',
    };

    // 4. Launch Chromium directly (renders in Xvfb display)
    const chromeProcess = spawn(chromiumPath, chromeArgs, {
      detached: false,
      stdio: 'ignore',
      env: chromeEnv,
    });

    await wait(2000);

    // 5. Start x11vnc to capture the Xvfb display
    const vncProcess = spawn('x11vnc', [
      '-display', `:${display}`,
      '-forever', '-shared',
      '-rfbport', String(vncPort),
      '-nopw',
      '-noxrecord',
      '-noxfixes',
      '-noxdamage',
      '-cursor', 'arrow',
    ], { detached: false, stdio: 'ignore' });

    await wait(2000);

    // 6. Start websockify to proxy WebSocket → VNC
    const wsProcess = spawn('websockify', [
      '--web', noVncPath,
      String(wsPort),
      `localhost:${vncPort}`
    ], { detached: false, stdio: 'ignore' });

    await wait(500);

    sessions[profileId] = {
      display, vncPort, wsPort,
      chromeProcess, vncProcess, wsProcess, xvfbProcess,
      startedAt: new Date().toISOString()
    };

    const railwayHost = process.env.RAILWAY_PUBLIC_DOMAIN || req.headers.host || 'localhost';
    const noVncUrl = `https://${railwayHost}/novnc/${profileId}`;

    res.json({ success: true, profileId, noVncUrl });

  } catch (error) {
    console.error('Session start error:', error.message);
    try { xvfbProcess.kill(); } catch (e) {}
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop a browser session
app.post('/session/stop', auth, async (req, res) => {
  const { profileId } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId required' });
  killSession(profileId);
  res.json({ success: true });
});

// Status
app.get('/session/:profileId/status', auth, (req, res) => {
  const session = sessions[req.params.profileId];
  if (!session) return res.json({ active: false });
  res.json({ active: true, profileId: req.params.profileId, startedAt: session.startedAt });
});

function killSession(profileId) {
  const s = sessions[profileId];
  if (!s) return;
  try { s.chromeProcess?.kill('SIGKILL'); } catch (e) {}
  try { s.wsProcess?.kill('SIGKILL'); } catch (e) {}
  try { s.vncProcess?.kill('SIGKILL'); } catch (e) {}
  try { s.xvfbProcess?.kill('SIGKILL'); } catch (e) {}
  try { execSync(`pkill -f "Xvfb :${s.display}"`, { stdio: 'ignore' }); } catch (e) {}
  delete sessions[profileId];
}

app.get('/health', (req, res) => res.json({ ok: true, sessions: Object.keys(sessions).length }));

// ── HTTP server + WebSocket tunnel ──────────────────────────────────────────
const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/ws\/([^/?]+)/);
  if (!match) { socket.destroy(); return; }

  const profileId = match[1];
  const session = sessions[profileId];
  if (!session) { socket.destroy(); return; }

  const target = net.createConnection(session.wsPort, 'localhost', () => {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ProfileVault Browser Server on port ${PORT}`));
