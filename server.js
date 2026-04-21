/* eslint-disable */
// @ts-nocheck

const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());
app.use(cors());

const SECRET = process.env.SERVICE_SECRET;
const sessions = {};

// ================= LOG GLOBAL =================
process.on('uncaughtException', (err) => {
  console.error('ERRO GLOBAL:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('PROMISE NÃO TRATADA:', err);
});

// ================= AUTH =================
function auth(req, res, next) {
  const key = req.headers['x-service-secret'];
  if (!SECRET || key !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ================= PROXY =================
function parseProxy(proxyRaw, proxyType) {
  if (!proxyRaw) return null;

  const parts = proxyRaw.split(':');
  const scheme = proxyType === 'socks5' ? 'socks5' : 'http';

  if (parts.length === 2) {
    return { server: `${scheme}://${parts[0]}:${parts[1]}` };
  }

  if (parts.length === 4) {
    return {
      server: `${scheme}://${parts[0]}:${parts[1]}`,
      username: parts[2],
      password: parts[3]
    };
  }

  return null;
}

// ================= START SESSION =================
app.post('/session/start', auth, async (req, res) => {
  const { profileId, proxyRaw, proxyType } = req.body;

  console.log('==== START SESSION ====');
  console.log(req.body);

  if (!profileId) {
    return res.status(400).json({ error: 'profileId required' });
  }

  try {
    const proxy = parseProxy(proxyRaw, proxyType);
    console.log('Proxy:', proxy);

    // encerra sessão existente
    if (sessions[profileId]) {
      try { await sessions[profileId].browser.close(); } catch {}
      delete sessions[profileId];
    }

    const browser = await chromium.launch({
      headless: true,
      timeout: 60000,
      proxy: proxy || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--ignore-certificate-errors'
      ]
    });

    const context = await browser.newContext({
      ignoreHTTPSErrors: true
    });

    const page = await context.newPage();

    await page.goto('http://example.com', {
      timeout: 60000,
      waitUntil: 'commit'
    });

    console.log('Navegação OK');

    // teste IP
    try {
      const resp = await page.goto('http://api.ipify.org?format=json');
      const body = await resp.text();
      console.log('IP:', body);
    } catch (e) {
      console.log('Erro ao validar IP:', e.message);
    }

    sessions[profileId] = { browser };

    res.json({ success: true, profileId });

  } catch (error) {
    console.error('ERRO AO INICIAR:', error);

    res.status(500).json({
      error: error.message
    });
  }
});

// ================= STOP =================
app.post('/session/stop', auth, async (req, res) => {
  const { profileId } = req.body;

  if (sessions[profileId]) {
    try { await sessions[profileId].browser.close(); } catch {}
    delete sessions[profileId];
  }

  res.json({ success: true });
});

// ================= HEALTH =================
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor rodando na porta', PORT);
});
