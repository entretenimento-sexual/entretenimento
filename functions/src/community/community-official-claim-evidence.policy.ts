// functions/src/community/community-official-claim-evidence.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM EVIDENCE POLICY
// -----------------------------------------------------------------------------
// Política pura para validar evidência de autoridade antes de uma associação
// oficial ser aprovada. Referência informada pelo cliente nunca é considerada
// prova por si só: ela precisa corresponder a um registro backend-only vigente.
// -----------------------------------------------------------------------------

import {
  normalizeCanonicalAuthorityResourceId,
} from '../authority/canonical-resource-authority.model';
import {
  resolveCanonicalResourceAuthority,
} from '../authority/canonical-resource-authority.resolver';
import {
  buildEventAuthorityRecordId,
} from '../authority/event-authority.policy';
import { evaluateProfileKyc } from '../identity/profile-kyc.policy';
import {
  buildOrganizationRepresentationId,
} from '../organization/organization-representation.policy';
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
  | 'venue_authority_mismatch'
  | 'profile_verification_invalid'
  | 'profile_verification_inactive'
  | 'profile_authority_mismatch'
  | 'organization_kyb_invalid'
  | 'organization_kyb_inactive'
  | 'organization_not_active'
  | 'organization_authority_mismatch'
  | 'event_authorization_invalid'
  | 'event_authorization_inactive'
  | 'event_not_active'
  | 'event_authority_mismatch';

export interface CommunityOfficialClaimEvidenceDecision {
  readonly allowed: boolean;
  readonly sponsorOrganizationId: string | null;
  readonly verificationPolicyVersion: number | null;
  readonly denialReason: CommunityOfficialClaimEvidenceDenialReason | null;
}

const SAFE_REFERENCE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,320}$/;

function normalizeId(value: unknown): string | null {
  return normalizeCanonicalAuthorityResourceId(value);
}

function normalizeReferenceId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_REFERENCE_ID_PATTERN.test(normalized) ? normalized : null;
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

