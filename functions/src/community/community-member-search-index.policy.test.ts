import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityMemberSearchIndexProjection,
  communityMemberSearchPublicProfileFingerprint,
  isCurrentCommunityMemberSearchPublicProfile,
  decodeCommunityMemberSearchCursor,
  encodeCommunityMemberSearchCursor,
  normalizeCommunityMemberSearchQuery,
} from './community-member-search-index.policy';

import { PRIVATE_DISCOVERY_INTEREST_FIELDS } from '../discovery/public-profile-discovery-projection';

const profileId = 'profile-00000000-0000-4000-8000-000000000001';

test('indexa somente nickname de perfil público canônico', () => {
  const projection = buildCommunityMemberSearchIndexProjection({
    communityId: 'community-1',
    memberId: 'uid-1',
    rawMembership: { status: 'active' },
    rawPublicProfile: {
      profileId,
      nickname: 'Álex Leandro',
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

test('não projeta membership inativa nem perfil público sem identidade canônica', () => {
  assert.equal(buildCommunityMemberSearchIndexProjection({
    communityId: 'community-1',
    memberId: 'uid-1',
    rawMembership: { status: 'left' },
    rawPublicProfile: {
      profileId,
      nickname: 'Alex',
    },
    nowMs: 1_000,
  }), null);

  assert.equal(buildCommunityMemberSearchIndexProjection({
    communityId: 'community-1',
    memberId: 'uid-1',
    rawMembership: { status: 'active' },
    rawPublicProfile: {
      profileId: 'invalid-profile-id',
      nickname: 'Alex',
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

test('exclui da busca de membros qualquer uma das 21 chaves privadas, inclusive null', () => {
  const clean = { profileId, nickname: 'Perfil seguro' };
  assert.equal(isCurrentCommunityMemberSearchPublicProfile(clean), true);
  for (const key of PRIVATE_DISCOVERY_INTEREST_FIELDS) {
    const contaminated = { ...clean, [key]: null };
    assert.equal(isCurrentCommunityMemberSearchPublicProfile(contaminated), false, key);
    assert.equal(buildCommunityMemberSearchIndexProjection({
      communityId: 'community-1', memberId: 'uid-1',
      rawMembership: { status: 'active' }, rawPublicProfile: contaminated,
    }), null, key);
    assert.notEqual(
      communityMemberSearchPublicProfileFingerprint(clean),
      communityMemberSearchPublicProfileFingerprint(contaminated), key
    );
  }
});

test('fingerprint nunca incorpora valores privados e volta ao estado limpo', () => {
  const clean = { profileId, nickname: 'Perfil seguro' };
  const unsafe = { ...clean, interestedInGenders: ['nao-vazar-valor'] };
  const initial = communityMemberSearchPublicProfileFingerprint(clean);
  const quarantined = communityMemberSearchPublicProfileFingerprint(unsafe);
  assert.notEqual(initial, quarantined);
  assert.equal(quarantined.includes('nao-vazar-valor'), false);
  assert.equal(communityMemberSearchPublicProfileFingerprint(clean), initial);
});
