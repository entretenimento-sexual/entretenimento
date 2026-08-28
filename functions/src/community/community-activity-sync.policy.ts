// functions/src/community/community-activity-sync.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY ACTIVITY SYNC POLICY
// -----------------------------------------------------------------------------
// Decide se triggers derivados podem mover o relógio de atividade comunitária.
// Comunidades arquivadas ou já elegíveis à exclusão ficam congeladas: moderação,
// retenção e leitura histórica continuam possíveis, mas atividade social não
// reescreve lastMeaningfulActivityAt/updatedAt após o encerramento.
// -----------------------------------------------------------------------------

export function canSyncCommunityActivity(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;
  const status = community['status'];

  if (source['type'] !== 'community') return false;

  return status !== 'archived' && status !== 'scheduled_for_deletion';
}
