import { initializeApp } from 'firebase/app';
import { getDatabase, push, ref, set } from 'firebase/database';
import { config } from './config.js';

let db = null;

export const initFirebase = () => {
  if (!config.firebaseEnabled) {
    console.log('ℹ️ Firebase desativado (FIREBASE_ENABLED=false).');
    return null;
  }

  const requiredKeys = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
  const missing = requiredKeys.filter((key) => !config.firebase[key]);

  if (missing.length > 0) {
    console.warn(`⚠️ Firebase habilitado, porém faltam variáveis: ${missing.join(', ')}`);
    return null;
  }

  const app = initializeApp(config.firebase);
  db = getDatabase(app);
  console.log('🔥 Firebase conectado com sucesso.');
  return db;
};

export const sendSnapshotToFirebase = async (snapshot) => {
  if (!db) return;

  const listRef = ref(db, config.firebasePath);
  const itemRef = push(listRef);
  await set(itemRef, snapshot);
};
