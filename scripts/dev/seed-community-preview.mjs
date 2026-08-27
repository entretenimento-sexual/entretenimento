// scripts/dev/seed-community-preview.mjs
// -----------------------------------------------------------------------------
// SEED DEV/EMULATOR - LOCAIS E COMUNIDADES
// -----------------------------------------------------------------------------
// - exige FIRESTORE_EMULATOR_HOST;
// - cria um Local e doze Comunidades fictícias para inspeção visual;
// - preserva os IDs do seed legado para manter o cenário determinístico;
// - Local é um lugar físico ou estabelecimento real;
// - Comunidade é um grupo permanente de pessoas;
// - Sala é conversa em tempo real e não é criada por este seed;
// - usa exclusivamente tags canônicas do domínio de Comunidades;
// - não grava coordenadas ou informações pessoais;
// - não depende de imagens ou serviços externos;
// - não cria atividade artificial no Mural;
// - remove somente os antigos seed-post-1..3, preservando publicações manuais;
// - usa merge e não limpa dados criados manualmente no Emulator.
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
const LEGACY_PREVIEW_POST_IDS = Object.freeze([
  'seed-post-1',
  'seed-post-2',
  'seed-post-3',
]);

function buildAccess({ join = 'open', minimumRole = null } = {}) {
  return {
    preview: 'authenticated',
    interaction: 'members_only',
    join,
    contentAccess: {
      minimumRole,
      requiresActiveSubscription: minimumRole !== null,
    },
  };
}

function communitySeed({
  id,
  name,
  slug,
  description,
  tagIds,
  metrics,
  rankScore,
  join = 'open',
  minimumRole = null,
}) {
  return {
    id,
    name,
    slug,
    description,
    source: { type: 'community', id },
    status: 'active',
    visibility: 'public_preview',
    tagIds,
    access: buildAccess({ join, minimumRole }),
    moderation: { state: 'active', reviewedAt: now, reviewedBy: 'dev-seed' },
    metrics,
    rankScore,
  };
}

