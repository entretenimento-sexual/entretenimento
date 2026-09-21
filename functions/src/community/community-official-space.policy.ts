// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL SPACE AUTHORITY POLICY
// -----------------------------------------------------------------------------
// Compatibilidade de nome: esta policy valida somente autoridade comercial.
// Capacidade Business/Official pertence exclusivamente ao entitlement canônico.
// -----------------------------------------------------------------------------

import {
  evaluateVerifiedCommercialAuthority,
} from '../authority/verified-commercial-authority.policy';

export const OFFICIAL_SPACE_CREATION_POLICY_VERSION = 3;

export interface OfficialSpaceCreationDecision {
  allowed: boolean;
  organizationId: string | null;
  denialReason: 'verification_required' | 'grant_inactive' | null;
}

const FORBIDDEN_COMMERCIAL_FIELDS = Object.freeze([
  'amountCents',
  'maxOfficialCommunities',
  'maxOfficialSpaces',
  'memberLimit',
  'plan',
  'planId',
  'planKey',
  'price',
  'priceCents',
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsCommercialTerms(
  grant: Readonly<Record<string, unknown>>
): boolean {
  return FORBIDDEN_COMMERCIAL_FIELDS.some(
    (field) => Object.hasOwn(grant, field)
  );
}

export function evaluateOfficialSpaceCreationGrant(input: {
  actorUid: string;
  actorUserRole: unknown;
  rawGrant: unknown;
  now?: number;
}): Readonly<OfficialSpaceCreationDecision> {
  if (input.actorUserRole === 'admin') {
    return Object.freeze({
      allowed: true,
      organizationId: 'platform-administration',
      denialReason: null,
    });
  }

  if (!isRecord(input.rawGrant)) {
    return Object.freeze({
      allowed: false,
      organizationId: null,
      denialReason: 'verification_required',
    });
  }

  if (
    input.rawGrant['scope'] !== 'verified_commercial_authority'
    || input.rawGrant['policyVersion'] !== OFFICIAL_SPACE_CREATION_POLICY_VERSION
    || containsCommercialTerms(input.rawGrant)
  ) {
    return Object.freeze({
      allowed: false,
      organizationId: null,
      denialReason: 'verification_required',
    });
  }

  const commercialAuthority = evaluateVerifiedCommercialAuthority({
    actorUid: input.actorUid,
    rawGrant: input.rawGrant,
    now: input.now,
  });

  if (!commercialAuthority.allowed) {
    const inactive = commercialAuthority.denialReason === 'authority_inactive';
    return Object.freeze({
      allowed: false,
      organizationId: inactive ? commercialAuthority.organizationId : null,
      denialReason: inactive ? 'grant_inactive' : 'verification_required',
    });
  }

  return Object.freeze({
    allowed: true,
    organizationId: commercialAuthority.organizationId,
    denialReason: null,
  });
}
