// src/app/community/data-access/community-capacity-regularization.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAPACITY REGULARIZATION - CLIENT CONTRACT
// -----------------------------------------------------------------------------
// O cliente recebe somente uma projeção operacional mínima. Entitlement, UID do
// proprietário, preços e regras comerciais permanecem exclusivamente canônicos
// no backend.
// -----------------------------------------------------------------------------

export type CommunityCapacityRegularizationPhase =
  | 'grace_period'
  | 'overdue';

export type CommunityCapacityRegularizationReason =
  | 'owner_subscription_required'
  | 'capacity_over_plan'
  | 'ownership_over_plan'
  | 'official_entitlement_required'
  | 'capacity_over_entitlement';

export interface CommunityCapacityRegularizationPreview {
  readonly phase: CommunityCapacityRegularizationPhase;
  readonly reason: CommunityCapacityRegularizationReason;
  readonly startedAt: number;
  readonly dueAt: number;
}

function finitePositiveTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeReason(
  value: unknown
): CommunityCapacityRegularizationReason | null {
  return value === 'owner_subscription_required'
    || value === 'capacity_over_plan'
    || value === 'ownership_over_plan'
    || value === 'official_entitlement_required'
    || value === 'capacity_over_entitlement'
    ? value
    : null;
}

export function normalizeCommunityCapacityRegularizationPreview(
  raw: unknown,
  now = Date.now()
): CommunityCapacityRegularizationPreview | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const reason = normalizeReason(source['reason']);
  const startedAt = finitePositiveTimestamp(source['startedAt']);
  const dueAt = finitePositiveTimestamp(source['dueAt']);

  if (
    reason === null
    || startedAt === null
    || dueAt === null
    || dueAt < startedAt
  ) {
    return null;
  }

  return {
    phase: now >= dueAt ? 'overdue' : 'grace_period',
    reason,
    startedAt,
    dueAt,
  };
}
