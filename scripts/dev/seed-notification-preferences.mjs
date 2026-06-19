// scripts/dev/seed-notification-preferences.mjs
// -----------------------------------------------------------------------------
// SEED DEV/EMULATOR - NOTIFICATION PREFERENCES
// -----------------------------------------------------------------------------
// Uso seguro:
// - destinado ao Firebase Emulator do app;
// - exige FIRESTORE_EMULATOR_HOST para evitar escrita acidental em produção;
// - usa set(..., { merge: true }) para NÃO apagar preferências existentes;
// - ativa/desativa tipos de notificação para facilitar testes de produto.
//
// Execução sugerida:
//   npm run seed:notification-preferences:emu
//
// Variáveis opcionais:
// - SEED_NOTIFY_COMPATIBLE_STATUS=true|false
// - SEED_NOTIFY_CONNECTIONS=true|false
// - SEED_NOTIFY_MESSAGES=true|false
// - SEED_NOTIFY_ROOMS=true|false
// - SEED_NOTIFY_PLACES=true|false
// - SEED_NOTIFY_LIMIT=12
// - SEED_NOTIFY_UF=RJ
// - SEED_NOTIFY_CITY=rio de janeiro
// - SEED_NOTIFY_EXCLUDE_UID=<uid atual>
// -----------------------------------------------------------------------------

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorHost) {
  console.error(
    '[seed:notification-preferences] Abortado: FIRESTORE_EMULATOR_HOST ausente. ' +
      'Este script só deve escrever no emulador.'
  );
  process.exit(1);
}

initializeApp({
  projectId,
  credential: applicationDefault(),
});

const db = getFirestore();
const limit = normalizeLimit(process.env.SEED_NOTIFY_LIMIT, 20);
const targetUf = normalizeUf(process.env.SEED_NOTIFY_UF || 'RJ');
const targetCity = normalizeCity(process.env.SEED_NOTIFY_CITY || 'rio de janeiro');
const excludeUid = normalizeText(process.env.SEED_NOTIFY_EXCLUDE_UID);

const preferencesPatch = {
  messages: parseBool(process.env.SEED_NOTIFY_MESSAGES, true),
  connections: parseBool(process.env.SEED_NOTIFY_CONNECTIONS, true),
  rooms: parseBool(process.env.SEED_NOTIFY_ROOMS, true),
  places: parseBool(process.env.SEED_NOTIFY_PLACES, true),
  compatibleStatus: parseBool(process.env.SEED_NOTIFY_COMPATIBLE_STATUS, true),
  accountSecurity: true,
};

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeUf(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeCity(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeLimit(rawValue, fallback) {
  const parsed = Number(rawValue ?? fallback);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), 100);
}

function parseBool(value, fallback) {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return fallback;
  }

  return ['1', 'true', 'sim', 'yes', 'on'].includes(normalized);
}

function isEligibleUser(uid, user) {
  return uid !== excludeUid &&
    user?.profileCompleted === true &&
    normalizeUf(user?.estado) === targetUf &&
    normalizeCity(user?.municipio) === targetCity;
}

const usersSnapshot = await db.collection('users').limit(200).get();
const users = usersSnapshot.docs
  .map((doc) => ({ uid: doc.id, data: doc.data() }))
  .filter(({ uid, data }) => isEligibleUser(uid, data))
  .slice(0, limit);

console.log(
  `[seed:notification-preferences] Projeto=${projectId} | Emulador=${emulatorHost} | Região=${targetUf}/${targetCity} | Itens=${users.length}`
);

if (!users.length) {
  console.warn('[seed:notification-preferences] Nenhum usuário elegível encontrado. Nada foi gravado.');
  process.exit(0);
}

for (const user of users) {
  await db.collection('preferences').doc(user.uid).set({
    notificationPreferences: preferencesPatch,
    updatedAt: FieldValue.serverTimestamp(),
    audit: {
      source: 'seed-notification-preferences',
      updatedAt: FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  console.log(`[seed:notification-preferences] upsert preferences/${user.uid}`);
}

console.log('[seed:notification-preferences] Concluído sem limpar dados existentes.');
