// functions/src/community/community-membership-visibility.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP VISIBILITY POLICY
// -----------------------------------------------------------------------------
// Decide apenas elegibilidade para uma futura projeção pública de participação.
// Não cria índice, não concede leitura e não transforma membership privado em
// dado público. Toda ausência ou valor desconhecido falha fechado.
// -----------------------------------------------------------------------------

export interface CommunityMembershipVisibilityDecision {
  readonly visible: boolean;
  readonly reason:
    | 'eligible'
    | 'community_not_public'
    | 'community_not_active'
    | 'community_not_moderation_active'
    | 'community_disclosure_disabled'
    | 'membership_not_active'
    | 'member_not_opted_in';
}

export function resolveCommunityMembershipVisibility(
  rawCommunity: unknown,
  rawMembership: unknown
): CommunityMembershipVisibilityDecision {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
  const disclosure = (community['membershipDisclosure'] ?? {}) as Record<string, unknown>;

  if (community['visibility'] !== 'public_preview') {
    return { visible: false, reason: 'community_not_public' };
  }

  if (community['status'] !== 'active') {
    return { visible: false, reason: 'community_not_active' };
  }

  if (moderation['state'] !== 'active') {
    return { visible: false, reason: 'community_not_moderation_active' };
  }

  if (disclosure['profileMembership'] !== 'opt_in') {
    return { visible: false, reason: 'community_disclosure_disabled' };
  }

  if (membership['status'] !== 'active') {
    return { visible: false, reason: 'membership_not_active' };
  }

  if (membership['profileVisibility'] !== 'visible') {
    return { visible: false, reason: 'member_not_opted_in' };
  }

  return { visible: true, reason: 'eligible' };
}
