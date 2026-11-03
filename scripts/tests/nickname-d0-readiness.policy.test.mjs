import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessNicknameD0Readiness } from '../maintenance/nickname-d0-readiness.policy.mjs';

const NOW = Date.parse('2026-11-03T14:45:00.000Z');
const preflight = {
  schemaVersion: 1, mode: 'READ_ONLY', status: 'NO_GO',
  deploymentAuthorized: false, projectId: 'prod-project',
  collectedAt: '2026-11-03T14:00:00.000Z',
  sources: Object.fromEntries([
    'iamPolicy', 'exclusions', 'defaultBucket', 'writeSample', 'deniedSample',
  ].map(x => [x, 'ok'])),
  signals: {
    projectScopeWriteConfigured: true,
    exemptionsNeedReview: false, activeExclusions: 0,
    defaultBucketRetentionDays: 60,
    recentWriteSampleObserved: true,
    recentDeniedWriteSampleObserved: true,
  },
};
const controls = {
  schemaVersion: 1, projectId: 'prod-project',
  environment: 'LIVE', sourceKind: 'INDEPENDENT_OPERATIONAL_REVIEW',
  evidenceReference: 'internal-review/2026-11-03',
  reviewedAt: '2026-11-03T14:35:00.000Z',
  controlledAllowedWriteVerified: true,
  controlledDeniedWriteVerified: true,
  registrationCompletionPathsVerified: true,
  nicknameIndexPathsVerified: true,
  clientVersionAttributionVerified: true,
  auditPolicyInheritanceReviewed: true,
  routingAndRetentionReviewed: true,
  sensitiveDataMinimizationReviewed: true,
  clientVersionFloorPlanReviewed: true,
  securityApproved: true,
  operationsApproved: true,
};
const assess = (p = preflight, c = controls) =>
  assessNicknameD0Readiness({ preflight: p, controls: c, now: NOW });

test('D0 is blocked by default, without fabricated operational evidence', () => {
  const result = assessNicknameD0Readiness({ now: NOW });
  assert.equal(result.status, 'D0_BLOCKED');
  assert.equal(result.observationStarted, false);
  assert.equal(result.deploymentAuthorized, false);
  assert.equal(result.proposedStartAtUtc, null);
});

test('even complete reviewed evidence only produces a FUTURE candidate', () => {
  assert.deepEqual(assess(), {
    status: 'D0_CANDIDATE', observationStarted: false,
    deploymentAuthorized: false, proposedStartAtUtc: '2026-11-03T15:00:00.000Z',
    projectId: 'prod-project', reasons: [],
  });
});

test('D0 rejects another project, emulator and stale sources', () => {
  assert.equal(assess(preflight, { ...controls, projectId: 'other' }).status, 'D0_BLOCKED');
  assert.equal(assess(preflight, { ...controls, environment: 'EMULATOR' }).status, 'D0_BLOCKED');
  assert.ok(assess({ ...preflight, collectedAt: '2026-10-30T14:00:00.000Z' }).reasons
    .includes('D0_STALE_OR_INVALID_PREFLIGHT'));
  assert.ok(assess({ ...preflight, sources: {
    ...preflight.sources, deniedSample: 'unavailable',
  } }).reasons.includes('D0_LOGGING_SOURCES_NOT_VERIFIED'));
});

test('D0 blocks unknown paths, attribution, denied writes or missing approvals', () => {
  for (const key of [
    'controlledDeniedWriteVerified', 'clientVersionAttributionVerified',
    'registrationCompletionPathsVerified', 'nicknameIndexPathsVerified',
    'securityApproved', 'operationsApproved', 'routingAndRetentionReviewed',
  ]) {
    assert.ok(assess(preflight, { ...controls, [key]: false }).reasons
      .includes('D0_MISSING_' + key));
  }
  assert.ok(assess({ ...preflight, signals: {
    ...preflight.signals, recentDeniedWriteSampleObserved: false,
  } }).reasons.includes('D0_LOGGING_COVERAGE_NOT_DEMONSTRATED'));
});

test('D0 does not expose operator identity or permit backdated review', () => {
  const result = assess(preflight, {
    ...controls, reviewedAt: '2026-11-01T14:35:00.000Z',
    evidenceReference: 'not valid/with spaces',
  });
  assert.equal(result.status, 'D0_BLOCKED');
  assert.ok(result.reasons.includes('D0_INVALID_REVIEW_TIME'));
  assert.ok(result.reasons.includes('D0_MISSING_VERIFIABLE_REVIEW_REFERENCE'));
});
