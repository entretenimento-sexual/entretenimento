// functions/src/community/community-capacity-regularization.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAPACITY REGULARIZATION
// -----------------------------------------------------------------------------
// Governa a incompatibilidade persistente entre assinatura, ownership e
// capacidade sem remover membros nem transferir propriedade automaticamente.
// O downgrade reduz a capacidade efetiva imediatamente; a regularização adiciona
// prazo explícito para o owner escolher plano, transferência ou arquivamento.
// -----------------------------------------------------------------------------

import type {
  CommunityCapacityState,
  CommunityEffectiveMemberLimit,
  CommunityMemberLimit,
  CommunityCapacityRegularizationReason,
  PersonalCommunitySponsorRole,
} from './community-capacity.policy';
import {
  resolveCommunityConfiguredMemberLimit,
} from './community-capacity.policy';
import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';

export const COMMUNITY_CAPACITY_REGULARIZATION_POLICY_VERSION = 1;

export type CommunityCapacityRegularizationStatus =
  | 'grace_period'
  | 'action_required';

export type CommunityCapacityGovernanceReason =
  | 'owner_subscription_required'
  | 'capacity_over_plan'
  | 'owned_community_quota_exceeded';

export type CommunityCapacityRegularizationAction =
  | 'regularize_plan'
  | 'transfer_ownership'
  | 'archive';

export interface CommunityCapacityRegularizationState {
  readonly policyVersion: number;
  readonly status: CommunityCapacityRegularizationStatus;
  readonly ownerUid: string;
  readonly reasons: readonly CommunityCapacityGovernanceReason[];
  readonly sponsorRole: PersonalCommunitySponsorRole;
  readonly currentOwnedCommunities: number;
  readonly maxOwnedCommunities: number | null;
  readonly configuredMemberLimit: CommunityMemberLimit;
  readonly planMemberLimit: CommunityEffectiveMemberLimit;
  readonly startedAt: number;
  readonly deadlineAt: number;
  readonly nextEvaluationAt: number | null;
  readonly availableActions: readonly CommunityCapacityRegularizationAction[];
  readonly updatedAt: number;
}

export const COMMUNITY_CAPACITY_REGULARIZATION_ACTIONS =
  Object.freeze([
    'regularize_plan',
    'transfer_ownership',
    'archive',
  ] as const);

const SAFE_UID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizeSponsorRole(value: unknown): PersonalCommunitySponsorRole | null {
  return value === 'free'
    || value === 'basic'
    || value === 'premium'
    || value === 'vip'
    || value === 'admin'
    ? value
    : null;
}

function normalizeReason(
  value: unknown
): CommunityCapacityGovernanceReason | null {
  return value === 'owner_subscription_required'
    || value === 'capacity_over_plan'
    || value === 'owned_community_quota_exceeded'
    ? value
    : null;
}

export function normalizeCommunityCapacityRegularizationState(
  rawCommunity: unknown
): Readonly<CommunityCapacityRegularizationState> | null {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const raw = community['capacityRegularization'];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const source = raw as Record<string, unknown>;
  const ownerUid = String(source['ownerUid'] ?? '').trim();
  const status = source['status'];
  const sponsorRole = normalizeSponsorRole(source['sponsorRole']);
  const currentOwnedCommunities = finiteNonNegativeInteger(
    source['currentOwnedCommunities']
  );
  const rawMaximum = source['maxOwnedCommunities'];
  const maxOwnedCommunities = rawMaximum === null
    ? null
    : finiteNonNegativeInteger(rawMaximum);
  const configuredMemberLimit = finitePositiveNumber(
    source['configuredMemberLimit']
  );
  const rawPlanLimit = source['planMemberLimit'];
  const planMemberLimit = rawPlanLimit === 0
    ? 0
    : finitePositiveNumber(rawPlanLimit);
  const startedAt = finitePositiveNumber(source['startedAt']);
  const deadlineAt = finitePositiveNumber(source['deadlineAt']);
  const nextEvaluationAt = source['nextEvaluationAt'] === null
    ? null
    : finitePositiveNumber(source['nextEvaluationAt']);
  const reasons = Array.isArray(source['reasons'])
    ? [...new Set(
      source['reasons']
        .map(normalizeReason)
        .filter((reason): reason is CommunityCapacityGovernanceReason =>
          reason !== null
        )
    )]
    : [];

  if (
    source['policyVersion'] !== COMMUNITY_CAPACITY_REGULARIZATION_POLICY_VERSION
    || !SAFE_UID_PATTERN.test(ownerUid)
    || (status !== 'grace_period' && status !== 'action_required')
    || !sponsorRole
    || currentOwnedCommunities === null
    || (rawMaximum !== null && maxOwnedCommunities === null)
    || configuredMemberLimit === null
    || planMemberLimit === null
    || startedAt === null
    || deadlineAt === null
    || deadlineAt < startedAt
    || reasons.length === 0
  ) {
    return null;
  }

  return {
    policyVersion: COMMUNITY_CAPACITY_REGULARIZATION_POLICY_VERSION,
    status,
    ownerUid,
    reasons,
    sponsorRole,
    currentOwnedCommunities,
    maxOwnedCommunities,
    configuredMemberLimit: configuredMemberLimit as CommunityMemberLimit,
    planMemberLimit: planMemberLimit as CommunityEffectiveMemberLimit,
    startedAt,
    deadlineAt,
    nextEvaluationAt: status === 'grace_period'
      ? nextEvaluationAt ?? deadlineAt
      : null,
    availableActions: COMMUNITY_CAPACITY_REGULARIZATION_ACTIONS,
    updatedAt: finitePositiveNumber(source['updatedAt']) ?? startedAt,
  };
}

