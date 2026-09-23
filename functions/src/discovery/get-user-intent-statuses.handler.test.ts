import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isCurrentUserIntentStatusExposure,
  serializeUserIntentStatusForDiscovery,
  userIntentStatusReadRateLimitCost,
} from './get-user-intent-statuses.handler';

const NOW = 1_800_000_000_000;

function status(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'status-owner',
    profile: {
      uid: 'status-owner',
      nickname: 'Pessoa adulta',
      photoURL: 'https://example.com/avatar.webp',
      age: 42,
    },
    availability: 'available_now',
    visibility: 'public_discovery',
    destination: {
      kind: 'region',
      label: 'Centro',
      venueId: null,
      region: { uf: 'RJ', city: 'rio de janeiro' },
    },
    moderation: { state: 'active' },
    startsAt: NOW - 60_000,
    expiresAt: NOW + 60_000,
    ageEligibilityAdultAccessAllowed: true,
    ageEligibilityValidUntil: {
      toMillis: () => NOW + 60_000,
    },
    createdAt: { toMillis: () => NOW - 120_000 },
    updatedAt: { toMillis: () => NOW - 30_000 },
    ...overrides,
  };
}

describe('get-user-intent-statuses backend-time boundary', () => {
  it('aceita somente status e elegibilidade adulta ainda vigentes', () => {
    assert.equal(isCurrentUserIntentStatusExposure(status(), NOW), true);

    assert.equal(
      isCurrentUserIntentStatusExposure(
        status({ expiresAt: NOW }),
        NOW
      ),
      false
    );

    assert.equal(
      isCurrentUserIntentStatusExposure(
        status({
          ageEligibilityValidUntil: { toMillis: () => NOW },
        }),
        NOW
      ),
      false
    );
  });

  it('falha fechado para projeção etária ausente, inválida ou não adulta', () => {
    assert.equal(
      isCurrentUserIntentStatusExposure(
        status({ ageEligibilityAdultAccessAllowed: false }),
        NOW
      ),
      false
    );

    assert.equal(
      isCurrentUserIntentStatusExposure(
        status({ ageEligibilityValidUntil: null }),
        NOW
      ),
      false
    );

    assert.equal(
      isCurrentUserIntentStatusExposure(
        status({ visibility: 'friends_only' }),
        NOW
      ),
      false
    );
  });

  it('serializa somente o mínimo público e não reprojeta idade exata', () => {
    const serialized = serializeUserIntentStatusForDiscovery(
      'current_status-owner',
      status(),
      NOW
    );

    assert.ok(serialized);
    assert.equal(serialized['uid'], 'status-owner');
    assert.equal(
      (serialized['profile'] as Record<string, unknown>)['age'],
      null
    );
    assert.equal(
      (serialized['moderation'] as Record<string, unknown>)['state'],
      'active'
    );
  });

  it('não serializa status cujo validUntil etário venceu sem nova escrita', () => {
    const serialized = serializeUserIntentStatusForDiscovery(
      'current_status-owner',
      status({
        ageEligibilityValidUntil: { toMillis: () => NOW - 1 },
      }),
      NOW
    );

    assert.equal(serialized, null);
  });

  it('pondera a quota pela quantidade máxima de itens solicitados', () => {
    assert.equal(userIntentStatusReadRateLimitCost(24), 1);
    assert.equal(userIntentStatusReadRateLimitCost(48), 2);
    assert.equal(userIntentStatusReadRateLimitCost(60), 3);
  });
});
