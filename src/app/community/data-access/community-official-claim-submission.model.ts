// src/app/community/data-access/community-official-claim-submission.model.ts
import type { CommunityOfficialClaimStatus } from './community-official-claim.model';
import type { CommunityOfficialTarget } from './community-official-target.policy';

export interface SubmitCommunityOfficialClaimInput {
  readonly requestId: string;
  readonly communityId: string;
  readonly target: CommunityOfficialTarget;
  readonly declarationAccepted: true;
}

export interface SubmitCommunityOfficialClaimResponse {
  readonly associationKey: string;
  readonly status: CommunityOfficialClaimStatus;
  readonly submitted: boolean;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_ASSOCIATION_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,192}$/;

function cleanStatus(value: unknown): CommunityOfficialClaimStatus | null {
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

export function normalizeSubmitCommunityOfficialClaimResponse(
  raw: unknown
): SubmitCommunityOfficialClaimResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const associationKey = String(source['associationKey'] ?? '').trim();
  const status = cleanStatus(source['status']);

  if (
    !SAFE_ASSOCIATION_KEY_PATTERN.test(associationKey)
    || !status
    || typeof source['submitted'] !== 'boolean'
  ) {
    return null;
  }

  return {
    associationKey,
    status,
    submitted: source['submitted'],
  };
}

export function normalizeSubmitCommunityOfficialClaimInput(
  input: SubmitCommunityOfficialClaimInput
): SubmitCommunityOfficialClaimInput | null {
  const requestId = String(input.requestId ?? '').trim();
  const communityId = String(input.communityId ?? '').trim();
  const targetId = String(input.target?.id ?? '').trim();
  const targetType = input.target?.type;

  if (
    !SAFE_ID_PATTERN.test(requestId)
    || !SAFE_ID_PATTERN.test(communityId)
    || !SAFE_ID_PATTERN.test(targetId)
    || (
      targetType !== 'profile'
      && targetType !== 'organization'
      && targetType !== 'venue'
      && targetType !== 'event'
    )
    || input.declarationAccepted !== true
  ) {
    return null;
  }

  return {
    requestId,
    communityId,
    target: { type: targetType, id: targetId },
    declarationAccepted: true,
  };
}
