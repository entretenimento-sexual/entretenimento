// functions/src/community/community-ownership-transfer.workflow.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNERSHIP TRANSFER WORKFLOW POLICY
// -----------------------------------------------------------------------------
// Ownership nunca muda no momento da indicação. O proprietário (ou staff em
// sucessão terminal) cria uma oferta; o candidato precisa aceitar explicitamente.
// A aceitação revalida toda elegibilidade imediatamente antes da mutação.
// -----------------------------------------------------------------------------

export const COMMUNITY_OWNERSHIP_TRANSFER_RESPONSE_WINDOW_MS =
  7 * 24 * 60 * 60 * 1_000;
export const COMMUNITY_OWNER_TERMINAL_SUCCESSION_WINDOW_MS =
  14 * 24 * 60 * 60 * 1_000;
export const COMMUNITY_OWNERSHIP_WORKFLOW_POLICY_VERSION = 1 as const;

export type CommunityOwnershipTransferMode =
  | 'voluntary'
  | 'terminal_succession';

export type CommunityOwnershipTransferStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'canceled'
  | 'expired'
  | 'completed';

export type CommunityOwnerTerminalSuccessionTrigger =
  | 'owner_terminally_unavailable'
  | 'confirmed_abandonment';

export type CommunityOwnerSuccessionCaseStatus =
  | 'open'
  | 'completed'
  | 'archived'
  | 'canceled';

export function resolveCommunityOwnershipTransferExpiresAt(input: {
  readonly now: number;
  readonly terminalDeadlineAt?: number | null;
}): number {
  const responseDeadline =
    input.now + COMMUNITY_OWNERSHIP_TRANSFER_RESPONSE_WINDOW_MS;
  const terminalDeadline = Number(input.terminalDeadlineAt);

  return Number.isFinite(terminalDeadline) && terminalDeadline > input.now
    ? Math.min(responseDeadline, Math.trunc(terminalDeadline))
    : responseDeadline;
}

export function isCommunityOwnershipTransferPending(
  status: unknown,
  expiresAt: unknown,
  now: number
): boolean {
  return status === 'pending'
    && Number.isFinite(Number(expiresAt))
    && Number(expiresAt) > now;
}

export function isCommunityOwnershipTransferExpired(
  status: unknown,
  expiresAt: unknown,
  now: number
): boolean {
  return status === 'pending'
    && (
      !Number.isFinite(Number(expiresAt))
      || Number(expiresAt) <= now
    );
}

export function canNominateCommunityOwnershipCandidate(input: {
  readonly explicitlyDesignated: boolean;
  readonly membershipActive: boolean;
  readonly accountEligible: boolean;
  readonly ownershipEntitlementEligible: boolean;
  readonly ownershipQuotaAvailable: boolean;
  readonly ownershipCapacityCompatible: boolean;
}): boolean {
  return input.explicitlyDesignated
    && input.membershipActive
    && input.accountEligible
    && input.ownershipEntitlementEligible
    && input.ownershipQuotaAvailable
    && input.ownershipCapacityCompatible;
}

export function canAcceptCommunityOwnershipTransfer(input: {
  readonly requestStatus: unknown;
  readonly expiresAt: unknown;
  readonly now: number;
  readonly candidateMatches: boolean;
  readonly ownerSnapshotMatches: boolean;
  readonly membershipActive: boolean;
  readonly accountEligible: boolean;
  readonly ownershipEntitlementEligible: boolean;
  readonly ownershipQuotaAvailable: boolean;
  readonly ownershipCapacityCompatible: boolean;
}): boolean {
  return isCommunityOwnershipTransferPending(
    input.requestStatus,
    input.expiresAt,
    input.now
  )
    && input.candidateMatches
    && input.ownerSnapshotMatches
    && input.membershipActive
    && input.accountEligible
    && input.ownershipEntitlementEligible
    && input.ownershipQuotaAvailable
    && input.ownershipCapacityCompatible;
}
