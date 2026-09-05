// functions/src/organization/organization-kyb.policy.ts
// -----------------------------------------------------------------------------
// ORGANIZATION KYB POLICY
// -----------------------------------------------------------------------------
// Valida somente o estado canônico de KYB. Evidências, documentos e dados do
// provedor permanecem backend-only e nunca são necessários para decisão da UI.
// -----------------------------------------------------------------------------

import { normalizeOrganizationId } from './organization.model';

export type OrganizationKybStatus =
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'expired'
  | 'revoked';

export type OrganizationKybDenialReason =
  | 'verification_required'
  | 'verification_inactive'
  | 'record_mismatch';

export interface OrganizationKybDecision {
  readonly allowed: boolean;
  readonly organizationId: string | null;
  readonly verificationPolicyVersion: number | null;
  readonly denialReason: OrganizationKybDenialReason | null;
}

function denied(
  organizationId: string | null,
  denialReason: OrganizationKybDenialReason
): Readonly<OrganizationKybDecision> {
  return Object.freeze({
    allowed: false,
    organizationId,
    verificationPolicyVersion: null,
    denialReason,
  });
}

function asPositiveTime(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function evaluateOrganizationKyb(input: {
  readonly organizationId: string;
  readonly rawKyb: unknown;
  readonly now?: number;
}): Readonly<OrganizationKybDecision> {
  const expectedOrganizationId = normalizeOrganizationId(input.organizationId);
  if (!expectedOrganizationId) {
    return denied(null, 'record_mismatch');
  }

  if (
    typeof input.rawKyb !== 'object'
    || input.rawKyb === null
    || Array.isArray(input.rawKyb)
  ) {
    return denied(expectedOrganizationId, 'verification_required');
  }

  const kyb = input.rawKyb as Record<string, unknown>;
  const organizationId = normalizeOrganizationId(kyb['organizationId']);
  if (organizationId !== expectedOrganizationId) {
    return denied(organizationId, 'record_mismatch');
  }

  const status = kyb['status'] as OrganizationKybStatus;
  if (status === 'pending' || status === 'rejected') {
    return denied(organizationId, 'verification_required');
  }
  if (status === 'expired' || status === 'revoked') {
    return denied(organizationId, 'verification_inactive');
  }
  if (status !== 'verified') {
    return denied(organizationId, 'verification_required');
  }

  const now = Math.trunc(input.now ?? Date.now());
  const verifiedAt = asPositiveTime(kyb['verifiedAt']);
  const policyVersion = Number(kyb['policyVersion']);
  const expiresAt = kyb['expiresAt'] === null
    ? null
    : asPositiveTime(kyb['expiresAt']);
  const revalidationDueAt = kyb['revalidationDueAt'] === null
    ? null
    : asPositiveTime(kyb['revalidationDueAt']);
  const revokedAt = kyb['revokedAt'] === null || kyb['revokedAt'] === undefined
    ? null
    : asPositiveTime(kyb['revokedAt']);

  if (
    !verifiedAt
    || verifiedAt > now
    || !Number.isInteger(policyVersion)
    || policyVersion < 1
  ) {
    return denied(organizationId, 'verification_required');
  }

  if (
    revokedAt !== null
    || (kyb['expiresAt'] !== null && expiresAt === null)
    || (expiresAt !== null && expiresAt <= now)
    || (kyb['revalidationDueAt'] !== null && revalidationDueAt === null)
    || (revalidationDueAt !== null && revalidationDueAt <= now)
  ) {
    return denied(organizationId, 'verification_inactive');
  }

  return Object.freeze({
    allowed: true,
    organizationId,
    verificationPolicyVersion: policyVersion,
    denialReason: null,
  });
}
