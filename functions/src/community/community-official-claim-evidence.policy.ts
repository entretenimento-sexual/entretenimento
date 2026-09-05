// functions/src/community/community-official-claim-evidence.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM EVIDENCE POLICY
// -----------------------------------------------------------------------------
// Política pura para validar evidência de autoridade antes de uma associação
// oficial ser aprovada. Referência informada pelo cliente nunca é considerada
// prova por si só: ela precisa corresponder a um registro backend-only vigente.
// -----------------------------------------------------------------------------

import {
  resolveCanonicalResourceAuthority,
} from '../authority/canonical-resource-authority.resolver';
import type {
  CommunityOfficialAuthorityRole,
} from './community-official-association.model';
import {
  OFFICIAL_SPACE_CREATION_POLICY_VERSION,
  evaluateOfficialSpaceCreationGrant,
} from './community-official-space.policy';

export type CommunityOfficialClaimEvidenceDenialReason =
  | 'authority_reference_mismatch'
  | 'authority_grant_invalid'
  | 'authority_grant_inactive'
  | 'sponsor_organization_mismatch'
  | 'venue_not_active'
  | 'venue_authority_mismatch';

export interface CommunityOfficialClaimEvidenceDecision {
  readonly allowed: boolean;
  readonly sponsorOrganizationId: string | null;
  readonly verificationPolicyVersion: number | null;
  readonly denialReason: CommunityOfficialClaimEvidenceDenialReason | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function denied(
  denialReason: CommunityOfficialClaimEvidenceDenialReason
): Readonly<CommunityOfficialClaimEvidenceDecision> {
  return Object.freeze({
    allowed: false,
    sponsorOrganizationId: null,
    verificationPolicyVersion: null,
    denialReason,
  });
}

function canonicalDenialReason(
  denialReason: ReturnType<typeof resolveCanonicalResourceAuthority>['denialReason']
): CommunityOfficialClaimEvidenceDenialReason {
  if (denialReason === 'verification_inactive') {
    return 'authority_grant_inactive';
  }
  if (denialReason === 'verification_required') {
    return 'authority_grant_invalid';
  }
  if (denialReason === 'target_inactive') {
    return 'venue_not_active';
  }
  return 'venue_authority_mismatch';
}

function authorityRoleMatches(
  claimedRole: CommunityOfficialAuthorityRole,
  canonicalRole: 'owner' | 'manager'
): boolean {
  if (claimedRole === canonicalRole) return true;

  // Compatibilidade com claims legados: antes da canonização, administradores
  // de Local eram registrados como `authorized_representative`.
  return claimedRole === 'authorized_representative'
    && canonicalRole === 'manager';
}

/**
 * Valida o único source de autoridade comercial já canônico no projeto:
 * `official_space_creation_grants/{holderUid}`.
 *
 * A capability de Espaço Oficial continua sendo uma regra de Comunidades. A
 * autoridade atual sobre o Local, porém, é resolvida exclusivamente pelo domínio
 * canônico de autoridade para impedir drift entre capability, submit e revisão.
 */
export function evaluateVenueOfficialClaimAuthorityGrant(input: {
  readonly claimantUid: string;
  readonly authorityRole: CommunityOfficialAuthorityRole;
  readonly sponsorOrganizationId: string | null;
  readonly authorityReferenceId: string;
  readonly rawGrant: unknown;
  readonly rawVenue: unknown;
  readonly now?: number;
}): Readonly<CommunityOfficialClaimEvidenceDecision> {
  const claimantUid = normalizeId(input.claimantUid);
  const authorityReferenceId = normalizeId(input.authorityReferenceId);

  if (
    !claimantUid
    || !authorityReferenceId
    || authorityReferenceId !== claimantUid
  ) {
    return denied('authority_reference_mismatch');
  }

  const grantDecision = evaluateOfficialSpaceCreationGrant({
    actorUid: claimantUid,
    // Não há bypass administrativo na validação de evidência de claim.
    actorUserRole: null,
    rawGrant: input.rawGrant,
    now: input.now,
  });

  if (!grantDecision.allowed || !grantDecision.organizationId) {
    return denied(
      grantDecision.denialReason === 'grant_inactive'
        ? 'authority_grant_inactive'
        : 'authority_grant_invalid'
    );
  }

  const claimedSponsorOrganizationId = input.sponsorOrganizationId === null
    ? null
    : normalizeId(input.sponsorOrganizationId);

  if (
    input.sponsorOrganizationId !== null
    && (
      !claimedSponsorOrganizationId
      || claimedSponsorOrganizationId !== grantDecision.organizationId
    )
  ) {
    return denied('sponsor_organization_mismatch');
  }

  const venue = (input.rawVenue ?? {}) as Record<string, unknown>;
  const targetId = normalizeId(venue['id']) ?? 'claim-venue';
  const authorityDecision = resolveCanonicalResourceAuthority({
    actorUid: claimantUid,
    targetType: 'venue',
    targetId,
    rawCommercialGrant: input.rawGrant,
    rawTarget: input.rawVenue,
    now: input.now,
  });

  if (!authorityDecision.allowed || !authorityDecision.authorityRole) {
    return denied(canonicalDenialReason(authorityDecision.denialReason));
  }

  if (!authorityRoleMatches(input.authorityRole, authorityDecision.authorityRole)) {
    return denied('venue_authority_mismatch');
  }

  return Object.freeze({
    allowed: true,
    sponsorOrganizationId: grantDecision.organizationId,
    verificationPolicyVersion: OFFICIAL_SPACE_CREATION_POLICY_VERSION,
    denialReason: null,
  });
}
