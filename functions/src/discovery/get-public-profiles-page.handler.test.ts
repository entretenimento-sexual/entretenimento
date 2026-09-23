import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isCurrentPublicProfileAgeProjection,
  serializePublicProfileForDiscovery,
} from './get-public-profiles-page.handler';

const NOW = 1_800_000_000_000;

function profile(overrides: Record<string, unknown> = {}) {
  return {
    nickname: 'Perfil adulto',
    ageEligibilityVerifiedAdult: true,
    ageEligibilityValidUntil: {
      toMillis: () => NOW + 60_000,
    },
    updatedAt: {
      toMillis: () => NOW - 1_000,
    },
    ...overrides,
  };
}

describe('get-public-profiles-page temporal boundary', () => {
  it('aceita somente projeção adulta ainda vigente no relógio do backend', () => {
    assert.equal(
      isCurrentPublicProfileAgeProjection(profile(), NOW),
      true
    );
    assert.equal(
      isCurrentPublicProfileAgeProjection(
        profile({
          ageEligibilityValidUntil: { toMillis: () => NOW },
        }),
        NOW
      ),
      false
    );
    assert.equal(
      isCurrentPublicProfileAgeProjection(
        profile({
          ageEligibilityValidUntil: { toMillis: () => NOW - 1 },
        }),
        NOW
      ),
      false
    );
  });

  it('falha fechado quando o booleano ou validUntil não estão íntegros', () => {
    assert.equal(
      isCurrentPublicProfileAgeProjection(
        profile({ ageEligibilityVerifiedAdult: false }),
        NOW
      ),
      false
    );
    assert.equal(
      isCurrentPublicProfileAgeProjection(
        profile({ ageEligibilityValidUntil: null }),
        NOW
      ),
      false
    );
  });

  it('serializa somente perfil vigente e não reprojeta idade exata legada', () => {
    const serialized = serializePublicProfileForDiscovery(
      'profile-1',
      profile({ age: 41, idade: 42 }),
      NOW
    );

    assert.ok(serialized);
    assert.equal(serialized['uid'], 'profile-1');
    assert.equal(serialized['age'], null);
    assert.equal(serialized['ageEligibilityVerifiedAdult'], true);
    assert.equal(serialized['ageEligibilityValidUntil'], NOW + 60_000);
  });

  it('não serializa perfil temporalmente expirado', () => {
    const serialized = serializePublicProfileForDiscovery(
      'profile-expired',
      profile({
        ageEligibilityValidUntil: { toMillis: () => NOW - 1 },
      }),
      NOW
    );

    assert.equal(serialized, null);
  });
});
