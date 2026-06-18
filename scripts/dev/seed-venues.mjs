// scripts/dev/seed-venues.mjs
// -----------------------------------------------------------------------------
// SEED DEV/EMULATOR - VENUES
// -----------------------------------------------------------------------------
// Uso seguro:
// - destinado ao Firebase Emulator do app;
// - exige FIRESTORE_EMULATOR_HOST para evitar escrita acidental em produção;
// - usa set(..., { merge: true }) para NÃO apagar dados manuais já criados;
// - popula estabelecimentos fictícios e moderados em venues;
// - não grava coordenadas precisas nem dados privados.
//
// Execução sugerida:
//   npm run seed:venues:emu
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
    '[seed:venues] Abortado: FIRESTORE_EMULATOR_HOST ausente. ' +
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

const venues = [
  {
    id: 'rj-centro-bar-luz',
    name: 'Bar Luz do Centro',
    slug: 'bar-luz-do-centro',
    kind: 'bar',
    description: 'Ponto fictício de teste para status de intenção no Centro.',
    region: { uf: 'RJ', city: 'rio de janeiro', district: 'Centro' },
    addressHint: 'Região central',
    visibility: 'public',
    moderation: {
      state: 'active',
      reviewedAt: now,
      reviewedBy: 'dev-seed',
      reason: 'seed-dev-emulator',
    },
    sponsorship: {
      state: 'eligible',
      priority: 40,
      startsAt: null,
      endsAt: null,
    },
    chat: {
      enabled: true,
      mode: 'hybrid',
      roomId: null,
    },
    ownerUid: null,
    adminUids: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'rj-zona-sul-club-noite',
    name: 'Club Noite Zona Sul',
    slug: 'club-noite-zona-sul',
    kind: 'club',
    description: 'Boate fictícia para testar local patrocinável e sala híbrida.',
    region: { uf: 'RJ', city: 'rio de janeiro', district: 'Zona Sul' },
    addressHint: 'Zona Sul',
    visibility: 'public',
    moderation: {
      state: 'active',
      reviewedAt: now,
      reviewedBy: 'dev-seed',
      reason: 'seed-dev-emulator',
    },
    sponsorship: {
      state: 'sponsored',
      priority: 95,
      startsAt: now,
      endsAt: now + 1000 * 60 * 60 * 12,
    },
    chat: {
      enabled: true,
      mode: 'public_preview',
      roomId: null,
    },
    ownerUid: null,
    adminUids: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'rj-barra-restaurante-ponto',
    name: 'Restaurante Ponto Barra',
    slug: 'restaurante-ponto-barra',
    kind: 'restaurant',
    description: 'Restaurante fictício para testar variedade de estabelecimentos.',
    region: { uf: 'RJ', city: 'rio de janeiro', district: 'Barra' },
    addressHint: 'Barra da Tijuca',
    visibility: 'public',
    moderation: {
      state: 'active',
      reviewedAt: now,
      reviewedBy: 'dev-seed',
      reason: 'seed-dev-emulator',
    },
    sponsorship: {
      state: 'none',
      priority: 10,
      startsAt: null,
      endsAt: null,
    },
    chat: {
      enabled: false,
      mode: 'hybrid',
      roomId: null,
    },
    ownerUid: null,
    adminUids: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'sp-centro-pub-paulista',
    name: 'Pub Paulista Centro',
    slug: 'pub-paulista-centro',
    kind: 'pub',
    description: 'Choperia fictícia para testar filtro fora do Rio.',
    region: { uf: 'SP', city: 'são paulo', district: 'Centro' },
    addressHint: 'Centro',
    visibility: 'public',
    moderation: {
      state: 'active',
      reviewedAt: now,
      reviewedBy: 'dev-seed',
      reason: 'seed-dev-emulator',
    },
    sponsorship: {
      state: 'eligible',
      priority: 50,
      startsAt: null,
      endsAt: null,
    },
    chat: {
      enabled: true,
      mode: 'frequenters_only',
      roomId: null,
    },
    ownerUid: null,
    adminUids: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'rj-hidden-venue-sample',
    name: 'Local Oculto de Teste',
    slug: 'local-oculto-de-teste',
    kind: 'other',
    description: 'Este item não deve aparecer para o app comum.',
    region: { uf: 'RJ', city: 'rio de janeiro', district: 'Teste' },
    addressHint: 'Oculto',
    visibility: 'hidden',
    moderation: {
      state: 'hidden',
      reviewedAt: now,
      reviewedBy: 'dev-seed',
      reason: 'deve ficar fora da leitura comum',
    },
    sponsorship: {
      state: 'none',
      priority: 999,
      startsAt: null,
      endsAt: null,
    },
    chat: {
      enabled: false,
      mode: 'hybrid',
      roomId: null,
    },
    ownerUid: null,
    adminUids: [],
    createdAt: now,
    updatedAt: now,
  },
];

console.log(
  `[seed:venues] Projeto=${projectId} | Emulador=${emulatorHost} | Itens=${venues.length}`
);

for (const venue of venues) {
  const { id, ...data } = venue;
  await db.collection('venues').doc(id).set(data, { merge: true });
  console.log(`[seed:venues] upsert venues/${id}`);
}

console.log('[seed:venues] Concluído sem limpar dados existentes.');
