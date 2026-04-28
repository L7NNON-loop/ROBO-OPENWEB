import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { AviatorService } from './aviatorService.js';
import { initFirebase } from './firebase.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const debugLogs = [];
const MAX_DEBUG_LOGS = 1000;
const logSubscribers = new Set();
const velaSubscribers = new Set();

const appendDebugLog = (entry) => {
  debugLogs.unshift(entry);
  if (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs.length = MAX_DEBUG_LOGS;
  }

  const printer = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.log;
  printer(`🧾 [${entry.stage}] ${entry.message}`);

  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of logSubscribers) {
    res.write(payload);
  }
};

const broadcastVela = (entry) => {
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of velaSubscribers) {
    res.write(payload);
  }
};

const aviatorService = new AviatorService({
  logHandler: appendDebugLog,
  snapshotHandler: broadcastVela
});

app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/api/velas', (req, res) => {
  const limit = req.query.limit ?? 50;
  return res.json({
    ok: true,
    limit: Number(limit),
    data: aviatorService.getVelas(limit),
    logs: debugLogs.slice(0, 20)
  });
});

app.get('/api/status', (req, res) => {
  return res.json({ ok: true, data: aviatorService.getStatus() });
});

app.get('/api/docs', (req, res) => {
  return res.json({
    ok: true,
    name: 'Aviator-auto-script-',
    endpoints: {
      velas: 'GET /api/velas?limit=50',
      status: 'GET /api/status',
      docs: 'GET /api/docs',
      sitesRequisicoes: 'GET /api/sites/requisicoes',
      debugLogs: 'GET /debug/logs?limit=200',
      debugLogsStream: 'GET /debug/logs/stream (SSE)',
      velasStream: 'GET /api/velas/stream (SSE)',
      webviewPage: 'GET /webview',
      webviewState: 'GET /webview/state',
      webviewOpen: 'POST /webview/open',
      webviewExec: 'POST /webview/exec',
      webviewSessionSave: 'POST /webview/session/save'
    }
  });
});

app.get('/api/sites/requisicoes', (req, res) => {
  return res.json({
    ok: true,
    message: 'Rota pública para consumo externo das velas capturadas.',
    links: [
      '/api/velas?limit=50',
      '/api/status',
      '/api/docs'
    ]
  });
});

app.get('/debug/logs', (req, res) => {
  const limit = Number(req.query.limit || 200);
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), MAX_DEBUG_LOGS) : 200;

  return res.json({
    ok: true,
    total: debugLogs.length,
    data: debugLogs.slice(0, safeLimit)
  });
});

app.get('/debug/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, channel: 'logs' })}\n\n`);
  logSubscribers.add(res);

  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    logSubscribers.delete(res);
  });
});

app.get('/api/velas/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, channel: 'velas' })}\n\n`);
  velaSubscribers.add(res);

  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    velaSubscribers.delete(res);
  });
});

app.get('/webview', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'webview.html'));
});

app.get('/webview/state', async (req, res) => {
  try {
    const data = await aviatorService.getWebviewState();
    return res.json({ ok: true, data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/webview/open', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: 'Campo "url" é obrigatório.' });
    const data = await aviatorService.openCustomUrl(url);
    return res.json({ ok: true, data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/webview/exec', async (req, res) => {
  try {
    const { script } = req.body || {};
    if (!script) return res.status(400).json({ ok: false, error: 'Campo "script" é obrigatório.' });
    const data = await aviatorService.executeConsoleScript(script);
    return res.json({ ok: true, data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/webview/session/save', async (req, res) => {
  try {
    const data = await aviatorService.saveSessionNow();
    return res.json({ ok: true, data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

const server = app.listen(config.port, async () => {
  console.log(`🚀 Servidor ativo na porta ${config.port}`);
  initFirebase();

  try {
    await aviatorService.start();
  } catch (error) {
    console.error('❌ Falha ao iniciar captura:', error.message);
  }
});

const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} recebido. Encerrando aplicação...`);

  await aviatorService.stop();

  await new Promise((resolve) => {
    server.close(() => resolve());
  });

  process.exit(0);
};

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
