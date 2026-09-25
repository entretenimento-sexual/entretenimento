import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityMemberSearchIndexProjection,
  decodeCommunityMemberSearchCursor,
  encodeCommunityMemberSearchCursor,
  normalizeCommunityMemberSearchQuery,
} from './community-member-search-index.policy';

const profileId = 'profile-00000000-0000-4000-8000-000000000001';

test('indexa somente nickname público de perfil adulto vigente', () => {
  const projection = buildCommunityMemberSearchIndexProjection({
    communityId: 'community-1',
    memberId: 'uid-1',
    rawMembership: { status: 'active' },
    rawPublicProfile: {
      profileId,
      nickname: 'Álex Leandro',
      ageEligibilityVerifiedAdult: true,
      ageEligibilityValidUntil: 2_000,
      nome: 'Nome Civil Não Indexado',
      email: 'privado@example.com',
    },
    nowMs: 1_000,
  });

  assert.ok(projection);
  assert.equal(projection.publicLabel, 'Álex Leandro');
  assert.equal(projection.publicLabelNormalized, 'alex leandro');
  assert.equal(projection.searchPrefixes.includes('alex'), true);
  assert.equal(projection.searchPrefixes.includes('leandro'), true);
  assert.equal(JSON.stringify(projection).includes('Nome Civil'), false);
  assert.equal(JSON.stringify(projection).includes('privado@example.com'), false);
});

test('não projeta membership inativa nem perfil etariamente inválido', () => {
  assert.equal(buildCommunityMemberSearchIndexProjection({
    communityId: 'community-1',
    memberId: 'uid-1',
    rawMembership: { status: 'left' },
    rawPublicProfile: {
      profileId,
      nickname: 'Alex',
      ageEligibilityVerifiedAdult: true,
      ageEligibilityValidUntil: 2_000,
    },
    nowMs: 1_000,
  }), null);

  assert.equal(buildCommunityMemberSearchIndexProjection({
    communityId: 'community-1',
    memberId: 'uid-1',
    rawMembership: { status: 'active' },
    rawPublicProfile: {
      profileId,
      nickname: 'Alex',
      ageEligibilityVerifiedAdult: true,
      ageEligibilityValidUntil: 500,
    },
    nowMs: 1_000,
  }), null);
});

test('normaliza busca por prefixo sem acentos', () => {
  assert.equal(normalizeCommunityMemberSearchQuery('  ÁLÉX  '), 'alex');
  assert.equal(normalizeCommunityMemberSearchQuery('a'), null);
  assert.equal(normalizeCommunityMemberSearchQuery(''), '');
});

test('cursor é opaco, versionado e vinculado à consulta', () => {
  const encoded = encodeCommunityMemberSearchCursor({
    query: 'alex',
    publicLabelNormalized: 'alex leandro',
    documentId: 'community-1:uid-1',
  });
  const decoded = decodeCommunityMemberSearchCursor(encoded);

  assert.ok(encoded.startsWith('v1_'));
  assert.deepEqual(decoded, {
    query: 'alex',
    publicLabelNormalized: 'alex leandro',
    documentId: 'community-1:uid-1',
  });
  assert.equal(decodeCommunityMemberSearchCursor('uid-1'), null);
});
