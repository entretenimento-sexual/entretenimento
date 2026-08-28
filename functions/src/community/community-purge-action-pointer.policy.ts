// functions/src/community/community-purge-action-pointer.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE - ACTION POINTER RECOVERY
// -----------------------------------------------------------------------------
// Deriva somente os ponteiros privados criados por remoção administrativa de
// publicação após revisão de denúncia. A função é pura para que o purge/trigger
// não precise confiar em campos incompletos ou em IDs não normalizados.
// -----------------------------------------------------------------------------

export interface CommunityFeedActionPointerTarget {
  readonly actorUid: string;
  readonly postId: string;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

export function resolveCommunityFeedActionPointerFromModerationReport(
  rawReport: unknown,
  expectedCommunityIdValue: unknown
): CommunityFeedActionPointerTarget | null {
  const report = (rawReport ?? {}) as Record<string, unknown>;
  const expectedCommunityId = cleanId(expectedCommunityIdValue);
  const parentTargetId = cleanId(report['parentTargetId']);
  const actorUid = cleanId(report['reviewedBy']);
  const postId = cleanId(report['targetId']);
  const status = String(report['status'] ?? '').trim().toLowerCase();
  const moderationAction = String(report['moderationAction'] ?? '')
    .trim()
    .toUpperCase();

  if (
    !expectedCommunityId
    || parentTargetId !== expectedCommunityId
    || report['targetType'] !== 'community_feed_post'
    || status !== 'resolved'
    || moderationAction !== 'REMOVE'
    || !actorUid
    || !postId
  ) {
    return null;
  }

  return { actorUid, postId };
}
