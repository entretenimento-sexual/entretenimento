// functions/src/shared/observability/product-calibration-observation.policy.ts
// -----------------------------------------------------------------------------
// PRODUCT CALIBRATION RUNTIME OBSERVATION
// -----------------------------------------------------------------------------
// Estrutura mínima e não identificável para registrar sinais reais de runtime
// usados somente em calibração posterior. Não grava estado adicional no caminho
// do usuário; os consumidores emitem o objeto no Cloud Logging.
// -----------------------------------------------------------------------------

export type ProductCalibrationRuntimeMetric =
  | 'community.projection.derived_writes_per_source_event'
  | 'community.notification.grouped_activities_per_push';

export interface ProductCalibrationRuntimeObservation {
  readonly metric: ProductCalibrationRuntimeMetric;
  readonly value: number;
  readonly source: string;
  readonly semantics: 'production_runtime_observation';
}

function normalizeValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 10_000) / 10_000;
}

function normalizeSource(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[^a-z0-9_.-]+/giu, '_')
    .slice(0, 96) || 'unknown';
}

export function buildProductCalibrationRuntimeObservation(input: {
  readonly metric: ProductCalibrationRuntimeMetric;
  readonly value: unknown;
  readonly source: unknown;
}): Readonly<ProductCalibrationRuntimeObservation> {
  return Object.freeze({
    metric: input.metric,
    value: normalizeValue(input.value),
    source: normalizeSource(input.source),
    semantics: 'production_runtime_observation',
  });
}
