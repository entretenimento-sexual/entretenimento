// scripts/dev/seed-community-preview.mjs
// -----------------------------------------------------------------------------
// SEED DEV/EMULATOR - LOCAIS E COMUNIDADES
// -----------------------------------------------------------------------------
// - exige FIRESTORE_EMULATOR_HOST;
// - cria um Local e duas Comunidades fictícias;
// - Local é um lugar físico ou estabelecimento real;
// - Comunidade é um grupo permanente de pessoas;
// - Sala é conversa em tempo real e não é criada por este seed;
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
    name: 'Bar Luz Centro',
    slug: 'bar-luz-centro',
    description: 'Local fictício com novidades, fotos e encontros na região central.',
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
    description: 'Comunidade de pessoas interessadas em movimento e encontros na Zona Sul.',
    source: { type: 'community', id: 'community-zona-sul' },
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
    id: 'community-conexoes-discretas',
    name: 'Conexões discretas',
    slug: 'conexoes-discretas',
    description: 'Comunidade fictícia para pessoas que valorizam discrição e respeito.',
    source: { type: 'community', id: 'community-conexoes-discretas' },
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
      author: { label: 'Equipe do Local', avatarUrl: null },
      text: 'Ambiente preparado para a noite.',
      image: {
        url: 'https://community-preview.invalid/centro-noite-1.webp',
        alt: 'Área social do Local preparada para a noite',
      },
      metrics: { commentCount: 4, reactionCount: 19 },
      offsetMs: 22 * 60_000,
    },
    {
      id: 'centro-text-1',
      kind: 'text',
      audience: 'public_preview',
      author: { label: 'Equipe do Local', avatarUrl: null },
      text: 'Movimento tranquilo e entrada organizada.',
      image: null,
      metrics: { commentCount: 2, reactionCount: 8 },
      offsetMs: 65 * 60_000,
    },
    {
      id: 'centro-photo-members',
      kind: 'photo',
      audience: 'members_only',
      author: { label: 'Equipe do Local', avatarUrl: null },
      text: 'Registro reservado às pessoas autorizadas no Local.',
      image: {
        url: 'https://community-preview.invalid/centro-membros.webp',
        alt: 'Registro reservado do Local',
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
      author: { label: 'Moderação da Comunidade', avatarUrl: null },
      text: 'Encontro comunitário aberto para acompanhamento.',
      image: {
        url: 'https://community-preview.invalid/zona-sul-1.webp',
        alt: 'Encontro fictício da Comunidade',
      },
      metrics: { commentCount: 9, reactionCount: 31 },
      offsetMs: 35 * 60_000,
    },
    {
      id: 'zona-sul-text-1',
      kind: 'text',
      audience: 'public_preview',
      author: { label: 'Moderação da Comunidade', avatarUrl: null },
      text: 'Atualizações públicas permanecem visíveis para visitantes.',
      image: null,
      metrics: { commentCount: 3, reactionCount: 12 },
      offsetMs: 80 * 60_000,
    },
    {
      id: 'zona-sul-photo-2',
      kind: 'photo',
      audience: 'public_preview',
      author: { label: 'Comunidade', avatarUrl: null },
      text: null,
      image: {
        url: 'https://community-preview.invalid/zona-sul-2.webp',
        alt: 'Registro fictício da Comunidade',
      },
      metrics: { commentCount: 1, reactionCount: 10 },
      offsetMs: 150 * 60_000,
    },
  ],
  'community-conexoes-discretas': [
    {
      id: 'conexoes-text-1',
      kind: 'text',
      audience: 'public_preview',
      author: { label: 'Moderação da Comunidade', avatarUrl: null },
      text: 'A prévia mostra publicações, mas não libera interação.',
      image: null,
      metrics: { commentCount: 0, reactionCount: 4 },
      offsetMs: 18 * 60_000,
    },
    {
      id: 'conexoes-photo-1',
      kind: 'photo',
      audience: 'public_preview',
      author: { label: 'Moderação da Comunidade', avatarUrl: null },
      text: 'Imagem fictícia para validar a galeria comunitária.',
      image: {
        url: 'https://community-preview.invalid/conexoes-1.webp',
        alt: 'Imagem fictícia da Comunidade',
      },
      metrics: { commentCount: 0, reactionCount: 7 },
      offsetMs: 55 * 60_000,
    },
    {
      id: 'conexoes-text-members',
      kind: 'text',
      audience: 'members_only',
      author: { label: 'Comunidade', avatarUrl: null },
      text: 'Publicação reservada aos membros ativos.',
      image: null,
      metrics: { commentCount: 2, reactionCount: 5 },
      offsetMs: 95 * 60_000,
    },
  ],
};

console.log(
  `[seed:communities] Projeto=${projectId} | Emulador=${emulatorHost} | Espaços=${communities.length}`
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
    `[seed:communities] upsert communities/${id} | source=${data.source.type} | posts=${communityPosts[id]?.length ?? 0}`
  );
}

console.log('[seed:communities] Concluído sem limpar dados existentes.');
