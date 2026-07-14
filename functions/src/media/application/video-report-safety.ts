export interface VideoReportCounterInput {
  reportsCount?: unknown;
  openReportsCount?: unknown;
  confirmedReportsCount?: unknown;
}

export type VideoReportCounterEvent = 'OPEN' | 'KEEP' | 'REMOVE';

export interface VideoReportSafetyState {
  reportsCount: number;
  openReportsCount: number;
  confirmedReportsCount: number;
  safetyScore: number;
}

function normalizeCount(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function calculateSafetyScore(
  openReportsCount: number,
  confirmedReportsCount: number
): number {
  const penalty = openReportsCount * 8 + confirmedReportsCount * 25;
  return Math.max(0, Math.min(100, 100 - penalty));
}

/**
 * Mantém contadores de denúncia e score de segurança em uma única regra pura.
 *
 * OPEN registra uma nova denúncia pendente. KEEP encerra uma denúncia
 * improcedente. REMOVE confirma a denúncia e mantém o histórico do incidente.
 */
export function buildVideoReportSafetyState(
  current: VideoReportCounterInput,
  event: VideoReportCounterEvent
): VideoReportSafetyState {
  const reportsCount = normalizeCount(current.reportsCount);
  const openReportsCount = normalizeCount(current.openReportsCount);
  const confirmedReportsCount = normalizeCount(current.confirmedReportsCount);

  const nextReportsCount = event === 'OPEN'
    ? reportsCount + 1
    : reportsCount;
  const nextOpenReportsCount = event === 'OPEN'
    ? openReportsCount + 1
    : Math.max(0, openReportsCount - 1);
  const nextConfirmedReportsCount = event === 'REMOVE'
    ? confirmedReportsCount + 1
    : confirmedReportsCount;

  return {
    reportsCount: nextReportsCount,
    openReportsCount: nextOpenReportsCount,
    confirmedReportsCount: nextConfirmedReportsCount,
    safetyScore: calculateSafetyScore(
      nextOpenReportsCount,
      nextConfirmedReportsCount
    ),
  };
}
