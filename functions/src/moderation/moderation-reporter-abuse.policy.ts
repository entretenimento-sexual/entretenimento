// functions/src/moderation/moderation-reporter-abuse.policy.ts
// -----------------------------------------------------------------------------
// MODERATION REPORTER ABUSE POLICY
// -----------------------------------------------------------------------------
// Reporter history can slow repeated low-quality submissions, but it never
// decides whether a target is guilty and never creates a permanent reporting
// ban. The window expires and every accepted report still reaches moderation.
// -----------------------------------------------------------------------------

import type {
  BackendFixedWindowRateLimitConfig,
} from '../shared/security/backend-fixed-window-rate-limit';

export type ModerationReporterAbuseLevel = 'NORMAL' | 'ELEVATED' | 'HIGH';

export interface ModerationReporterAbuseSignals {
  readonly reviewedReports: number;
  readonly rejectedReports: number;
  readonly confirmedReports: number;
}

export interface ModerationReporterAbuseAssessment {
  readonly level: ModerationReporterAbuseLevel;
  readonly reviewedReports: number;
  readonly rejectedReports: number;
  readonly confirmedReports: number;
  readonly rejectionRatio: number;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

export function evaluateModerationReporterAbuse(
  input: ModerationReporterAbuseSignals
): Readonly<ModerationReporterAbuseAssessment> {
  const reviewedReports = count(input.reviewedReports);
  const rejectedReports = Math.min(
    reviewedReports,
    count(input.rejectedReports)
  );
  const confirmedReports = Math.min(
    reviewedReports,
    count(input.confirmedReports)
  );
  const rejectionRatio = reviewedReports > 0
    ? rejectedReports / reviewedReports
    : 0;

  if (
    reviewedReports >= 8 &&
    confirmedReports === 0 &&
    rejectionRatio >= 0.875
  ) {
    return Object.freeze({
      level: 'HIGH',
      reviewedReports,
      rejectedReports,
      confirmedReports,
      rejectionRatio,
    });
  }

  if (
    reviewedReports >= 4 &&
    confirmedReports <= 1 &&
    rejectionRatio >= 0.75
  ) {
    return Object.freeze({
      level: 'ELEVATED',
      reviewedReports,
      rejectedReports,
      confirmedReports,
      rejectionRatio,
    });
  }

  return Object.freeze({
    level: 'NORMAL',
    reviewedReports,
    rejectedReports,
    confirmedReports,
    rejectionRatio,
  });
}

const RATE_LIMIT_BY_LEVEL: Readonly<
Record<ModerationReporterAbuseLevel, BackendFixedWindowRateLimitConfig>
> = Object.freeze({
  NORMAL: Object.freeze({
    burstWindowMs: 5 * 60 * 1_000,
    burstMax: 8,
    sustainedWindowMs: 24 * 60 * 60 * 1_000,
    sustainedMax: 40,
  }),
  ELEVATED: Object.freeze({
    burstWindowMs: 10 * 60 * 1_000,
    burstMax: 5,
    sustainedWindowMs: 24 * 60 * 60 * 1_000,
    sustainedMax: 20,
  }),
  HIGH: Object.freeze({
    burstWindowMs: 30 * 60 * 1_000,
    burstMax: 3,
    sustainedWindowMs: 24 * 60 * 60 * 1_000,
    sustainedMax: 10,
  }),
});

export function minorSafetyReportRateLimitConfig(
  level: ModerationReporterAbuseLevel
): BackendFixedWindowRateLimitConfig {
  return RATE_LIMIT_BY_LEVEL[level];
}
