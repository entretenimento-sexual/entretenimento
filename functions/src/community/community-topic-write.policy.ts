// functions/src/community/community-topic-write.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPIC WRITE POLICY
// -----------------------------------------------------------------------------
// Quota funcional e audiência efetiva sem acessar Firebase. A audiência final
// segue a visibilidade da Comunidade; o autor não escolhe isso por Tópico.
// Os valores moduláveis de produto ficam em community-product-limits.config.ts.
// -----------------------------------------------------------------------------

import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';
import type { CommunityTopicAudience } from './community-topic.model';

export type CommunityTopicWriteKind = 'topic' | 'reply';

export interface CommunityTopicRateWindowDecision {
  allowed: boolean;
  windowStartedAt: number;
  nextCount: number;
}

const TOPIC_CREATION_QUOTA =
  COMMUNITY_PRODUCT_LIMITS.contentWriteQuotas.topicCreations;
const TOPIC_REPLY_QUOTA = COMMUNITY_PRODUCT_LIMITS.contentWriteQuotas.topicReplies;

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function resolveCommunityTopicQuota(kind: CommunityTopicWriteKind) {
  return kind === 'topic' ? TOPIC_CREATION_QUOTA : TOPIC_REPLY_QUOTA;
}

export function resolveCommunityTopicAudience(
  communityVisibility: unknown
): CommunityTopicAudience {
  return communityVisibility === 'public_preview'
    ? 'public_preview'
    : 'members_only';
}

export function resolveCommunityTopicWriteLimit(
  rawConfig: unknown,
  kind: CommunityTopicWriteKind
): number {
  const config = (rawConfig ?? {}) as Record<string, unknown>;
  const quota = resolveCommunityTopicQuota(kind);
  const configKey = kind === 'topic'
    ? 'maxTopicCreationsPer24h'
    : 'maxTopicRepliesPer24h';

  return normalizePositiveInteger(
    config[configKey],
    quota.defaultLimit,
    quota.minLimit,
    quota.maxLimit
  );
}

export function evaluateCommunityTopicRateWindow(
  rawState: unknown,
  kind: CommunityTopicWriteKind,
  now: number,
  limit: number
): CommunityTopicRateWindowDecision {
  const state = (rawState ?? {}) as Record<string, unknown>;
  const quota = resolveCommunityTopicQuota(kind);
  const startKey = kind === 'topic'
    ? 'topicWindowStartedAt'
    : 'replyWindowStartedAt';
  const countKey = kind === 'topic'
    ? 'topicWritesInWindow'
    : 'replyWritesInWindow';
  const currentStart = normalizeTimestamp(state[startKey]);
  const withinWindow = currentStart !== null
    && now >= currentStart
    && now - currentStart < quota.windowMs;
  const currentCount = withinWindow ? normalizeCount(state[countKey]) : 0;

  if (currentCount >= limit) {
    return {
      allowed: false,
      windowStartedAt: currentStart ?? now,
      nextCount: currentCount,
    };
  }

  return {
    allowed: true,
    windowStartedAt: withinWindow && currentStart !== null ? currentStart : now,
    nextCount: currentCount + 1,
  };
}
