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

// ================= START =================
app.post('/session/start', auth, async (req, res) => {
  const { profileId, proxyRaw, proxyType } = req.body;

  console.log('==== START REQUEST ====');
  console.log(req.body);

  try {
    const proxy = parseProxy(proxyRaw, proxyType);
    console.log('Proxy:', proxy);

    // kill sessão antiga
    if (sessions[profileId]) {
      console.log('Matando sessão antiga...');
      try { await sessions[profileId].browser.close(); } catch {}
      delete sessions[profileId];
    }

    console.log('Iniciando browser...');

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

    console.log('Browser OK');

    const context = await browser.newContext({
      ignoreHTTPSErrors: true
    });

    console.log('Context OK');

    const page = await context.newPage();

    console.log('Page OK');

    await page.goto('http://example.com', {
      timeout: 60000,
      waitUntil: 'commit'
    });

    console.log('Navigation OK');

    sessions[profileId] = { browser };

    res.json({ success: true });

  } catch (error) {
    console.error('🔥 ERRO REAL:', error);

    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
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
