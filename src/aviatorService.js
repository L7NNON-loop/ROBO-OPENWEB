import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
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
  constructor(options = {}) {
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
    this.injectorReady = false;
    this.logHandler = options.logHandler || null;
    this.snapshotHandler = options.snapshotHandler || null;
    this.sessionId = null;
  }

  emitLog(level, stage, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      stage,
      sessionId: this.sessionId,
      message,
      meta
    };

    if (this.logHandler) {
      this.logHandler(entry);
      return;
    }

    const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    printer(`[${stage}] ${message}`);
  }

  async start() {
    if (this.isRunning) return;

    try {
      this.sessionId = `sess-${Date.now()}`;
      this.emitLog('info', '1-CONEXAO', 'Iniciando nova sessão do serviço.', {
        casinoBaseUrl: config.casinoBaseUrl,
        pollIntervalMs: config.pollIntervalMs
      });
      await this.launchBrowser();

      const sessionReused = await this.tryReuseSession();
      if (!sessionReused) {
        this.emitLog('info', '2-LOGIN', 'Sessão não reaproveitada. Iniciando login automático.');
        await this.login();
        await this.persistSession();
      } else {
        this.emitLog('info', '2-LOGIN', 'Sessão reaproveitada com sucesso.');
      }

      await this.openAviator();
      await this.setupInjector();
      this.emitLog('info', '3-INJECTOR', 'Etapa de injeção finalizada.', { injectorReady: this.injectorReady });

      this.startedAt = new Date().toISOString();
      this.pollTimer = setInterval(() => {
        void this.captureCycle();
      }, config.pollIntervalMs);

      await this.captureCycle();
      this.isRunning = true;
      this.emitLog('info', '1-CONEXAO', 'Serviço iniciado e ciclo de captura ativo.');
      console.log(`✅ Captura iniciada. Intervalo: ${config.pollIntervalMs}ms`);
    } catch (error) {
      this.lastError = error.message;
      this.emitLog('error', '1-CONEXAO', 'Falha ao iniciar serviço.', { error: error.message });
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
      const contextOptions = {};

      if (config.sessionEnabled && config.sessionStatePath && existsSync(config.sessionStatePath)) {
        contextOptions.storageState = config.sessionStatePath;
        console.log(`🍪 Sessão carregada de ${config.sessionStatePath}`);
      }

      this.context = await this.browser.newContext(contextOptions);
      this.page = await this.context.newPage();
      this.page.on('console', (msg) => {
        console.log(`🧩 [BrowserConsole:${msg.type()}] ${msg.text()}`);
        this.emitLog('info', '3-INJECTOR', `BrowserConsole(${msg.type()}): ${msg.text()}`);
      });
      this.page.on('pageerror', (error) => {
        console.error(`🧩 [BrowserPageError] ${error.message}`);
        this.emitLog('error', '3-INJECTOR', 'Erro de página no browser.', { error: error.message });
      });
      this.page.on('requestfailed', (request) => {
        console.warn(`🧩 [RequestFailed] ${request.failure()?.errorText || 'unknown'} :: ${request.url()}`);
        this.emitLog('warn', '1-CONEXAO', 'Request failed durante execução do browser.', {
          error: request.failure()?.errorText || 'unknown',
          url: request.url()
        });
      });
      console.log('🌐 Navegador/contexto/página iniciados com sucesso.');
      this.emitLog('info', '1-CONEXAO', 'Navegador/contexto/página iniciados com sucesso.');
    } catch (error) {
      if (error.message?.includes("Executable doesn't exist") || error.message?.includes('Failed to launch')) {
        throw new Error(
          'Chromium do Playwright não foi instalado no ambiente. Execute: npx playwright install --with-deps chromium'
        );
      }
      throw error;
    }
  }

  async tryReuseSession() {
    if (!config.sessionEnabled) return false;

    if (!config.sessionStatePath || !existsSync(config.sessionStatePath)) {
      return false;
    }

    try {
      await this.page.goto(config.casinoAviatorUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      if (this.page.url().includes('/aviator')) {
        console.log('🍪 Sessão reaproveitada com sucesso (sem novo login).');
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  async persistSession() {
    if (!config.sessionEnabled || !config.sessionStatePath) return;

    const sessionDir = path.dirname(config.sessionStatePath);
    await fs.mkdir(sessionDir, { recursive: true });
    await this.context.storageState({ path: config.sessionStatePath });
    console.log(`💾 Sessão salva em ${config.sessionStatePath}`);
  }

  async login() {
    if (!config.casinoUsername || !config.casinoPassword) {
      throw new Error('CASINO_USERNAME e CASINO_PASSWORD são obrigatórios para iniciar o login automático.');
    }

    console.log(`🔐 Acessando tela de login: ${config.casinoLoginUrl}`);
    await this.page.goto(config.casinoLoginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await this.page.fill(config.selectorUsername, config.casinoUsername);
    await this.page.fill(config.selectorPassword, config.casinoPassword);
    await Promise.all([
      this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => null),
      this.page.click(config.selectorSubmit)
    ]);

    if (this.page.url().includes('/login')) {
      console.warn('⚠️ Após submit, ainda estamos na rota /login. Verifique credenciais, captcha ou bloqueio.');
      this.emitLog('warn', '2-LOGIN', 'Submit realizado, porém ainda na rota /login.', { url: this.page.url() });
    } else {
      console.log(`✅ Login enviado com sucesso. URL atual: ${this.page.url()}`);
      this.emitLog('info', '2-LOGIN', 'Login concluído.', { url: this.page.url() });
    }
  }

  async openAviator() {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.page.goto(config.casinoAviatorUrl, { waitUntil: 'commit', timeout: 60000 });

        await this.page.waitForURL((url) => url.href.includes('/aviator'), { timeout: 30000 }).catch(() => null);

        if (this.page.url().includes('/aviator')) {
          console.log(`🎰 Página do Aviator aberta (tentativa ${attempt}/${maxAttempts}).`);
          this.emitLog('info', '2-LOGIN', 'Navegação para Aviator concluída.', { attempt, maxAttempts });
          return;
        }
      } catch (error) {
        const isAborted = error.message?.includes('ERR_ABORTED');

        if (!isAborted || attempt === maxAttempts) {
          throw error;
        }

        console.warn(`⚠️ Navegação abortada para Aviator (tentativa ${attempt}/${maxAttempts}). Tentando novamente...`);
        this.emitLog('warn', '2-LOGIN', 'Navegação abortada ao abrir Aviator.', { attempt, maxAttempts });
      }

      await this.page.waitForTimeout(2000);

      if (this.page.url().includes('/aviator')) {
        console.log(`🎰 Página do Aviator aberta (recuperada na tentativa ${attempt}/${maxAttempts}).`);
        this.emitLog('info', '2-LOGIN', 'Aviator aberto após recuperação.', { attempt, maxAttempts });
        return;
      }

      await this.page.evaluate((aviatorUrl) => {
        window.location.href = aviatorUrl;
      }, config.casinoAviatorUrl).catch(() => null);

      await this.page.waitForURL((url) => url.href.includes('/aviator'), { timeout: 30000 }).catch(() => null);

      if (this.page.url().includes('/aviator')) {
        console.log(`🎰 Página do Aviator aberta após fallback (tentativa ${attempt}/${maxAttempts}).`);
        this.emitLog('info', '2-LOGIN', 'Aviator aberto após fallback de window.location.', { attempt, maxAttempts });
        return;
      }
    }

    throw new Error(`Não foi possível abrir a página do Aviator após ${maxAttempts} tentativas.`);
  }

  async setupInjector() {
    if (!config.injectorEnabled) {
      console.log('ℹ️ Injector desativado por configuração (INJECTOR_ENABLED=false).');
      this.injectorReady = false;
      return;
    }

    try {
      const injected = await this.page.evaluate(() => {
        const velaRegex = /^\d+\.\d+x$/i;
        const fallbackSelectors = [
          'div.payout[appcoloredmultiplier]',
          'div[class*="payout"]',
          'div[style*="rgb(52, 180, 255)"], div[style*="rgb(145, 62, 248)"], div[style*="rgb(192, 23, 180)"]',
          'div[class*="payouts-block"] div[style*="color"]',
          '[class*="stats"] div[style*="rgb"]'
        ];

        if (window.__aviatorInjector?.timer) {
          clearInterval(window.__aviatorInjector.timer);
        }

        window.__aviatorInjector = {
          selectorVelas: window.SELETOR_VELAS || 'div.payout[appcoloredmultiplier]',
          lastVelas: [],
          lastUpdatedAt: null,
          server: window.location.hostname,
          getSnapshot() {
            return {
              server: this.server,
              velas: this.lastVelas,
              lastUpdatedAt: this.lastUpdatedAt
            };
          }
        };

        const extract = () => {
          const allSelectors = [
            window.__aviatorInjector.selectorVelas,
            ...fallbackSelectors.filter((item) => item !== window.__aviatorInjector.selectorVelas)
          ];

          let velas = [];
          for (const selector of allSelectors) {
            try {
              const elements = Array.from(document.querySelectorAll(selector));
              const texts = elements
                .map((item) => (item.textContent || '').trim())
                .filter((text) => velaRegex.test(text));
              if (texts.length > 0) {
                velas = texts;
                break;
              }
            } catch {
              // ignora selector inválido
            }
          }

          if (velas.length === 0) {
            velas = Array.from(document.querySelectorAll('div'))
              .map((item) => (item.textContent || '').trim())
              .filter((text) => velaRegex.test(text));
          }

          window.__aviatorInjector.lastVelas = Array.from(new Set(velas));
          window.__aviatorInjector.lastUpdatedAt = new Date().toISOString();
        };

        extract();
        window.__aviatorInjector.timer = setInterval(extract, 3000);
        return true;
      });

      this.injectorReady = Boolean(injected);
      console.log(`🧩 Injector ${this.injectorReady ? 'ativado' : 'não ativado'} na página do Aviator.`);
      this.emitLog('info', '3-INJECTOR', 'Injector executado na página do Aviator.', {
        injectorReady: this.injectorReady
      });
    } catch (error) {
      this.injectorReady = false;
      console.warn(`⚠️ Falha ao ativar injector: ${error.message}`);
      this.emitLog('error', '3-INJECTOR', 'Falha ao ativar injector.', { error: error.message });
    }
  }

  async readInjectorVelas() {
    if (!this.injectorReady) return [];

    try {
      const snapshot = await this.page.evaluate(() => {
        if (!window.__aviatorInjector?.getSnapshot) return null;
        return window.__aviatorInjector.getSnapshot();
      });

      if (!snapshot) return [];
      if (snapshot.velas?.length > 0) {
        console.log(`🧩 Injector snapshot recebido | servidor=${snapshot.server} | velas=${snapshot.velas.length}`);
        this.emitLog('info', '4-CAPTURA', 'Snapshot recebido do injector.', {
          server: snapshot.server,
          count: snapshot.velas.length
        });
      }
      return this.normalizeVelas(snapshot.velas || []);
    } catch (error) {
      console.warn(`⚠️ Não foi possível ler snapshot do injector: ${error.message}`);
      return [];
    }
  }

  async captureCycle() {
    try {
      const injectedVelas = await this.readInjectorVelas();
      const velas = injectedVelas.length > 0 ? injectedVelas : await this.extractVelas();
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
      if (this.snapshotHandler) {
        this.snapshotHandler({
          sessionId: this.sessionId,
          snapshot
        });
      }
      this.emitLog('info', '4-CAPTURA', 'Snapshot capturado e armazenado.', {
        totalSnapshots: this.totalSnapshots,
        ultimaVela: snapshot.ultimaVela,
        totalVelas: snapshot.totalVelas
      });
      console.log(`📈 #${this.totalSnapshots} Capturado: ${snapshot.ultimaVela} | total=${snapshot.totalVelas}`);
    } catch (error) {
      this.lastError = error.message;
      this.emitLog('error', '4-CAPTURA', 'Erro no ciclo de captura.', { error: error.message });
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
    this.emitLog('info', '1-CONEXAO', 'Serviço parado e recursos do browser liberados.');
    console.log('🛑 AviatorService encerrado.');
  }
}
