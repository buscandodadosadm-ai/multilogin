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

// ================= ESTABILIDADE GLOBAL =================
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

// ================= PROXY (HTTP + SOCKS5) =================
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

// ================= START SESSION =================
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
    // 🔥 AUTO-KILL sessão existente
    if (sessions[profileId]) {
      console.log('Sessão já existe, encerrando automaticamente...');

      try {
        await sessions[profileId].page.close();
        await sessions[profileId].context.close();
        await sessions[profileId].browser.close();
      } catch (e) {}

      delete sessions[profileId];
    }

    const proxy = parseProxy(proxyRaw, proxyType);

    console.log('==== NOVA SESSÃO ====');
    console.log('Perfil:', profileId);
    console.log('Proxy:', proxy);

    const browser = await chromium.launch({
      headless: true,
      timeout: 60000
    });

    const context = await browser.newContext({
      userAgent: userAgent || undefined,
      locale: language || 'pt-BR',
      timezoneId: timezone || 'America/Sao_Paulo',
      proxy: proxy || undefined,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true
    });

    // ================= COOKIES =================
    if (cookies && Array.isArray(cookies)) {
      try {
        await context.addCookies(cookies);
        console.log('Cookies aplicados');
      } catch (e) {
        console.log('Erro ao aplicar cookies:', e.message);
      }
    }

    const page = await context.newPage();

    // ================= TESTE DE CONEXÃO =================
    await page.goto('http://example.com', {
      timeout: 60000,
      waitUntil: 'commit'
    });

    console.log('Navegação inicial OK');

    // ================= TESTE DE IP =================
    try {
      const ipCheck = await page.goto('http://api.ipify.org?format=json', {
        timeout: 30000
      });
      const body = await ipCheck.text();
      console.log('IP do proxy:', body);
    } catch (e) {
      console.log('Falha ao validar proxy:', e.message);
    }

    sessions[profileId] = {
      browser,
      context,
      page,
      startedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      profileId,
      status: 'running'
    });

  } catch (error) {
    console.error('ERRO AO INICIAR SESSÃO:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================= STOP SESSION =================
app.post('/session/stop', auth, async (req, res) => {
  const { profileId } = req.body;

  const session = sessions[profileId];
  if (!session) {
    return res.json({ success: false });
  }

  try {
    await session.page.close();
    await session.context.close();
    await session.browser.close();
  } catch (e) {}

  delete sessions[profileId];

  res.json({ success: true });
});

// ================= STATUS =================
app.get('/session/:profileId/status', auth, (req, res) => {
  const s = sessions[req.params.profileId];

  res.json({
    active: !!s,
    startedAt: s?.startedAt || null
  });
});

// ================= LIST =================
app.get('/sessions', auth, (req, res) => {
  res.json({
    total: Object.keys(sessions).length,
    sessions: Object.keys(sessions)
  });
});

// ================= HEALTH =================
app.get('/health', (req, res) => {
  try {
    res.status(200).json({
      ok: true,
      sessions: Object.keys(sessions).length
    });
  } catch (e) {
    res.status(200).json({ ok: false });
  }
});

// ================= START SERVER =================
app.listen(process.env.PORT || 3000, () => {
  console.log('Multilogin Worker rodando...');
});
