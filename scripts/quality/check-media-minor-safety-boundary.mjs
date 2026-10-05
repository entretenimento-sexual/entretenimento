// scripts/quality/check-media-minor-safety-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA / PROTEÇÃO DE MENORES
// -----------------------------------------------------------------------------
// Invariantes:
// - suspeita envolvendo menor = severidade máxima e quarentena do CONTEÚDO;
// - nudez/sexo consensual entre adultos não é violação por si só;
// - não consentimento/coerção possui motivo próprio;
// - evidência crítica é preservada backend-only;
// - denúncia bruta nunca suspende conta;
// - hold de conta é reversível e exige padrão independente;
// - suspensão depende de violação confirmada;
// - contestação nunca restaura conteúdo nem libera evidência automaticamente.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error('[media-minor-safety] arquivo obrigatório ausente: ' + relativePath);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireIncludes(source, fragments, label) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      throw new Error('[media-minor-safety] ' + label + ': ausente ' + fragment);
    }
  }
}

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error('[media-minor-safety] ' + label);
  }
}

function forbid(source, pattern, reason) {
  if (pattern.test(source)) {
    throw new Error('[media-minor-safety] ' + reason);
  }
}

const contentSafety = read(
  'functions/src/media/application/media-content-safety-assessment.policy.ts'
);
requireIncludes(contentSafety, [
  "'UNASSESSED'",
  "'POSSIBLE_MINOR'",
  "'CONFIRMED_MINOR'",
  "'CLEARED'",
  "'HUMAN_REPORT'",
  "'MODERATOR_REVIEW'",
  "'AUTOMATED_SIGNAL'",
  'buildUnassessedMediaContentSafetyAssessment',
  'buildPossibleMinorContentSafetyAssessment',
  'buildReviewedMinorContentSafetyAssessment',
], 'autoridade canônica de content safety');

forbid(
  contentSafety,
  /ageEligibility|SELF_DECLARED_ADULT|VERIFIED_ADULT/,
  'content safety não pode depender de assurance etário da conta'
);

const safety = read('functions/src/media/application/media-report-safety.ts');
requireIncludes(safety, [
  "'minor_exposure_safety'",
  "'minor_content_safety'",
  "'MAXIMUM_MINOR'",
  "'non_consensual_sexual_content'",
  'maximumMinorReports: 1',
  'highSeverityReports: 1',
  'generalOpenReports: 3',
  'isAdultConsensualSexualContentViolation',
  'return false;',
  "severity === 'MAXIMUM_MINOR'",
  'shouldPreserveMediaEvidence',
], 'policy de segurança');

