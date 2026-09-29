import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPublicPreferenceProjection,
} from './public-preference-projection';

function profile(overrides: Record<string, unknown> = {}) {
  return {
    relationshipIntents: ['serious'],
    hardRules: {
      acceptedRelationshipIntents: ['serious', 'dating'],
    },
    softRules: {
      sexualPractices: ['bdsm', 'tantra'],
      bodyPreferences: ['curvy'],
    },
    selfTraits: {
      bodyTraits: ['tattoos'],
    },
    visibility: {
      showPreferenceBadges: true,
    },
    ...overrides,
  };
}

describe('public preference projection', () => {
  it('fecha toda a projeção quando o usuário não autoriza badges públicos', () => {
    assert.deepEqual(
      buildPublicPreferenceProjection(
        profile({
          visibility: { showPreferenceBadges: false },
        }),
        { canPublishAdvanced: true }
      ),
      {
        preferenceBadgesVisible: false,
        publicRelationshipIntents: [],
        publicSexualPractices: [],
        publicBodyTraits: [],
      }
    );
  });

  it('publica apenas sinais sanitizados e não transforma preferência procurada em traço próprio', () => {
    const projection = buildPublicPreferenceProjection(
      profile(),
      { canPublishAdvanced: true }
    );

    assert.deepEqual(
      projection.publicRelationshipIntents,
      ['serious', 'dating']
    );
    assert.deepEqual(
      projection.publicSexualPractices,
      ['bdsm', 'tantra']
    );
    assert.deepEqual(
      projection.publicBodyTraits,
      ['tattoos']
    );
    assert.equal(
      projection.publicBodyTraits.includes('curvy'),
      false
    );
  });

  it('não publica práticas avançadas sem entitlement, mas preserva sinais essenciais autorizados', () => {
    const projection = buildPublicPreferenceProjection(
      profile(),
      { canPublishAdvanced: false }
    );

    assert.deepEqual(
      projection.publicRelationshipIntents,
      ['serious', 'dating']
    );
    assert.deepEqual(projection.publicSexualPractices, []);
    assert.deepEqual(projection.publicBodyTraits, ['tattoos']);
  });

  it('remove valores fora dos catálogos públicos', () => {
    const projection = buildPublicPreferenceProjection(
      profile({
        hardRules: {
          acceptedRelationshipIntents: ['serious', 'private-token'],
        },
        softRules: {
          sexualPractices: ['bdsm', 'private-token'],
          bodyPreferences: [],
        },
        selfTraits: {
          bodyTraits: ['tattoos', 'private-token'],
        },
      }),
      { canPublishAdvanced: true }
    );

    assert.deepEqual(projection.publicRelationshipIntents, ['serious']);
    assert.deepEqual(projection.publicSexualPractices, ['bdsm']);
    assert.deepEqual(projection.publicBodyTraits, ['tattoos']);
  });
});
