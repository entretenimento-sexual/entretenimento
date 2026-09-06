// functions/src/community/community-membership-profile-visibility.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP PROFILE VISIBILITY CONTRACT
// -----------------------------------------------------------------------------
// Contrato privado do próprio membro. A preferência nunca autoriza exposição
// sozinha: a leitura pública revalida membership, policy da Comunidade e a
// projeção sanitizada de descoberta antes de devolver qualquer card.
// -----------------------------------------------------------------------------

export type CommunityMembershipProfileVisibility = 'hidden' | 'visible';
export type CommunityMembershipDisclosureMode = 'disabled' | 'opt_in';

export interface CommunityMembershipProfileVisibilityRequest {
  communityId?: unknown;
  profileVisibility?: unknown;
}

export interface CommunityMembershipProfileVisibilityReadRequest {
  communityId?: unknown;
}

export interface NormalizedCommunityMembershipProfileVisibilityRequest {
  communityId: string;
  profileVisibility: CommunityMembershipProfileVisibility;
}

export interface CommunityMembershipProfileVisibilityState {
  communityId: string;
  disclosureMode: CommunityMembershipDisclosureMode;
  policyVersion: number;
  profileVisibility: CommunityMembershipProfileVisibility;
  profileVisibilityPolicyVersion: number | null;
  canChange: boolean;
  canManagePolicy: boolean;
  generatedAt: number;
}

const COMMUNITY_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join('');
}

function normalizeText(value: unknown, maxLength: number): string {
  return stripControlCharacters(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normalizeCommunityMembershipProfileVisibilityRequest(
  raw: CommunityMembershipProfileVisibilityRequest | null | undefined
): NormalizedCommunityMembershipProfileVisibilityRequest | null {
  const communityId = normalizeText(raw?.communityId, 128);
  const profileVisibility = raw?.profileVisibility;

  if (
    !COMMUNITY_ID_PATTERN.test(communityId)
    || (profileVisibility !== 'hidden' && profileVisibility !== 'visible')
  ) {
    return null;
  }

  return { communityId, profileVisibility };
}

export function normalizeCommunityMembershipProfileVisibilityCommunityId(
  value: unknown
): string | null {
  const communityId = normalizeText(value, 128);
  return COMMUNITY_ID_PATTERN.test(communityId) ? communityId : null;
}
