// functions/src/community/community-member-count-reconciliation.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER COUNT RECONCILIATION POLICY
// -----------------------------------------------------------------------------
// A ocupação autoritativa é derivada dos memberships persistidos. Qualquer
// estado desconhecido impede reparo automático: corrupção não pode ser
// reinterpretada silenciosamente como membro inativo.
// -----------------------------------------------------------------------------

import { normalizeCommunityMemberCount } from './community-member-count.policy';

export type CommunityMembershipReconciliationStatus =
  | 'active'
  | 'pending'
  | 'blocked'
  | 'left';

export interface CommunityMembershipOccupancySummary {
  totalCount: number;
  activeCount: number;
  invalidStatusCount: number;
}

export type CommunityMemberCountProjectionState =
  | 'consistent'
  | 'drift'
  | 'projection_invalid'
  | 'membership_state_invalid';

export interface CommunityMemberCountProjectionDecision {
  state: CommunityMemberCountProjectionState;
  projectedCount: number | null;
  activeCount: number;
  invalidStatusCount: number;
  repairable: boolean;
  needsRepair: boolean;
}

function normalizeMembershipStatus(
  value: unknown
): CommunityMembershipReconciliationStatus | null {
  return value === 'active'
    || value === 'pending'
    || value === 'blocked'
    || value === 'left'
    ? value
    : null;
}

export function summarizeCommunityMembershipOccupancy(
  rawStatuses: readonly unknown[]
): CommunityMembershipOccupancySummary {
  let activeCount = 0;
  let invalidStatusCount = 0;

  for (const rawStatus of rawStatuses) {
    const status = normalizeMembershipStatus(rawStatus);
    if (status === 'active') activeCount += 1;
    if (status === null) invalidStatusCount += 1;
  }

  return {
    totalCount: rawStatuses.length,
    activeCount,
    invalidStatusCount,
  };
}

export function evaluateCommunityMemberCountProjection(
  rawProjectedCount: unknown,
  occupancy: CommunityMembershipOccupancySummary
): CommunityMemberCountProjectionDecision {
  const projectedCount = normalizeCommunityMemberCount(rawProjectedCount);

  if (occupancy.invalidStatusCount > 0) {
    return {
      state: 'membership_state_invalid',
      projectedCount,
      activeCount: occupancy.activeCount,
      invalidStatusCount: occupancy.invalidStatusCount,
      repairable: false,
      needsRepair: false,
    };
  }

  if (projectedCount === null) {
    return {
      state: 'projection_invalid',
      projectedCount: null,
      activeCount: occupancy.activeCount,
      invalidStatusCount: 0,
      repairable: true,
      needsRepair: true,
    };
  }

  if (projectedCount !== occupancy.activeCount) {
    return {
      state: 'drift',
      projectedCount,
      activeCount: occupancy.activeCount,
      invalidStatusCount: 0,
      repairable: true,
      needsRepair: true,
    };
  }

  return {
    state: 'consistent',
    projectedCount,
    activeCount: occupancy.activeCount,
    invalidStatusCount: 0,
    repairable: true,
    needsRepair: false,
  };
}
