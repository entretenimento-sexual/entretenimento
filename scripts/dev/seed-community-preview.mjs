// scripts/dev/seed-community-preview.mjs
// -----------------------------------------------------------------------------
// SEED DEV/EMULATOR - COMMUNITY PREVIEW
// -----------------------------------------------------------------------------
// - exige FIRESTORE_EMULATOR_HOST;
// - cria somente comunidades e publicações fictícias;
// - não grava coordenadas ou informações pessoais;
// - imagens usam domínio reservado .invalid e acionam o fallback local;
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
    metrics: { memberCount: 28, postCount: 3, mediaCount: 2 },
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
    metrics: { memberCount: 64, postCount: 3, mediaCount: 2 },
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
    metrics: { memberCount: 14, postCount: 3, mediaCount: 1 },
    rankScore: 72,
  },
];

const communityPosts = {
  'community-rj-centro': [
    {
      id: 'centro-photo-1',
      kind: 'photo',
      audience: 'public_preview',
      author: { label: 'Equipe do local', avatarUrl: null },
      text: 'Ambiente preparado para a noite.',
      image: {
        url: 'https://community-preview.invalid/centro-noite-1.webp',
        alt: 'Área social do local preparada para a noite',
      },
      metrics: { commentCount: 4, reactionCount: 19 },
      offsetMs: 22 * 60_000,
    },
    {
      id: 'centro-text-1',
      kind: 'text',
      audience: 'public_preview',
      author: { label: 'Moderação', avatarUrl: null },
      text: 'Movimento tranquilo e entrada organizada.',
      image: null,
      metrics: { commentCount: 2, reactionCount: 8 },
      offsetMs: 65 * 60_000,
    },
    {
      id: 'centro-photo-members',
      kind: 'photo',
      audience: 'members_only',
      author: { label: 'Comunidade', avatarUrl: null },
      text: 'Registro reservado aos membros.',
      image: {
        url: 'https://community-preview.invalid/centro-membros.webp',
        alt: 'Registro reservado da comunidade',
      },
      metrics: { commentCount: 1, reactionCount: 6 },
      offsetMs: 110 * 60_000,
    },
  ],
  'community-zona-sul': [
    {
      id: 'zona-sul-photo-1',
      kind: 'photo',
      audience: 'public_preview',
      author: { label: 'Equipe do local', avatarUrl: null },
      text: 'Espaço aberto e fluxo moderado.',
      image: {
        url: 'https://community-preview.invalid/zona-sul-1.webp',
        alt: 'Espaço social da comunidade',
      },
      metrics: { commentCount: 9, reactionCount: 31 },
      offsetMs: 35 * 60_000,
    },
    {
      id: 'zona-sul-text-1',
      kind: 'text',
      audience: 'public_preview',
      author: { label: 'Moderação', avatarUrl: null },
      text: 'Atualizações públicas permanecem visíveis para visitantes.',
      image: null,
      metrics: { commentCount: 3, reactionCount: 12 },
      offsetMs: 80 * 60_000,
    },
    {
      id: 'zona-sul-photo-2',
      kind: 'photo',
      audience: 'public_preview',
      author: { label: 'Equipe do local', avatarUrl: null },
      text: null,
      image: {
        url: 'https://community-preview.invalid/zona-sul-2.webp',
        alt: 'Detalhe do ambiente comunitário',
      },
      metrics: { commentCount: 1, reactionCount: 10 },
      offsetMs: 150 * 60_000,
    },
  ],
  'community-sala-conexoes': [
    {
      id: 'sala-text-1',
      kind: 'text',
      audience: 'public_preview',
      author: { label: 'Moderação da sala', avatarUrl: null },
      text: 'A prévia mostra o movimento, mas não libera interação.',
      image: null,
      metrics: { commentCount: 0, reactionCount: 4 },
      offsetMs: 18 * 60_000,
    },
    {
      id: 'sala-photo-1',
      kind: 'photo',
      audience: 'public_preview',
      author: { label: 'Moderação da sala', avatarUrl: null },
      text: 'Imagem fictícia para validar a galeria.',
      image: {
        url: 'https://community-preview.invalid/sala-1.webp',
        alt: 'Imagem fictícia da sala comunitária',
      },
      metrics: { commentCount: 0, reactionCount: 7 },
      offsetMs: 55 * 60_000,
    },
    {
      id: 'sala-text-members',
      kind: 'text',
      audience: 'members_only',
      author: { label: 'Comunidade', avatarUrl: null },
      text: 'Publicação reservada aos integrantes ativos.',
      image: null,
      metrics: { commentCount: 2, reactionCount: 5 },
      offsetMs: 95 * 60_000,
    },
  ],
};

console.log(
  `[seed:communities] Projeto=${projectId} | Emulador=${emulatorHost} | Comunidades=${communities.length}`
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

  for (const post of communityPosts[id] ?? []) {
    const { id: postId, offsetMs, ...postData } = post;

    await db
      .collection('community_public_feed')
      .doc(id)
      .collection('items')
      .doc(postId)
      .set(
        {
          ...postData,
          status: 'active',
          moderationState: 'active',
          publishedAt: now - offsetMs,
          updatedAt: now,
        },
        { merge: true }
      );
  }

  console.log(
    `[seed:communities] upsert communities/${id} | posts=${communityPosts[id]?.length ?? 0}`
  );
}

console.log('[seed:communities] Concluído sem limpar dados existentes.');
