import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  LEGACY_RECOVERY_GOVERNANCE_VERSION,
  LEGACY_RECOVERY_OPERATION_PURPOSE,
  LEGACY_RECOVERY_APPROVAL_WINDOW_MS,
  evaluateLegacyRecoveryGovernanceEvidence,
  buildLegacyRecoveryAuditEnvelope,
  assertLegacyRecoveryGovernanceMayPersist,
} from '../maintenance/discovery-legacy-recovery-governance.policy.mjs';

const NOW = 1_800_000_000_000;
const OPERATOR = 'synthetic-operator-001';
const REVIEWER = 'synthetic-reviewer-002';
const OPERATION = 'synthetic-batch-review-003';

function evidence() {
  return {
    nowMs: NOW,
    request: {
      operationId: OPERATION,
      operatorUid: OPERATOR,
      purpose: LEGACY_RECOVERY_OPERATION_PURPOSE,
      projectId: 'entretenimento-sexual',
      targetCollection: 'legacy_discovery_preference_recovery',
      candidateCount: 2,
      legacyEntryCount: 8,
    },
    operatorIdentity: {
      uid: OPERATOR,
      disabled: false,
      emailVerified: true,
      tokenRevoked: false,
      authenticatedAtMs: NOW - 120_000,
      checkedAtMs: NOW - 10_000,
    },
    operatorAccount: {
      uid: OPERATOR,
      role: 'admin',
      accountStatus: 'active',
      privateRecoveryOperator: true,
      adminPrivilegeRevokedAt: null,
    },
    reviewerAccount: {
      uid: REVIEWER,
      role: 'admin',
      accountStatus: 'active',
      privateRecoveryReviewer: true,
      adminPrivilegeRevokedAt: null,
    },
    approvalRecord: {
      operationId: OPERATION,
      purpose: LEGACY_RECOVERY_OPERATION_PURPOSE,
      status: 'APPROVED_FOR_REVIEW_ONLY',
      projectId: 'entretenimento-sexual',
      targetCollection: 'legacy_discovery_preference_recovery',
      candidateCount: 2,
      legacyEntryCount: 8,
      requestedByUid: OPERATOR,
      approvedByUid: REVIEWER,
      approvedAtMs: NOW - 120_000,
      expiresAtMs: NOW + 300_000,
      revokedAtMs: null,
      consumedAtMs: null,
    },
  };
}
function assess(modifier = (input) => input) {
  const input = evidence();
  modifier(input);
  return evaluateLegacyRecoveryGovernanceEvidence(input);
}

test('B2.6 evidence shape can pass all checks but persistence always stays blocked', () => {
  const report = assess();
  assert.equal(LEGACY_RECOVERY_GOVERNANCE_VERSION, 1);
  assert.equal(LEGACY_RECOVERY_APPROVAL_WINDOW_MS, 900_000);
  assert.equal(report.evidenceShapeCompatible, true);
  assert.equal(report.requestMatches, true);
  assert.equal(report.identityMatches, true);
  assert.equal(report.operatorEligible, true);
  assert.equal(report.reviewerEligible, true);
  assert.equal(report.approvalMatches, true);
  assert.equal(report.outcome, 'BLOCKED');
  assert.equal(report.backendAuthorityVerified, false);
  assert.equal(report.approvalConsumed, false);
  assert.equal(report.auditPersisted, false);
  assert.equal(report.expirationJobImplemented, false);
  assert.equal(report.ownerConsentEstablished, false);
  assert.equal(report.persistentWritesAllowed, false);
  assert.equal(report.publicVisibilityAllowed, false);
  assert.equal(report.sourceDeletionAllowed, false);
  assert.equal(report.requiresServerSideRevalidation, true);
  assert.ok(Object.isFrozen(report));
});

test('identity rejects disabled, revoked, unverified and stale credentials', () => {
  for (const patch of [
    { uid: REVIEWER },
    { disabled: true },
    { tokenRevoked: true },
    { emailVerified: false },
    { authenticatedAtMs: NOW - 900_001 },
    { authenticatedAtMs: NOW + 1 },
    { checkedAtMs: NOW - 60_001 },
    { checkedAtMs: NOW + 1 },
    { checkedAtMs: 'fake' },
  ]) {
    const report = assess(e => Object.assign(e.operatorIdentity, patch));
    assert.equal(report.identityMatches, false);
    assert.equal(report.persistentWritesAllowed, false);
  }
});

test('revalidates operator role, account deletion and explicit capability', () => {
  for (const patch of [
    { role: 'user' }, { role: 'moderator' },
    { uid: REVIEWER },
    { accountStatus: 'pending_deletion' },
    { accountStatus: 'deleted' },
    { adminPrivilegeRevokedAt: NOW - 100 },
    { deletionRequestedAt: NOW - 100 },
    { purgeLeaseOwner: 'lease' }, { purgeLeaseUntil: NOW + 60_000 },
    { legalHold: true }, { billingHold: true }, { disabled: true },
    { privateRecoveryOperator: false },
  ]) {
    const report = assess(e => Object.assign(e.operatorAccount, patch));
    assert.equal(report.operatorEligible, false);
    assert.equal(report.persistentWritesAllowed, false);
  }
});

test('independent reviewer must be active admin with explicit reviewer capability', () => {
  for (const patch of [
    { uid: OPERATOR }, { role: 'user' },
    { accountStatus: 'deleted' },
    { adminPrivilegeRevokedAt: NOW - 100 },
    { privateRecoveryReviewer: false },
    { purgeLeaseOwner: 'synthetic-lease' },
  ]) {
    const report = assess(e => Object.assign(e.reviewerAccount, patch));
    assert.equal(report.reviewerEligible, false);
    assert.equal(report.persistentWritesAllowed, false);
  }
});

