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

export const COMMUNITY_MEMBERSHIP_RECONCILIATION_STATUSES:
readonly CommunityMembershipReconciliationStatus[] = Object.freeze([
  'active',
  'pending',
  'blocked',
  'left',
]);

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

function normalizeAggregateCount(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0
    ? normalized
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

export function summarizeCommunityMembershipOccupancyFromCounts(input: {
  totalCount: unknown;
  activeCount: unknown;
  knownStatusCount: unknown;
}): CommunityMembershipOccupancySummary {
  const totalCount = normalizeAggregateCount(input.totalCount);
  const activeCount = normalizeAggregateCount(input.activeCount);
  const knownStatusCount = normalizeAggregateCount(input.knownStatusCount);

  if (
    totalCount === null
    || activeCount === null
    || knownStatusCount === null
    || activeCount > knownStatusCount
    || knownStatusCount > totalCount
  ) {
    return {
      totalCount: totalCount ?? 0,
      activeCount: activeCount ?? 0,
      invalidStatusCount: 1,
    };
  }

  return {
    totalCount,
    activeCount,
    invalidStatusCount: totalCount - knownStatusCount,
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
