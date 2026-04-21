/* eslint-disable */
// @ts-nocheck

const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const SECRET = process.env.SERVICE_SECRET;
const sessions = {};

function auth(req, res, next) {
  const key = req.headers['x-service-secret'];
  if (!SECRET || key !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ================= PROXY =================
function parseProxy(proxyRaw) {
  if (!proxyRaw) return null;

  const parts = proxyRaw.split(':');

  if (parts.length === 2) {
    return { server: `http://${parts[0]}:${parts[1]}` };
  }

  if (parts.length === 4) {
    return {
      server: `http://${parts[0]}:${parts[1]}`,
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
    userAgent,
    cookies,
    timezone,
    language
  } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'profileId required' });
  }

  if (sessions[profileId]) {
    return res.status(400).json({ error: 'Perfil já em uso' });
  }

  try {
    const proxy = parseProxy(proxyRaw);

    const browser = await chromium.launch({
      headless: true
    });

    const context = await browser.newContext({
      userAgent: userAgent || undefined,
      locale: language || 'pt-BR',
      timezoneId: timezone || 'America/Sao_Paulo',
      proxy: proxy || undefined,
      viewport: { width: 1280, height: 720 }
    });

    // ================= COOKIES =================
    if (cookies && Array.isArray(cookies)) {
      await context.addCookies(cookies);
    }

    const page = await context.newPage();

    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });

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
    res.status(500).json({ error: error.message });
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
  res.json({ ok: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Multilogin Worker rodando...');
});
