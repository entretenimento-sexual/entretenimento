// functions/src/community/community-feed-realtime-cleanup.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED REALTIME CLEANUP POLICY
// -----------------------------------------------------------------------------
// Decide quando a projeção realtime deve ser apagada definitivamente em vez de
// escrita/convertida em tombstone. Estados terminais e Comunidade inexistente
// sempre vencem o snapshot do evento, inclusive quando ele chegou atrasado.
// -----------------------------------------------------------------------------

export function shouldDeleteCommunityFeedRealtimeProjection(
  _publicProjectionExists: boolean,
  rawCommunity: unknown
): boolean {
  if (!rawCommunity || typeof rawCommunity !== 'object') return true;

  const community = rawCommunity as Record<string, unknown>;
  return community['status'] === 'archived'
    || community['status'] === 'scheduled_for_deletion';
}
