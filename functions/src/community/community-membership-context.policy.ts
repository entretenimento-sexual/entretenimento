// functions/src/community/community-membership-context.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP CONTEXT POLICY
// -----------------------------------------------------------------------------
// Contrato mínimo para enriquecer a descoberta com o vínculo do próprio usuário.
// O cliente informa apenas IDs que já estão visíveis; o backend nunca enumera a
// coleção inteira de memberships para fins de recomendação.
// -----------------------------------------------------------------------------

import { normalizeCommunityId } from './community-preview.model';

export const COMMUNITY_MEMBERSHIP_CONTEXT_MAX_IDS = 24;

export function normalizeCommunityMembershipContextIds(
  raw: unknown
): readonly string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > COMMUNITY_MEMBERSHIP_CONTEXT_MAX_IDS) return null;

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const value of raw) {
    const communityId = normalizeCommunityId(value);
    if (!communityId) return null;
    if (seen.has(communityId)) continue;

    seen.add(communityId);
    ids.push(communityId);
  }

  return ids.length > 0 ? ids : null;
}

export function isCommunityMembershipContextActive(raw: unknown): boolean {
  const membership = (raw ?? {}) as Record<string, unknown>;
  return membership['status'] === 'active';
}
