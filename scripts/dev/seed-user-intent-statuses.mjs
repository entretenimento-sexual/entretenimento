// scripts/dev/seed-user-intent-statuses.mjs
// -----------------------------------------------------------------------------
// SEED DEV/EMULATOR - USER INTENT STATUSES
// -----------------------------------------------------------------------------
// Uso seguro:
// - destinado ao Firebase Emulator do app;
// - exige FIRESTORE_EMULATOR_HOST para evitar escrita acidental em produção;
// - usa set(..., { merge: true }) para NÃO apagar dados manuais já criados;
// - cria status temporários fictícios para testar Radar de Hoje e CTAs;
// - lê somente /users do emulador e grava projeção pública mínima no status;
// - não grava coordenadas precisas nem dados privados.
//
// Execução sugerida:
//   npm run seed:intents:emu
//
// Variáveis opcionais:
// - SEED_INTENTS_EXCLUDE_UID=<uid atual> para não alterar o status do usuário logado;
// - SEED_INTENTS_LIMIT=3 para controlar quantos status criar.
//
// Pré-requisito:
//   emulador Firestore rodando com o mesmo projectId usado pelo app.
// -----------------------------------------------------------------------------

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const excludeUid = String(process.env.SEED_INTENTS_EXCLUDE_UID ?? '').trim();
const limit = normalizeLimit(process.env.SEED_INTENTS_LIMIT, 3);

if (!emulatorHost) {
  console.error(
    '[seed:intents] Abortado: FIRESTORE_EMULATOR_HOST ausente. ' +
      'Este script só deve escrever no emulador.'
  );
  process.exit(1);
}

initializeApp({
  projectId,
  credential: applicationDefault(),
});

const db = getFirestore();
const now = Date.now();
const expiresAt = now + 1000 * 60 * 60 * 12;

const destinationTemplates = [
  {
    availability: 'available_now',
    destination: {
      kind: 'venue',
      label: 'Bar Luz do Centro',
      venueId: 'rj-centro-bar-luz',
      region: { uf: 'RJ', city: 'rio de janeiro' },
    },
  },
  {
    availability: 'available_today',
    destination: {
      kind: 'venue',
      label: 'Club Noite Zona Sul',
      venueId: 'rj-zona-sul-club-noite',
      region: { uf: 'RJ', city: 'rio de janeiro' },
    },
  },
  {
    availability: 'planning_later',
    destination: {
      kind: 'region',
      label: 'rio de janeiro',
      venueId: null,
      region: { uf: 'RJ', city: 'rio de janeiro' },
    },
  },
];

function normalizeLimit(rawValue, fallback) {
  const parsed = Number(rawValue ?? fallback);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), 12);
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeCity(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeUf(value) {
  return normalizeText(value).toUpperCase();
}

function toPublicProfile(uid, user) {
  return {
    uid,
    nickname: normalizeText(user.nickname) || 'perfil-dev',
    photoURL: normalizeText(user.photoURL) || null,
    age: typeof user.idade === 'number' ? user.idade : null,
  };
}

function resolveUserRegion(user) {
  return {
    uf: normalizeUf(user.estado) || 'RJ',
    city: normalizeCity(user.municipio) || 'rio de janeiro',
  };
}

function buildStatus(uid, user, index) {
  const template = destinationTemplates[index % destinationTemplates.length];
  const region = resolveUserRegion(user);

  const destination = {
    ...template.destination,
    region,
  };

  if (destination.kind === 'region') {
    destination.label = region.city;
    destination.venueId = null;
  }

  return {
    uid,
    profile: toPublicProfile(uid, user),
    availability: template.availability,
    visibility: 'public_discovery',
    destination,
    moderation: {
      state: 'active',
      reviewedAt: now,
      reviewedBy: 'dev-seed',
      reason: 'seed-dev-emulator',
    },
    startsAt: now,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    audit: {
      source: 'seed-user-intent-statuses',
      updatedBy: 'dev-seed',
      updatedAt: now,
    },
  };
}

const snapshot = await db.collection('users').limit(50).get();
const users = snapshot.docs
  .map((doc) => ({ uid: doc.id, data: doc.data() }))
  .filter(({ uid, data }) => uid !== excludeUid && data?.profileCompleted === true)
  .filter(({ data }) => normalizeUf(data?.estado) === 'RJ')
  .filter(({ data }) => normalizeCity(data?.municipio) === 'rio de janeiro')
  .slice(0, limit);

console.log(
  `[seed:intents] Projeto=${projectId} | Emulador=${emulatorHost} | Itens=${users.length}`
);

if (!users.length) {
  console.warn(
    '[seed:intents] Nenhum usuário elegível encontrado em /users para RJ/rio de janeiro. ' +
      'Nada foi gravado.'
  );
  process.exit(0);
}

for (const [index, user] of users.entries()) {
  const statusId = `current_${user.uid}`;
  const status = buildStatus(user.uid, user.data, index);

  await db.collection('user_intent_statuses').doc(statusId).set(status, { merge: true });

  await db.collection('user_intent_status_audit').add({
    uid: user.uid,
    statusId,
    event: 'seed-upsert',
    source: 'seed-user-intent-statuses',
    createdAt: now,
  });

  console.log(`[seed:intents] upsert user_intent_statuses/${statusId}`);
}

console.log('[seed:intents] Concluído sem limpar dados existentes.');
