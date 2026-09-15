// functions/src/community/community-admission-operational.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY ADMISSION OPERATIONAL POLICY
// -----------------------------------------------------------------------------
// Entrada/ativação de novos membros só pode ocorrer enquanto a Comunidade está
// operacional. Fluxos de limpeza/moderação sem ativação não dependem desta policy.
// -----------------------------------------------------------------------------

export function isCommunityAdmissionOperational(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;

  return community['status'] === 'active' && moderation['state'] === 'active';
}
