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

// ================= DEBUG GLOBAL =================
process.on('uncaughtException', (err) => {
  console.error('🔥 ERRO GLOBAL:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('🔥 PROMISE NÃO TRATADA:', err);
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

  console.log('\n==============================');
  console.log('🚀 NOVA SESSÃO');
  console.log(req.body);
  console.log('==============================\n');

  try {
    if (!profileId) {
      throw new Error('profileId não enviado');
    }

    const proxy = parseProxy(proxyRaw, proxyType);
    console.log('Proxy:', proxy);

    // matar sessão antiga
    if (sessions[profileId]) {
      console.log('Encerrando sessão anterior...');
      try { await sessions[profileId].browser.close(); } catch {}
      delete sessions[profileId];
    }

    console.log('1️⃣ Launch browser...');

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

    console.log('2️⃣ Browser OK');

    const context = await browser.newContext({
      ignoreHTTPSErrors: true
    });

    console.log('3️⃣ Context OK');

    const page = await context.newPage();

    console.log('4️⃣ Page OK');

    await page.goto('http://example.com', {
      timeout: 60000,
      waitUntil: 'commit'
    });

    console.log('5️⃣ Navegação OK');

    // teste IP
    try {
      const resp = await page.goto('http://api.ipify.org?format=json');
      const body = await resp.text();
      console.log('🌍 IP:', body);
    } catch (e) {
      console.log('⚠️ Erro ao pegar IP:', e.message);
    }

    sessions[profileId] = { browser };

    res.json({
      success: true,
      message: 'Sessão iniciada com sucesso'
    });

  } catch (error) {
    console.error('❌ ERRO REAL DETALHADO:\n', error);

    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// ================= HEALTH =================
app.get('/health', (req, res) => {
  res.send('OK');
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor rodando na porta', PORT);
});
