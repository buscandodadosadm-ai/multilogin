/* global require, process */
const express = require('express');
const { spawn } = require('child_process');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const sessions = {}; // profileId → { xvfb, chrome, vnc, ws, ports }

// ================= START SESSION =================
app.post('/session/start', async (req, res) => {
  const {
    profileId,
    userId,
    proxyRaw,
    proxyType = 'http',
    userAgent,
    timezone,
    language,
    canvasSeed,
    webglSeed,
    cookies
  } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'profileId required' });
  }

  try {
    const displayNum = Math.floor(Math.random() * 1000) + 100;
    const display = `:${displayNum}`;
    const vncPort = 5900 + displayNum;
    const wsPort = 6900 + displayNum;

    console.log(`\n========== START ${profileId} ==========`);
    console.log(`Display: ${display}, VNC: ${vncPort}, WS: ${wsPort}`);

    // 1. Xvfb (virtual display)
    console.log(`[1] Iniciando Xvfb no ${display}...`);
    const xvfb = spawn('Xvfb', [
      display,
      '-screen', '0', '1920x1080x24',
      '-listen', 'tcp'
    ]);
    xvfb.on('error', err => console.error(`[Xvfb] erro:`, err));
    xvfb.stdout?.on('data', d => console.log(`[Xvfb]`, d.toString().trim()));
    xvfb.stderr?.on('data', d => console.log(`[Xvfb ERROR]`, d.toString().trim()));

    await new Promise(r => setTimeout(r, 2000));

    // 2. Fluxbox (window manager)
    console.log(`[2] Iniciando Fluxbox...`);
    const fluxbox = spawn('fluxbox', [], {
      env: { ...process.env, DISPLAY: display }
    });
    fluxbox.on('error', err => console.error(`[Fluxbox] erro:`, err));
    fluxbox.stdout?.on('data', d => console.log(`[Fluxbox]`, d.toString().trim()));
    fluxbox.stderr?.on('data', d => console.log(`[Fluxbox ERROR]`, d.toString().trim()));

    // 3. Chromium
    console.log(`[3] Iniciando Chromium...`);
    const chromeArgs = [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled',
      '--disable-extensions',
      '--disable-plugins',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank'
    ];

    // Proxy
    if (proxyRaw) {
      const proxyUrl = proxyType === 'socks5'
        ? `socks5://${proxyRaw}`
        : `http://${proxyRaw}`;
      chromeArgs.push(`--proxy-server=${proxyUrl}`);
    }

    // User-Agent
    if (userAgent) {
      chromeArgs.push(`--user-agent=${userAgent}`);
    }

    const chrome = spawn('chromium', chromeArgs, {
      env: { ...process.env, DISPLAY: display }
    });
    chrome.on('error', err => console.error(`[Chromium] erro:`, err));
    chrome.stdout?.on('data', d => console.log(`[Chromium]`, d.toString().slice(0, 120)));
    chrome.stderr?.on('data', d => console.log(`[Chromium ERROR]`, d.toString().slice(0, 120)));

    await new Promise(r => setTimeout(r, 6000));

    // 4. x11vnc
    console.log(`[4] Iniciando x11vnc na porta ${vncPort}...`);
    const vnc = spawn('x11vnc', [
      '-display', display,
      '-forever',
      '-shared',
      '-rfbport', String(vncPort),
      '-nopw',
      '-norc',
      '-xkb',
      '-noresize',
      '-verbose'
    ]);
    vnc.on('error', err => console.error(`[x11vnc] erro:`, err));
    vnc.stdout?.on('data', d => console.log(`[x11vnc]`, d.toString().slice(0, 120)));
    vnc.stderr?.on('data', d => console.log(`[x11vnc ERROR]`, d.toString().slice(0, 120)));

    // Esperar x11vnc estar pronto
    await new Promise(r => setTimeout(r, 4000));

    // Verificar se x11vnc está escutando
    console.log(`[5] Verificando se VNC está escutando na porta ${vncPort}...`);
    const net = require('net');
    let vncReady = false;
    for (let i = 0; i < 10; i++) {
      const socket = net.createConnection({
        host: 'localhost',
        port: vncPort,
        timeout: 1000
      });
      try {
        await new Promise((resolve) => {
          socket.on('connect', () => {
            console.log(`[5] ✅ VNC está pronto na porta ${vncPort}`);
            vncReady = true;
            socket.destroy();
            resolve();
          });
          socket.on('error', () => {
            socket.destroy();
            resolve();
          });
        });
        if (vncReady) break;
      } catch (e) {}
      await new Promise(r => setTimeout(r, 500));
    }

    if (!vncReady) {
      console.error(`[5] ❌ VNC não respondeu depois de 10 tentativas`);
    }

    // 5. websockify (WebSocket → RFB proxy)
    console.log(`[5] Iniciando websockify na porta ${wsPort}...`);
    const ws = spawn('websockify', [
      '--web', '/usr/share/novnc',
      String(wsPort),
      `localhost:${vncPort}`
    ]);
    ws.on('error', err => console.error(`[websockify] erro:`, err));
    ws.stdout?.on('data', d => console.log(`[websockify]`, d.toString().trim()));
    ws.stderr?.on('data', d => console.log(`[websockify]`, d.toString().trim()));

    await new Promise(r => setTimeout(r, 2000));

    // Salva sessão
    sessions[profileId] = {
      xvfb,
      fluxbox,
      chrome,
      vnc,
      ws,
      display,
      vncPort,
      wsPort,
      startedAt: new Date()
    };

    // Retorna URL
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const noVncUrl = `${protocol}://${host}/novnc/${profileId}`;

    console.log(`✅ Sessão iniciada! URL: ${noVncUrl}\n`);

    return res.json({
      success: true,
      profileId,
      url: noVncUrl,
      vncPort,
      wsPort
    });

  } catch (err) {
    console.error(`❌ Erro ao iniciar ${profileId}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ================= STOP SESSION =================
app.post('/session/stop', async (req, res) => {
  const { profileId } = req.body;
  const s = sessions[profileId];

  if (!s) {
    return res.json({ success: true });
  }

  console.log(`\n========== STOP ${profileId} ==========`);

  try {
    s.chrome?.kill();
    s.vnc?.kill();
    s.ws?.kill();
    s.fluxbox?.kill();
    s.xvfb?.kill();
  } catch (e) {
    console.error(`Erro ao matar processos:`, e.message);
  }

  delete sessions[profileId];
  console.log(`✅ Sessão encerrada\n`);

  res.json({ success: true });
});

// ================= STATUS =================
app.get('/session/:profileId/status', (req, res) => {
  const { profileId } = req.params;
  const s = sessions[profileId];

  if (!s) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const uptime = new Date() - s.startedAt;

  res.json({
    success: true,
    profileId,
    active: true,
    uptime: Math.floor(uptime / 1000),
    ports: { vnc: s.vncPort, ws: s.wsPort }
  });
});

// ================= NOVNC HTML PAGE =================
app.get('/novnc/:profileId', (req, res) => {
  const { profileId } = req.params;
  const s = sessions[profileId];

  if (!s) {
    return res.status(404).send('Sessão não encontrada');
  }

  const host = req.headers.host;
  const wsUrl = `wss://${host}/ws/${profileId}`;

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Browser ${profileId}</title>
  <link rel="stylesheet" href="/novnc/app/ui.css">
  <script type="module">
    import RFB from '/novnc/core/rfb.js';

    const rfb = new RFB(
      document.getElementById('screen'),
      '${wsUrl}',
      { credentials: { username: '', password: '' } }
    );

    rfb.addEventListener('connect', () => {
      console.log('✅ Conectado ao VNC');
      document.body.style.overflow = 'hidden';
    });

    rfb.addEventListener('disconnect', () => {
      console.log('❌ Desconectado do VNC');
    });

    rfb.addEventListener('error', (e) => {
      console.error('❌ Erro VNC:', e.detail);
    });

    rfb.scaleViewport = true;
    rfb.resizeSession = true;
  </script>
  <style>
    body { margin: 0; padding: 0; background: #000; overflow: hidden; font-family: sans-serif; }
    #screen { width: 100vw; height: 100vh; display: block; }
    .status { position: fixed; bottom: 10px; right: 10px; color: #0f0; font-size: 12px; font-family: monospace; }
  </style>
</head>
<body>
  <div id="screen"></div>
  <div class="status">Conectando...</div>
</body>
</html>
  `);
});

// ================= STATIC NOVNC =================
app.use('/novnc', express.static('/usr/share/novnc'));

// ================= HEALTH =================
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    activeSessions: Object.keys(sessions).length,
    timestamp: new Date().toISOString()
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// ================= WEBSOCKET PROXY (para noVNC via JS) =================
const WebSocket = require('ws');
const wsServer = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws/')) {
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      const profileId = req.url.split('/').pop();
      const s = sessions[profileId];

      if (!s) {
        ws.close(1008, 'Session not found');
        return;
      }

      console.log(`[WebSocket] Client conectado a ${profileId}, tentando conectar ao VNC na porta ${s.vncPort}...`);

      // Conectar ao x11vnc (com retry)
      let vncSocket;
      const maxRetries = 3;
      let retryCount = 0;

      const connectVNC = () => {
        vncSocket = require('net').createConnection({
          host: 'localhost',
          port: s.vncPort,
          timeout: 5000
        });

        vncSocket.on('connect', () => {
          console.log(`[VNC Socket] Conectado com sucesso a ${s.vncPort}`);
        });

        vncSocket.on('data', (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        vncSocket.on('error', (err) => {
          console.error(`[VNC Socket] erro:`, err.message, `(tentativa ${retryCount + 1}/${maxRetries})`);
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`[VNC Socket] Tentando reconectar em 1s...`);
            setTimeout(connectVNC, 1000);
          } else {
            ws.close(1011, `VNC connection error after ${maxRetries} retries: ${err.message}`);
          }
        });

        vncSocket.on('close', () => {
          console.log(`[VNC Socket] Fechado`);
          ws.close(1000);
        });

        vncSocket.on('timeout', () => {
          console.error(`[VNC Socket] timeout na porta ${s.vncPort}`);
          vncSocket.destroy();
        });
      };

      connectVNC();

      ws.on('message', (data) => {
        if (vncSocket && vncSocket.writable) {
          vncSocket.write(data);
        }
      });

      ws.on('close', () => {
        if (vncSocket) vncSocket.destroy();
        console.log(`[WebSocket] Client desconectado de ${profileId}`);
      });

      ws.on('error', (err) => {
        console.error(`[WebSocket] erro:`, err.message);
        if (vncSocket) vncSocket.destroy();
      });
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ProfileVault Server rodando na porta ${PORT}`);
  console.log(`📍 Railway URL: ${process.env.RAILWAY_URL || 'http://localhost:3000'}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n⚠️  SIGTERM recebido, encerrando sessões...');
  Object.values(sessions).forEach(s => {
    try { s.xvfb?.kill(); s.chrome?.kill(); s.vnc?.kill(); s.ws?.kill(); s.fluxbox?.kill(); } catch {}
  });
  server.close(() => process.exit(0));
});
