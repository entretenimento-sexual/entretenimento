// functions/src/community/community-feed-realtime-cleanup.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED REALTIME CLEANUP POLICY
// -----------------------------------------------------------------------------
// Decide quando a remoção de uma projeção pública deve apagar definitivamente o
// sinal realtime em vez de publicar tombstone. Estados que ainda podem voltar a
// operar preservam tombstones; estados terminais e Comunidade inexistente não.
// -----------------------------------------------------------------------------

export function shouldDeleteCommunityFeedRealtimeProjection(
  publicProjectionExists: boolean,
  rawCommunity: unknown
): boolean {
  if (publicProjectionExists) return false;
  if (!rawCommunity || typeof rawCommunity !== 'object') return true;

  const community = rawCommunity as Record<string, unknown>;
  return community['status'] === 'archived'
    || community['status'] === 'scheduled_for_deletion';
}
