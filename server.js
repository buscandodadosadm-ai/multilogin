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
  let scheme = proxyType === 'socks5' ? 'socks5' : 'http';

  if (parts.length === 2) {
    return {
      server: `${scheme}://${parts[0]}:${parts[1]}`
    };
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

// ================= START =================
app.post('/session/start', auth, async (req, res) => {
  const { profileId, proxyRaw, proxyType } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'profileId required' });
  }

  try {
    // mata sessão antiga
    if (sessions[profileId]) {
      try { await sessions[profileId].browser.close(); } catch {}
      delete sessions[profileId];
    }

    const proxy = parseProxy(proxyRaw, proxyType);

    console.log('=== INICIANDO ===');
    console.log('Proxy:', proxy);

    const browser = await chromium.launch({
      headless: false, // 🔥 IMPORTANTE (teste real)
      timeout: 60000,
      proxy: proxy || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list'
      ]
    });

    const context = await browser.newContext({
      ignoreHTTPSErrors: true
    });

    const page = await context.newPage();

    // teste básico
    await page.goto('http://example.com', {
      timeout: 60000,
      waitUntil: 'domcontentloaded'
    });

    console.log('Página abriu');

    // teste IP
    try {
      const resp = await page.goto('http://api.ipify.org?format=json');
      const body = await resp.text();
      console.log('IP:', body);
    } catch (e) {
      console.log('Erro IP:', e.message);
    }

    sessions[profileId] = { browser };

    res.json({ success: true });

  } catch (error) {
    console.error('ERRO REAL:', error);

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
  res.send('OK');
});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor rodando...');
});
