require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
// Importação do Stealth Mode
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const app = express();
app.use(express.json());
app.use(cors());

const SECRET = process.env.SERVICE_SECRET;
const PORT = process.env.PORT || 3000;
const PROFILES_DIR = path.join(__dirname, 'profiles');

const sessions = {};

// Garante pasta base
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

// Middleware de Autenticação
function auth(req, res, next) {
  const key = req.headers['x-service-secret'];
  if (!SECRET || key !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Parsing de Proxy Robusto
function parseProxy(proxyRaw, proxyType) {
  if (!proxyRaw) return null;
  const parts = proxyRaw.split(':');
  const scheme = proxyType === 'socks5' ? 'socks5' : 'http';

  if (parts.length >= 4) {
    return {
      server: `${scheme}://${parts[0]}:${parts[1]}`,
      username: parts[2],
      password: parts[3]
    };
  } else if (parts.length >= 2) {
    return { server: `${scheme}://${parts[0]}:${parts[1]}` };
  }
  return null;
}

// START SESSION
app.post('/session/start', auth, async (req, res) => {
  const { profileId, proxyRaw, proxyType, userAgent, timezone, language } = req.body;

  try {
    if (!profileId) throw new Error('profileId é obrigatório');

    // Segurança: Evita criar pastas fora do diretório profiles (Path Traversal)
    const safeProfileId = path.basename(profileId);
    const profilePath = path.join(PROFILES_DIR, safeProfileId);

    const proxy = parseProxy(proxyRaw, proxyType);

    // Fecha sessão anterior se existir
    if (sessions[safeProfileId]) {
      try { await sessions[safeProfileId].context.close(); } catch (e) {}
      delete sessions[safeProfileId];
    }

    // Lançamento do Contexto Persistente
    const context = await chromium.launchPersistentContext(profilePath, {
      headless: true,
      proxy: proxy || undefined,
      userAgent: userAgent || undefined,
      locale: language || 'pt-BR',
      timezoneId: timezone || 'America/Sao_Paulo',
      viewport: { width: 1280, height: 720 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled', // Esconde o WebDriver
        '--disable-gpu',
        '--ignore-certificate-errors'
      ]
    });

    // Tratamento de Erro de Conexão (Timeout)
    try {
      const page = context.pages()[0] || await context.newPage();
      
      // Espera apenas o início do carregamento (commit) para evitar erro de timeout em proxies lentos
      await page.goto('https://www.google.com', {
        timeout: 45000, 
        waitUntil: 'commit'
      });

      sessions[safeProfileId] = { context };

      res.json({
        success: true,
        message: 'Sessão iniciada com Stealth e Persistência',
        profileId: safeProfileId
      });

    } catch (navError) {
      // FECHA O CONTEXTO SE DER ERRO NO GOTO (Evita Memory Leak)
      await context.close();
      throw new Error(`Falha na navegação inicial (Proxy Offline?): ${navError.message}`);
    }

  } catch (error) {
    console.error(`[ERRO START]: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// STOP SESSION
app.post('/session/stop', auth, async (req, res) => {
  const { profileId } = req.body;
  const safeId = path.basename(profileId);

  if (sessions[safeId]) {
    try { await sessions[safeId].context.close(); } catch (e) {}
    delete sessions[safeId];
    return res.json({ success: true, message: 'Sessão encerrada' });
  }
  res.status(404).json({ error: 'Sessão não encontrada' });
});

// HEALTH CHECK
app.get('/health', (req, res) => res.send('Sistema Multilogin Online'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
