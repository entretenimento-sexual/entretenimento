// Pure offline D0 preflight; the operator still confirms source evidence.
// Never starts the observation window or authorizes deployment.
const HOUR_MS = 3_600_000;
const MAX_AGE_MS = 86_400_000;
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{3,62}$/;
const EVIDENCE_REF = /^[A-Za-z0-9._:/#-]{8,200}$/;
const REQUIRED_CONTROLS = Object.freeze([
  'controlledAllowedWriteVerified',
  'controlledDeniedWriteVerified',
  'registrationCompletionPathsVerified',
  'nicknameIndexPathsVerified',
  'clientVersionAttributionVerified',
  'auditPolicyInheritanceReviewed',
  'routingAndRetentionReviewed',
  'sensitiveDataMinimizationReviewed',
  'clientVersionFloorPlanReviewed',
  'securityApproved',
  'operationsApproved',
]);
const REQUIRED_SOURCES = Object.freeze([
  'iamPolicy', 'exclusions', 'defaultBucket', 'writeSample', 'deniedSample',
]);

function exactUtcInstant(value) {
  const n = Date.parse(value ?? '');
  return typeof value === 'string' && Number.isFinite(n) &&
    new Date(n).toISOString() === value ? n : NaN;
}
export function assessNicknameD0Readiness({ preflight, controls, now = Date.now() } = {}) {
  const reasons = [];
  const projectId = preflight?.projectId;
  if (typeof projectId !== 'string' ||
    !PROJECT_ID.test(projectId) || projectId.startsWith('demo-') ||
    preflight?.schemaVersion !== 1 || preflight?.mode !== 'READ_ONLY' ||
    preflight?.deploymentAuthorized !== false) {
    reasons.push('D0_INVALID_LIVE_PREFLIGHT');
  }
  const preflightAt = exactUtcInstant(preflight?.collectedAt);
  if (!Number.isFinite(preflightAt) || preflightAt > now + 60_000 ||
    now - preflightAt > MAX_AGE_MS) {
    reasons.push('D0_STALE_OR_INVALID_PREFLIGHT');
  }
  if (REQUIRED_SOURCES.some(key => preflight?.sources?.[key] !== 'ok')) {
    reasons.push('D0_LOGGING_SOURCES_NOT_VERIFIED');
  }
  const signal = preflight?.signals;
  if (!signal?.projectScopeWriteConfigured ||
    signal.exemptionsNeedReview !== false ||
    signal.activeExclusions !== 0 ||
    signal.defaultSinkDisabled !== false ||
    !Number.isSafeInteger(signal.defaultBucketRetentionDays) ||
    signal.defaultBucketRetentionDays < 31 ||
    signal.recentWriteSampleObserved !== true ||
    signal.recentDeniedWriteSampleObserved !== true) {
    reasons.push('D0_LOGGING_COVERAGE_NOT_DEMONSTRATED');
  }
  if (!controls || controls.schemaVersion !== 1 ||
    controls.environment !== 'LIVE' || controls.projectId !== projectId ||
    controls.sourceKind !== 'INDEPENDENT_OPERATIONAL_REVIEW' ||
    typeof controls.evidenceReference !== 'string' ||
    !EVIDENCE_REF.test(controls.evidenceReference)) {
    reasons.push('D0_MISSING_VERIFIABLE_REVIEW_REFERENCE');
  }
  const reviewed = exactUtcInstant(controls?.reviewedAt);
  if (!Number.isFinite(reviewed) || reviewed > now + 60_000 ||
    now - reviewed > MAX_AGE_MS ||
    (Number.isFinite(preflightAt) && reviewed < preflightAt)) {
    reasons.push('D0_INVALID_REVIEW_TIME');
  }
  for (const key of REQUIRED_CONTROLS) {
    if (controls?.[key] !== true) {
      reasons.push('D0_MISSING_' + key);
    }
  }
  // Proposal is always the next future whole UTC hour. Never backdate D0.
  const nextHour = Number.isFinite(now)
    ? new Date((Math.floor(now / HOUR_MS) + 1) * HOUR_MS).toISOString()
    : null;
  return Object.freeze({
    status: reasons.length ? 'D0_BLOCKED' : 'D0_CANDIDATE',
    observationStarted: false,
    deploymentAuthorized: false,
    proposedStartAtUtc: reasons.length ? null : nextHour,
    projectId: typeof projectId === 'string' ? projectId : null,
    reasons,
  });
}
