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

// ================= ESTABILIDADE =================
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
  const {
    profileId,
    proxyRaw,
    proxyType,
    userAgent,
    cookies,
    timezone,
    language
  } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'profileId required' });
  }

  try {
    // AUTO-KILL
    if (sessions[profileId]) {
      try {
        await sessions[profileId].browser.close();
      } catch {}
      delete sessions[profileId];
    }

    const proxy = parseProxy(proxyRaw, proxyType);

    console.log('==== NOVA SESSÃO ====');
    console.log('Perfil:', profileId);
    console.log('Proxy:', proxy);

    // 🔥 PROXY NO LAUNCH (CORREÇÃO PRINCIPAL)
    const browser = await chromium.launch({
      headless: true,
      timeout: 60000,
      proxy: proxy || undefined
    });

    const context = await browser.newContext({
      userAgent: userAgent || undefined,
      locale: language || 'pt-BR',
      timezoneId: timezone || 'America/Sao_Paulo',
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true
    });

    if (cookies && Array.isArray(cookies)) {
      try {
        await context.addCookies(cookies);
      } catch (e) {
        console.log('Erro cookies:', e.message);
      }
    }

    const page = await context.newPage();

    // TESTE CONEXÃO
    await page.goto('http://example.com', {
      timeout: 60000,
      waitUntil: 'commit'
    });

    console.log('Navegação OK');

    // TESTE IP
    try {
      const ipCheck = await page.goto('http://api.ipify.org?format=json');
      const body = await ipCheck.text();
      console.log('IP:', body);
    } catch (e) {
      console.log('Erro IP:', e.message);
    }

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
    console.error('ERRO:', error);

    res.status(500).json({
      error: error.message
    });
  }
});

// ================= STOP =================
app.post('/session/stop', auth, async (req, res) => {
  const { profileId } = req.body;

  const session = sessions[profileId];
  if (!session) return res.json({ success: false });

  try {
    await session.browser.close();
  } catch {}

  delete sessions[profileId];

  res.json({ success: true });
});

// ================= HEALTH =================
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor rodando na porta', PORT);
});
