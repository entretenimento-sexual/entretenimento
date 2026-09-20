import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_OPERATIONAL_REQUEST_COLLECTIONS,
  COMMUNITY_OPERATIONAL_REQUEST_RETENTION_DAYS,
  COMMUNITY_OPERATIONAL_RETENTION_POLICY_VERSION,
  buildCommunityOperationalRequestRetention,
} from './community-operational-retention.policy';

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

test('classifica todos os receipts idempotentes conhecidos por retenção finita', () => {
  assert.deepEqual(COMMUNITY_OPERATIONAL_REQUEST_COLLECTIONS, {
    community_creation_requests: 'administrative_idempotency',
    venue_community_creation_requests: 'administrative_idempotency',
    community_official_claim_requests: 'administrative_idempotency',
    community_settings_requests: 'administrative_idempotency',
    community_lifecycle_requests: 'administrative_idempotency',
    community_highlight_requests: 'administrative_idempotency',
    community_feed_requests: 'high_volume_idempotency',
    community_topic_requests: 'high_volume_idempotency',
  });
});

test('mantém conteúdo de alto volume por 7 dias e operações administrativas por 30', () => {
  for (const kind of ['feed', 'topic'] as const) {
    const retention = buildCommunityOperationalRequestRetention(kind, NOW);
    assert.equal(
      retention.retentionPolicyVersion,
      COMMUNITY_OPERATIONAL_RETENTION_POLICY_VERSION
    );
    assert.equal(retention.retentionClass, 'high_volume_idempotency');
    assert.equal(
      retention.expiresAt.getTime(),
      NOW
        + COMMUNITY_OPERATIONAL_REQUEST_RETENTION_DAYS.high_volume_idempotency
        * DAY_MS
    );
  }

  for (const kind of [
    'creation',
    'venue_creation',
    'official_claim',
    'settings',
    'lifecycle',
    'highlight',
  ] as const) {
    const retention = buildCommunityOperationalRequestRetention(kind, NOW);
    assert.equal(retention.retentionClass, 'administrative_idempotency');
    assert.equal(
      retention.expiresAt.getTime(),
      NOW
        + COMMUNITY_OPERATIONAL_REQUEST_RETENTION_DAYS.administrative_idempotency
        * DAY_MS
    );
  }
});
