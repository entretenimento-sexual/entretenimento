// functions/src/media/application/media-content-safety-assessment.policy.ts
// -----------------------------------------------------------------------------
// MEDIA CONTENT SAFETY ASSESSMENT
// -----------------------------------------------------------------------------
// Autoridade canônica sobre sinais de segurança presentes NO CONTEÚDO.
// Não representa a idade/assurance do proprietário da conta e não é requisito
// de publicação prévia. A mídia pode nascer UNASSESSED e ser publicada.
// -----------------------------------------------------------------------------

import type {
  MinorMediaSafetyReason,
} from './media-report-safety';

export type MediaContentSafetyAssessmentState =
  | 'UNASSESSED'
  | 'POSSIBLE_MINOR'
  | 'CONFIRMED_MINOR'
  | 'CLEARED';

export type MediaContentSafetyAssessmentSource =
  | 'PUBLICATION'
  | 'HUMAN_REPORT'
  | 'MODERATOR_REVIEW'
  | 'AUTOMATED_SIGNAL';

export interface MediaContentSafetyAssessment {
  readonly schemaVersion: 1;
  readonly state: MediaContentSafetyAssessmentState;
  readonly source: MediaContentSafetyAssessmentSource;
  readonly reason: MinorMediaSafetyReason | null;
  readonly confidence: number | null;
  readonly assessedAtMs: number;
  readonly assessorId: string | null;
}

function normalizedConfidence(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function normalizedTime(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : Date.now();
}

export function buildUnassessedMediaContentSafetyAssessment(
  assessedAtMs: number = Date.now()
): MediaContentSafetyAssessment {
  return Object.freeze({
    schemaVersion: 1,
    state: 'UNASSESSED',
    source: 'PUBLICATION',
    reason: null,
    confidence: null,
    assessedAtMs: normalizedTime(assessedAtMs),
    assessorId: null,
  });
}

export function buildPossibleMinorContentSafetyAssessment(input: {
  reason: MinorMediaSafetyReason;
  assessedAtMs?: number;
  confidence?: number | null;
  source?: 'HUMAN_REPORT' | 'AUTOMATED_SIGNAL';
  assessorId?: string | null;
}): MediaContentSafetyAssessment {
  return Object.freeze({
    schemaVersion: 1,
    state: 'POSSIBLE_MINOR',
    source: input.source ?? 'HUMAN_REPORT',
    reason: input.reason,
    confidence: normalizedConfidence(input.confidence),
    assessedAtMs: normalizedTime(input.assessedAtMs),
    assessorId: String(input.assessorId ?? '').trim() || null,
  });
}

export function buildReviewedMinorContentSafetyAssessment(input: {
  confirmed: boolean;
  reason: MinorMediaSafetyReason;
  assessedAtMs?: number;
  moderatorUid: string;
}): MediaContentSafetyAssessment {
  const moderatorUid = String(input.moderatorUid ?? '').trim();

  return Object.freeze({
    schemaVersion: 1,
    state: input.confirmed ? 'CONFIRMED_MINOR' : 'CLEARED',
    source: 'MODERATOR_REVIEW',
    reason: input.confirmed ? input.reason : null,
    confidence: input.confirmed ? 1 : null,
    assessedAtMs: normalizedTime(input.assessedAtMs),
    assessorId: moderatorUid || null,
  });
}
