// src/app/community/data-access/community-official-claim.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM - PRIVATE CLIENT CONTRACT
// -----------------------------------------------------------------------------
// Contrato sanitizado do claim pertencente ao usuário autenticado.
// Evidências, KYC/KYB, reviewerUid, claimantUid e notas internas não pertencem
// ao cliente Angular.
// -----------------------------------------------------------------------------

import type { CommunityOfficialTarget } from './community-official-target.policy';

export type CommunityOfficialClaimStatus =
  | 'pending'
  | 'under_review'
  | 'verified'
  | 'rejected'
  | 'disputed'
  | 'revoked'
  | 'expired';

export interface CommunityOfficialClaimView {
  readonly associationKey: string;
  readonly communityId: string;
  readonly target: CommunityOfficialTarget;
  readonly status: CommunityOfficialClaimStatus;
  readonly submittedAt: number;
  readonly updatedAt: number;
  readonly revalidationDueAt: number | null;
  readonly verificationExpiresAt: number | null;
}

export interface MyCommunityOfficialClaimResponse {
  readonly claim: CommunityOfficialClaimView | null;
  readonly generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_ASSOCIATION_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,192}$/;

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeAssociationKey(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ASSOCIATION_KEY_PATTERN.test(normalized) ? normalized : null;
}

function normalizeStatus(value: unknown): CommunityOfficialClaimStatus | null {
  return value === 'pending'
    || value === 'under_review'
    || value === 'verified'
    || value === 'rejected'
    || value === 'disputed'
    || value === 'revoked'
    || value === 'expired'
    ? value
    : null;
}

function normalizeTarget(value: unknown): CommunityOfficialTarget | null {
  const source = (value ?? {}) as Record<string, unknown>;
  const type = source['type'];
  const id = normalizeId(source['id']);

  if (
    !id
    || (
      type !== 'profile'
      && type !== 'organization'
      && type !== 'venue'
      && type !== 'event'
    )
  ) {
    return null;
  }

  return { type, id };
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOptionalEpoch(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return normalizeEpoch(value) ?? undefined;
}

export function normalizeMyCommunityOfficialClaimResponse(
  raw: unknown
): MyCommunityOfficialClaimResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const generatedAt = normalizeEpoch(source['generatedAt']);
  if (!generatedAt) return null;

  if (source['claim'] === null) {
    return { claim: null, generatedAt };
  }

  const claim = (source['claim'] ?? {}) as Record<string, unknown>;
  const associationKey = normalizeAssociationKey(claim['associationKey']);
  const communityId = normalizeId(claim['communityId']);
  const target = normalizeTarget(claim['target']);
  const status = normalizeStatus(claim['status']);
  const submittedAt = normalizeEpoch(claim['submittedAt']);
  const updatedAt = normalizeEpoch(claim['updatedAt']);
  const revalidationDueAt = normalizeOptionalEpoch(claim['revalidationDueAt']);
  const verificationExpiresAt = normalizeOptionalEpoch(
    claim['verificationExpiresAt']
  );

  if (
    !associationKey
    || !communityId
    || !target
    || !status
    || !submittedAt
    || !updatedAt
    || updatedAt < submittedAt
    || revalidationDueAt === undefined
    || verificationExpiresAt === undefined
    || associationKey !== `${target.type}:${target.id}`
  ) {
    return null;
  }

  return {
    claim: {
      associationKey,
      communityId,
      target,
      status,
      submittedAt,
      updatedAt,
      revalidationDueAt,
      verificationExpiresAt,
    },
    generatedAt,
  };
}