function venueDenialReason(
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

function organizationDenialReason(
  denialReason: ReturnType<typeof resolveCanonicalResourceAuthority>['denialReason']
): CommunityOfficialClaimEvidenceDenialReason {
  if (denialReason === 'verification_inactive') {
    return 'organization_kyb_inactive';
  }
  if (denialReason === 'verification_required') {
    return 'organization_kyb_invalid';
  }
  if (denialReason === 'target_inactive') {
    return 'organization_not_active';
  }
  return 'organization_authority_mismatch';
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
 * Revalida Profile Oficial sem confiar no target ou na evidência persistida.
 * O vínculo self vem de users/{uid}.profileId e o KYC privado precisa continuar
 * vigente para exatamente o mesmo uid/profileId.
 */
export function evaluateProfileOfficialClaimAuthority(input: {
  readonly claimantUid: string;
  readonly profileId: string;
  readonly authorityRole: CommunityOfficialAuthorityRole;
  readonly sponsorOrganizationId: string | null;
  readonly kycReferenceId: string;
  readonly rawUser: unknown;
  readonly rawKyc: unknown;
  readonly now?: number;
}): Readonly<CommunityOfficialClaimEvidenceDecision> {
  const claimantUid = normalizeId(input.claimantUid);
  const profileId = normalizeId(input.profileId);
  const kycReferenceId = normalizeId(input.kycReferenceId);

  if (
    !claimantUid
    || !profileId
    || !kycReferenceId
    || kycReferenceId !== claimantUid
  ) {
    return denied('authority_reference_mismatch');
  }

  if (input.sponsorOrganizationId !== null || input.authorityRole !== 'self') {
    return denied('profile_authority_mismatch');
  }

  const authority = resolveCanonicalResourceAuthority({
    actorUid: claimantUid,
    targetType: 'profile',
    targetId: profileId,
    rawTarget: input.rawUser,
    now: input.now,
  });
  if (
    !authority.allowed
    || authority.authorityUid !== claimantUid
    || authority.authorityRole !== 'self'
    || authority.organizationId !== null
  ) {
    return denied('profile_authority_mismatch');
  }

  const kyc = evaluateProfileKyc({
    actorUid: claimantUid,
    profileId,
    rawKyc: input.rawKyc,
    now: input.now,
  });
  if (!kyc.allowed || !kyc.verificationPolicyVersion) {
    if (kyc.denialReason === 'verification_inactive') {
      return denied('profile_verification_inactive');
    }
    if (kyc.denialReason === 'record_mismatch') {
      return denied('profile_authority_mismatch');
    }
    return denied('profile_verification_invalid');
  }

  return Object.freeze({
    allowed: true,
    sponsorOrganizationId: null,
    verificationPolicyVersion: kyc.verificationPolicyVersion,
    denialReason: null,
  });
}

/**
 * Revalida Organização no momento da aprovação. KYB e representação precisam
 * continuar vigentes e a referência de representação precisa ser exatamente a
 * canônica para Organização + titular do claim.
 */
export function evaluateOrganizationOfficialClaimAuthority(input: {
  readonly claimantUid: string;
  readonly organizationId: string;
  readonly authorityRole: CommunityOfficialAuthorityRole;
  readonly sponsorOrganizationId: string | null;
  readonly kybReferenceId: string;
  readonly authorityReferenceId: string;
  readonly rawOrganization: unknown;
  readonly rawKyb: unknown;
  readonly rawRepresentation: unknown;
  readonly now?: number;
}): Readonly<CommunityOfficialClaimEvidenceDecision> {
  const claimantUid = normalizeId(input.claimantUid);
  const organizationId = normalizeId(input.organizationId);
  const kybReferenceId = normalizeId(input.kybReferenceId);
  const authorityReferenceId = normalizeReferenceId(input.authorityReferenceId);
  const expectedRepresentationId = buildOrganizationRepresentationId(
    organizationId,
    claimantUid
  );

  if (
    !claimantUid
    || !organizationId
    || !kybReferenceId
    || kybReferenceId !== organizationId
    || !authorityReferenceId
    || !expectedRepresentationId
    || authorityReferenceId !== expectedRepresentationId
  ) {
    return denied('authority_reference_mismatch');
  }

  const sponsorOrganizationId = input.sponsorOrganizationId === null
    ? null
    : normalizeId(input.sponsorOrganizationId);
  if (sponsorOrganizationId !== organizationId) {
    return denied('sponsor_organization_mismatch');
  }

  const authority = resolveCanonicalResourceAuthority({
    actorUid: claimantUid,
    targetType: 'organization',
    targetId: organizationId,
    rawTarget: input.rawOrganization,
    rawOrganizationKyb: input.rawKyb,
    rawOrganizationRepresentation: input.rawRepresentation,
    requiredOrganizationScope: 'community_official_claim',
    now: input.now,
  });

  if (
    !authority.allowed
    || !authority.authorityRole
    || !authority.verificationPolicyVersion
  ) {
    return denied(organizationDenialReason(authority.denialReason));
  }

  if (authority.authorityRole !== input.authorityRole) {
    return denied('organization_authority_mismatch');
  }

  return Object.freeze({
    allowed: true,
    sponsorOrganizationId: organizationId,
    verificationPolicyVersion: authority.verificationPolicyVersion,
    denialReason: null,
  });
}

function eventDenialReason(
  denialReason: ReturnType<typeof resolveCanonicalResourceAuthority>['denialReason']
): CommunityOfficialClaimEvidenceDenialReason {
  if (denialReason === 'verification_inactive') {
    return 'event_authorization_inactive';
  }
  if (denialReason === 'verification_required') {
    return 'event_authorization_invalid';
  }
  if (denialReason === 'target_inactive') {
    return 'event_not_active';
  }
  return 'event_authority_mismatch';
}

/**
 * Revalida a autoridade de Evento no registro backend-only canônico.
 * creatorUid/organizerUid em documentos de apresentação nunca substituem esse
 * registro, e a referência precisa ser exatamente eventId:claimantUid.
 */
export function evaluateEventOfficialClaimAuthority(input: {
  readonly claimantUid: string;
  readonly eventId: string;
  readonly authorityRole: CommunityOfficialAuthorityRole;
  readonly sponsorOrganizationId: string | null;
  readonly authorityReferenceId: string;
  readonly rawEventAuthority: unknown;
  readonly now?: number;
}): Readonly<CommunityOfficialClaimEvidenceDecision> {
  const claimantUid = normalizeId(input.claimantUid);
  const eventId = normalizeId(input.eventId);
  const authorityReferenceId = normalizeReferenceId(input.authorityReferenceId);
  const expectedReferenceId = buildEventAuthorityRecordId(eventId, claimantUid);

  if (
    !claimantUid
    || !eventId
    || !authorityReferenceId
    || !expectedReferenceId
    || authorityReferenceId !== expectedReferenceId
  ) {
    return denied('authority_reference_mismatch');
  }

  const authority = resolveCanonicalResourceAuthority({
    actorUid: claimantUid,
    targetType: 'event',
    targetId: eventId,
    rawTarget: null,
    rawEventAuthority: input.rawEventAuthority,
    now: input.now,
  });
  if (
    !authority.allowed
    || !authority.authorityRole
    || !authority.verificationPolicyVersion
  ) {
    return denied(eventDenialReason(authority.denialReason));
  }

  if (
    authority.authorityRole !== input.authorityRole
    || (
      authority.authorityRole !== 'organizer'
      && authority.authorityRole !== 'promoter'
      && authority.authorityRole !== 'responsible'
    )
  ) {
    return denied('event_authority_mismatch');
  }

  const claimedSponsorOrganizationId = input.sponsorOrganizationId === null
    ? null
    : normalizeId(input.sponsorOrganizationId);
  if (
    (input.sponsorOrganizationId !== null && !claimedSponsorOrganizationId)
    || claimedSponsorOrganizationId !== authority.organizationId
  ) {
    return denied('sponsor_organization_mismatch');
  }

  return Object.freeze({
    allowed: true,
    sponsorOrganizationId: authority.organizationId,
    verificationPolicyVersion: authority.verificationPolicyVersion,
    denialReason: null,
  });
}

/**
 * Valida a prova backend-only de autoridade comercial do Local.
 * `official_space_creation_grants/{holderUid}` é um nome legado de coleção:
 * o documento contém somente autoridade/verificação. Capacidade de criação,
 * quotas, preço e plano pertencem ao entitlement Business/Official separado.
 */
export function evaluateVenueOfficialClaimAuthorityGrant(input: {
  readonly claimantUid: string;
  readonly venueId: string;
  readonly authorityRole: CommunityOfficialAuthorityRole;
  readonly sponsorOrganizationId: string | null;
  readonly authorityReferenceId: string;
  readonly rawGrant: unknown;
  readonly rawVenue: unknown;
  readonly now?: number;
}): Readonly<CommunityOfficialClaimEvidenceDecision> {
  const claimantUid = normalizeId(input.claimantUid);
  const venueId = normalizeId(input.venueId);
  const authorityReferenceId = normalizeId(input.authorityReferenceId);

  if (
    !claimantUid
    || !venueId
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

  const authorityDecision = resolveCanonicalResourceAuthority({
    actorUid: claimantUid,
    targetType: 'venue',
    targetId: venueId,
    rawCommercialGrant: input.rawGrant,
    rawTarget: input.rawVenue,
    now: input.now,
  });

  if (!authorityDecision.allowed || !authorityDecision.authorityRole) {
    return denied(venueDenialReason(authorityDecision.denialReason));
  }

  if (
    authorityDecision.authorityRole !== 'owner'
    && authorityDecision.authorityRole !== 'manager'
  ) {
    return denied('venue_authority_mismatch');
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
