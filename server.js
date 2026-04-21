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
const EXTENSIONS_DIR = path.join(__dirname, 'extensions');

if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR);
if (!fs.existsSync(EXTENSIONS_DIR)) fs.mkdirSync(EXTENSIONS_DIR);

// ================= AUTH =================
function auth(req, res, next) {
  const key = req.headers['x-service-secret'];
  if (!SECRET || key !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ================= PARSE PROXY =================
function parseProxy(proxyRaw) {
  if (!proxyRaw) return null;

  const parts = proxyRaw.split(':');

  if (parts.length === 2) {
    return { host: parts[0], port: parts[1] };
  }

  if (parts.length === 4) {
    return {
      host: parts[0],
      port: parts[1],
      username: parts[2],
      password: parts[3]
    };
  }

  return null;
}

// ================= CRIAR EXTENSÃO =================
function createProxyExtension(profileId, proxy) {
  const extPath = path.join(EXTENSIONS_DIR, profileId);

  if (!fs.existsSync(extPath)) {
    fs.mkdirSync(extPath, { recursive: true });
  }

  const manifest = `
{
  "manifest_version": 2,
  "name": "ProxyAuth",
  "version": "1.0",
  "permissions": [
    "proxy",
    "tabs",
    "storage",
    "<all_urls>",
    "webRequest",
    "webRequestBlocking"
  ],
  "background": {
    "scripts": ["background.js"]
  }
}
`;

  const background = `
var config = {
  mode: "fixed_servers",
  rules: {
    singleProxy: {
      scheme: "http",
      host: "${proxy.host}",
      port: parseInt(${proxy.port})
    },
    bypassList: ["localhost"]
  }
};

chrome.proxy.settings.set({ value: config, scope: "regular" });

chrome.webRequest.onAuthRequired.addListener(
  function(details) {
    return {
      authCredentials: {
        username: "${proxy.username || ''}",
        password: "${proxy.password || ''}"
      }
    };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);
`;

  fs.writeFileSync(path.join(extPath, 'manifest.json'), manifest);
  fs.writeFileSync(path.join(extPath, 'background.js'), background);

  return extPath;
}

// ================= START =================
app.post('/session/start', auth, async (req, res) => {
  const { profileId, proxyRaw, userAgent, timezone, language } = req.body;

  console.log('\n🚀 START SESSION');
  console.log(req.body);

  try {
    if (!profileId) throw new Error('profileId obrigatório');

    const profilePath = path.join(PROFILES_DIR, profileId);

    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true });
    }

    const proxy = parseProxy(proxyRaw);
    console.log('Proxy:', proxy);

    // encerra sessão antiga
    if (sessions[profileId]) {
      try { await sessions[profileId].context.close(); } catch {}
      delete sessions[profileId];
    }

    let extensionPath = null;

    if (proxy && proxy.username) {
      console.log('🔌 Criando extensão de proxy...');
      extensionPath = createProxyExtension(profileId, proxy);
    }

    console.log('🌐 Abrindo browser...');

    const context = await chromium.launchPersistentContext(profilePath, {
      headless: false, // obrigatório para extensão
      viewport: { width: 1280, height: 720 },
      userAgent: userAgent || undefined,
      locale: language || 'pt-BR',
      timezoneId: timezone || 'America/Sao_Paulo',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        ...(extensionPath
          ? [
              `--disable-extensions-except=${extensionPath}`,
              `--load-extension=${extensionPath}`
            ]
          : [])
      ]
    });

    console.log('✅ Browser OK');

    const page = context.pages()[0] || await context.newPage();

    await page.goto('http://example.com', {
      timeout: 60000,
      waitUntil: 'commit'
    });

    console.log('✅ Navegação OK');

    try {
      const resp = await page.goto('http://api.ipify.org?format=json');
      const body = await resp.text();
      console.log('🌍 IP:', body);
    } catch (e) {
      console.log('⚠️ Falha IP:', e.message);
    }

    sessions[profileId] = { context };

    res.json({
      status: "ok",
      success: true,
      data: { profileId }
    });

  } catch (error) {
    console.error('❌ ERRO COMPLETO:', error);

    res.status(500).json({
      status: "error",
      success: false,
      message: error.message
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

  res.json({ status: "ok" });
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
