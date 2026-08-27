// functions/src/community/community-feed-realtime.projection.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED REALTIME PROJECTION
// -----------------------------------------------------------------------------
// Evento mínimo consumível pelo navegador para sincronizar o Mural. Não contém
// texto, autor, UID, audiência, storage path, URL de mídia ou estado interno de
// moderação. Conteúdo completo continua hidratado por callable autorizada.
// -----------------------------------------------------------------------------

import {
  CommunityFeedKind,
  sanitizeCommunityFeedProjection,
} from './community-feed.model';

export type CommunityFeedRealtimeState = 'active' | 'removed';

export interface CommunityFeedRealtimeProjection {
  postId: string;
  kind: CommunityFeedKind;
  state: CommunityFeedRealtimeState;
  metrics: {
    commentCount: number;
    reactionCount: number;
  };
  publishedAt: number;
  eventAt: number;
}

export function buildCommunityFeedRealtimeProjection(
  postId: string,
  beforeRaw: unknown,
  afterRaw: unknown,
  now = Date.now()
): CommunityFeedRealtimeProjection | null {
  const after = sanitizeCommunityFeedProjection(postId, afterRaw, now);

  if (after) {
    return {
      postId: after.item.postId,
      kind: after.item.kind,
      state: 'active',
      metrics: { ...after.item.metrics },
      publishedAt: after.item.publishedAt,
      eventAt: now,
    };
  }

  const before = sanitizeCommunityFeedProjection(postId, beforeRaw, now);
  if (!before) return null;

  return {
    postId: before.item.postId,
    kind: before.item.kind,
    state: 'removed',
    metrics: { ...before.item.metrics },
    publishedAt: before.item.publishedAt,
    eventAt: now,
  };
}
