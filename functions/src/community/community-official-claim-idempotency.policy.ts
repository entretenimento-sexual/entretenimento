// functions/src/community/community-official-claim-idempotency.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM IDEMPOTENCY
// -----------------------------------------------------------------------------
// O documento de request registra a tentativa idempotente, mas não é a fonte
// canônica do estado corrente. O status atual sempre vem do claim privado.
// -----------------------------------------------------------------------------

import { normalizeCommunityOfficialAssociationKey } from './community-official-association.model';
import {
  normalizeCommunityOfficialClaimStatus,
  type CommunityOfficialClaimStatus,
} from './community-official-claim.model';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export interface CommunityOfficialClaimIdempotentStatusInput {
  readonly actorUid: string;
  readonly associationKey: string;
  readonly communityId: string;
  readonly claimRecord: Readonly<Record<string, unknown>> | null;
}

export function resolveCommunityOfficialClaimIdempotentStatus(
  input: CommunityOfficialClaimIdempotentStatusInput
): CommunityOfficialClaimStatus | null {
  const claim = input.claimRecord;
  if (!claim) return null;

  const claimantUid = cleanId(claim['claimantUid']);
  const communityId = cleanId(claim['communityId']);
  const associationKey = normalizeCommunityOfficialAssociationKey(
    claim['associationKey']
  );
  const status = normalizeCommunityOfficialClaimStatus(claim['status']);

  if (
    claimantUid !== input.actorUid
    || communityId !== input.communityId
    || associationKey !== input.associationKey
    || !status
  ) {
    return null;
  }

  return status;
}
