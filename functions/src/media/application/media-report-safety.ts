export interface MediaReportCounterInput {
  reportsCount?: unknown;
  openReportsCount?: unknown;
  confirmedReportsCount?: unknown;
}

export type MediaReportCounterEvent = 'OPEN' | 'KEEP' | 'REMOVE';
export type MediaReportSafetyReason =
  | 'spam'
  | 'fake_profile'
  | 'harassment'
  | 'hate_or_abuse'
  | 'sexual_boundary'
  | 'illegal_content'
  | 'privacy'
  | 'minor_safety'
  | 'other';

export interface MediaReportSafetyState {
  reportsCount: number;
  openReportsCount: number;
  confirmedReportsCount: number;
  safetyScore: number;
}

const IMMEDIATE_QUARANTINE_REASONS = new Set<MediaReportSafetyReason>([
  'minor_safety',
  'illegal_content',
  'sexual_boundary',
]);
const EVIDENCE_PRESERVATION_REASONS = new Set<MediaReportSafetyReason>([
  'minor_safety',
  'illegal_content',
  'sexual_boundary',
]);
const GENERAL_QUARANTINE_OPEN_REPORTS = 3;

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

export function buildMediaReportSafetyState(
  current: MediaReportCounterInput,
  event: MediaReportCounterEvent
): MediaReportSafetyState {
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

/**
 * Conteúdo com risco de menoridade, possível ilegalidade ou violação grave de
 * limite sexual sai imediatamente da distribuição enquanto é analisado.
 * Denúncias comuns exigem três casos ainda abertos para reduzir abuso do
 * mecanismo de denúncia como forma de derrubar conteúdo legítimo.
 */
export function shouldQuarantineMediaAfterReport(
  reason: MediaReportSafetyReason,
  openReportsCount: number
): boolean {
  return IMMEDIATE_QUARANTINE_REASONS.has(reason) ||
    normalizeCount(openReportsCount) >= GENERAL_QUARANTINE_OPEN_REPORTS;
}

/**
 * Preservação técnica não significa conclusão jurídica nem comunicação
 * automática a autoridades. Apenas impede que um ativo de alto risco seja
 * destruído antes da revisão e de eventual solicitação legal válida.
 */
export function shouldPreserveMediaEvidence(
  reason: MediaReportSafetyReason
): boolean {
  return EVIDENCE_PRESERVATION_REASONS.has(reason);
}
