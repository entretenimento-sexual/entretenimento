// functions/src/shared/observability/operational-cost-baseline.policy.ts
// -----------------------------------------------------------------------------
// OPERATIONAL COST BASELINE
// -----------------------------------------------------------------------------
// Qualifica uma janela REAL de produção antes de qualquer recalibração comercial.
// O baseline vem de Cloud Monitoring sobre métricas derivadas dos logs existentes;
// não adiciona reads/writes ao caminho do usuário e não transforma proxies em BRL.
// -----------------------------------------------------------------------------

import {
  COMMUNITY_OPERATIONAL_COST_BUDGETS,
  type OperationalCostBudgetMetric,
} from './operational-cost-budget.policy';

export const COMMUNITY_OPERATIONAL_COST_BASELINE_VERSION = 1;
export const COMMUNITY_OPERATIONAL_COST_BASELINE_MIN_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1_000;

export type CommunityOperationalCostBaselineOnlyMetric =
  | 'community.boost.reads_proxy_per_served_placement'
  | 'community.boost.writes_proxy_per_served_placement';

export type CommunityOperationalCostObservedMetric =
  | OperationalCostBudgetMetric
  | CommunityOperationalCostBaselineOnlyMetric;

export type CommunityOperationalCostBaselineStatus =
  | 'invalid_observation'
  | 'non_production_source'
  | 'window_too_short'
  | 'missing_metric'
  | 'insufficient_samples'
  | 'ready';

export interface CommunityOperationalCostMetricEvidence {
  readonly sampleCount: unknown;
  readonly observedDays: unknown;
  readonly baselineValue?: unknown;
}

export interface CommunityOperationalCostBaselineInput {
  readonly schemaVersion: unknown;
  readonly source: unknown;
  readonly environment: unknown;
  readonly projectId: unknown;
  readonly windowStartedAt: unknown;
  readonly windowEndedAt: unknown;
  readonly generatedAt: unknown;
  readonly metrics: unknown;
}

export interface CommunityOperationalCostBaselineEvaluation {
  readonly status: CommunityOperationalCostBaselineStatus;
  readonly ready: boolean;
  readonly windowDays: number;
  readonly missingMetrics: readonly CommunityOperationalCostObservedMetric[];
  readonly insufficientMetrics: readonly CommunityOperationalCostObservedMetric[];
}

const BASELINE_ONLY_MINIMUMS: Readonly<
  Record<
    CommunityOperationalCostBaselineOnlyMetric,
    { minimumSamples: number; minimumObservedDays: number }
  >
> = Object.freeze({
  'community.boost.reads_proxy_per_served_placement': Object.freeze({
    minimumSamples: 100,
    minimumObservedDays: 7,
  }),
  'community.boost.writes_proxy_per_served_placement': Object.freeze({
    minimumSamples: 100,
    minimumObservedDays: 7,
  }),
});

export const COMMUNITY_OPERATIONAL_COST_REAL_BASELINE_METRICS:
readonly CommunityOperationalCostObservedMetric[] = Object.freeze([
  'community.discovery.reads_per_card',
  'community.discovery.exposure_writes_per_accepted',
  'community.notification.push_targets_per_notification',
  'community.storage.upper_bound_bytes_per_community',
  'community.boost.reads_proxy_per_served_placement',
  'community.boost.writes_proxy_per_served_placement',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    ? value
    : null;
}

function positiveTimestamp(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function minimumsForMetric(
  metric: CommunityOperationalCostObservedMetric
): { minimumSamples: number; minimumObservedDays: number } {
  if (metric in BASELINE_ONLY_MINIMUMS) {
    return BASELINE_ONLY_MINIMUMS[
      metric as CommunityOperationalCostBaselineOnlyMetric
    ];
  }

  const budget = COMMUNITY_OPERATIONAL_COST_BUDGETS[
    metric as OperationalCostBudgetMetric
  ];

  return {
    minimumSamples: budget.minimumSamples,
    minimumObservedDays:
      metric === 'community.storage.upper_bound_bytes_per_community' ? 1 : 7,
  };
}

export function evaluateCommunityOperationalCostBaseline(
  input: CommunityOperationalCostBaselineInput
): Readonly<CommunityOperationalCostBaselineEvaluation> {
  const startedAt = positiveTimestamp(input.windowStartedAt);
  const endedAt = positiveTimestamp(input.windowEndedAt);
  const generatedAt = positiveTimestamp(input.generatedAt);

  if (
    Number(input.schemaVersion) !== COMMUNITY_OPERATIONAL_COST_BASELINE_VERSION
    || !startedAt
    || !endedAt
    || !generatedAt
    || endedAt <= startedAt
    || generatedAt < endedAt
  ) {
    return Object.freeze({
      status: 'invalid_observation',
      ready: false,
      windowDays: 0,
      missingMetrics: [],
      insufficientMetrics: [],
    });
  }

  const windowDays = Math.floor((endedAt - startedAt) / DAY_MS);

  if (
    input.source !== 'cloud_logging_runtime_events'
    || input.environment !== 'production'
    || String(input.projectId ?? '').trim().length === 0
  ) {
    return Object.freeze({
      status: 'non_production_source',
      ready: false,
      windowDays,
      missingMetrics: [],
      insufficientMetrics: [],
    });
  }

  if (windowDays < COMMUNITY_OPERATIONAL_COST_BASELINE_MIN_DAYS) {
    return Object.freeze({
      status: 'window_too_short',
      ready: false,
      windowDays,
      missingMetrics: [],
      insufficientMetrics: [],
    });
  }

  const metrics = asRecord(input.metrics);
  const missingMetrics: CommunityOperationalCostObservedMetric[] = [];
  const insufficientMetrics: CommunityOperationalCostObservedMetric[] = [];

  for (const metric of COMMUNITY_OPERATIONAL_COST_REAL_BASELINE_METRICS) {
    const evidence = asRecord(metrics[metric]);
    const sampleCount = nonNegativeInteger(evidence['sampleCount']);
    const observedDays = nonNegativeInteger(evidence['observedDays']);

    if (sampleCount === null || observedDays === null) {
      missingMetrics.push(metric);
      continue;
    }

    const minimums = minimumsForMetric(metric);
    if (
      sampleCount < minimums.minimumSamples
      || observedDays < minimums.minimumObservedDays
    ) {
      insufficientMetrics.push(metric);
    }
  }

  if (missingMetrics.length > 0) {
    return Object.freeze({
      status: 'missing_metric',
      ready: false,
      windowDays,
      missingMetrics,
      insufficientMetrics,
    });
  }

  if (insufficientMetrics.length > 0) {
    return Object.freeze({
      status: 'insufficient_samples',
      ready: false,
      windowDays,
      missingMetrics,
      insufficientMetrics,
    });
  }

  return Object.freeze({
    status: 'ready',
    ready: true,
    windowDays,
    missingMetrics,
    insufficientMetrics,
  });
}
