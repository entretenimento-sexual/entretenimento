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

export interface CommunityCapacityRegularizationManagementProjection {
  readonly phase: CommunityCapacityRegularizationPhase;
  readonly reason: Exclude<CommunityCapacityRegularizationReason, null>;
  readonly startedAt: number;
  readonly dueAt: number;
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

function normalizeRegularizationReason(
  value: unknown
): Exclude<CommunityCapacityRegularizationReason, null> | null {
  return value === 'owner_subscription_required'
    || value === 'capacity_over_plan'
    || value === 'ownership_over_plan'
    || value === 'official_entitlement_required'
    || value === 'capacity_over_entitlement'
    ? value
    : null;
}

export function sanitizeCommunityCapacityRegularizationForManagement(
  rawRegularization: unknown,
  now = Date.now()
): Readonly<CommunityCapacityRegularizationManagementProjection> | null {
  const value = record(rawRegularization);
  const reason = normalizeRegularizationReason(value['reason']);
  const startedAt = finitePositiveTimestamp(value['startedAt']);
  const dueAt = finitePositiveTimestamp(value['dueAt']);

  if (
    value['state'] !== 'capacity_regularization'
    || reason === null
    || startedAt === null
    || dueAt === null
    || dueAt < startedAt
  ) {
    return null;
  }

  return Object.freeze({
    phase: now >= dueAt ? 'overdue' as const : 'grace_period' as const,
    reason,
    startedAt,
    dueAt,
  });
}

export function resolveCommunityCapacityRegularizationForViewer(
  rawRegularization: unknown,
  viewerRole: unknown,
  now = Date.now()
): Readonly<CommunityCapacityRegularizationManagementProjection> | null {
  if (viewerRole !== 'owner' && viewerRole !== 'admin') return null;

  return sanitizeCommunityCapacityRegularizationForManagement(
    rawRegularization,
    now
  );
}

export function resolveCommunityCapacityRegularizationClockOwnerUid(
  rawRegularization: unknown,
  now = Date.now()
): string | null {
  const value = record(rawRegularization);
  const dueAt = finitePositiveTimestamp(value['dueAt']);
  const ownerUid = String(value['ownerUid'] ?? '').trim();

  if (
    value['state'] !== 'capacity_regularization'
    || value['phase'] !== 'grace_period'
    || dueAt === null
    || now < dueAt
    || !/^[A-Za-z0-9:_-]{1,160}$/.test(ownerUid)
  ) {
    return null;
  }

  return ownerUid;
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
