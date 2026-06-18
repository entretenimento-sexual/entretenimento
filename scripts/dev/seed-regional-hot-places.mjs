// scripts/dev/seed-regional-hot-places.mjs
// -----------------------------------------------------------------------------
// SEED DEV/EMULATOR - REGIONAL HOT PLACES
// -----------------------------------------------------------------------------
// Uso seguro:
// - destinado ao Firebase Emulator do app;
// - exige FIRESTORE_EMULATOR_HOST para evitar escrita acidental em produção;
// - usa set(..., { merge: true }) para NÃO apagar dados manuais já criados;
// - popula apenas documentos fictícios e moderados em regional_hot_places;
// - não grava UIDs, participantes ou coordenadas precisas.
//
// Execução sugerida:
//   npm run seed:hot-places:emu
//
// Pré-requisito:
//   emulador Firestore rodando com o mesmo projectId usado pelo app.
// -----------------------------------------------------------------------------

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorHost) {
  console.error(
    '[seed:hot-places] Abortado: FIRESTORE_EMULATOR_HOST ausente. ' +
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

const seedItems = [
  {
    id: 'rj-centro-pulso-online',
    title: 'Centro em movimento',
    subtitle: 'Sinais agregados de perfis ativos e conversas recentes na região.',
    kind: 'online_pulse',
    audience: 'all',
    region: { uf: 'RJ', city: 'rio de janeiro' },
    metrics: {
      score: 92,
      activeNowCount: 18,
      roomCount: 4,
      compatibleProfileCount: 32,
      lastActivityAt: now,
    },
    moderation: {
      visibility: 'visible',
      reviewedAt: now,
      reviewedBy: 'dev-seed',
      reason: 'seed-dev-emulator',
    },
    compatibilitySignals: ['same_city', 'available_now', 'intent_overlap'],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'rj-zona-sul-room-cluster',
    title: 'Zona Sul com salas ativas',
    subtitle: 'Cluster regional de salas com atividade recente e moderação ativa.',
    kind: 'room_cluster',
    audience: 'verified',
    region: { uf: 'RJ', city: 'rio de janeiro' },
    metrics: {
      score: 84,
      activeNowCount: 11,
      roomCount: 3,
      compatibleProfileCount: 21,
      lastActivityAt: now - 1000 * 60 * 8,
    },
    moderation: {
      visibility: 'visible',
      reviewedAt: now,
      reviewedBy: 'dev-seed',
      reason: 'seed-dev-emulator',
    },
    compatibilitySignals: ['same_city', 'verified_only', 'available_now'],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'sp-centro-discovery',
    title: 'Centro paulista em alta',
    subtitle: 'Atividade regional agregada para testar filtros fora do Rio.',
    kind: 'city_area',
    audience: 'all',
    region: { uf: 'SP', city: 'são paulo' },
    metrics: {
      score: 76,
      activeNowCount: 9,
      roomCount: 2,
      compatibleProfileCount: 18,
      lastActivityAt: now - 1000 * 60 * 20,
    },
    moderation: {
      visibility: 'visible',
      reviewedAt: now,
      reviewedBy: 'dev-seed',
      reason: 'seed-dev-emulator',
    },
    compatibilitySignals: ['same_city', 'practice_overlap'],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'rj-hidden-moderation-sample',
    title: 'Local oculto de teste',
    subtitle: 'Este item não deve aparecer no widget porque está hidden.',
    kind: 'venue',
    audience: 'all',
    region: { uf: 'RJ', city: 'rio de janeiro' },
    metrics: {
      score: 99,
      activeNowCount: 99,
      roomCount: 9,
      compatibleProfileCount: 99,
      lastActivityAt: now,
    },
    moderation: {
      visibility: 'hidden',
      reviewedAt: now,
      reviewedBy: 'dev-seed',
      reason: 'deve ficar fora da leitura do app',
    },
    compatibilitySignals: ['same_city'],
    createdAt: now,
    updatedAt: now,
  },
];

console.log(
  `[seed:hot-places] Projeto=${projectId} | Emulador=${emulatorHost} | Itens=${seedItems.length}`
);

for (const item of seedItems) {
  const { id, ...data } = item;
  await db.collection('regional_hot_places').doc(id).set(data, { merge: true });
  console.log(`[seed:hot-places] upsert regional_hot_places/${id}`);
}

console.log('[seed:hot-places] Concluído sem limpar dados existentes.');
