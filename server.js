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

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SERVICE_SECRET || "123";

const sessions = {};
const PROFILES_DIR = path.join(__dirname, 'profiles');

if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR);
}

// ================= HEALTH (NUNCA FALHA) =================
app.get('/health', (req, res) => {
  return res.status(200).send('OK');
});

// ================= AUTH =================
function auth(req, res, next) {
  const key = req.headers['x-service-secret'];
  if (key !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ================= START SESSION =================
app.post('/session/start', auth, async (req, res) => {
  const { profileId } = req.body;

  console.log('🚀 START SESSION:', profileId);

  try {
    if (!profileId) throw new Error('profileId obrigatório');

    const profilePath = path.join(PROFILES_DIR, profileId);

    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true });
    }

    // fecha sessão anterior
    if (sessions[profileId]) {
      try { await sessions[profileId].close(); } catch {}
      delete sessions[profileId];
    }

    console.log('🌐 Abrindo browser...');

    const context = await chromium.launchPersistentContext(profilePath, {
      headless: true, // 🔥 IMPORTANTE: estabilidade no Railway
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    console.log('✅ Browser OK');

    const page = await context.newPage();

    await page.goto('https://example.com', {
      timeout: 60000,
      waitUntil: 'domcontentloaded'
    });

    console.log('✅ Navegação OK');

    sessions[profileId] = context;

    return res.json({
      status: "ok",
      success: true,
      data: { profileId }
    });

  } catch (error) {
    console.error('❌ ERRO:', error);

    return res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

// ================= STOP =================
app.post('/session/stop', auth, async (req, res) => {
  const { profileId } = req.body;

  if (sessions[profileId]) {
    try { await sessions[profileId].close(); } catch {}
    delete sessions[profileId];
  }

  return res.json({ status: "ok" });
});

// ================= START SERVER =================
app.listen(PORT, '0.0.0.0', () => {
  console.log('🔥 SERVER INICIADO NA PORTA', PORT);
});
