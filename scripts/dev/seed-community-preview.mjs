// scripts/dev/seed-community-preview.mjs
// -----------------------------------------------------------------------------
// SEED DEV/EMULATOR - COMMUNITY PREVIEW
// -----------------------------------------------------------------------------
// - exige FIRESTORE_EMULATOR_HOST;
// - cria somente dados fictícios e públicos;
// - não grava coordenadas, mídia ou informações pessoais;
// - usa merge para preservar ajustes manuais do emulador.
// -----------------------------------------------------------------------------

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorHost) {
  console.error(
    '[seed:communities] Abortado: FIRESTORE_EMULATOR_HOST ausente.'
  );
  process.exit(1);
}

initializeApp({ projectId, credential: applicationDefault() });

const db = getFirestore();
const now = Date.now();

const communities = [
  {
    id: 'community-rj-centro',
    name: 'Centro à noite',
    slug: 'centro-a-noite',
    description: 'Novidades e encontros em locais moderados da região central.',
    source: { type: 'venue', id: 'rj-centro-bar-luz' },
    status: 'active',
    visibility: 'public_preview',
    access: {
      preview: 'authenticated',
      interaction: 'members_only',
      join: 'approval',
    },
    moderation: { state: 'active', reviewedAt: now, reviewedBy: 'dev-seed' },
    metrics: { memberCount: 28, postCount: 7, mediaCount: 12 },
    rankScore: 96,
  },
  {
    id: 'community-zona-sul',
    name: 'Zona Sul agora',
    slug: 'zona-sul-agora',
    description: 'Movimento, fotos e atualizações de uma comunidade local.',
    source: { type: 'venue', id: 'rj-zona-sul-club-noite' },
    status: 'active',
    visibility: 'public_preview',
    access: {
      preview: 'authenticated',
      interaction: 'members_only',
      join: 'open',
      contentAccess: {
        minimumRole: 'premium',
        requiresActiveSubscription: true,
      },
    },
    moderation: { state: 'active', reviewedAt: now, reviewedBy: 'dev-seed' },
    metrics: { memberCount: 64, postCount: 18, mediaCount: 31 },
    rankScore: 88,
  },
  {
    id: 'community-sala-conexoes',
    name: 'Conexões discretas',
    slug: 'conexoes-discretas',
    description: 'Sala comunitária fictícia para validar a experiência somente leitura.',
    source: { type: 'room', id: 'room-community-preview' },
    status: 'active',
    visibility: 'public_preview',
    access: {
      preview: 'authenticated',
      interaction: 'members_only',
      join: 'invite_only',
    },
    moderation: { state: 'active', reviewedAt: now, reviewedBy: 'dev-seed' },
    metrics: { memberCount: 14, postCount: 5, mediaCount: 8 },
    rankScore: 72,
  },
];

console.log(
  `[seed:communities] Projeto=${projectId} | Emulador=${emulatorHost} | Itens=${communities.length}`
);

for (const community of communities) {
  const { id, rankScore, ...data } = community;

  await db.collection('communities').doc(id).set(
    {
      ...data,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await db.collection('community_discovery_index').doc(id).set(
    {
      communityId: id,
      name: data.name,
      slug: data.slug,
      description: data.description,
      source: data.source,
      status: data.status,
      moderationState: data.moderation.state,
      visibility: data.visibility,
      metrics: data.metrics,
      access: data.access,
      avatarUrl: null,
      coverUrl: null,
      rankScore,
      updatedAt: now,
    },
    { merge: true }
  );

  console.log(`[seed:communities] upsert communities/${id}`);
}

console.log('[seed:communities] Concluído sem limpar dados existentes.');
