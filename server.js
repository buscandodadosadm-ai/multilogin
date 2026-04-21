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
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const app = express();
app.use(express.json());
app.use(cors());

const SECRET = process.env.SERVICE_SECRET;
const BASE_PORT_VNC = 5900;
const BASE_PORT_WS  = 6080; // websockify WebSocket port (no HTTP, raw WS)

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

// Serve noVNC static files directly from the package
const noVncPath = (() => {
  try { return path.dirname(require.resolve('@novnc/novnc/vnc.html')); } catch (e) {}
  if (require('fs').existsSync('/usr/share/novnc/vnc.html')) return '/usr/share/novnc';
  return null;
})();

if (noVncPath) {
  app.use('/novnc-static', express.static(noVncPath));
  console.log('noVNC static files served from', noVncPath);
} else {
  console.warn('noVNC static files not found — iframe view will not work');
}

// noVNC viewer page for a specific profile
app.get('/novnc/:profileId', (req, res) => {
  const session = sessions[req.params.profileId];
  if (!session) return res.status(404).send('Session not found or not started yet.');

  const proto = req.headers['x-forwarded-proto'] || 'wss';
  const host  = req.headers.host || 'localhost';
  // WebSocket connects back to this same server via /ws/:profileId
  const wsUrl = `wss://${host}/ws/${req.params.profileId}`;

  // Inline noVNC viewer HTML
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Browser - ${req.params.profileId}</title>
  <style>
    body { margin: 0; background: #1a1a1a; overflow: hidden; }
    #screen { width: 100vw; height: 100vh; }
  </style>
  <script type="module">
    import RFB from '/novnc-static/core/rfb.js';
    const rfb = new RFB(document.getElementById('screen'), '${wsUrl}', {
      scaleViewport: true,
      resizeSession: true,
    });
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
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
    await new Promise(r => setTimeout(r, 500));
  }

  const { display, vncPort, wsPort } = getPorts(profileId);
  const proxy = parseProxy(proxyRaw);

  // Start Xvfb
  const xvfbProcess = spawn('Xvfb', [`:${display}`, '-screen', '0', '1280x720x24'], {
    detached: false, stdio: 'ignore'
  });

  await new Promise(r => setTimeout(r, 1000));

  try {
    const env = { ...process.env, DISPLAY: `:${display}`, TZ: timezone || 'America/Sao_Paulo' };

    // Detect chromium path dynamically
    let chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    if (!chromiumPath) {
      try {
        const found = execSync('find /ms-playwright -name "chrome" -type f 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
        chromiumPath = found || undefined;
      } catch (e) {
        chromiumPath = undefined;
      }
    }

    const launchOptions = {
      headless: false,
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
      env,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        `--lang=${language || 'pt-BR'}`,
        '--window-size=1280,720',
      ],
    };

    if (proxy) {
      const scheme = proxyType === 'socks5' ? 'socks5' : 'http';
      launchOptions.args.push(`--proxy-server=${scheme}://${proxy.host}:${proxy.port}`);
    }

    const browser = await chromium.launch(launchOptions);

    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      userAgent: userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: language || 'pt-BR',
      timezoneId: timezone || 'America/Sao_Paulo',
    };

    if (proxy && proxy.user && proxy.pass) {
      contextOptions.httpCredentials = { username: proxy.user, password: proxy.pass };
    }

    const context = await browser.newContext(contextOptions);

    if (cookies) {
      try {
        const decoded = Buffer.from(cookies, 'base64').toString('utf-8');
        await context.addCookies(JSON.parse(decoded));
      } catch (e) {
        console.error('Cookie injection failed:', e.message);
      }
    }

    const page = await context.newPage();
    await page.goto('about:blank');

    // Start x11vnc (raw VNC, no password)
    const vncProcess = spawn('x11vnc', [
      '-display', `:${display}`,
      '-forever', '-shared',
      '-rfbport', String(vncPort),
      '-nopw', '-quiet', '-bg'
    ], { detached: false, stdio: 'ignore' });

    await new Promise(r => setTimeout(r, 1500));

    // Start websockify: WebSocket on wsPort → VNC on vncPort
    const wsProcess = spawn('websockify', [
      String(wsPort),
      `localhost:${vncPort}`
    ], { detached: false, stdio: 'ignore' });

    await new Promise(r => setTimeout(r, 500));

    sessions[profileId] = {
      display, vncPort, wsPort,
      browser, context, page,
      xvfbProcess, vncProcess, wsProcess,
      startedAt: new Date().toISOString()
    };

    const railwayHost = process.env.RAILWAY_PUBLIC_DOMAIN || req.headers.host || 'localhost';
    const noVncUrl = `https://${railwayHost}/novnc/${profileId}`;

    res.json({ success: true, profileId, noVncUrl });

  } catch (error) {
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
  try { s.browser?.close(); } catch (e) {}
  try { s.wsProcess?.kill('SIGKILL'); } catch (e) {}
  try { s.vncProcess?.kill('SIGKILL'); } catch (e) {}
  try { s.xvfbProcess?.kill('SIGKILL'); } catch (e) {}
  try { execSync(`pkill -f "Xvfb :${s.display}"`, { stdio: 'ignore' }); } catch (e) {}
  delete sessions[profileId];
}

app.get('/health', (req, res) => res.json({ ok: true, sessions: Object.keys(sessions).length }));

// ── HTTP server + WebSocket tunnel ──────────────────────────────────────────
const server = http.createServer(app);

// Proxy WebSocket upgrades at /ws/:profileId → local websockify port
server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/ws\/([^/?]+)/);
  if (!match) { socket.destroy(); return; }

  const profileId = match[1];
  const session = sessions[profileId];
  if (!session) { socket.destroy(); return; }

  const target = net.createConnection(session.wsPort, 'localhost', () => {
    // Send HTTP upgrade response manually, then pipe raw TCP
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
