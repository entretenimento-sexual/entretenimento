import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  discoveryReadRateLimitCost,
  serializePublicProfileForDiscovery,
} from './get-public-profiles-page.handler';

const NOW = 1_800_000_000_000;

function profile(overrides: Record<string, unknown> = {}) {
  return {
    nickname: 'Perfil público',
    updatedAt: {
      toMillis: () => NOW - 1_000,
    },
    ...overrides,
  };
}

describe('get-public-profiles-page boundary', () => {
  it('serializa perfil público sem depender de assurance etário', () => {
    const serialized = serializePublicProfileForDiscovery(
      'profile-1',
      profile({
        age: 41,
        ageEligibilityVerifiedAdult: false,
        ageEligibilityValidUntil: null,
      }),
      NOW
    );

    assert.ok(serialized);
    assert.equal(serialized['uid'], 'profile-1');
    assert.equal(serialized['age'], 41);
    assert.equal('ageEligibilityVerifiedAdult' in serialized, false);
    assert.equal('ageEligibilityValidUntil' in serialized, false);
  });

  it('descarta idade social fora da faixa sem bloquear o perfil', () => {
    const serialized = serializePublicProfileForDiscovery(
      'profile-invalid-social-age',
      profile({ age: 17 }),
      NOW
    );

    assert.ok(serialized);
    assert.equal(serialized['age'], null);
  });

  it('exige apenas identidade pública mínima para serialização', () => {
    assert.equal(
      serializePublicProfileForDiscovery('', profile(), NOW),
      null
    );
    assert.equal(
      serializePublicProfileForDiscovery(
        'profile-no-nickname',
        profile({ nickname: '' }),
        NOW
      ),
      null
    );
  });

  it('dimensiona a quota de leitura proporcionalmente ao custo da consulta', () => {
    assert.equal(discoveryReadRateLimitCost({ pageSize: 24 }), 1);
    assert.equal(discoveryReadRateLimitCost({ pageSize: 48 }), 2);
    assert.equal(discoveryReadRateLimitCost({ pageSize: 120 }), 5);
    assert.equal(discoveryReadRateLimitCost({ uidCount: 25 }), 1);
    assert.equal(discoveryReadRateLimitCost({ uidCount: 50 }), 2);
    assert.equal(discoveryReadRateLimitCost({}), 1);
  });
});
