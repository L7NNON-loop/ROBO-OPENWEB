import dotenv from 'dotenv';

dotenv.config();

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: parseNumber(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  casinoBaseUrl: process.env.CASINO_BASE_URL || 'https://megagamelive.com/',
  casinoLoginUrl: process.env.CASINO_LOGIN_URL || 'https://megagamelive.com/login',
  casinoAviatorUrl: process.env.CASINO_AVIATOR_URL || 'https://megagamelive.com/aviator',
  casinoUsername: process.env.CASINO_USERNAME || '',
  casinoPassword: process.env.CASINO_PASSWORD || '',

  selectorUsername: process.env.SELECTOR_USERNAME || '#username_l',
  selectorPassword: process.env.SELECTOR_PASSWORD || '#password_l',
  selectorSubmit: process.env.SELECTOR_SUBMIT || 'button.button-submit-login',
  selectorVelas: process.env.SELECTOR_VELAS || 'div.payout[appcoloredmultiplier]',

  pollIntervalMs: parseNumber(process.env.POLL_INTERVAL_MS, 5000),
  maxStoredRecords: parseNumber(process.env.MAX_STORED_RECORDS, 500),

  browserHeadless: parseBool(process.env.BROWSER_HEADLESS, true),
  browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
  sessionEnabled: parseBool(process.env.SESSION_ENABLED, true),
  sessionStatePath: process.env.SESSION_STATE_PATH || '.session/state.json',

  corsOrigin: process.env.CORS_ORIGIN || '*',

  firebaseEnabled: parseBool(process.env.FIREBASE_ENABLED, false),
  firebasePath: process.env.FIREBASE_PATH || 'historico-velas',
  firebase: {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
  }
};
