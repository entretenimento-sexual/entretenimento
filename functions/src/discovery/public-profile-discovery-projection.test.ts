import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublicAvatarProjection,
  buildPublicLocationProjection,
  buildPublicProfileIdProjection,
  publicAvatarProjectionMatches,
  publicLocationProjectionMatches,
  publicProfileDiscoveryProjectionMatches,
  publicProfileIdProjectionMatches,
} from './public-profile-discovery-projection';
import {
  buildPublicPreferenceProjection,
  publicPreferenceProjectionMatches,
} from './public-preference-projection';

const CANONICAL = {
  normalizedGender: 'woman' as const,
  normalizedOrientation: 'bisexual' as const,
  interestedInGenders: ['man', 'woman'] as const,
  interestedInOrientations: ['heterosexual', 'bisexual'] as const,
  compatibilityReady: true,
};

const PUBLIC_PROFILE_ID = 'profile-123e4567-e89b-42d3-a456-426614174000';

test('ignora billing quando discovery já está sincronizado', () => {
  assert.equal(publicProfileDiscoveryProjectionMatches({
    ...CANONICAL,
    role: 'premium',
    billingProjectionVersion: 1,
  }, CANONICAL), true);
});

test('detecta alteração real de compatibilidade', () => {
  assert.equal(publicProfileDiscoveryProjectionMatches({
    ...CANONICAL,
    normalizedGender: 'man',
  }, CANONICAL), false);
  assert.equal(publicProfileDiscoveryProjectionMatches({
    ...CANONICAL,
    interestedInGenders: ['woman', 'man'],
  }, CANONICAL), false);
});

test('detecta projeção ausente para backfill', () => {
  assert.equal(publicProfileDiscoveryProjectionMatches({}, CANONICAL), false);
});

test('projeta profileId público sem usar UID como fallback', () => {
  assert.deepEqual(buildPublicProfileIdProjection({
    profileId: PUBLIC_PROFILE_ID,
    uid: 'firebase-auth-uid',
  }), {
    profileId: PUBLIC_PROFILE_ID,
  });

  assert.deepEqual(buildPublicProfileIdProjection({
    uid: 'firebase-auth-uid',
  }), {
    profileId: null,
  });
});

test('normaliza e compara somente profileId público válido', () => {
  const expected = buildPublicProfileIdProjection({
    profileId: PUBLIC_PROFILE_ID.toUpperCase(),
  });

  assert.deepEqual(expected, { profileId: PUBLIC_PROFILE_ID });
  assert.equal(publicProfileIdProjectionMatches({
    profileId: PUBLIC_PROFILE_ID,
    uid: 'internal-id',
  }, expected), true);
  assert.equal(publicProfileIdProjectionMatches({
    profileId: 'internal-id',
  }, expected), false);
});

test('projeta photoURL legado como avatar público canônico', () => {
  const projection = buildPublicAvatarProjection({
    photoURL: 'https://cdn.example.test/avatar.jpg',
  });

  assert.deepEqual(projection, {
    avatarUrl: 'https://cdn.example.test/avatar.jpg',
    photoURL: 'https://cdn.example.test/avatar.jpg',
  });
});

test('prefere avatarUrl canônico quando os dois campos existem', () => {
  const projection = buildPublicAvatarProjection({
    avatarUrl: 'https://cdn.example.test/canonical.jpg',
    photoURL: 'https://cdn.example.test/legacy.jpg',
  });

  assert.deepEqual(projection, {
    avatarUrl: 'https://cdn.example.test/canonical.jpg',
    photoURL: 'https://cdn.example.test/canonical.jpg',
  });
});

test('não publica avatar inseguro e detecta projeção divergente', () => {
  const projection = buildPublicAvatarProjection({
    photoURL: 'http://cdn.example.test/avatar.jpg',
  });

  assert.deepEqual(projection, {
    avatarUrl: null,
    photoURL: null,
  });
  assert.equal(publicAvatarProjectionMatches({
    avatarUrl: 'https://cdn.example.test/old.jpg',
    photoURL: 'https://cdn.example.test/old.jpg',
  }, projection), false);
  assert.equal(publicAvatarProjectionMatches(projection, projection), true);
});

