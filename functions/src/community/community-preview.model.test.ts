// functions/src/community/community-preview.model.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterCommunityDiscoveryCardForViewer,
  normalizeCommunityDiscoveryPageRequest,
  normalizeCommunityId,
  resolveCommunityViewerMode,
  sanitizeCommunityDiscoveryProjection,
  sanitizeCommunityDocument,
  sanitizeCommunityPreviewDetails,
} from './community-preview.model';

function projection(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Comunidade do Centro',
    slug: 'comunidade-do-centro',
    description: 'Grupo permanente de pessoas da região central.',
    rules: 'Respeite os participantes.\nPreserve a privacidade de todos.',
    source: { type: 'community', id: 'community-1' },
    status: 'active',
    moderationState: 'active',
    visibility: 'public_preview',
    tagIds: ['intent:friendship', 'practice:bdsm'],
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

test('normaliza paginação, fonte, tag e limita o tamanho máximo', () => {
  assert.deepEqual(
    normalizeCommunityDiscoveryPageRequest({
      limit: 999,
      cursor: 'community-1',
      sourceType: 'venue',
    }),
    { limit: 24, cursor: 'community-1', sourceType: 'venue', tagId: null }
  );

  assert.deepEqual(
    normalizeCommunityDiscoveryPageRequest({
      sourceType: 'community',
      tagId: 'practice:bdsm',
    }),
    {
      limit: 12,
      cursor: null,
      sourceType: 'community',
      tagId: 'practice:bdsm',
    }
  );

  assert.deepEqual(
    normalizeCommunityDiscoveryPageRequest({ sourceType: 'room' }),
    {
      limit: 12,
      cursor: null,
      sourceType: null,
      tagId: null,
    }
  );
});

test('preserva envelope opaco de cursor sem truncar id máximo', () => {
  const documentId = 'a'.repeat(128);
  const cursor = `cursor1:score_v2:${documentId}`;

  assert.equal(
    normalizeCommunityDiscoveryPageRequest({ cursor }).cursor,
    cursor
  );
});

test('descarta cursor, communityId e tag com formato ou catálogo inválido', () => {
  assert.equal(
    normalizeCommunityDiscoveryPageRequest({ cursor: 'https://example.com' }).cursor,
    null
  );
  assert.equal(
    normalizeCommunityDiscoveryPageRequest({ tagId: 'practice:inexistente' }).tagId,
    null
  );
  assert.equal(normalizeCommunityId('../community'), null);
});

test('sanitiza uma projeção comunitária pública válida com tags canônicas', () => {
  const card = sanitizeCommunityDiscoveryProjection(
    'community-1',
    projection({
      tagIds: [
        'practice:bdsm',
        'intent:friendship',
        'practice:inexistente',
      ],
    })
  );

  assert.equal(card?.communityId, 'community-1');
  assert.equal(card?.source.type, 'community');
  assert.equal(card?.access.minimumRole, null);
  assert.equal(card?.access.requiresActiveSubscription, false);
  assert.equal(card ? 'rules' in card : true, false);
  assert.equal(card ? 'lifecycleStatus' in card : true, false);
  assert.deepEqual(card?.tags, [
    { id: 'intent:friendship', label: 'Amizade', category: 'intent' },
    { id: 'practice:bdsm', label: 'BDSM', category: 'practice' },
  ]);
});

test('não devolve nenhum metadado do card para viewer bloqueado', () => {
  const card = sanitizeCommunityDiscoveryProjection(
    'community-1',
    projection()
  );

  assert.ok(card);
  assert.equal(
    filterCommunityDiscoveryCardForViewer(
      card,
      { status: 'blocked', role: 'owner' }
    ),
    null
  );
  assert.equal(filterCommunityDiscoveryCardForViewer(card, null), card);
  assert.equal(
    filterCommunityDiscoveryCardForViewer(
      card,
      { status: 'active', role: 'member' }
    ),
    card
  );
});

test('expõe regras e lifecycle somente nos detalhes do preview autenticado', () => {
  assert.deepEqual(
    sanitizeCommunityPreviewDetails(projection({
      status: 'dormant',
      rules: '  Respeite   os participantes.\r\n\r\n Preserve a privacidade.  ',
    })),
    {
      rules: 'Respeite os participantes.\nPreserve a privacidade.',
      lifecycleStatus: 'dormant',
    }
  );

  assert.deepEqual(
    sanitizeCommunityPreviewDetails(projection({
      source: { type: 'venue', id: 'venue-1' },
      rules: 'Não deve aparecer no Local.',
    })),
    { rules: null, lifecycleStatus: null }
  );

  assert.equal(
    sanitizeCommunityPreviewDetails(projection({ status: 'unknown' })),
    null
  );
});

test('sanitiza Local sem tags e rejeita Sala como origem comunitária', () => {
  const venue = sanitizeCommunityDiscoveryProjection(
    'community-local',
    projection({ source: { type: 'venue', id: 'venue-1' } })
  );

  assert.equal(venue?.source.type, 'venue');
  assert.deepEqual(venue?.tags, []);
  assert.equal(
    sanitizeCommunityDiscoveryProjection(
      'community-room',
      projection({ source: { type: 'room', id: 'room-1' } })
    ),
    null
  );
});

test('descarta da descoberta projeções ocultas, pausadas, dormentes ou arquivadas', () => {
  for (const overrides of [
    { visibility: 'hidden' },
    { status: 'paused' },
    { status: 'dormant' },
    { status: 'archived', visibility: 'hidden' },
  ]) {
    assert.equal(
      sanitizeCommunityDiscoveryProjection(
        'community-1',
        projection(overrides)
      ),
      null
    );
  }

  assert.equal(
    sanitizeCommunityDiscoveryProjection(
      'community-1',
      projection({ source: { type: 'invalid', id: 'community-1' } })
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

test('preserva documento pausado ou dormente para vínculo existente', () => {
  for (const status of ['paused', 'dormant'] as const) {
    const raw: Record<string, unknown> = projection({
      status,
      visibility: 'members_only',
      moderation: { state: 'active' },
    });
    Reflect.deleteProperty(raw, 'moderationState');

    assert.equal(
      sanitizeCommunityDocument('community-1', raw)?.communityId,
      'community-1'
    );
  }
});

test('preserva arquivo terminal oculto apenas no documento canônico vinculado', () => {
  for (const status of ['archived', 'scheduled_for_deletion'] as const) {
    const raw: Record<string, unknown> = projection({
      status,
      visibility: 'hidden',
      moderation: { state: 'active' },
    });
    Reflect.deleteProperty(raw, 'moderationState');

    assert.equal(
      sanitizeCommunityDocument('community-1', raw)?.communityId,
      'community-1'
    );
  }

  const activeHidden: Record<string, unknown> = projection({
    status: 'active',
    visibility: 'hidden',
    moderation: { state: 'active' },
  });
  Reflect.deleteProperty(activeHidden, 'moderationState');
  assert.equal(sanitizeCommunityDocument('community-1', activeHidden), null);
});

test('resolve visitante, pendente, membro, moderador e gestores', () => {
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
    resolveCommunityViewerMode({ status: 'active', role: 'admin' }),
    { mode: 'manager', role: 'admin', active: true, blocked: false }
  );
  assert.deepEqual(
    resolveCommunityViewerMode({ status: 'active', role: 'owner' }),
    { mode: 'manager', role: 'owner', active: true, blocked: false }
  );
});

test('não promove papel ativo desconhecido a privilégio de gestão', () => {
  assert.deepEqual(resolveCommunityViewerMode({ status: 'active', role: 'root' }), {
    mode: 'member',
    role: null,
    active: true,
    blocked: false,
  });
});

test('marca membership bloqueada sem expor um modo privilegiado', () => {
  assert.deepEqual(resolveCommunityViewerMode({ status: 'blocked', role: 'owner' }), {
    mode: 'visitor',
    role: null,
    active: false,
    blocked: true,
  });
});
