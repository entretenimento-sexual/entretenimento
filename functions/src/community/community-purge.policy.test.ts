import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_COMMUNITY_PURGE_GRACE_DAYS,
  evaluateCommunityPurgeEligibility,
  resolveCommunityPurgeGraceDays,
} from './community-purge.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 7, 27, 5, 0, 0);

function buildCommunity(overrides: Record<string, unknown> = {}) {
  const base = {
    source: { type: 'community', id: 'community-1' },
    status: 'scheduled_for_deletion',
    moderation: {
      state: 'active',
      retentionHold: false,
      legalHold: false,
    },
    metrics: {
      memberCount: 0,
      postCount: 0,
      mediaCount: 0,
      topicCount: 0,
    },
    lifecycle: {
      scheduledForDeletionAt:
        NOW - (DEFAULT_COMMUNITY_PURGE_GRACE_DAYS + 1) * DAY_MS,
      retentionHold: false,
      hold: false,
    },
    legalHold: false,
  };

  return {
    ...base,
    ...overrides,
  };
}

test('community purge rejects venues and unscheduled communities', () => {
  const venue = evaluateCommunityPurgeEligibility(
    buildCommunity({ source: { type: 'venue', id: 'venue-1' } }),
    NOW
  );
  const active = evaluateCommunityPurgeEligibility(
    buildCommunity({ status: 'active' }),
    NOW
  );

  assert.equal(venue.eligible, false);
  assert.equal(venue.reason, 'not_community');
  assert.equal(active.eligible, false);
  assert.equal(active.reason, 'status_not_scheduled');
});

test('community purge fails closed for holds and unreliable member count', () => {
  const held = evaluateCommunityPurgeEligibility(
    buildCommunity({
      moderation: {
        state: 'active',
        retentionHold: true,
        legalHold: false,
      },
    }),
    NOW
  );
  const unknownMembers = evaluateCommunityPurgeEligibility(
    buildCommunity({
      metrics: {
        postCount: 0,
        mediaCount: 0,
        topicCount: 0,
      },
    }),
    NOW
  );
  const membersPresent = evaluateCommunityPurgeEligibility(
    buildCommunity({
      metrics: {
        memberCount: 1,
        postCount: 0,
        mediaCount: 0,
        topicCount: 0,
      },
    }),
    NOW
  );

  assert.equal(held.reason, 'lifecycle_hold');
  assert.equal(unknownMembers.reason, 'member_count_unknown');
  assert.equal(membersPresent.reason, 'members_present');
});

test('community purge requires a schedule anchor and full grace period', () => {
  const missingAnchor = evaluateCommunityPurgeEligibility(
    buildCommunity({
      lifecycle: {
        scheduledForDeletionAt: null,
        retentionHold: false,
        hold: false,
      },
    }),
    NOW
  );
  const withinGrace = evaluateCommunityPurgeEligibility(
    buildCommunity({
      lifecycle: {
        scheduledForDeletionAt: NOW - 10 * DAY_MS,
        retentionHold: false,
        hold: false,
      },
    }),
    NOW
  );

  assert.equal(missingAnchor.reason, 'missing_schedule_anchor');
  assert.equal(withinGrace.reason, 'grace_period');
  assert.equal(withinGrace.purgeEligibleAt, NOW + 20 * DAY_MS);
});

test('community purge blocks pending moderation references after grace', () => {
  const decision = evaluateCommunityPurgeEligibility(
    buildCommunity(),
    NOW,
    DEFAULT_COMMUNITY_PURGE_GRACE_DAYS,
    { hasBlockingModerationReference: true }
  );

  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'moderation_reference_hold');
});

test('community purge becomes eligible only after every invariant is satisfied', () => {
  const decision = evaluateCommunityPurgeEligibility(buildCommunity(), NOW);

  assert.equal(decision.eligible, true);
  assert.equal(decision.reason, 'eligible');
  assert.equal(
    decision.purgeEligibleAt,
    NOW - DAY_MS
  );
});

test('community purge grace config is bounded and defaults safely', () => {
  assert.equal(resolveCommunityPurgeGraceDays(null), 30);
  assert.equal(resolveCommunityPurgeGraceDays({ lifecyclePurgeGraceDays: 3 }), 7);
  assert.equal(resolveCommunityPurgeGraceDays({ lifecyclePurgeGraceDays: 45 }), 45);
  assert.equal(resolveCommunityPurgeGraceDays({ lifecyclePurgeGraceDays: 999 }), 365);
});
