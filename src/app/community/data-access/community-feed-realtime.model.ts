// src/app/community/data-access/community-feed-realtime.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED REALTIME CLIENT MODEL
// -----------------------------------------------------------------------------
// Contrato mínimo do stream Firestore. Nunca contém conteúdo integral, UID,
// audiência, storage path, URL de mídia ou capacidades do viewer.
// -----------------------------------------------------------------------------

import type { CommunityFeedKind } from './community-feed.model';

export type CommunityFeedRealtimeState = 'active' | 'removed';
export type CommunityFeedRealtimeChangeType = 'added' | 'modified' | 'removed';

export interface CommunityFeedRealtimeProjection {
  readonly postId: string;
  readonly kind: CommunityFeedKind;
  readonly state: CommunityFeedRealtimeState;
  readonly metrics: {
    readonly commentCount: number;
    readonly reactionCount: number;
  };
  readonly publishedAt: number;
  readonly eventAt: number;
}

export interface CommunityFeedRealtimeChange {
  readonly type: CommunityFeedRealtimeChangeType;
  readonly projection: CommunityFeedRealtimeProjection;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MIN_TIMESTAMP = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

function normalizeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.trunc(parsed), 0), 1_000_000_000)
    : 0;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };
    if (typeof source.toMillis === 'function') {
      const time = Number(source.toMillis());
      return Number.isFinite(time) ? Math.trunc(time) : null;
    }
    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      return Math.trunc(seconds * 1_000 + nanoseconds / 1_000_000);
    }
  }

  return null;
}

export function normalizeCommunityFeedRealtimeProjection(
  documentId: string,
  raw: unknown,
  now = Date.now()
): CommunityFeedRealtimeProjection | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const metrics = (source['metrics'] ?? {}) as Record<string, unknown>;
  const postId = String(documentId ?? '').trim();
  const declaredPostId = String(source['postId'] ?? '').trim();
  const kind = source['kind'];
  const state = source['state'];
  const publishedAt = normalizeTimestamp(source['publishedAt']);
  const eventAt = normalizeTimestamp(source['eventAt']);

  if (
    !SAFE_ID_PATTERN.test(postId)
    || declaredPostId !== postId
    || (kind !== 'text' && kind !== 'photo')
    || (state !== 'active' && state !== 'removed')
    || publishedAt === null
    || publishedAt < MIN_TIMESTAMP
    || publishedAt > now + MAX_FUTURE_SKEW_MS
    || eventAt === null
    || eventAt < MIN_TIMESTAMP
    || eventAt > now + MAX_FUTURE_SKEW_MS
  ) {
    return null;
  }

  return {
    postId,
    kind,
    state,
    metrics: {
      commentCount: normalizeCount(metrics['commentCount']),
      reactionCount: normalizeCount(metrics['reactionCount']),
    },
    publishedAt,
    eventAt,
  };
}

function sameProjection(
  left: CommunityFeedRealtimeProjection,
  right: CommunityFeedRealtimeProjection
): boolean {
  return left.postId === right.postId
    && left.kind === right.kind
    && left.state === right.state
    && left.metrics.commentCount === right.metrics.commentCount
    && left.metrics.reactionCount === right.metrics.reactionCount
    && left.publishedAt === right.publishedAt
    && left.eventAt === right.eventAt;
}

export function diffCommunityFeedRealtimeProjections(
  previous: readonly CommunityFeedRealtimeProjection[],
  current: readonly CommunityFeedRealtimeProjection[]
): CommunityFeedRealtimeChange[] {
  const previousById = new Map(previous.map((item) => [item.postId, item]));
  const changes: CommunityFeedRealtimeChange[] = [];

  for (const projection of current) {
    const prior = previousById.get(projection.postId);
    if (!prior) {
      changes.push({ type: 'added', projection });
    } else if (!sameProjection(prior, projection)) {
      changes.push({ type: 'modified', projection });
    }
  }

  // Não emitimos `removed` ao sair da janela `limit`: isso pode ser apenas
  // eviction do query. Remoções reais chegam por tombstone `state: removed`.
  // O tipo `removed` fica reservado para uma futura fonte que consiga provar
  // exclusão física sem ambiguidade.
  return changes;
}
