// functions/src/community/community-feed-activity.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED ACTIVITY POLICY
// -----------------------------------------------------------------------------
// A projeção do mural é backend-only. Apenas publicação válida/reativada ou
// crescimento real de interação renova o relógio de atividade da Comunidade.
// -----------------------------------------------------------------------------

const MAX_INTERACTION_DELTA_PER_WRITE = 1_000;

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function isActiveProjection(raw: unknown): boolean {
  const source = (raw ?? {}) as Record<string, unknown>;
  return (source['kind'] === 'text' || source['kind'] === 'photo' || source['kind'] === 'location')
    && source['status'] === 'active'
    && source['moderationState'] === 'active';
}

export function resolveCommunityFeedInteractionDelta(
  rawBefore: unknown,
  rawAfter: unknown
): number {
  if (!isActiveProjection(rawBefore) || !isActiveProjection(rawAfter)) {
    return 0;
  }

  const before = (rawBefore ?? {}) as Record<string, unknown>;
  const after = (rawAfter ?? {}) as Record<string, unknown>;
  const beforeMetrics = (before['metrics'] ?? {}) as Record<string, unknown>;
  const afterMetrics = (after['metrics'] ?? {}) as Record<string, unknown>;
  const commentGrowth = Math.max(
    normalizeCount(afterMetrics['commentCount'])
      - normalizeCount(beforeMetrics['commentCount']),
    0
  );
  const reactionGrowth = Math.max(
    normalizeCount(afterMetrics['reactionCount'])
      - normalizeCount(beforeMetrics['reactionCount']),
    0
  );

  return Math.min(
    commentGrowth + reactionGrowth,
    MAX_INTERACTION_DELTA_PER_WRITE
  );
}

export function isCommunityFeedTransitionMeaningful(
  rawBefore: unknown,
  rawAfter: unknown
): boolean {
  if (!isActiveProjection(rawAfter)) return false;
  if (!isActiveProjection(rawBefore)) return true;

  return resolveCommunityFeedInteractionDelta(rawBefore, rawAfter) > 0;
}
