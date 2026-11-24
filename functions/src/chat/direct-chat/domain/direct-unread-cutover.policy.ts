/** Release decision only. No runtime switch, remote flag or client grant.
 * The current deployment cannot serve experimental unread projections.
 * Keep the hard block until the missing architecture is actually implemented.
 */
export const DIRECT_UNREAD_PROJECTION_RUNTIME_READY: boolean = false;

export const DIRECT_UNREAD_REQUIRED_RELEASE_GATES = [
  'qualityGatePassed',
  'completeSourceCoverageVerified',
  'snapshotSafeHistoryMigrationVerified',
  'incrementalReconciliationVerified',
  'authorizedGlobalAggregationVerified',
  'blockAndLifecycleReactivityVerified',
  'rulesAndSessionIsolationVerified',
  'operatorAuthorizationAndRetentionVerified',
  'costAndContentionBudgetVerified',
  'independentShadowComparisonVerified',
  'rollbackRehearsalVerified',
] as const;

type ReleaseGate = typeof DIRECT_UNREAD_REQUIRED_RELEASE_GATES[number];
export type DirectUnreadRequestedMode = 'RECEIPTS' | 'SHADOW' | 'PROJECTION';

export interface DirectUnreadCutoverDecision {
  readonly activeAuthority: 'RECEIPTS' | 'PROJECTION';
  readonly shadowPermitted: boolean;
  readonly blockers: readonly string[];
}

/** Pure decision for release rehearsals, not a grant of operational authority. */
export function resolveDirectUnreadCutover(
  requestedMode: unknown,
  emergencyStop: unknown,
  evidence: unknown
): DirectUnreadCutoverDecision {
  const blockers: string[] = [];
  if (requestedMode !== 'RECEIPTS' && requestedMode !== 'SHADOW' && requestedMode !== 'PROJECTION') {
    return { activeAuthority: 'RECEIPTS', shadowPermitted: false, blockers: ['INVALID_MODE'] };
  }
  // Missing or malformed kill switch is treated as engaged.
  if (emergencyStop !== false) {
    return { activeAuthority: 'RECEIPTS', shadowPermitted: false, blockers: ['EMERGENCY_STOP'] };
  }
  if (requestedMode === 'RECEIPTS') {
    return { activeAuthority: 'RECEIPTS', shadowPermitted: false, blockers: [] };
  }
  if (requestedMode === 'SHADOW') {
    return { activeAuthority: 'RECEIPTS', shadowPermitted: true, blockers: [] };
  }
  const record = evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    ? evidence as Partial<Record<ReleaseGate, unknown>> : {};
  for (const gate of DIRECT_UNREAD_REQUIRED_RELEASE_GATES) {
    if (!Object.prototype.hasOwnProperty.call(record, gate) || record[gate] !== true) blockers.push(gate);
  }
  if (!DIRECT_UNREAD_PROJECTION_RUNTIME_READY) blockers.push('RUNTIME_NOT_IMPLEMENTED');
  return {
    activeAuthority: blockers.length === 0 ? 'PROJECTION' : 'RECEIPTS',
    shadowPermitted: false,
    blockers,
  };
}