const spaces = [
  {
    id: 'community-rj-centro',
    name: 'Bar Luz Centro',
    slug: 'bar-luz-centro',
    description: 'Local fictício com novidades, fotos e encontros na região central.',
    source: { type: 'venue', id: 'rj-centro-bar-luz' },
    status: 'active',
    visibility: 'public_preview',
    tagIds: [],
    access: buildAccess({ join: 'approval' }),
    moderation: { state: 'active', reviewedAt: now, reviewedBy: 'dev-seed' },
    metrics: { memberCount: 28, postCount: 9, mediaCount: 6 },
    rankScore: 96,
  },
  communitySeed({
    id: 'community-amizades-rio',
    name: 'Amizades Rio',
    slug: 'amizades-rio',
    description: 'Conversas, encontros sociais e novas amizades para quem vive ou passa pelo Rio.',
    tagIds: [
      'intent:friendship',
      'intent:casual',
      'audience:men',
      'audience:women',
      'audience:non_binary',
    ],
    metrics: { memberCount: 842, postCount: 138, mediaCount: 74 },
    rankScore: 990,
  }),
  communitySeed({
    id: 'community-swing-rio',
    name: 'Swing Rio',
    slug: 'swing-rio',
    description: 'Comunidade para casais e pessoas interessadas em swing, respeito e discrição.',
    tagIds: [
      'intent:swing',
      'intent:open_relationship',
      'practice:menage',
      'audience:couple_mf',
      'audience:couple_ff',
      'audience:couple_mm',
    ],
    metrics: { memberCount: 1264, postCount: 246, mediaCount: 188 },
    rankScore: 970,
    join: 'approval',
  }),
  communitySeed({
    id: 'community-bdsm-brasil',
    name: 'BDSM Brasil',
    slug: 'bdsm-brasil',
    description: 'Troca responsável sobre BDSM, consentimento, práticas e cultura da comunidade.',
    tagIds: [
      'practice:bdsm',
      'practice:dom_sub',
      'practice:shibari',
      'practice:roleplay',
      'intent:fetish_exploration',
    ],
    metrics: { memberCount: 738, postCount: 192, mediaCount: 93 },
    rankScore: 940,
    join: 'approval',
  }),
  communitySeed({
    id: 'community-casais-liberais',
    name: 'Casais Liberais',
    slug: 'casais-liberais',
    description: 'Espaço para experiências, diálogo e convivência entre casais de relacionamento aberto.',
    tagIds: [
      'intent:open_relationship',
      'intent:swing',
      'practice:menage',
      'audience:couple_mf',
    ],
    metrics: { memberCount: 592, postCount: 111, mediaCount: 126 },
    rankScore: 910,
    join: 'approval',
    minimumRole: 'premium',
  }),
  communitySeed({
    id: 'community-tantra-conexao',
    name: 'Tantra & Conexão',
    slug: 'tantra-conexao',
    description: 'Conversas sobre tantra, intimidade, presença e conexão entre pessoas adultas.',
    tagIds: [
      'practice:tantra',
      'intent:dating',
      'intent:serious',
      'intent:friendship',
    ],
    metrics: { memberCount: 321, postCount: 68, mediaCount: 41 },
    rankScore: 860,
  }),
  communitySeed({
    id: 'community-poliamor-brasil',
    name: 'Poliamor Brasil',
    slug: 'poliamor-brasil',
    description: 'Debates e vivências sobre relações não monogâmicas, afeto, acordos e comunicação.',
    tagIds: [
      'intent:polyamory',
      'intent:open_relationship',
      'intent:dating',
      'intent:friendship',
    ],
    metrics: { memberCount: 477, postCount: 154, mediaCount: 58 },
    rankScore: 830,
  }),
  communitySeed({
    id: 'community-voyeurismo-exibicionismo',
    name: 'Voyeurismo & Exibicionismo',
    slug: 'voyeurismo-exibicionismo',
    description: 'Comunidade adulta para conversar sobre voyeurismo e exibicionismo com limites claros.',
    tagIds: [
      'practice:voyeurism',
      'practice:exhibitionism',
      'intent:fetish_exploration',
      'practice:fetishes',
    ],
    metrics: { memberCount: 219, postCount: 84, mediaCount: 164 },
    rankScore: 790,
    join: 'approval',
    minimumRole: 'vip',
  }),
  communitySeed({
    id: 'community-pessoas-trans-aliados',
    name: 'Pessoas Trans & Aliados',
    slug: 'pessoas-trans-aliados',
    description: 'Espaço de acolhimento, amizade e troca entre pessoas trans, não binárias e aliados.',
    tagIds: [
      'audience:trans_people',
      'audience:non_binary',
      'intent:friendship',
      'intent:dating',
    ],
    metrics: { memberCount: 356, postCount: 129, mediaCount: 47 },
    rankScore: 760,
    join: 'approval',
  }),
  communitySeed({
    id: 'community-fetiches-sem-tabu',
    name: 'Fetiches sem Tabu',
    slug: 'fetiches-sem-tabu',
    description: 'Descoberta e conversa sobre fetiches, roleplay e curiosidades com respeito e consentimento.',
    tagIds: [
      'practice:fetishes',
      'intent:fetish_exploration',
      'practice:roleplay',
      'practice:bdsm',
    ],
    metrics: { memberCount: 188, postCount: 72, mediaCount: 88 },
    rankScore: 710,
  }),
  communitySeed({
    id: 'community-ao-ar-livre',
    name: 'Ao Ar Livre',
    slug: 'ao-ar-livre',
    description: 'Pessoas adultas interessadas em natureza, viagens e experiências fora da rotina.',
    tagIds: [
      'practice:outdoor',
      'intent:casual',
      'intent:friendship',
    ],
    metrics: { memberCount: 94, postCount: 31, mediaCount: 52 },
    rankScore: 650,
  }),
  communitySeed({
    id: 'community-zona-sul',
    name: 'Zona Sul agora',
    slug: 'zona-sul-agora',
    description: 'Pessoas da Zona Sul trocando ideias sobre encontros, amizade e movimento na região.',
    tagIds: [
      'intent:friendship',
      'intent:casual',
      'intent:dating',
      'audience:men',
      'audience:women',
    ],
    metrics: { memberCount: 64, postCount: 27, mediaCount: 18 },
    rankScore: 610,
    join: 'open',
    minimumRole: 'premium',
  }),
  communitySeed({
    id: 'community-conexoes-discretas',
    name: 'Conexões discretas',
    slug: 'conexoes-discretas',
    description: 'Comunidade para quem valoriza privacidade, discrição, conversa e respeito.',
    tagIds: [
      'intent:friendship',
      'intent:casual',
      'intent:dating',
    ],
    metrics: { memberCount: 14, postCount: 12, mediaCount: 4 },
    rankScore: 560,
    join: 'invite_only',
  }),
];

async function removeLegacyPreviewPosts(spaceId) {
  const batch = db.batch();

  for (const postId of LEGACY_PREVIEW_POST_IDS) {
    batch.delete(
      db
        .collection('community_public_feed')
        .doc(spaceId)
        .collection('items')
        .doc(postId)
    );
  }

  await batch.commit();
}

console.log(
  `[seed:communities] Projeto=${projectId} | Emulador=${emulatorHost} | Espaços=${spaces.length}`
);

for (const space of spaces) {
  const { id, rankScore, ...data } = space;

  await db.collection('communities').doc(id).set(
    {
      ...data,
      createdAt: now,
      updatedAt: now,
      lifecycle: {
        lastMeaningfulActivityAt: now,
        dormantAt: null,
        archivedAt: null,
        scheduledForDeletionAt: null,
        policyVersion: 1,
      },
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
      tagIds: data.tagIds,
      metrics: data.metrics,
      access: data.access,
      avatarUrl: null,
      coverUrl: null,
      rankScore,
      updatedAt: now,
    },
    { merge: true }
  );

  await removeLegacyPreviewPosts(id);

  console.log(
    `[seed:communities] upsert communities/${id} | source=${data.source.type} | tags=${data.tagIds.length} | artificialFeedPosts=0`
  );
}

const seededCommunities = spaces.filter(
  (space) => space.source.type === 'community'
).length;
const seededVenues = spaces.filter((space) => space.source.type === 'venue').length;

console.log(
  `[seed:communities] Concluído sem limpar dados manuais | Comunidades=${seededCommunities} | Locais=${seededVenues}`
);
console.log(
  '[seed:communities] Abra /dashboard/comunidades para inspeção visual.'
);
