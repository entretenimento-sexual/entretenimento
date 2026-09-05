// src/app/community/data-access/community-official-claim-admin.model.ts

export type CommunityOfficialClaimAdminStatus =
  | 'pending'
  | 'under_review'
  | 'disputed';

export type CommunityOfficialClaimAdminDecision =
  | 'approve'
  | 'reject'
  | 'mark_disputed'
  | 'revoke';

export interface CommunityOfficialClaimAdminItem {
  associationKey: string;
  communityId: string;
  target: {
    type: 'profile' | 'organization' | 'venue' | 'event';
    id: string;
  };
  claimantUid: string;
  authorityRole:
    | 'self'
    | 'owner'
    | 'authorized_representative'
    | 'manager'
    | 'organizer'
    | 'promoter';
  sponsorOrganizationId: string | null;
  evidenceReferences: Array<{
    type:
      | 'profile_kyc_record'
      | 'organization_kyb_record'
      | 'authority_record'
      | 'event_authorization_record';
    referenceId: string;
  }>;
  status: CommunityOfficialClaimAdminStatus;
  submittedAt: number;
  revalidationRequestedAt: number | null;
  updatedAt: number;
}

export interface CommunityOfficialClaimReviewQueueResponse {
  items: CommunityOfficialClaimAdminItem[];
}

export interface CommunityOfficialClaimAdminReviewCommand {
  associationKey: string;
  decision: CommunityOfficialClaimAdminDecision;
  resolution: string;
  verificationExpiresAt: number | null;
  revalidationDueAt: number | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,192}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanEpoch(value: unknown): number | null {
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function normalizeItem(raw: unknown): CommunityOfficialClaimAdminItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const rawTarget = (source['target'] ?? {}) as Record<string, unknown>;
  const targetType = rawTarget['type'];
  const targetId = cleanId(rawTarget['id']);
  const associationKey = cleanId(source['associationKey']);
  const communityId = cleanId(source['communityId']);
  const claimantUid = cleanId(source['claimantUid']);
  const status = source['status'];
  const authorityRole = source['authorityRole'];
  const submittedAt = cleanEpoch(source['submittedAt']);
  const updatedAt = cleanEpoch(source['updatedAt']);

  if (
    !associationKey
    || !communityId
    || !claimantUid
    || !targetId
    || !submittedAt
    || !updatedAt
    || (
      targetType !== 'profile'
      && targetType !== 'organization'
      && targetType !== 'venue'
      && targetType !== 'event'
    )
    || (
      status !== 'pending'
      && status !== 'under_review'
      && status !== 'disputed'
    )
    || (
      authorityRole !== 'self'
      && authorityRole !== 'owner'
      && authorityRole !== 'authorized_representative'
      && authorityRole !== 'manager'
      && authorityRole !== 'organizer'
      && authorityRole !== 'promoter'
    )
  ) {
    return null;
  }

  const sponsorOrganizationId = source['sponsorOrganizationId'] === null
    || source['sponsorOrganizationId'] === undefined
    ? null
    : cleanId(source['sponsorOrganizationId']);

  if (
    source['sponsorOrganizationId'] !== null
    && source['sponsorOrganizationId'] !== undefined
    && !sponsorOrganizationId
  ) {
    return null;
  }

  const evidenceReferences = Array.isArray(source['evidenceReferences'])
    ? source['evidenceReferences']
      .map((rawReference) => {
        const reference = (rawReference ?? {}) as Record<string, unknown>;
        const type = reference['type'];
        const referenceId = cleanId(reference['referenceId']);

        if (
          !referenceId
          || (
            type !== 'profile_kyc_record'
            && type !== 'organization_kyb_record'
            && type !== 'authority_record'
            && type !== 'event_authorization_record'
          )
        ) {
          return null;
        }

        return { type, referenceId };
      })
      .filter((reference): reference is CommunityOfficialClaimAdminItem['evidenceReferences'][number] => !!reference)
      .slice(0, 8)
    : [];

  const revalidationRequestedAt = source['revalidationRequestedAt'] === null
    || source['revalidationRequestedAt'] === undefined
    ? null
    : cleanEpoch(source['revalidationRequestedAt']);

  return {
    associationKey,
    communityId,
    target: { type: targetType, id: targetId },
    claimantUid,
    authorityRole,
    sponsorOrganizationId,
    evidenceReferences,
    status,
    submittedAt,
    revalidationRequestedAt,
    updatedAt,
  };
}

export function normalizeCommunityOfficialClaimReviewQueueResponse(
  raw: unknown
): CommunityOfficialClaimReviewQueueResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(source['items'])) return null;

  const items = source['items']
    .map(normalizeItem)
    .filter((item): item is CommunityOfficialClaimAdminItem => !!item);

  return { items };
}
