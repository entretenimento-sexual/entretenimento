// Pure, offline assessment of sanitized Cloud Logging configuration signals.
// Never accepts those signals as proof of client-version attribution or deploy.
export const FIRESTORE_WRITE_METHODS = Object.freeze([
  'google.firestore.v1.Firestore.BatchWrite',
  'google.firestore.v1.Firestore.Commit',
  'google.firestore.v1.Firestore.CreateDocument',
  'google.firestore.v1.Firestore.DeleteDocument',
  'google.firestore.v1.Firestore.UpdateDocument',
  'google.firestore.v1.Firestore.Write',
  // Older Firestore clients may use beta1 paths; ExecutePipeline can write.
  'google.firestore.v1.Firestore.ExecutePipeline',
  'google.firestore.v1beta1.Firestore.BatchWrite',
  'google.firestore.v1beta1.Firestore.Commit',
  'google.firestore.v1beta1.Firestore.CreateDocument',
  'google.firestore.v1beta1.Firestore.DeleteDocument',
  'google.firestore.v1beta1.Firestore.UpdateDocument',
  'google.firestore.v1beta1.Firestore.Write',
  'google.firestore.v1beta1.Firestore.ExecutePipeline',
]);

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{3,62}$/;

export function assessNicknameFirestoreLoggingPreflight({
  projectId, iamPolicy, exclusions, defaultBucket, writeSample, deniedSample,
  sourceReads = {}, collectedAt = new Date().toISOString(),
} = {}) {
  if (!PROJECT_ID.test(projectId ?? '') || projectId.startsWith('demo-')) {
    throw new Error('Informe um projeto Firebase real explicitamente.');
  }
  const configs = Array.isArray(iamPolicy?.auditConfigs)
    ? iamPolicy.auditConfigs : null;
  const relevantConfigs = (configs ?? []).filter(item =>
    item?.service === 'datastore.googleapis.com' || item?.service === 'allServices');
  const writeConfigs = relevantConfigs.flatMap(item =>
    (Array.isArray(item.auditLogConfigs) ? item.auditLogConfigs : [])
      .filter(config => config?.logType === 'DATA_WRITE'));
  // An ancestor policy may enable Data Access even when project scope is empty.
  const projectScopeWriteConfigured = writeConfigs.length > 0;
  const exemptionsNeedReview = writeConfigs.some(config =>
    !Array.isArray(config.exemptedMembers) ?
      config.exemptedMembers != null : config.exemptedMembers.length > 0);
  const activeExclusions = Array.isArray(exclusions)
    ? exclusions.filter(item => item?.disabled !== true).length : null;
  const retentionDays = Number.isSafeInteger(defaultBucket?.retentionDays)
    ? defaultBucket.retentionDays : null;

  const reasons = [];
  if (!configs) reasons.push('PROJECT_IAM_AUDIT_POLICY_UNAVAILABLE');
  if (!projectScopeWriteConfigured) reasons.push('PROJECT_SCOPE_DATA_WRITE_NOT_PROVEN');
  if (exemptionsNeedReview) reasons.push('DATA_ACCESS_EXEMPTIONS_REQUIRE_REVIEW');
  if (activeExclusions === null) reasons.push('LOG_EXCLUSIONS_UNAVAILABLE');
  else if (activeExclusions > 0) reasons.push('ACTIVE_EXCLUSIONS_REQUIRE_REVIEW');
  if (retentionDays === null || retentionDays < 31) {
    reasons.push('THIRTY_DAY_LOG_RETENTION_NOT_PROVEN');
  }
  if (writeSample !== true) reasons.push('RECENT_DATA_WRITE_AUDIT_LOG_NOT_CONFIRMED');
  if (deniedSample !== true) reasons.push('DENIED_WRITE_AUDIT_LOG_NOT_CONFIRMED');
  if (Object.values(sourceReads).some(state => state !== 'ok')) {
    reasons.push('READ_ONLY_SOURCE_QUERY_FAILED');
  }
  // Even with both log samples, no request-path and client-version proof exists.
  reasons.push('REQUEST_PATH_COVERAGE_REQUIRES_CONTROLLED_VALIDATION');
  reasons.push('CLIENT_VERSION_ATTRIBUTION_REQUIRES_INDEPENDENT_EVIDENCE');
  reasons.push('ANCESTOR_AUDIT_POLICY_AND_ROUTING_REQUIRE_MANUAL_REVIEW');

  return Object.freeze({
    schemaVersion: 1, projectId, mode: 'READ_ONLY',
    collectedAt, status: 'NO_GO', deploymentAuthorized: false,
    signals: {
      projectScopeWriteConfigured,
      exemptionsNeedReview,
      activeExclusions,
      defaultBucketRetentionDays: retentionDays,
      recentWriteSampleObserved: writeSample === true,
      recentDeniedWriteSampleObserved: deniedSample === true,
    },
    sources: {
      iamPolicy: sourceReads.iamPolicy ?? 'not_checked',
      exclusions: sourceReads.exclusions ?? 'not_checked',
      defaultBucket: sourceReads.defaultBucket ?? 'not_checked',
      writeSample: sourceReads.writeSample ?? 'not_checked',
      deniedSample: sourceReads.deniedSample ?? 'not_checked',
    },
    reasons,
  });
}
