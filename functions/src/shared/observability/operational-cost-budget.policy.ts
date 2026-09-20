// functions/src/shared/observability/operational-cost-budget.policy.ts
// -----------------------------------------------------------------------------
// OPERATIONAL COST BUDGET
// -----------------------------------------------------------------------------
// Fonte canônica de orçamento técnico antes de qualquer otimização de custo.
// Os valores abaixo são unidades operacionais observáveis, não preços de billing.
// Isso evita acoplar o runtime a preços/tiers/regiões que podem mudar.
//
// Regra de leitura:
// - targetMax: envelope desejado para desenho/otimização;
// - warningAbove: sinal para investigação em janela agregada;
// - criticalAbove: sinal crítico para alerta/paging;
// - status por evento serve para observabilidade; alertas reais devem respeitar
//   aggregation/window/minimumSamples para evitar ruído por amostra isolada.
// -----------------------------------------------------------------------------

export type OperationalCostBudgetMetric =
  | 'community.discovery.reads_per_card'
  | 'community.discovery.exposure_writes_per_accepted'
  | 'community.discovery.callables_per_session'
  | 'community.notification.push_targets_per_notification'
  | 'community.storage.upper_bound_bytes_per_community';

export type OperationalCostBudgetStatus =
  | 'within'
  | 'warning'
  | 'critical';

export type OperationalCostBudgetAggregation = 'mean' | 'p95' | 'max';
export type OperationalCostBudgetMeasurementSource =
  | 'runtime_log'
  | 'client_synthetic';

export interface OperationalCostBudgetDefinition {
  readonly unit: string;
  readonly measurementSource: OperationalCostBudgetMeasurementSource;
  readonly targetMax: number;
  readonly warningAbove: number;
  readonly criticalAbove: number;
  readonly aggregation: OperationalCostBudgetAggregation;
  readonly windowMinutes: number;
  readonly minimumSamples: number;
  readonly semantics: string;
}

export interface OperationalCostBudgetObservation
  extends OperationalCostBudgetDefinition {
  readonly metric: OperationalCostBudgetMetric;
  readonly value: number;
  readonly status: OperationalCostBudgetStatus;
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/**
 * Discovery saudável tende a ~2 leituras por card entregue:
 * projeção + membership do viewer. Over-fetch, bloqueios e cursor aumentam isso.
 */
export const COMMUNITY_OPERATIONAL_COST_BUDGETS: Readonly<
  Record<OperationalCostBudgetMetric, OperationalCostBudgetDefinition>
> = Object.freeze({
  'community.discovery.reads_per_card': Object.freeze({
    measurementSource: 'runtime_log',
    unit: 'document-read-proxy/card',
    targetMax: 2.5,
    warningAbove: 3.5,
    criticalAbove: 5,
    aggregation: 'p95',
    windowMinutes: 15,
    minimumSamples: 100,
    semantics: 'operational_proxy_not_billed_reads',
  }),
  'community.discovery.exposure_writes_per_accepted': Object.freeze({
    measurementSource: 'runtime_log',
    unit: 'document-write-proxy/accepted-exposure',
    targetMax: 1.25,
    warningAbove: 1.5,
    criticalAbove: 2,
    aggregation: 'mean',
    windowMinutes: 15,
    minimumSamples: 100,
    semantics:
      'counter_writes_plus_one_rate_limit_write_per_successful_batch',
  }),
  'community.discovery.callables_per_session': Object.freeze({
    measurementSource: 'client_synthetic',
    unit: 'callable-invocations/session',
    targetMax: 4,
    warningAbove: 6,
    criticalAbove: 10,
    aggregation: 'p95',
    windowMinutes: 60,
    minimumSamples: 100,
    semantics:
      'client-session-envelope; do not add server session identifiers only for cost telemetry',
  }),
  'community.notification.push_targets_per_notification': Object.freeze({
    measurementSource: 'runtime_log',
    unit: 'push-targets/notification',
    targetMax: 3,
    warningAbove: 5,
    criticalAbove: 8,
    aggregation: 'p95',
    windowMinutes: 15,
    minimumSamples: 100,
    semantics: 'fresh_canonical_push_targets_after_ownership_filter',
  }),
  'community.storage.upper_bound_bytes_per_community': Object.freeze({
    measurementSource: 'runtime_log',
    unit: 'bytes/community',
    targetMax: 256 * MIB,
    warningAbove: 512 * MIB,
    criticalAbove: GIB,
    aggregation: 'max',
    windowMinutes: 24 * 60,
    minimumSamples: 1,
    semantics:
      'conservative_upper_bound_from_media_count_times_max_asset_bytes',
  }),
});

function normalizeMetricValue(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function evaluateOperationalCostBudget(
  metric: OperationalCostBudgetMetric,
  rawValue: number
): Readonly<OperationalCostBudgetObservation> {
  const definition = COMMUNITY_OPERATIONAL_COST_BUDGETS[metric];
  const value = normalizeMetricValue(rawValue);
  const status: OperationalCostBudgetStatus =
    value > definition.criticalAbove
      ? 'critical'
      : value > definition.warningAbove
        ? 'warning'
        : 'within';

  return Object.freeze({
    metric,
    value,
    status,
    ...definition,
  });
}

export function estimateExposureWritesPerAcceptedExposure(input: {
  readonly accepted: number;
  readonly successfulRateLimitWrites?: number;
}): number | null {
  const accepted = Math.max(0, Math.trunc(Number(input.accepted) || 0));
  if (accepted === 0) return null;

  const rateLimitWrites = Math.max(
    0,
    Math.trunc(Number(input.successfulRateLimitWrites ?? 1) || 0)
  );

  return Math.round(
    ((accepted + rateLimitWrites) / accepted) * 100
  ) / 100;
}

export function estimateCommunityStorageUpperBoundBytes(input: {
  readonly mediaCount: number;
  readonly maxAssetBytes: number;
}): number {
  const mediaCount = Math.max(0, Math.trunc(Number(input.mediaCount) || 0));
  const maxAssetBytes = Math.max(
    0,
    Math.trunc(Number(input.maxAssetBytes) || 0)
  );

  return mediaCount * maxAssetBytes;
}

export function isOperationalCostBudgetAlert(
  observation: OperationalCostBudgetObservation
): boolean {
  return observation.status !== 'within';
}
