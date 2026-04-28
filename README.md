# Aviator-auto-script-

Projeto Node.js (ESM) com **Playwright + Express + Firebase Realtime Database** para:
- abrir navegador automaticamente,
- fazer login no casino,
- entrar no Aviator,
- capturar velas recentes/histórico,
- expor APIs públicas para consumo por outros sites,
- opcionalmente enviar snapshots para Firebase.

> ⚠️ Este projeto **não faz previsão**. Apenas captura resultados recentes no formato `X.XXx`.

## Requisitos
- Node.js >= 20
- npm >= 10
- Chromium do Playwright instalado

---

## 1) Instalação local

```bash
npm install
npx playwright install --with-deps chromium
cp .env.example .env
```

Edite o `.env` com seus dados de login e (opcional) Firebase.

Iniciar:

```bash
npm start
```

Modo dev:

```bash
npm run dev
```

---

## 2) Instalação no Termux (Android)

> Observação: Playwright puro no Android/Termux pode ter limitações de compatibilidade de navegador/headless.
> Em Termux, muitas vezes é necessário usar ambiente Linux via proot-distro (Ubuntu/Debian) para estabilidade.

Passos sugeridos:

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts git
npm install
npx playwright install chromium
cp .env.example .env
npm start
```

Se houver erro de browser no Termux, rode o projeto em:
- servidor Linux (VPS),
- Render,
- Railway.

---

## 3) Variáveis de ambiente (.env)

```env
PORT=3000
NODE_ENV=development

CASINO_BASE_URL=https://megagamelive.com/
CASINO_LOGIN_URL=https://megagamelive.com/login
CASINO_AVIATOR_URL=https://megagamelive.com/aviator
CASINO_USERNAME=
CASINO_PASSWORD=

SELECTOR_USERNAME=#username_l
SELECTOR_PASSWORD=#password_l
SELECTOR_SUBMIT=button.button-submit-login
SELECTOR_VELAS=div.payout[appcoloredmultiplier]

POLL_INTERVAL_MS=5000
MAX_STORED_RECORDS=500

BROWSER_HEADLESS=true
BROWSER_EXECUTABLE_PATH=

CORS_ORIGIN=*

FIREBASE_ENABLED=false
FIREBASE_PATH=historico-velas
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_DATABASE_URL=
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=
FIREBASE_MEASUREMENT_ID=
```

### Sessão persistente (cookies/login)
- `SESSION_ENABLED=true`: habilita reaproveitamento de sessão.
- `SESSION_STATE_PATH=.session/state.json`: caminho do arquivo de sessão (cookies/localStorage) salvo pelo Playwright.
- Quando a sessão estiver válida, o serviço reutiliza login automaticamente e evita novo login a cada restart.
- `INJECTOR_ENABLED=true`: habilita o injector no navegador para tentar capturar velas diretamente no contexto da página (com logs no Render via console do browser).

---

## 4) APIs públicas

### GET `/api/velas?limit=50`
Retorna últimos snapshots capturados em memória.

Exemplo:
```bash
curl "http://localhost:3000/api/velas?limit=10"
```

### GET `/api/status`
Retorna status do serviço de captura.

```bash
curl "http://localhost:3000/api/status"
```

### GET `/api/docs`
Retorna documentação básica das rotas.

```bash
curl "http://localhost:3000/api/docs"
```

### GET `/api/sites/requisicoes`
Rota pública para integração entre sites.

```bash
curl "http://localhost:3000/api/sites/requisicoes"
```

### GET `/debug/logs?limit=200`
Logs internos do bot organizados por etapas:
- `1-CONEXAO`
- `2-LOGIN`
- `3-INJECTOR`
- `4-CAPTURA`

```bash
curl "http://localhost:3000/debug/logs?limit=200"
```

---

## 5) Deploy no Render

Arquivo `render.yaml` já incluído.

Ponto crítico para evitar erro de Chromium ausente:

- Build Command usa cache custom do Playwright:
  - `PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.cache/ms-playwright npm install`
  - `PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.cache/ms-playwright npx playwright install chromium`
- Env var:
  - `PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.cache/ms-playwright`

Após deploy, configure as variáveis `.env` equivalentes no painel do Render.

---

## 6) Deploy no Railway

Arquivo `railway.json` já incluído.

Passos:
1. Criar novo projeto no Railway.
2. Conectar repositório.
3. Definir variáveis de ambiente.
4. Garantir instalação do Chromium no build (NIXPACKS com comando pós-instalação).

Comando de start: `npm start`.

---

## 7) Deploy no Vercel

Arquivo `vercel.json` incluído para facilitar deploy da API.

> Importante: Playwright com browser completo pode não ser ideal no ambiente serverless da Vercel devido a limitações de execução persistente. Para captura contínua, prefira Render/Railway/VPS.

---

## 8) Troubleshooting

### Erro: `browserType.launch: Executable doesn't exist ... chrome-headless-shell`

Para ambiente local Linux (com permissões de sistema):

```bash
npx playwright install --with-deps chromium
```

No **Render**, use no build:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.cache/ms-playwright npm install && PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/.cache/ms-playwright npx playwright install chromium
```

> Motivo: `--with-deps` tenta instalar pacotes de sistema via `su`/root e pode falhar no Render com `Authentication failure`.

Mensagem padronizada no projeto:

**Chromium do Playwright não foi instalado no ambiente. Execute: npx playwright install --with-deps chromium**

### Erro: `page.goto: net::ERR_ABORTED` ao abrir `/aviator`
- A plataforma pode abortar navegação direta por redirecionamento/anti-bot/estado de sessão.
- Nesta versão, o serviço já tenta novamente automaticamente (com fallback de `window.location.href`).
- Se persistir, confirme:
  - credenciais corretas (`CASINO_USERNAME`/`CASINO_PASSWORD`),
  - se o login realmente concluiu,
  - se a sua região/IP consegue abrir `https://megagamelive.com/aviator` manualmente.

### Sem velas capturadas
- Ajuste `SELECTOR_VELAS` no `.env`.
- O serviço tenta fallback automático de seletores e varredura por regex `^\d+\.\d+x$`, incluindo busca dentro de iframes/frames da página.
- Confirme se o login foi efetuado e a rota do Aviator carregou corretamente.

---

## 9) Estrutura

```text
.
├── .env.example
├── .gitignore
├── Procfile
├── package.json
├── railway.json
├── render.yaml
├── vercel.json
└── src
    ├── aviatorService.js
    ├── config.js
    ├── firebase.js
    └── index.js
```
