// functions/src/community/community-profile-membership-index.projection.ts
// -----------------------------------------------------------------------------
// PRIVATE PUBLIC-MEMBERSHIP LOCATOR
// -----------------------------------------------------------------------------
// Este documento apenas localiza candidatos que declararam opt-in. Não contém
// nome, papel, perfil, card ou autorização e nunca substitui a revalidação do
// membership canônico. Ausência/false/legacy sempre remove o candidato.
// -----------------------------------------------------------------------------

export interface CommunityProfileMembershipIndexProjection {
  communityId: string;
  status: 'candidate';
}

const COMMUNITY_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeCommunityId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return COMMUNITY_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

export function buildCommunityProfileMembershipIndexProjection(
  communityIdRaw: unknown,
  rawMembership: unknown
): CommunityProfileMembershipIndexProjection | null {
  const communityId = normalizeCommunityId(communityIdRaw);
  const membership = (rawMembership ?? {}) as Record<string, unknown>;

  if (
    !communityId
    || membership['status'] !== 'active'
    || membership['profileVisibility'] !== 'visible'
    || !normalizePositiveInteger(membership['profileVisibilityPolicyVersion'])
  ) {
    return null;
  }

  return { communityId, status: 'candidate' };
}
