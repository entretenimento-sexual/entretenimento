// functions/src/community/community-purge.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_COMMUNITY_PURGE_GRACE_DAYS,
  evaluateCommunityPurgeReadiness,
} from './community-purge.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);
const SCHEDULED_AT = NOW - (DEFAULT_COMMUNITY_PURGE_GRACE_DAYS + 1) * DAY_MS;

function community(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    source: { type: 'community', id: 'community-1' },
    status: 'scheduled_for_deletion',
    ownerUid: '',
    moderation: { state: 'active' },
    metrics: { memberCount: 0 },
    lifecycle: {
      scheduledForDeletionAt: SCHEDULED_AT,
      retentionHold: false,
    },
    ...overrides,
  };
}

const emptyEvidence = {
  hasLiveMemberships: false,
  hasRetainedContent: false,
  hasModerationEvidence: false,
} as const;

test('vazio canônico libera purge mesmo com memberCount stale positivo', () => {
  const result = evaluateCommunityPurgeReadiness(
    community({ metrics: { memberCount: 12 } }),
    emptyEvidence,
    NOW
  );

  assert.equal(result.eligible, true);
  assert.equal(result.denialReason, null);
});

test('vazio canônico libera purge mesmo sem projeção de memberCount', () => {
  const result = evaluateCommunityPurgeReadiness(
    community({ metrics: {} }),
    emptyEvidence,
    NOW
  );

  assert.equal(result.eligible, true);
  assert.equal(result.denialReason, null);
});

test('membership canônico presente bloqueia purge com projeção em zero', () => {
  const result = evaluateCommunityPurgeReadiness(
    community(),
    {
      ...emptyEvidence,
      hasLiveMemberships: true,
    },
    NOW
  );

  assert.equal(result.eligible, false);
  assert.equal(result.denialReason, 'live_memberships_present');
});

test('probe canônico desconhecido permanece fail closed', () => {
  const result = evaluateCommunityPurgeReadiness(
    community(),
    {
      ...emptyEvidence,
      hasLiveMemberships: null,
    },
    NOW
  );

  assert.equal(result.eligible, false);
  assert.equal(result.denialReason, 'membership_probe_unknown');
});

test('motivos legados da projeção são preservados quando probe não confirma vazio', () => {
  const unknownCount = evaluateCommunityPurgeReadiness(
    community({ metrics: {} }),
    {
      ...emptyEvidence,
      hasLiveMemberships: null,
    },
    NOW
  );
  const projectedMembers = evaluateCommunityPurgeReadiness(
    community({ metrics: { memberCount: 4 } }),
    {
      ...emptyEvidence,
      hasLiveMemberships: null,
    },
    NOW
  );

  assert.equal(unknownCount.eligible, false);
  assert.equal(unknownCount.denialReason, 'member_count_unknown');
  assert.equal(projectedMembers.eligible, false);
  assert.equal(projectedMembers.denialReason, 'members_present');
});
