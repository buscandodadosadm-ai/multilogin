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

  let scheme = 'http';
  if (proxyType === 'socks5') scheme = 'socks5';

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

  console.log('==== INICIO DE SESSÃO ====');
  console.log(req.body);

  if (!profileId) {
    return res.status(400).json({ error: 'profileId required' });
  }

  if (sessions[profileId]) {
    return res.status(400).json({ error: 'Perfil já em uso' });
  }

  try {
    const proxy = parseProxy(proxyRaw, proxyType);
    console.log('Proxy processado:', proxy);

    // ================= TESTE: LAUNCH =================
    const browser = await chromium.launch({
      headless: true,
      timeout: 60000
    });

    console.log('Browser iniciado');

    const context = await browser.newContext({
      proxy: proxy || undefined,
      ignoreHTTPSErrors: true
    });

    console.log('Context criado');

    const page = await context.newPage();

    console.log('Página criada');

    // ================= TESTE DE CONEXÃO =================
    await page.goto('http://example.com', {
      timeout: 60000,
      waitUntil: 'commit'
    });

    console.log('Navegação OK');

    sessions[profileId] = {
      browser,
      context,
      page,
      startedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      profileId
    });

  } catch (error) {
    console.error('ERRO COMPLETO:', error);

    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// ================= STOP =================
app.post('/session/stop', auth, async (req, res) => {
  const { profileId } = req.body;

  const session = sessions[profileId];
  if (!session) return res.json({ success: false });

  try {
    await session.page.close();
    await session.context.close();
    await session.browser.close();
  } catch (e) {}

  delete sessions[profileId];

  res.json({ success: true });
});

// ================= HEALTH =================
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor rodando...');
});