test('approval must match operation, reviewer, scope, counts and short validity', () => {
  for (const patch of [
    { operationId: 'synthetic-other-operation' },
    { status: 'APPROVED' },
    { status: 'REVOKED' },
    { purpose: 'ACTIVATE_PUBLIC_PREFERENCES' },
    { projectId: 'production' },
    { targetCollection: 'public_profiles' },
    { candidateCount: 3 }, { legacyEntryCount: 9 },
    { requestedByUid: REVIEWER },
    { approvedByUid: OPERATOR },
    { approvedByUid: 'synthetic-outsider-004' },
    { approvedAtMs: NOW + 1 },
    { expiresAtMs: NOW },
    { expiresAtMs: NOW + LEGACY_RECOVERY_APPROVAL_WINDOW_MS + 1 },
    { revokedAtMs: NOW - 1 }, { consumedAtMs: NOW - 1 },
  ]) {
    const report = assess(e => Object.assign(e.approvalRecord, patch));
    assert.equal(report.approvalMatches, false);
    assert.equal(report.persistentWritesAllowed, false);
  }
});

test('rejects request scope changes and unexpected or sensitive envelope fields', () => {
  for (const patch of [
    { projectId: 'other-project' },
    { targetCollection: 'users' },
    { purpose: 'PUBLIC_ACTIVATION' },
    { candidateCount: 3 },
    { legacyEntryCount: 7 },
    { operationId: 'x' },
    { operatorUid: '../cross-account' },
    { legacyRaw: ['private'] },
  ]) {
    const report = assess(e => Object.assign(e.request, patch));
    assert.equal(report.requestMatches, false);
    assert.equal(report.persistentWritesAllowed, false);
  }
  assert.throws(() => evaluateLegacyRecoveryGovernanceEvidence({
    ...evidence(), leakedUid: OPERATOR,
  }), /RECOVERY_GOVERNANCE_INVALID_INPUT/);
  assert.throws(() => evaluateLegacyRecoveryGovernanceEvidence({
    ...evidence(), nowMs: 0,
  }), /RECOVERY_GOVERNANCE_INVALID_TIME/);
});

test('audit envelope only exposes bounded aggregate and cannot be approved', () => {
  const assessment = assess();
  const audit = buildLegacyRecoveryAuditEnvelope({
    action: 'B2_6_PRECHECK_EVALUATED', assessment,
  });
  assert.deepEqual(audit, {
    version: 1,
    event: 'B2_6_PRECHECK_EVALUATED',
    scope: 'PRIVATE_LEGACY_RECOVERY_PREFLIGHT_ONLY',
    outcome: 'BLOCKED',
    eligibleEvidenceCount: 5,
    checkedEvidenceCount: 5,
    writesPerformed: 0,
    approvalConsumed: false,
    persisted: false,
  });
  const textValue = JSON.stringify({ audit, assessment });
  for (const secret of [OPERATOR, REVIEWER, OPERATION,
    'legacyRaw', 'contentSha256', 'interestedInGenders']) {
    assert.equal(textValue.includes(secret), false, secret);
  }
  for (const action of [
    'B2_6_WRITE', 'B2_6_APPROVED', 'ACTIVATE', '', null, undefined,
  ]) {
    assert.throws(
      () => buildLegacyRecoveryAuditEnvelope({ action, assessment }),
      /RECOVERY_GOVERNANCE_UNTRUSTED_AUDIT/
    );
  }
  assert.throws(() => buildLegacyRecoveryAuditEnvelope({
    action: 'B2_6_PRECHECK_BLOCKED',
    assessment: { ...assessment, persistentWritesAllowed: true },
  }), /RECOVERY_GOVERNANCE_UNTRUSTED_AUDIT/);
  assert.throws(() => buildLegacyRecoveryAuditEnvelope({
    action: 'B2_6_PRECHECK_REJECTED',
    assessment: { ...assessment, ownerUid: OPERATOR },
  }), /RECOVERY_GOVERNANCE_UNTRUSTED_AUDIT/);
});

test('no caller approval, forged report or environment toggles persistence', () => {
  for (const supplied of [
    undefined, null, { admin: true, role: 'admin' },
    evidence(), assess(), { approvalRecord: { status: 'APPROVED' } },
  ]) {
    assert.throws(() => assertLegacyRecoveryGovernanceMayPersist(supplied),
      /LEGACY_RECOVERY_PERSISTENCE_NOT_AUTHORIZED/);
  }
});

test('governance policy has no Firestore/HTTP access or mutation side effects', () => {
  const path = fileURLToPath(new URL(
    '../maintenance/discovery-legacy-recovery-governance.policy.mjs',
    import.meta.url
  ));
  const source = readFileSync(path, 'utf8');
  const codeOnly = source.split('\n').filter(x =>
    !x.trim().startsWith('//')).join('\n');
  for (const disallowed of [
    'firebase-admin', 'firebase-functions', 'initializeApp(',
    'onCall(', 'onSchedule(', 'runTransaction(', '.collection(',
    '.set(', 'tx.create(', 'tx.update(', 'tx.delete(',
    'fetch(', 'spawn(', 'writeFile(', 'console.log(',
  ]) assert.equal(codeOnly.includes(disallowed), false, disallowed);
});