test('projeta localização free com precisão pública reduzida', () => {
  const projection = buildPublicLocationProjection({
    latitude: -22.9309,
    longitude: -43.3536,
    role: 'free',
    emailVerified: true,
  });

  assert.deepEqual(projection, {
    latitude: -22.93,
    longitude: -43.35,
    geohash: '75cjt',
  });
});

test('mantém política mais precisa para premium verificado', () => {
  const projection = buildPublicLocationProjection({
    latitude: -22.93091,
    longitude: -43.35364,
    role: 'premium',
    emailVerified: true,
  });

  assert.equal(projection.latitude, -22.9309);
  assert.equal(projection.longitude, -43.3536);
  assert.equal(projection.geohash?.length, 8);
});

test('reduz localização de conta não verificada ao limite conservador', () => {
  const projection = buildPublicLocationProjection({
    latitude: 42.6,
    longitude: -5.6,
    role: 'vip',
    emailVerified: false,
  });

  assert.deepEqual(projection, {
    latitude: 42.6,
    longitude: -5.6,
    geohash: 'ezs42',
  });
});

test('remove coordenada sentinela 0,0 da projeção pública', () => {
  const projection = buildPublicLocationProjection({
    latitude: 0,
    longitude: 0,
    role: 'free',
    emailVerified: true,
  });

  assert.deepEqual(projection, {
    latitude: null,
    longitude: null,
    geohash: null,
  });
});

test('compara localização pública sem considerar campos não relacionados', () => {
  const expected = buildPublicLocationProjection({
    latitude: -22.9309,
    longitude: -43.3536,
    role: 'free',
    emailVerified: true,
  });

  assert.equal(publicLocationProjectionMatches({
    ...expected,
    mediaCount: 12,
  }, expected), true);

  assert.equal(publicLocationProjectionMatches({
    ...expected,
    longitude: -43.34,
  }, expected), false);
});

test('não publica sinais quando o usuário desativa badges', () => {
  assert.deepEqual(buildPublicPreferenceProjection({
    visibility: { showPreferenceBadges: false },
    relationshipIntents: ['dating'],
    selfTraits: { bodyTraits: ['tattoos'] },
  }, { canPublishAdvanced: true }), {
    preferenceBadgesVisible: false,
    publicRelationshipIntents: [],
    publicSexualPractices: [],
    publicBodyTraits: [],
  });
});

test('separa características próprias das características procuradas', () => {
  const projection = buildPublicPreferenceProjection({
    visibility: { showPreferenceBadges: true },
    hardRules: { acceptedRelationshipIntents: ['dating'] },
    softRules: {
      sexualPractices: ['bdsm'],
      bodyPreferences: ['athletic'],
    },
    selfTraits: { bodyTraits: ['curvy', 'tattoos'] },
  }, { canPublishAdvanced: true });

  assert.deepEqual(projection.publicRelationshipIntents, ['dating']);
  assert.deepEqual(projection.publicSexualPractices, ['bdsm']);
  assert.deepEqual(projection.publicBodyTraits, ['curvy', 'tattoos']);
  assert.equal('publicBodyPreferences' in projection, false);
});

test('plano gratuito não publica práticas pagas, mas mantém autodescrição', () => {
  const projection = buildPublicPreferenceProjection({
    visibility: { showPreferenceBadges: true },
    softRules: { sexualPractices: ['bdsm'] },
    selfTraits: { bodyTraits: ['tattoos'] },
  }, { canPublishAdvanced: false });

  assert.deepEqual(projection.publicSexualPractices, []);
  assert.deepEqual(projection.publicBodyTraits, ['tattoos']);
});

test('compara a projeção pública sem considerar campos não relacionados', () => {
  const expected = buildPublicPreferenceProjection({
    visibility: { showPreferenceBadges: true },
    relationshipIntents: ['friendship'],
    selfTraits: { bodyTraits: ['beard'] },
  }, { canPublishAdvanced: false });

  assert.equal(publicPreferenceProjectionMatches({
    ...expected,
    mediaCount: 12,
  }, expected), true);
});
