// functions/src/moderation/moderation-minor-safety-report-security.service.ts
// -----------------------------------------------------------------------------
// TRANSVERSAL MINOR-SAFETY REPORT SECURITY
// -----------------------------------------------------------------------------
// Shared by profile, media and community reporting surfaces. Surface-specific
// throttles remain in place; this quota closes cross-surface evasion and tunes
// only the cadence from reviewed reporter outcomes.
// -----------------------------------------------------------------------------

import {
  minorSafetyReportRateLimitConfig,
  type ModerationReporterAbuseAssessment,
} from './moderation-reporter-abuse.policy';
import {
  safeGetModerationReporterAbuseAssessment,
} from './moderation-reporter-abuse.service';
import {
  consumeBackendRateLimitQuota,
} from '../shared/security/backend-rate-limit.service';

export function isMinorSafetyReportReason(value: unknown): boolean {
  const reason = String(value ?? '').trim().toLowerCase();
  return reason === 'minor_safety' || reason === 'minor_content_safety';
}

export async function consumeMinorSafetyReporterQuota(input: {
  reporterUid: string;
}): Promise<Readonly<ModerationReporterAbuseAssessment>> {
  const assessment = await safeGetModerationReporterAbuseAssessment(
    input.reporterUid
  );

  await consumeBackendRateLimitQuota({
    action: 'minorSafetyReport',
    subject: input.reporterUid,
    cost: 1,
    config: minorSafetyReportRateLimitConfig(assessment.level),
    message: [
      'Muitas denúncias relacionadas à segurança de menores foram enviadas',
      'em pouco tempo. Aguarde o prazo indicado e tente novamente.',
    ].join(' '),
  });

  return assessment;
}
