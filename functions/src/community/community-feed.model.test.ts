// functions/src/community/community-feed.model.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCommunityFeedPostCreateRequest,
  normalizeCommunityFeedPageRequest,
  sanitizeCommunityFeedProjection,
} from './community-feed.model';
import { buildCommunityPublicAuthor } from './community-public-author.model';

const NOW = 1_800_000_000_000;

function feedItem(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'photo',
    audience: 'public_preview',
    status: 'active',
    moderationState: 'active',
    author: {
      label: 'Equipe do local',
      avatarUrl: 'https://example.com/avatar.webp',
    },
    text: 'Movimento tranquilo nesta noite.',
    image: {
      url: 'https://example.com/photo.webp',
      alt: 'Ambiente iluminado do local',
    },
    metrics: {
      commentCount: 3,
      reactionCount: 8,
    },
    publishedAt: NOW - 10_000,
    ...overrides,
  };
}

test('normaliza mural, fotos, limite e cursor', () => {
  assert.deepEqual(
    normalizeCommunityFeedPageRequest({
      communityId: 'community-1',
      view: 'photos',
      limit: 999,
      cursor: 'post-1',
    }),
    {
      communityId: 'community-1',
      view: 'photos',
      limit: 20,
      cursor: 'post-1',
    }
  );
});

test('rejeita communityId e cursor inseguros', () => {
  const request = normalizeCommunityFeedPageRequest({
    communityId: '../community',
    cursor: 'https://example.com',
  });

  assert.equal(request.communityId, null);
  assert.equal(request.cursor, null);
});

test('normaliza mensagem textual com audiência privada por padrão', () => {
  assert.deepEqual(
    normalizeCommunityFeedPostCreateRequest({
      requestId: 'post-request-1',
      communityId: 'community-1',
      text: '  Uma nova conversa\nno mural.  ',
      audience: 'invalid',
    }),
    {
      requestId: 'post-request-1',
      communityId: 'community-1',
      text: 'Uma nova conversa no mural.',
      audience: 'members_only',
      imageUploadPath: null,
      location: null,
      replyToPostId: null,
    }
  );

  assert.equal(
    normalizeCommunityFeedPostCreateRequest({
      requestId: '../unsafe',
      communityId: 'community-1',
      text: 'Olá',
      audience: 'public_preview',
    }).requestId,
    null
  );
});

test('normaliza localização para precisão pública aproximada', () => {
  const result = normalizeCommunityFeedPostCreateRequest({
    requestId: 'post-location-1',
    communityId: 'community-1',
    text: 'Estamos aqui.',
    location: { latitude: -22.9068, longitude: -43.1729 },
  });

  assert.deepEqual(result.location, {
    latitude: -22.91,
    longitude: -43.17,
    precision: 'approximate',
  });
});

test('normaliza resposta como nova mensagem do Mural ligada à origem', () => {
  const result = normalizeCommunityFeedPostCreateRequest({
    requestId: 'reply-1',
    communityId: 'community-1',
    text: 'Concordo com você.',
    replyToPostId: 'post-original',
  });

  assert.equal(result.replyToPostId, 'post-original');
  assert.equal(
    normalizeCommunityFeedPostCreateRequest({
      requestId: 'reply-2',
      communityId: 'community-1',
      text: 'Resposta inválida',
      replyToPostId: '../post-original',
    }).replyToPostId,
    null
  );
});

test('normaliza mensagem com foto privada para promoção backend', () => {
  const result = normalizeCommunityFeedPostCreateRequest({
    requestId: 'post-photo-1',
    communityId: 'community-1',
    text: 'Como está o local agora.',
    imageUploadPath: 'users/u1/uploads/images/photo.webp',
  });

  assert.equal(result.text, 'Como está o local agora.');
  assert.equal(
    result.imageUploadPath,
    'users/u1/uploads/images/photo.webp'
  );
});

test('sanitiza publicação pública com foto legada HTTPS', () => {
  const result = sanitizeCommunityFeedProjection('post-1', feedItem(), NOW);

  assert.equal(result?.audience, 'public_preview');
  assert.equal(result?.item.kind, 'photo');
  assert.equal(result?.item.author.label, 'Equipe do local');
  assert.equal(result?.item.author.profileType, null);
  assert.equal(result?.item.metrics.reactionCount, 8);
  assert.equal(result?.item.replyTo, null);
  assert.equal(result?.replyToPostId, null);
  assert.equal(result?.imageStoragePath, null);
  assert.deepEqual(result?.item.capabilities, {
    canDeleteOwn: false,
    canModerate: false,
    canReport: false,
    canReact: false,
    viewerReacted: false,
    canViewComments: false,
    canComment: false,
  });
});

