import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicProfileDiscoveryProjectionMatches,
} from './public-profile-discovery-projection';
import { normalizePublicProfileDescription } from './public-profile-description';
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

test('normaliza descrição pública mantendo parágrafos', () => {
  assert.equal(
    normalizePublicProfileDescription(
      '  Primeiro   parágrafo.\r\n\r\n\r\nSegundo\tparágrafo.  '
    ),
    'Primeiro parágrafo.\n\nSegundo parágrafo.'
  );
  assert.equal(normalizePublicProfileDescription('   '), null);
  assert.equal(normalizePublicProfileDescription(null), null);
});

test('limita descrição pública ao volume permitido', () => {
  const normalized = normalizePublicProfileDescription('a'.repeat(1200));
  assert.equal(normalized?.length, 1000);
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
