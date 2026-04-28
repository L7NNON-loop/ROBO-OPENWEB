import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { AviatorService } from './aviatorService.js';
import { initFirebase } from './firebase.js';

const app = express();
const aviatorService = new AviatorService();

app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin }));
app.use(express.json());

app.get('/api/velas', (req, res) => {
  const limit = req.query.limit ?? 50;
  return res.json({
    ok: true,
    limit: Number(limit),
    data: aviatorService.getVelas(limit)
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
      sitesRequisicoes: 'GET /api/sites/requisicoes'
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
