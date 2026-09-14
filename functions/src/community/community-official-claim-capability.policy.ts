// functions/src/community/community-official-claim-capability.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM CAPABILITY
// -----------------------------------------------------------------------------
// Resolve somente alvos cuja autoridade já pode ser comprovada por fonte
// canônica backend-only. O cliente recebe alvo, rótulo e papel, nunca grant,
// KYC/KYB, organização patrocinadora ou referência de evidência.
// -----------------------------------------------------------------------------

import {
  normalizeCanonicalAuthorityResourceId,
  type CanonicalResourceAuthorityRole,
} from '../authority/canonical-resource-authority.model';
import {
  resolveCanonicalResourceAuthority,
} from '../authority/canonical-resource-authority.resolver';
import { evaluateProfileKyc } from '../identity/profile-kyc.policy';
import {
  evaluateOfficialSpaceCreationGrant,
} from './community-official-space.policy';

export const MAX_COMMUNITY_OFFICIAL_CLAIM_CANDIDATES = 12;

export type CommunityOfficialClaimCapabilityReason =
  | 'eligible'
  | 'verification_required'
  | 'verification_inactive'
  | 'no_eligible_target'
  | 'community_already_official';

type CommunityOfficialClaimCandidateAuthorityRole = Extract<
  CanonicalResourceAuthorityRole,
  'self' | 'owner' | 'authorized_representative' | 'manager'
>;

export interface CommunityOfficialClaimCapabilityCandidate {
  readonly target: {
    readonly type: 'profile' | 'organization' | 'venue';
    readonly id: string;
  };
  readonly label: string;
  readonly authorityRole: CommunityOfficialClaimCandidateAuthorityRole;
}

export interface CommunityOfficialClaimProfileAuthorityInput {
  readonly rawUser: Readonly<Record<string, unknown>> | null;
  readonly rawKyc: unknown;
}

export interface CommunityOfficialClaimOrganizationAuthorityInput {
  readonly organizationId: string;
  readonly rawOrganization: Readonly<Record<string, unknown>> | null;
  readonly rawKyb: unknown;
  readonly rawRepresentation: unknown;
}

export interface CommunityOfficialClaimCapabilityDecision {
  readonly canSubmit: boolean;
  readonly reason: CommunityOfficialClaimCapabilityReason;
  readonly candidates: readonly CommunityOfficialClaimCapabilityCandidate[];
}

function cleanId(value: unknown): string | null {
  return normalizeCanonicalAuthorityResourceId(value);
}

function cleanLabel(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, 80);
}

