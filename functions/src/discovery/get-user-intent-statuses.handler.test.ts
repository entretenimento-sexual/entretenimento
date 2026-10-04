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
      nickname: 'Pessoa',
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
    createdAt: { toMillis: () => NOW - 120_000 },
    updatedAt: { toMillis: () => NOW - 30_000 },
    ...overrides,
  };
}

describe('get-user-intent-statuses backend-time boundary', () => {
  it('exige status vigente, ativo e publicamente descobrível', () => {
    assert.equal(isCurrentUserIntentStatusExposure(status(), NOW), true);

    assert.equal(
      isCurrentUserIntentStatusExposure(status({ expiresAt: NOW }), NOW),
      false
    );

    assert.equal(
      isCurrentUserIntentStatusExposure(
        status({ visibility: 'friends_only' }),
        NOW
      ),
      false
    );

    assert.equal(
      isCurrentUserIntentStatusExposure(
        status({ moderation: { state: 'hidden' } }),
        NOW
      ),
      false
    );
  });

  it('não usa campos etários legados como autoridade de exposição', () => {
    assert.equal(
      isCurrentUserIntentStatusExposure(
        status({
          ageEligibilityVerifiedAdult: false,
          ageEligibilityValidUntil: null,
        }),
        NOW
      ),
      true
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
    assert.equal('ageEligibilityValidUntil' in serialized, false);
  });

  it('pondera a quota pela quantidade máxima de itens solicitados', () => {
    assert.equal(userIntentStatusReadRateLimitCost(24), 1);
    assert.equal(userIntentStatusReadRateLimitCost(48), 2);
    assert.equal(userIntentStatusReadRateLimitCost(60), 3);
  });
});