test('preserva replyToPostId somente para hidratação backend da citação', () => {
  const result = sanitizeCommunityFeedProjection(
    'reply-1',
    feedItem({
      kind: 'text',
      image: null,
      text: 'Uma resposta que deve entrar na timeline.',
      replyToPostId: 'post-original',
    }),
    NOW
  );

  assert.equal(result?.replyToPostId, 'post-original');
  assert.equal(result?.item.replyTo, null);

  assert.equal(
    sanitizeCommunityFeedProjection(
      'reply-self',
      feedItem({
        kind: 'text',
        image: null,
        text: 'Referência inválida.',
        replyToPostId: 'reply-self',
      }),
      NOW
    ),
    null
  );
});

test('aceita foto publicada backend-only para hidratação posterior', () => {
  const result = sanitizeCommunityFeedProjection(
    'post-photo',
    feedItem({
      image: {
        storagePath:
          'users/u1/published/images/post-photo/1800000000000-version1',
        alt: 'Foto compartilhada no Mural',
      },
    }),
    NOW
  );

  assert.equal(
    result?.imageStoragePath,
    'users/u1/published/images/post-photo/1800000000000-version1'
  );
  assert.equal(result?.item.image, null);
});

test('sanitiza localização no backend sem preservar coordenada precisa', () => {
  const result = sanitizeCommunityFeedProjection(
    'post-location',
    feedItem({
      kind: 'location',
      image: null,
      location: { latitude: -22.9068, longitude: -43.1729 },
    }),
    NOW
  );

  assert.deepEqual(result?.item.location, {
    latitude: -22.91,
    longitude: -43.17,
    precision: 'approximate',
  });
});

test('mantém item válido quando avatar usa URL insegura', () => {
  const result = sanitizeCommunityFeedProjection(
    'post-1',
    feedItem({
      author: { label: 'Moderação', avatarUrl: 'http://insecure.test/a.jpg' },
    }),
    NOW
  );

  assert.equal(result?.item.author.avatarUrl, null);
});

test('descarta foto sem HTTPS/storage publicado e texto vazio', () => {
  assert.equal(
    sanitizeCommunityFeedProjection(
      'post-1',
      feedItem({ image: { url: 'http://insecure.test/photo.jpg' } }),
      NOW
    ),
    null
  );

  assert.equal(
    sanitizeCommunityFeedProjection(
      'post-2',
      feedItem({ kind: 'text', text: '   ', image: null }),
      NOW
    ),
    null
  );
});

test('descarta conteúdo oculto, expirado ou futuro', () => {
  assert.equal(
    sanitizeCommunityFeedProjection(
      'post-1',
      feedItem({ moderationState: 'pending_review' }),
      NOW
    ),
    null
  );
  assert.equal(
    sanitizeCommunityFeedProjection(
      'post-2',
      feedItem({ expiresAt: NOW - 1 }),
      NOW
    ),
    null
  );
  assert.equal(
    sanitizeCommunityFeedProjection(
      'post-3',
      feedItem({ publishedAt: NOW + 10 * 60_000 }),
      NOW
    ),
    null
  );
});

test('aceita audiência exclusiva para membros sem expor UID', () => {
  const result = sanitizeCommunityFeedProjection(
    'post-members',
    feedItem({ audience: 'members_only' }),
    NOW
  );

  assert.equal(result?.audience, 'members_only');
  assert.equal('uid' in (result?.item.author ?? {}), false);
});

test('projeta somente identidade social pública coarse para Comunidades', () => {
  const author = buildCommunityPublicAuthor({
    uid: 'internal-user-id',
    nickname: 'casal_serale',
    avatarUrl: 'https://example.com/public-avatar.webp',
    identityCode: 'casal-ele-ela',
    identityCatalogVersion: 1,
    identityLabel: 'Casal (Ele/Ela)',
    identityShortLabel: 'Casal',
    identityDiscoveryGroup: 'couple',
    municipio: 'Rio de Janeiro',
    estado: 'Rio de Janeiro',
    nome: 'Nome civil não público',
    cpf: '00000000000',
    endereco: 'Rua que não deve aparecer',
  }, {
    label: 'Participante',
    avatarUrl: null,
  });

  assert.deepEqual(author, {
    profileId: null,
    nickname: 'casal_serale',
    label: 'casal_serale',
    avatarUrl: 'https://example.com/public-avatar.webp',
    identityCode: 'casal-ele-ela',
    identityLabel: 'Casal (Ele/Ela)',
    identityShortLabel: 'Casal',
    discoveryGroup: 'couple',
    city: 'Rio de Janeiro',
    state: 'RJ',
    profileType: 'couple',
    profileTypeLabel: 'Casal',
  });
  assert.equal('uid' in author, false);
  assert.equal('nome' in author, false);
  assert.equal('cpf' in author, false);
  assert.equal('endereco' in author, false);
});