export function resolveCommunityOfficialClaimCapability(input: {
  readonly actorUid: string;
  readonly rawGrant: unknown;
  readonly rawVenues: readonly Readonly<Record<string, unknown>>[];
  readonly rawProfileAuthority?: CommunityOfficialClaimProfileAuthorityInput | null;
  readonly rawOrganizationAuthorities?: readonly CommunityOfficialClaimOrganizationAuthorityInput[];
  readonly activeOfficialProfileIds?: readonly string[];
  readonly activeOfficialVenueIds?: readonly string[];
  readonly activeOfficialOrganizationIds?: readonly string[];
  readonly communityAlreadyOfficial: boolean;
  readonly now?: number;
}): Readonly<CommunityOfficialClaimCapabilityDecision> {
  if (input.communityAlreadyOfficial) {
    return Object.freeze({
      canSubmit: false,
      reason: 'community_already_official',
      candidates: Object.freeze([]),
    });
  }

  const actorUid = cleanId(input.actorUid);
  if (!actorUid) {
    return Object.freeze({
      canSubmit: false,
      reason: 'verification_required',
      candidates: Object.freeze([]),
    });
  }

  const grant = evaluateOfficialSpaceCreationGrant({
    actorUid,
    // Claim nunca herda bypass administrativo: precisa de autoridade comercial.
    actorUserRole: null,
    rawGrant: input.rawGrant,
    now: input.now,
  });
  let sawVerificationRequired = !grant.allowed
    && grant.denialReason !== 'grant_inactive';
  let sawVerificationInactive = !grant.allowed
    && grant.denialReason === 'grant_inactive';

  // Ocupação oficial é decidida somente pela associação canônica. Projeções
  // eventualmente presentes nos recursos públicos são ignoradas aqui.
  const activeOfficialProfileIds = new Set(
    (input.activeOfficialProfileIds ?? [])
      .map(cleanId)
      .filter((profileId): profileId is string => profileId !== null)
  );
  const activeOfficialVenueIds = new Set(
    (input.activeOfficialVenueIds ?? [])
      .map(cleanId)
      .filter((venueId): venueId is string => venueId !== null)
  );
  const activeOfficialOrganizationIds = new Set(
    (input.activeOfficialOrganizationIds ?? [])
      .map(cleanId)
      .filter((organizationId): organizationId is string => organizationId !== null)
  );
  const unique = new Map<string, CommunityOfficialClaimCapabilityCandidate>();

  // Profile é independente de grant comercial. A única fonte de identidade do
  // alvo é users/{actorUid}.profileId; KYC só decide elegibilidade no backend e
  // jamais é projetado para o cliente.
  const profileSource = input.rawProfileAuthority;
  const profileId = cleanId(profileSource?.rawUser?.['profileId']);
  if (
    profileSource
    && profileId
    && !activeOfficialProfileIds.has(profileId)
    && unique.size < MAX_COMMUNITY_OFFICIAL_CLAIM_CANDIDATES
  ) {
    const authority = resolveCanonicalResourceAuthority({
      actorUid,
      targetType: 'profile',
      targetId: profileId,
      rawTarget: profileSource.rawUser,
      now: input.now,
    });

    if (
      authority.allowed
      && authority.authorityUid === actorUid
      && authority.authorityRole === 'self'
      && authority.organizationId === null
    ) {
      const profileKyc = evaluateProfileKyc({
        actorUid,
        profileId,
        rawKyc: profileSource.rawKyc,
        now: input.now,
      });

      if (profileKyc.allowed && profileKyc.verificationPolicyVersion) {
        unique.set(`profile:${profileId}`, Object.freeze({
          target: Object.freeze({ type: 'profile' as const, id: profileId }),
          // Não derivar rótulo de KYC nem de atributos civis privados.
          label: 'Meu perfil',
          authorityRole: 'self',
        }));
      } else {
        sawVerificationInactive ||= profileKyc.denialReason === 'verification_inactive';
        sawVerificationRequired ||= profileKyc.denialReason === 'verification_required';
      }
    }
  }

  if (grant.allowed) {
    for (const rawVenue of input.rawVenues) {
      if (unique.size >= MAX_COMMUNITY_OFFICIAL_CLAIM_CANDIDATES) break;

      const venueId = cleanId(rawVenue['id']);
      if (!venueId || activeOfficialVenueIds.has(venueId)) continue;

      const authority = resolveCanonicalResourceAuthority({
        actorUid,
        targetType: 'venue',
        targetId: venueId,
        rawCommercialGrant: input.rawGrant,
        rawTarget: rawVenue,
        now: input.now,
      });

      if (
        !authority.allowed
        || (authority.authorityRole !== 'owner'
          && authority.authorityRole !== 'manager')
      ) {
        continue;
      }

      unique.set(`venue:${venueId}`, Object.freeze({
        target: Object.freeze({ type: 'venue' as const, id: venueId }),
        label: cleanLabel(rawVenue['name'], 'Local sem nome'),
        authorityRole: authority.authorityRole,
      }));
    }
  }

  for (const source of input.rawOrganizationAuthorities ?? []) {
    if (unique.size >= MAX_COMMUNITY_OFFICIAL_CLAIM_CANDIDATES) break;

    const organizationId = cleanId(source.organizationId);
    if (!organizationId || activeOfficialOrganizationIds.has(organizationId)) {
      continue;
    }

    const authority = resolveCanonicalResourceAuthority({
      actorUid,
      targetType: 'organization',
      targetId: organizationId,
      rawTarget: source.rawOrganization,
      rawOrganizationKyb: source.rawKyb,
      rawOrganizationRepresentation: source.rawRepresentation,
      requiredOrganizationScope: 'community_official_claim',
      now: input.now,
    });

    if (!authority.allowed || !authority.authorityRole) {
      sawVerificationInactive ||= authority.denialReason === 'verification_inactive';
      sawVerificationRequired ||= authority.denialReason === 'verification_required';
      continue;
    }

    if (
      authority.authorityRole !== 'owner'
      && authority.authorityRole !== 'authorized_representative'
      && authority.authorityRole !== 'manager'
    ) {
      continue;
    }

    unique.set(`organization:${organizationId}`, Object.freeze({
      target: Object.freeze({
        type: 'organization' as const,
        id: organizationId,
      }),
      label: cleanLabel(
        source.rawOrganization?.['displayName'],
        'Organização sem nome'
      ),
      authorityRole: authority.authorityRole,
    }));
  }

  const candidates = Object.freeze([...unique.values()]);
  if (candidates.length > 0) {
    return Object.freeze({
      canSubmit: true,
      reason: 'eligible',
      candidates,
    });
  }

  return Object.freeze({
    canSubmit: false,
    reason: sawVerificationInactive
      ? 'verification_inactive'
      : sawVerificationRequired
        ? 'verification_required'
        : 'no_eligible_target',
    candidates,
  });
}
