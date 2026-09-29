export interface MediaReportCounterInput {
  reportsCount?: unknown;
  openReportsCount?: unknown;
  confirmedReportsCount?: unknown;
}

export type MediaReportCounterEvent = 'OPEN' | 'KEEP' | 'REMOVE';
export type MinorMediaSafetyReason =
  | 'minor_exposure_safety'
  | 'minor_content_safety';

export type MediaReportSafetyReason =
  | 'spam'
  | 'fake_profile'
  | 'harassment'
  | 'hate_or_abuse'
  | 'sexual_boundary'
  | 'non_consensual_sexual_content'
  | 'illegal_content'
  | 'privacy'
  | MinorMediaSafetyReason
  | 'other';

export type MediaSafetySeverity =
  | 'STANDARD'
  | 'HIGH'
  | 'MAXIMUM_MINOR';

export interface MediaReportSafetyState {
  reportsCount: number;
  openReportsCount: number;
  confirmedReportsCount: number;
  safetyScore: number;
}

const CRITICAL_MINOR_MEDIA_REASONS = new Set<MinorMediaSafetyReason>([
  'minor_exposure_safety',
  'minor_content_safety',
]);

const HIGH_SEVERITY_REASONS = new Set<MediaReportSafetyReason>([
  'illegal_content',
  'non_consensual_sexual_content',
]);

export const MEDIA_REPORT_QUARANTINE_THRESHOLDS = Object.freeze({
  maximumMinorReports: 1,
  highSeverityReports: 1,
  generalOpenReports: 3,
});
const EVIDENCE_PRESERVATION_REASONS = new Set<MediaReportSafetyReason>([
  ...CRITICAL_MINOR_MEDIA_REASONS,
  'illegal_content',
  'sexual_boundary',
]);


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
/**
 * Media não decide a maioridade do perfil. Estes motivos descrevem apenas
 * risco observado no conteúdo publicado. Em uma plataforma adulta, a mera
 * exposição aparente de criança/adolescente em foto ou vídeo é tratada como
 * crítica, mesmo sem nudez ou ato sexual.
 */
export function normalizeMinorMediaSafetyReason(
  value: unknown
): MinorMediaSafetyReason | null {
  const normalized = String(value ?? '').trim().toLowerCase();

  return normalized === 'minor_exposure_safety' ||
    normalized === 'minor_content_safety'
    ? normalized
    : null;
}

export function isCriticalMinorMediaSafetyReason(
  reason: MediaReportSafetyReason
): reason is MinorMediaSafetyReason {
  return CRITICAL_MINOR_MEDIA_REASONS.has(reason as MinorMediaSafetyReason);
}

export function mediaSafetySeverity(
  reason: MediaReportSafetyReason
): MediaSafetySeverity {
  if (isCriticalMinorMediaSafetyReason(reason)) {
    return 'MAXIMUM_MINOR';
  }

  if (HIGH_SEVERITY_REASONS.has(reason)) {
    return 'HIGH';
  }

  return 'STANDARD';
}

/**
 * Nudez ou sexo consensual entre adultos, por si só, não é violação nesta
 * plataforma. "sexual_boundary" permanece como categoria de denúncia genérica
 * e nunca recebe quarentena imediata somente pelo rótulo; para suspeita de
 * coerção/não consentimento use non_consensual_sexual_content.
 */
export function isAdultConsensualSexualContentViolation(): false {
  return false;
}

export function shouldQuarantineMediaAfterReport(
  reason: MediaReportSafetyReason,
  openReportsCount: number
): boolean {
  const count = normalizeCount(openReportsCount);
  const severity = mediaSafetySeverity(reason);

  if (severity === 'MAXIMUM_MINOR') {
    return count >= MEDIA_REPORT_QUARANTINE_THRESHOLDS.maximumMinorReports;
  }

  if (severity === 'HIGH') {
    return count >= MEDIA_REPORT_QUARANTINE_THRESHOLDS.highSeverityReports;
  }

  return count >= MEDIA_REPORT_QUARANTINE_THRESHOLDS.generalOpenReports;
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
