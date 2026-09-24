// functions/src/community/community-capacity-regularization.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAPACITY REGULARIZATION POLICY
// -----------------------------------------------------------------------------
// Downgrade/perda de entitlement nunca remove membros nem transfere ownership.
// Quando a capacidade vigente deixa de sustentar a Comunidade, abre-se uma
// janela explícita para regularizar plano, transferir ou arquivar.
// -----------------------------------------------------------------------------

import type {
  CommunityCapacityRegularizationReason,
  CommunityCapacityState,
} from './community-capacity.policy';
import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';

export type CommunityCapacityRegularizationPhase =
  | 'grace_period'
  | 'overdue';

export interface CommunityCapacityRegularization {
  readonly state: 'capacity_regularization';
  readonly phase: CommunityCapacityRegularizationPhase;
  readonly reason: Exclude<CommunityCapacityRegularizationReason, null>;
  readonly ownerUid: string;
  readonly configuredLimit: number;
  readonly effectiveLimit: number;
  readonly startedAt: number;
  readonly dueAt: number;
  readonly policyVersion: 1;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function finitePositiveTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

export function resolveCapacityRegularizationGracePeriodMs(): number {
  return COMMUNITY_PRODUCT_LIMITS.capacityRegularization.gracePeriodDays
    * DAY_MS;
}

export function buildCommunityCapacityRegularization(input: {
  readonly rawExisting: unknown;
  readonly capacity: Readonly<CommunityCapacityState>;
  readonly ownerUid: string;
  readonly reasonOverride?: Exclude<CommunityCapacityRegularizationReason, null>;
  readonly now?: number;
}): Readonly<CommunityCapacityRegularization> | null {
  const reason = input.reasonOverride ?? input.capacity.regularizationReason;
  if (!input.capacity.regularizationRequired && reason === null) {
    return null;
  }
  if (reason === null) return null;

  const now = Number.isFinite(input.now)
    ? Math.trunc(input.now as number)
    : Date.now();
  const existing = record(input.rawExisting);
  const sameCycle =
    existing['state'] === 'capacity_regularization'
    && existing['reason'] === reason
    && existing['ownerUid'] === input.ownerUid;
  const startedAt = sameCycle
    ? finitePositiveTimestamp(existing['startedAt']) ?? now
    : now;
  const dueAt = startedAt + resolveCapacityRegularizationGracePeriodMs();

  return Object.freeze({
    state: 'capacity_regularization' as const,
    phase: now >= dueAt ? 'overdue' as const : 'grace_period' as const,
    reason,
    ownerUid: input.ownerUid,
    configuredLimit: input.capacity.configuredLimit,
    effectiveLimit: input.capacity.effectiveLimit,
    startedAt,
    dueAt,
    policyVersion: 1 as const,
  });
}

export function isCommunityCapacityRegularizationOverdue(
  rawRegularization: unknown,
  now = Date.now()
): boolean {
  const value = record(rawRegularization);
  const dueAt = finitePositiveTimestamp(value['dueAt']);

  return value['state'] === 'capacity_regularization'
    && dueAt !== null
    && now >= dueAt;
}
