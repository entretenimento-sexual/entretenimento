// functions/src/organization/organization-authority.policy.ts
// -----------------------------------------------------------------------------
// ORGANIZATION AUTHORITY POLICY
// -----------------------------------------------------------------------------
// Combina entidade ativa + KYB vigente + representação vigente/escopada. Não
// aceita role comunitária, claim do cliente ou evidência opaca como autoridade.
// -----------------------------------------------------------------------------

import {
  evaluateOrganizationKyb,
} from './organization-kyb.policy';
import {
  evaluateOrganizationRepresentation,
  type OrganizationAuthorityScope,
} from './organization-representation.policy';
import { normalizeOrganizationId } from './organization.model';

export type OrganizationCanonicalAuthorityRole =
  | 'owner'
  | 'authorized_representative'
  | 'manager';

export type OrganizationAuthorityDenialReason =
  | 'verification_required'
  | 'verification_inactive'
  | 'target_inactive'
  | 'target_authority_mismatch';

export interface OrganizationAuthorityDecision {
  readonly allowed: boolean;
  readonly organizationId: string | null;
  readonly authorityUid: string | null;
  readonly authorityRole: OrganizationCanonicalAuthorityRole | null;
  readonly verificationPolicyVersion: number | null;
  readonly denialReason: OrganizationAuthorityDenialReason | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeUid(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function denied(input: {
  organizationId?: string | null;
  authorityUid?: string | null;
  denialReason: OrganizationAuthorityDenialReason;
}): Readonly<OrganizationAuthorityDecision> {
  return Object.freeze({
    allowed: false,
    organizationId: input.organizationId ?? null,
    authorityUid: input.authorityUid ?? null,
    authorityRole: null,
    verificationPolicyVersion: null,
    denialReason: input.denialReason,
  });
}

export function evaluateOrganizationResourceAuthority(input: {
  readonly actorUid: string;
  readonly organizationId: string;
  readonly rawOrganization: unknown;
  readonly rawKyb: unknown;
  readonly rawRepresentation: unknown;
  readonly requiredScope: OrganizationAuthorityScope;
  readonly now?: number;
}): Readonly<OrganizationAuthorityDecision> {
  const organizationId = normalizeOrganizationId(input.organizationId);
  const actorUid = normalizeUid(input.actorUid);
  if (!organizationId || !actorUid) {
    return denied({ denialReason: 'target_authority_mismatch' });
  }

  if (
    typeof input.rawOrganization !== 'object'
    || input.rawOrganization === null
    || Array.isArray(input.rawOrganization)
  ) {
    return denied({
      organizationId,
      authorityUid: actorUid,
      denialReason: 'target_authority_mismatch',
    });
  }

  const organization = input.rawOrganization as Record<string, unknown>;
  if (normalizeOrganizationId(organization['organizationId']) !== organizationId) {
    return denied({
      organizationId,
      authorityUid: actorUid,
      denialReason: 'target_authority_mismatch',
    });
  }
  if (organization['status'] !== 'active') {
    return denied({
      organizationId,
      authorityUid: actorUid,
      denialReason: 'target_inactive',
    });
  }

  const kyb = evaluateOrganizationKyb({
    organizationId,
    rawKyb: input.rawKyb,
    now: input.now,
  });
  if (!kyb.allowed) {
    return denied({
      organizationId,
      authorityUid: actorUid,
      denialReason: kyb.denialReason === 'verification_inactive'
        ? 'verification_inactive'
        : kyb.denialReason === 'record_mismatch'
          ? 'target_authority_mismatch'
          : 'verification_required',
    });
  }

  const representation = evaluateOrganizationRepresentation({
    organizationId,
    actorUid,
    requiredScope: input.requiredScope,
    rawRepresentation: input.rawRepresentation,
    now: input.now,
  });
  if (!representation.allowed || !representation.role) {
    return denied({
      organizationId,
      authorityUid: actorUid,
      denialReason: 'target_authority_mismatch',
    });
  }

  const authorityRole: OrganizationCanonicalAuthorityRole =
    representation.role === 'legal_representative'
      ? 'authorized_representative'
      : representation.role;

  return Object.freeze({
    allowed: true,
    organizationId,
    authorityUid: actorUid,
    authorityRole,
    verificationPolicyVersion: kyb.verificationPolicyVersion,
    denialReason: null,
  });
}
