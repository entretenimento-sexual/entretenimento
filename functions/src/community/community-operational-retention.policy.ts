// functions/src/community/community-operational-retention.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OPERATIONAL RETENTION
// -----------------------------------------------------------------------------
// Idempotency receipts are operational fences, not durable evidence. They need
// to survive long enough for realistic retries, but must not grow forever.
// High-volume content requests use a shorter window than administrative actions.
// Durable audit/evidence collections are intentionally outside this policy.
// -----------------------------------------------------------------------------

export const COMMUNITY_OPERATIONAL_RETENTION_POLICY_VERSION = 1;

export type CommunityOperationalRetentionClass =
  | 'high_volume_idempotency'
  | 'administrative_idempotency';

export type CommunityOperationalRequestKind =
  | 'creation'
  | 'venue_creation'
  | 'official_claim'
  | 'settings'
  | 'lifecycle'
  | 'highlight'
  | 'feed'
  | 'topic';

export const COMMUNITY_OPERATIONAL_REQUEST_RETENTION_DAYS = Object.freeze({
  high_volume_idempotency: 7,
  administrative_idempotency: 30,
} satisfies Readonly<Record<CommunityOperationalRetentionClass, number>>);

export const COMMUNITY_OPERATIONAL_REQUEST_COLLECTIONS = Object.freeze({
  community_creation_requests: 'administrative_idempotency',
  venue_community_creation_requests: 'administrative_idempotency',
  community_official_claim_requests: 'administrative_idempotency',
  community_settings_requests: 'administrative_idempotency',
  community_lifecycle_requests: 'administrative_idempotency',
  community_highlight_requests: 'administrative_idempotency',
  community_feed_requests: 'high_volume_idempotency',
  community_topic_requests: 'high_volume_idempotency',
} satisfies Readonly<Record<string, CommunityOperationalRetentionClass>>);

const DAY_MS = 24 * 60 * 60 * 1_000;

function retentionClassForKind(
  kind: CommunityOperationalRequestKind
): CommunityOperationalRetentionClass {
  return kind === 'feed' || kind === 'topic'
    ? 'high_volume_idempotency'
    : 'administrative_idempotency';
}

export function buildCommunityOperationalRequestRetention(
  kind: CommunityOperationalRequestKind,
  now: number
): Readonly<{
  retentionPolicyVersion: 1;
  retentionClass: CommunityOperationalRetentionClass;
  expiresAt: Date;
}> {
  const safeNow = Number.isFinite(now) && now > 0
    ? Math.trunc(now)
    : Date.now();
  const retentionClass = retentionClassForKind(kind);
  const retentionDays =
    COMMUNITY_OPERATIONAL_REQUEST_RETENTION_DAYS[retentionClass];

  return Object.freeze({
    retentionPolicyVersion: COMMUNITY_OPERATIONAL_RETENTION_POLICY_VERSION,
    retentionClass,
    expiresAt: new Date(safeNow + retentionDays * DAY_MS),
  });
}