forbid(
  safety,
  /IMMEDIATE_QUARANTINE_REASONS[\s\S]{0,400}['"]sexual_boundary['"]/,
  'sexual_boundary genérico não pode voltar a gerar quarentena imediata'
);

for (const handler of [
  'functions/src/media/application/report-photo-content.handler.ts',
  'functions/src/media/application/report-video-content.handler.ts',
]) {
  const source = read(handler);
  requireIncludes(source, [
    'getModerationReporterAbuseRisk',
    'moderationReportRateLimitCost',
    "'non_consensual_sexual_content'",
    'isCriticalMinorMediaSafetyReason',
    'mediaSafetySeverity',
    'shouldQuarantineMediaAfterReport',
    'shouldPreserveMediaEvidence',
    'queueModerationEvidencePreservation',
    'safetySeverity: mediaSafetySeverity(reason)',
    'safeRecordModerationOpenSignal',
    'buildPossibleMinorContentSafetyAssessment',
    'contentSafetyAssessment',
  ], handler);

  requirePattern(
    source,
    /transaction\.create\(reportRef,\s*\{[\s\S]*?\bcriticalMinorSafety(?:\s*:\s*criticalMinorSafety)?\s*,/,
    handler + ' deve persistir criticalMinorSafety no moderation report'
  );
}

for (const reviewHandler of [
  'functions/src/media/application/review-photo-content-report.handler.ts',
  'functions/src/media/application/review-video-content-report.handler.ts',
]) {
  const source = read(reviewHandler);
  requireIncludes(source, [
    'safeRecordModerationReviewSignal',
    'safeRecordModerationReporterOutcome',
    "confirmed: decision === 'REMOVE'",
    'buildReviewedMinorContentSafetyAssessment',
    'contentSafetyAssessment',
  ], reviewHandler + ' deve alimentar automação e risco do denunciante');
}

for (const publicationHandler of [
  'functions/src/media/application/manage-photo-publication.handler.ts',
  'functions/src/media/application/manage-video-publication.handler.ts',
]) {
  const source = read(publicationHandler);
  requireIncludes(source, [
    'buildUnassessedMediaContentSafetyAssessment',
    'contentSafetyAssessment',
  ], publicationHandler + ' deve iniciar content safety sem revisão prévia');
}

const evidence = read(
  'functions/src/media/application/moderation-evidence-preservation.service.ts'
);
requireIncludes(evidence, [
  'system/moderation-evidence/',
  "retentionStatus: 'LEGAL_REVIEW_REQUIRED'",
  "accessPolicy: 'BACKEND_ONLY'",
  "evidencePreservationStatus: 'PRESERVED'",
], 'preservação de evidência');

const evidenceRules = read('firestore-rules/moderation_evidence.rules');
requireIncludes(evidenceRules, [
  'match /moderation_evidence/{evidenceId}',
  'allow read, write: if false;',
  'match /moderation_content_contests/{contestId}',
], 'evidência/contestação backend-only');

const automation = read('functions/src/moderation/moderation-automation.policy.ts');
requireIncludes(automation, [
  'holdCriticalReports: 3',
  'holdCriticalUniqueReporters: 3',
  'suspendConfirmedCriticalViolations: 1',
  "action: 'PRIORITIZE_REVIEW'",
  "action: 'TEMPORARY_INTERACTION_HOLD'",
  "action: 'SUSPEND_CONFIRMED'",
], 'automação segura');

const automationTest = read(
  'functions/src/moderation/moderation-automation.enforcement.test.ts'
);
requireIncludes(automationTest, [
  'não transforma denúncias brutas em suspensão',
  'uma violação crítica só suspende depois de confirmada',
], 'testes de automação');

const contest = read(
  'functions/src/media/application/submit-media-moderation-contest.handler.ts'
);
requireIncludes(contest, [
  "['photo', 'video'].includes(targetType)",
  "status: 'SUBMITTED'",
  "reviewStatus: 'PENDING'",
  'autoRestoreAllowed: false',
  'evidenceReleaseAllowed: false',
  'contentRestored: false',
  'evidenceReleased: false',
], 'contestação segura');

forbid(
  contest,
  /moderationStatus\s*:\s*['"]APPROVED['"]/,
  'contestação não pode restaurar moderação automaticamente'
);
forbid(
  contest,
  /releaseModerationEvidence/,
  'contestação não pode liberar evidência automaticamente'
);

const contestReview = read(
  'functions/src/media/application/review-media-moderation-contest.handler.ts'
);
requireIncludes(contestReview, [
  "'UPHOLD'",
  "'OVERTURN'",
  "effectiveModerationAction: 'KEEP'",
  'confirmedViolationEffective: false',
  'safeRecordModerationReviewSignal',
  'safeRecordModerationReporterOutcome',
  'contentRestored: false',
  'evidenceReleased: false',
], 'revisão de contestação');
forbid(
  contestReview,
  /moderationStatus\s*:\s*['"]APPROVED['"]/,
  'revisão de contestação não pode republicar conteúdo automaticamente'
);
forbid(
  contestReview,
  /releaseModerationEvidence/,
  'revisão de contestação não pode liberar evidência automaticamente'
);

const notifications = read(
  'functions/src/moderation/moderation-safety-notification.service.ts'
);
requireIncludes(notifications, [
  'Você pode registrar uma contestação',
  'caseId: reportId',
], 'notificação de contestação');

const dialog = read(
  'src/app/shared/components-globais/moderation-report/report-content-dialog/report-content-dialog.component.ts'
);
requireIncludes(dialog, [
  "'non_consensual_sexual_content'",
  'Nudez/sexo consensual entre adultos não entra nesta categoria.',
  "reason.value === 'sexual_boundary'",
  'return [];',
  "'minor_exposure_safety'",
  "'minor_content_safety'",
], 'UI de denúncia');

const page = read('src/app/media/videos/video-report-page/video-report-page.component.ts');
requireIncludes(page, [
  "'non_consensual_sexual_content'",
  "'minor_exposure_safety'",
  "'minor_content_safety'",
], 'página de denúncia de Media');

const reportService = read(
  'src/app/core/services/moderation/moderation-report.service.ts'
);
requireIncludes(reportService, [
  'submitMediaModerationContest$(',
  "'submitMediaModerationContest'",
  "'non_consensual_sexual_content'",
], 'boundary Angular de moderação');

const mediaIndex = read('functions/src/media/index.ts');
requireIncludes(mediaIndex, [
  'submitMediaModerationContest',
  'reviewMediaModerationContest',
], 'exports de contestação');

console.log(
  '[media-minor-safety] OK: menoridade tem severidade máxima por conteúdo, evidência/contestação seguras e nudez adulta consensual não é tratada como violação.'
);
