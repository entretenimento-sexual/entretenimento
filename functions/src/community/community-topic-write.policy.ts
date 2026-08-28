// functions/src/community/community-topic-write.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPIC WRITE POLICY
// -----------------------------------------------------------------------------
// Rate limit e audiência efetiva sem acessar Firebase. A audiência final segue
// a visibilidade da Comunidade; o autor não escolhe isso por Tópico.
// -----------------------------------------------------------------------------

import type { CommunityTopicAudience } from './community-topic.model';

export type CommunityTopicWriteKind = 'topic' | 'reply';

export interface CommunityTopicRateWindowDecision {
  allowed: boolean;
  windowStartedAt: number;
  nextCount: number;
}

const WINDOW_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TOPIC_LIMIT = 12;
const DEFAULT_REPLY_LIMIT = 120;

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

  return kind === 'topic'
    ? normalizePositiveInteger(
      config['maxTopicCreationsPer24h'],
      DEFAULT_TOPIC_LIMIT,
      1,
      100
    )
    : normalizePositiveInteger(
      config['maxTopicRepliesPer24h'],
      DEFAULT_REPLY_LIMIT,
      1,
      1_000
    );
}

export function evaluateCommunityTopicRateWindow(
  rawState: unknown,
  kind: CommunityTopicWriteKind,
  now: number,
  limit: number
): CommunityTopicRateWindowDecision {
  const state = (rawState ?? {}) as Record<string, unknown>;
  const startKey = kind === 'topic'
    ? 'topicWindowStartedAt'
    : 'replyWindowStartedAt';
  const countKey = kind === 'topic'
    ? 'topicWritesInWindow'
    : 'replyWritesInWindow';
  const currentStart = normalizeTimestamp(state[startKey]);
  const withinWindow = currentStart !== null
    && now >= currentStart
    && now - currentStart < WINDOW_MS;
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
