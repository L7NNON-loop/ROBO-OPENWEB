import { chromium } from 'playwright';
import { config } from './config.js';
import { sendSnapshotToFirebase } from './firebase.js';

const VELA_REGEX = /^\d+\.\d+x$/i;

const FALLBACK_SELECTORS = [
  'div.payout[appcoloredmultiplier]',
  'div[class*="payout"]',
  'div[style*="rgb(52, 180, 255)"], div[style*="rgb(145, 62, 248)"], div[style*="rgb(192, 23, 180)"]',
  'div[class*="payouts-block"] div[style*="color"]',
  '[class*="stats"] div[style*="rgb"]'
];

export class AviatorService {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.pollTimer = null;
    this.isRunning = false;

    this.history = [];
    this.lastSnapshotHash = '';
    this.totalSnapshots = 0;
    this.lastError = null;
    this.lastCaptureAt = null;
    this.startedAt = null;
  }

  async start() {
    if (this.isRunning) return;

    try {
      await this.launchBrowser();
      await this.login();
      await this.openAviator();

      this.startedAt = new Date().toISOString();
      this.pollTimer = setInterval(() => {
        void this.captureCycle();
      }, config.pollIntervalMs);

      await this.captureCycle();
      this.isRunning = true;
      console.log(`✅ Captura iniciada. Intervalo: ${config.pollIntervalMs}ms`);
    } catch (error) {
      this.lastError = error.message;
      await this.stop();
      throw error;
    }
  }

  async launchBrowser() {
    try {
      this.browser = await chromium.launch({
        headless: config.browserHeadless,
        executablePath: config.browserExecutablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
    } catch (error) {
      if (error.message?.includes("Executable doesn't exist") || error.message?.includes('Failed to launch')) {
        throw new Error(
          'Chromium do Playwright não foi instalado no ambiente. Execute: npx playwright install --with-deps chromium'
        );
      }
      throw error;
    }
  }

  async login() {
    if (!config.casinoUsername || !config.casinoPassword) {
      throw new Error('CASINO_USERNAME e CASINO_PASSWORD são obrigatórios para iniciar o login automático.');
    }

    await this.page.goto(config.casinoLoginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await this.page.fill(config.selectorUsername, config.casinoUsername);
    await this.page.fill(config.selectorPassword, config.casinoPassword);
    await Promise.all([
      this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => null),
      this.page.click(config.selectorSubmit)
    ]);

    console.log('🔐 Login enviado.');
  }

  async openAviator() {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.page.goto(config.casinoAviatorUrl, { waitUntil: 'commit', timeout: 60000 });

        await this.page.waitForURL((url) => url.href.includes('/aviator'), { timeout: 30000 }).catch(() => null);

        if (this.page.url().includes('/aviator')) {
          console.log(`🎰 Página do Aviator aberta (tentativa ${attempt}/${maxAttempts}).`);
          return;
        }
      } catch (error) {
        const isAborted = error.message?.includes('ERR_ABORTED');

        if (!isAborted || attempt === maxAttempts) {
          throw error;
        }

        console.warn(`⚠️ Navegação abortada para Aviator (tentativa ${attempt}/${maxAttempts}). Tentando novamente...`);
      }

      await this.page.waitForTimeout(2000);

      if (this.page.url().includes('/aviator')) {
        console.log(`🎰 Página do Aviator aberta (recuperada na tentativa ${attempt}/${maxAttempts}).`);
        return;
      }

      await this.page.evaluate((aviatorUrl) => {
        window.location.href = aviatorUrl;
      }, config.casinoAviatorUrl).catch(() => null);

      await this.page.waitForURL((url) => url.href.includes('/aviator'), { timeout: 30000 }).catch(() => null);

      if (this.page.url().includes('/aviator')) {
        console.log(`🎰 Página do Aviator aberta após fallback (tentativa ${attempt}/${maxAttempts}).`);
        return;
      }
    }

    throw new Error(`Não foi possível abrir a página do Aviator após ${maxAttempts} tentativas.`);
  }

  async captureCycle() {
    try {
      const velas = await this.extractVelas();
      if (velas.length === 0) return;

      const snapshotHash = velas.join(',');
      if (snapshotHash === this.lastSnapshotHash) return;

      this.lastSnapshotHash = snapshotHash;
      const values = velas.map((item) => Number.parseFloat(item));

      const snapshot = {
        timestamp: new Date().toISOString(),
        velas,
        ultimaVela: velas[0] || null,
        totalVelas: velas.length,
        maiorVela: Math.max(...values),
        menorVela: Math.min(...values),
        media: Number((values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(2)),
        velasAltas: values.filter((value) => value >= 10).length,
        velasBaixas: values.filter((value) => value < 2).length,
        servidor: new URL(config.casinoBaseUrl).hostname
      };

      this.history.unshift(snapshot);
      if (this.history.length > config.maxStoredRecords) {
        this.history.length = config.maxStoredRecords;
      }

      this.totalSnapshots += 1;
      this.lastCaptureAt = snapshot.timestamp;
      this.lastError = null;

      await sendSnapshotToFirebase(snapshot);
      console.log(`📈 #${this.totalSnapshots} Capturado: ${snapshot.ultimaVela} | total=${snapshot.totalVelas}`);
    } catch (error) {
      this.lastError = error.message;
      console.error('❌ Erro no ciclo de captura:', error.message);
    }
  }

  normalizeVelas(velas = []) {
    return Array.from(new Set(velas.map((item) => String(item).trim()).filter((item) => VELA_REGEX.test(item))));
  }

  async extractVelasFromContext(context, allSelectors) {
    for (const selector of allSelectors) {
      try {
        const matches = await context.$$eval(selector, (elements) =>
          elements.map((item) => item.textContent?.trim() || '').filter(Boolean)
        );
        const velas = matches.filter((text) => /^\d+\.\d+x$/i.test(text));
        if (velas.length > 0) return velas;
      } catch {
        // ignora seletor inválido/não suportado no contexto
      }
    }

    try {
      const deepScan = await context.$$eval('div', (elements) =>
        elements
          .map((item) => item.textContent?.trim() || '')
          .filter((text) => /^\d+\.\d+x$/i.test(text))
      );

      return deepScan.filter((item) => VELA_REGEX.test(item));
    } catch {
      return [];
    }
  }

  async extractVelas() {
    const customSelector = config.selectorVelas?.trim();

    const allSelectors = customSelector
      ? [customSelector, ...FALLBACK_SELECTORS.filter((item) => item !== customSelector)]
      : [...FALLBACK_SELECTORS];

    const contexts = [this.page, ...this.page.frames()];

    for (const context of contexts) {
      const velas = this.normalizeVelas(await this.extractVelasFromContext(context, allSelectors));
      if (velas.length > 0) return velas;
    }

    return [];
  }

  getVelas(limit = 50) {
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 50;
    return this.history.slice(0, safeLimit);
  }

  getStatus() {
    return {
      running: this.isRunning,
      startedAt: this.startedAt,
      totalSnapshots: this.totalSnapshots,
      historySize: this.history.length,
      lastCaptureAt: this.lastCaptureAt,
      lastError: this.lastError,
      pollIntervalMs: config.pollIntervalMs,
      maxStoredRecords: config.maxStoredRecords,
      firebaseEnabled: config.firebaseEnabled
    };
  }

  async stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.isRunning = false;

    if (this.context) {
      await this.context.close().catch(() => null);
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close().catch(() => null);
      this.browser = null;
    }

    this.page = null;
    console.log('🛑 AviatorService encerrado.');
  }
}