export function evaluateCommunityCapacityRegularization(input: {
  readonly rawCommunity: unknown;
  readonly ownerUid: string;
  readonly sponsorRole: PersonalCommunitySponsorRole;
  readonly currentOwnedCommunities: number;
  readonly maxOwnedCommunities: number | null;
  readonly planMemberLimit: CommunityEffectiveMemberLimit;
  readonly now?: number;
}): Readonly<CommunityCapacityRegularizationState> | null {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const configuredMemberLimit = resolveCommunityConfiguredMemberLimit(
    input.rawCommunity
  );
  const reasons: CommunityCapacityGovernanceReason[] = [];

  if (input.planMemberLimit === 0) {
    reasons.push('owner_subscription_required');
  } else if (configuredMemberLimit > input.planMemberLimit) {
    reasons.push('capacity_over_plan');
  }

  if (
    input.maxOwnedCommunities !== null
    && input.currentOwnedCommunities > input.maxOwnedCommunities
  ) {
    reasons.push('owned_community_quota_exceeded');
  }

  if (reasons.length === 0) return null;

  const existing = normalizeCommunityCapacityRegularizationState(
    input.rawCommunity
  );
  const preserveCycle = existing?.ownerUid === input.ownerUid;
  const gracePeriodDays =
    COMMUNITY_PRODUCT_LIMITS.capacityRegularization.gracePeriodDays;
  const startedAt = preserveCycle ? existing.startedAt : now;
  const deadlineAt = preserveCycle
    ? existing.deadlineAt
    : startedAt + gracePeriodDays * DAY_MS;
  const status: CommunityCapacityRegularizationStatus =
    existing?.status === 'action_required' || now >= deadlineAt
      ? 'action_required'
      : 'grace_period';

  return {
    policyVersion: COMMUNITY_CAPACITY_REGULARIZATION_POLICY_VERSION,
    status,
    ownerUid: input.ownerUid,
    reasons,
    sponsorRole: input.sponsorRole,
    currentOwnedCommunities: Math.max(
      0,
      Math.trunc(input.currentOwnedCommunities)
    ),
    maxOwnedCommunities: input.maxOwnedCommunities,
    configuredMemberLimit,
    planMemberLimit: input.planMemberLimit,
    startedAt,
    deadlineAt,
    nextEvaluationAt: status === 'grace_period' ? deadlineAt : null,
    availableActions: COMMUNITY_CAPACITY_REGULARIZATION_ACTIONS,
    updatedAt: now,
  };
}

export function isCommunityCapacityRegularizationActionRequired(
  rawCommunity: unknown
): boolean {
  return normalizeCommunityCapacityRegularizationState(rawCommunity)?.status
    === 'action_required';
}

export function applyCommunityCapacityRegularizationGate(
  state: Readonly<CommunityCapacityState>,
  rawCommunity: unknown
): Readonly<CommunityCapacityState> {
  const regularization = normalizeCommunityCapacityRegularizationState(
    rawCommunity
  );

  if (regularization?.status !== 'action_required') return state;

  const reason: CommunityCapacityRegularizationReason =
    regularization.reasons.includes('owner_subscription_required')
      ? 'owner_subscription_required'
      : regularization.reasons.includes('capacity_over_plan')
        ? 'capacity_over_plan'
        : 'owned_community_quota_exceeded';

  return {
    ...state,
    effectiveLimit: 0,
    acceptingNewMembers: false,
    restrictedByOwnerPlan: true,
    regularizationRequired: true,
    regularizationReason: reason,
    atCapacity: true,
  };
}
