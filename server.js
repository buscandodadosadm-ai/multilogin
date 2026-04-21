/* eslint-disable */
// @ts-nocheck

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());
app.use(cors());

const SECRET = process.env.SERVICE_SECRET;
const sessions = {};

const PROFILES_DIR = path.join(__dirname, 'profiles');

if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR);
}

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
  const { profileId, proxyRaw, proxyType, userAgent, timezone, language } = req.body;

  console.log('\n===== START SESSION =====');
  console.log(req.body);

  try {
    if (!profileId) throw new Error('profileId obrigatório');

    const profilePath = path.join(PROFILES_DIR, profileId);

    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true });
    }

    const proxy = parseProxy(proxyRaw, proxyType);
    console.log('Proxy:', proxy);

    // encerra sessão antiga
    if (sessions[profileId]) {
      try { await sessions[profileId].context.close(); } catch {}
      delete sessions[profileId];
    }

    const context = await chromium.launchPersistentContext(profilePath, {
      headless: true,
      proxy: proxy || undefined,
      viewport: { width: 1280, height: 720 },
      userAgent: userAgent || undefined,
      locale: language || 'pt-BR',
      timezoneId: timezone || 'America/Sao_Paulo',
      ignoreHTTPSErrors: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--ignore-certificate-errors'
      ]
    });

    const page = context.pages()[0] || await context.newPage();

    // 🔥 TESTE MAIS ESTÁVEL (não usar Google)
    await page.goto('http://example.com', {
      timeout: 60000,
      waitUntil: 'commit'
    });

    console.log('✅ Navegação OK');

    // teste IP (se proxy estiver ativo)
    try {
      const resp = await page.goto('http://api.ipify.org?format=json');
      const body = await resp.text();
      console.log('🌍 IP:', body);
    } catch (e) {
      console.log('⚠️ Falha ao obter IP:', e.message);
    }

    sessions[profileId] = { context };

    res.json({
      success: true,
      profileId
    });

  } catch (error) {
    console.error('❌ ERRO REAL:', error);

    res.status(500).json({
      error: error.message
    });
  }
});

// ================= STOP =================
app.post('/session/stop', auth, async (req, res) => {
  const { profileId } = req.body;

  if (sessions[profileId]) {
    try { await sessions[profileId].context.close(); } catch {}
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
  console.log('🚀 Servidor rodando na porta', PORT);
});
