import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCanonicalOfficialCommunityReference,
  resolveOfficialCommunityCardForCanonicalReference,
} from './official-communities.query';

const target = Object.freeze({
  type: 'venue' as const,
  id: 'venue-123',
});

function buildAssociation(overrides: Record<string, unknown> = {}) {
  return {
    associationKey: 'venue:venue-123',
    communityId: 'community-123',
    target,
    status: 'verified',
    verification: {
      expiresAt: null,
    },
    ...overrides,
  };
}

function buildDiscoveryProjection(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    moderationState: 'active',
    visibility: 'public_preview',
    name: 'Comunidade Oficial do Local',
    slug: 'comunidade-oficial-do-local',
    source: {
      type: 'community',
      id: 'community-123',
    },
    metrics: {
      memberCount: 10,
      postCount: 3,
      mediaCount: 1,
    },
    officialAssociation: {
      target,
      verified: true,
    },
    ...overrides,
  };
}

test('resolve referência somente a partir da associação canônica verificada', () => {
  assert.deepEqual(
    resolveCanonicalOfficialCommunityReference(target, buildAssociation()),
    {
      associationKey: 'venue:venue-123',
      communityId: 'community-123',
      target,
    }
  );
});

test('falha fechado quando associação foi revogada ou expirou', () => {
  assert.equal(
    resolveCanonicalOfficialCommunityReference(
      target,
      buildAssociation({ status: 'revoked' })
    ),
    null
  );

  assert.equal(
    resolveCanonicalOfficialCommunityReference(
      target,
      buildAssociation({
        verification: { expiresAt: Date.now() - 1 },
      })
    ),
    null
  );
});

test('falha fechado diante de chave ou alvo canônico inconsistente', () => {
  assert.equal(
    resolveCanonicalOfficialCommunityReference(
      target,
      buildAssociation({ associationKey: 'venue:venue-outro' })
    ),
    null
  );

  assert.equal(
    resolveCanonicalOfficialCommunityReference(
      target,
      buildAssociation({
        target: { type: 'venue', id: 'venue-outro' },
      })
    ),
    null
  );
});

test('aceita card público apenas quando ele confirma o mesmo alvo oficial', () => {
  const reference = resolveCanonicalOfficialCommunityReference(
    target,
    buildAssociation()
  );
  assert.ok(reference);

  const card = resolveOfficialCommunityCardForCanonicalReference(
    reference,
    buildDiscoveryProjection()
  );

  assert.equal(card?.communityId, 'community-123');
  assert.deepEqual(card?.officialAssociation, {
    target,
    verified: true,
  });
});

test('não usa projeção pública stale ou divergente como fonte de verdade', () => {
  const revokedReference = resolveCanonicalOfficialCommunityReference(
    target,
    buildAssociation({ status: 'revoked' })
  );
  assert.equal(revokedReference, null);

  const validReference = resolveCanonicalOfficialCommunityReference(
    target,
    buildAssociation()
  );
  assert.ok(validReference);

  assert.equal(
    resolveOfficialCommunityCardForCanonicalReference(
      validReference,
      buildDiscoveryProjection({
        officialAssociation: {
          target: { type: 'venue', id: 'venue-outro' },
          verified: true,
        },
      })
    ),
    null
  );
});
