// functions/src/identity/profile-kyc.policy.ts
// -----------------------------------------------------------------------------
// PROFILE KYC POLICY
// -----------------------------------------------------------------------------
// Valida o estado privado de identidade civil verificada de uma pessoa física.
// O registro é backend-only e precisa estar vinculado exatamente ao mesmo uid e
// profileId canônico. Dados do provedor/documentos ficam fora deste contrato.
// -----------------------------------------------------------------------------

import {
  normalizeCanonicalAuthorityResourceId,
} from '../authority/canonical-resource-authority.model';

export type ProfileKycStatus =
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'expired'
  | 'revoked';

export type ProfileKycDenialReason =
  | 'verification_required'
  | 'verification_inactive'
  | 'record_mismatch';

export interface ProfileKycDecision {
  readonly allowed: boolean;
  readonly uid: string | null;
  readonly profileId: string | null;
  readonly verificationPolicyVersion: number | null;
  readonly denialReason: ProfileKycDenialReason | null;
}

function denied(input: {
  uid: string | null;
  profileId: string | null;
  denialReason: ProfileKycDenialReason;
}): Readonly<ProfileKycDecision> {
  return Object.freeze({
    allowed: false,
    uid: input.uid,
    profileId: input.profileId,
    verificationPolicyVersion: null,
    denialReason: input.denialReason,
  });
}

function asPositiveTime(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function evaluateProfileKyc(input: {
  readonly actorUid: string;
  readonly profileId: string;
  readonly rawKyc: unknown;
  readonly now?: number;
}): Readonly<ProfileKycDecision> {
  const expectedUid = normalizeCanonicalAuthorityResourceId(input.actorUid);
  const expectedProfileId = normalizeCanonicalAuthorityResourceId(input.profileId);
  if (!expectedUid || !expectedProfileId) {
    return denied({
      uid: expectedUid,
      profileId: expectedProfileId,
      denialReason: 'record_mismatch',
    });
  }

  if (
    typeof input.rawKyc !== 'object'
    || input.rawKyc === null
    || Array.isArray(input.rawKyc)
  ) {
    return denied({
      uid: expectedUid,
      profileId: expectedProfileId,
      denialReason: 'verification_required',
    });
  }

  const kyc = input.rawKyc as Record<string, unknown>;
  const uid = normalizeCanonicalAuthorityResourceId(kyc['uid']);
  const profileId = normalizeCanonicalAuthorityResourceId(kyc['profileId']);
  if (uid !== expectedUid || profileId !== expectedProfileId) {
    return denied({ uid, profileId, denialReason: 'record_mismatch' });
  }

  const status = kyc['status'] as ProfileKycStatus;
  if (status === 'pending' || status === 'rejected') {
    return denied({ uid, profileId, denialReason: 'verification_required' });
  }
  if (status === 'expired' || status === 'revoked') {
    return denied({ uid, profileId, denialReason: 'verification_inactive' });
  }
  if (status !== 'verified') {
    return denied({ uid, profileId, denialReason: 'verification_required' });
  }

  const now = Math.trunc(input.now ?? Date.now());
  const verifiedAt = asPositiveTime(kyc['verifiedAt']);
  const policyVersion = Number(kyc['policyVersion']);
  const expiresAt = kyc['expiresAt'] === null
    ? null
    : asPositiveTime(kyc['expiresAt']);
  const revalidationDueAt = kyc['revalidationDueAt'] === null
    ? null
    : asPositiveTime(kyc['revalidationDueAt']);
  const revokedAt = kyc['revokedAt'] === null || kyc['revokedAt'] === undefined
    ? null
    : asPositiveTime(kyc['revokedAt']);

  if (
    !Number.isFinite(now)
    || now <= 0
    || !verifiedAt
    || verifiedAt > now
    || !Number.isInteger(policyVersion)
    || policyVersion < 1
  ) {
    return denied({ uid, profileId, denialReason: 'verification_required' });
  }

  if (
    revokedAt !== null
    || (kyc['expiresAt'] !== null && expiresAt === null)
    || (expiresAt !== null && expiresAt <= now)
    || (kyc['revalidationDueAt'] !== null && revalidationDueAt === null)
    || (revalidationDueAt !== null && revalidationDueAt <= now)
  ) {
    return denied({ uid, profileId, denialReason: 'verification_inactive' });
  }

  return Object.freeze({
    allowed: true,
    uid,
    profileId,
    verificationPolicyVersion: Math.trunc(policyVersion),
    denialReason: null,
  });
}
