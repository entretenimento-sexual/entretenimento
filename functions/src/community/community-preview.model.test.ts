// functions/src/community/community-preview.model.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCommunityDiscoveryPageRequest,
  normalizeCommunityId,
  resolveCommunityViewerMode,
  sanitizeCommunityDiscoveryProjection,
  sanitizeCommunityDocument,
} from './community-preview.model';

function projection(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Comunidade do Centro',
    slug: 'comunidade-do-centro',
    description: 'Atualizações e fotos do local.',
    source: { type: 'venue', id: 'venue-1' },
    status: 'active',
    moderationState: 'active',
    visibility: 'public_preview',
    metrics: { memberCount: 10, postCount: 4, mediaCount: 3 },
    access: {
      join: 'approval',
      contentAccess: {
        minimumRole: 'premium',
        requiresActiveSubscription: true,
      },
    },
    ...overrides,
  };
}

test('normaliza paginação, fonte e limita o tamanho máximo', () => {
  assert.deepEqual(
    normalizeCommunityDiscoveryPageRequest({
      limit: 999,
      cursor: 'community-1',
      sourceType: 'venue',
    }),
    { limit: 24, cursor: 'community-1', sourceType: 'venue' }
  );

  assert.deepEqual(normalizeCommunityDiscoveryPageRequest({ sourceType: 'other' }), {
    limit: 12,
    cursor: null,
    sourceType: null,
  });
});

test('descarta cursor e communityId com formato inseguro', () => {
  assert.equal(
    normalizeCommunityDiscoveryPageRequest({ cursor: 'https://example.com' }).cursor,
    null
  );
  assert.equal(normalizeCommunityId('../community'), null);
});

test('sanitiza uma projeção pública válida', () => {
  const card = sanitizeCommunityDiscoveryProjection(
    'community-1',
    projection()
  );

  assert.equal(card?.communityId, 'community-1');
  assert.equal(card?.source.type, 'venue');
  assert.equal(card?.access.minimumRole, 'premium');
  assert.equal(card?.access.requiresActiveSubscription, true);
});

test('descarta projeções ocultas, pausadas ou malformadas', () => {
  assert.equal(
    sanitizeCommunityDiscoveryProjection(
      'community-1',
      projection({ visibility: 'hidden' })
    ),
    null
  );
  assert.equal(
    sanitizeCommunityDiscoveryProjection(
      'community-1',
      projection({ status: 'paused' })
    ),
    null
  );
  assert.equal(
    sanitizeCommunityDiscoveryProjection(
      'community-1',
      projection({ source: { type: 'invalid', id: 'venue-1' } })
    ),
    null
  );
});

test('aceita documento restrito somente para avaliação de membro', () => {
  const raw: Record<string, unknown> = projection({
    visibility: 'members_only',
    moderation: { state: 'active' },
  });
  Reflect.deleteProperty(raw, 'moderationState');

  assert.equal(
    sanitizeCommunityDocument('community-1', raw)?.communityId,
    'community-1'
  );
});

test('preserva documento pausado para prévia de membro', () => {
  const raw: Record<string, unknown> = projection({
    status: 'paused',
    visibility: 'members_only',
    moderation: { state: 'active' },
  });
  Reflect.deleteProperty(raw, 'moderationState');

  assert.equal(
    sanitizeCommunityDocument('community-1', raw)?.communityId,
    'community-1'
  );
});

test('resolve visitante, pendente, membro, moderador e gestor', () => {
  assert.deepEqual(resolveCommunityViewerMode(null), {
    mode: 'visitor',
    role: null,
    active: false,
    blocked: false,
  });
  assert.deepEqual(
    resolveCommunityViewerMode({ status: 'pending', role: 'member' }),
    { mode: 'pending', role: 'member', active: false, blocked: false }
  );
  assert.equal(
    resolveCommunityViewerMode({ status: 'active', role: 'member' }).mode,
    'member'
  );
  assert.equal(
    resolveCommunityViewerMode({ status: 'active', role: 'moderator' }).mode,
    'moderator'
  );
  assert.deepEqual(
    resolveCommunityViewerMode({ status: 'active', role: 'owner' }),
    { mode: 'manager', role: 'owner', active: true, blocked: false }
  );
});

test('marca membership bloqueada sem expor um modo privilegiado', () => {
  assert.deepEqual(resolveCommunityViewerMode({ status: 'blocked', role: 'owner' }), {
    mode: 'visitor',
    role: null,
    active: false,
    blocked: true,
  });
});
