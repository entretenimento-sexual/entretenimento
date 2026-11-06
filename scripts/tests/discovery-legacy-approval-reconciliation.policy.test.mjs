import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  REVIEW_AUDIT_KINDS,
  appendSyntheticReviewAuditEvent,
} from '../maintenance/discovery-legacy-approval-audit-integrity.policy.mjs';
import {
  REVIEW_RECONCILIATION_PHASE,
  reconcileSyntheticReviewApprovals as reconcile,
  assertSyntheticReconciliationMayRepair,
} from '../maintenance/discovery-legacy-approval-reconciliation.policy.mjs';

const T = 1_850_000_000_000;
const DAY = 24 * 60 * 60_000;
const key = suffix => `synthetic-b293d-${suffix}`;
function approval(suffix = 'pair-001', patch = {}) {
  return {
    syntheticKey: key(suffix), schemaVersion: 1,
    status: 'CONSUMED_FOR_REVIEW_ONLY', revision: 2,
    purpose: 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW',
    projectId: 'entretenimento-sexual',
    targetCollection: 'legacy_discovery_preference_recovery',
    candidateCount: 2, legacyEntryCount: 8,
    requestedAtMs: T - 120_000, approvedAtMs: T - 60_000,
    expiresAtMs: T + 840_000, consumedAtMs: T,
    revokedAtMs: null, expiredAtMs: null,
    ...patch,
  };
}
function audit(suffix = 'pair-001', patch = {}) {
  return {
    syntheticKey: key(suffix), schemaVersion: 1,
    entries: appendSyntheticReviewAuditEvent([], {
      kind: REVIEW_AUDIT_KINDS.CONSUMED_SYNTHETIC, atMs: T,
    }),
    ...patch,
  };
}
function input(approvals = [approval()], audits = [audit()], nowMs = T + 10) {
  return { approvals, audits, nowMs };
}
function locked(report) {
  assert.equal(report.phase, REVIEW_RECONCILIATION_PHASE);
  assert.equal(report.decision, 'BLOCKED');
  for (const field of [
    'sourceIsTrusted', 'externalAnchorVerified', 'backendIdentityVerified',
    'auditDurabilityVerified', 'automatedRepairAllowed',
    'approvalWriterIntegrated', 'auditProductionPersisted',
    'persistentWritesAllowed', 'privateRecoveryRead',
    'privateRecoveryWritten', 'sourceDeletionAllowed',
    'publicVisibilityAllowed',
  ]) assert.equal(report[field], false, field);
  assert.ok(Object.isFrozen(report));
}

test('consumed approval with one matching synthetic audit passes shape reconciliation only', () => {
  const r = reconcile(input());
  assert.equal(r.approvalsInspected, 1);
  assert.equal(r.auditsInspected, 1);
  assert.equal(r.matchedSyntheticPairs, 1);
  assert.equal(r.consumedApprovals, 1);
  assert.equal(r.totalIssues, 0);
  assert.equal(r.shapeReconciled, true);
  locked(r);
});

test('consumed approval without audit is counted and not repaired', () => {
  const r = reconcile(input([approval()], []));
  assert.equal(r.missingAudit, 1);
  assert.equal(r.matchedSyntheticPairs, 0);
  assert.equal(r.shapeReconciled, false);
  locked(r);
});

test('orphan audit without approval is detected and cannot imply consumption', () => {
  const r = reconcile(input([], [audit()]));
  assert.equal(r.orphanAudit, 1);
  assert.equal(r.matchedSyntheticPairs, 0);
  locked(r);
});

test('duplicate approval and duplicate audit fixture keys cannot be counted as matched', () => {
  const a = approval();
  const e = audit();
  const r = reconcile(input([a, { ...a }], [e, { ...e }]));
  assert.equal(r.duplicateApprovalKeys, 1);
  assert.equal(r.duplicateAuditKeys, 1);
  assert.equal(r.matchedSyntheticPairs, 0);
  assert.equal(r.shapeReconciled, false);
  locked(r);
});

test('consumed approval with stale revision is invalid even if audit matches', () => {
  const r = reconcile(input([approval('pair-001', { revision: 1 })]));
  assert.equal(r.invalidRevision, 1);
  assert.equal(r.matchedSyntheticPairs, 0);
  locked(r);
});

test('corrupt hash chain or extra audit events are rejected without leaking digest', () => {
  const base = audit();
  const corrupted = { ...base, entries: [{ ...base.entries[0], entryHash: 'a'.repeat(64) }] };
  const multiple = { ...base, entries: [base.entries[0], base.entries[0]] };
  for (const value of [corrupted, multiple, { ...base, schemaVersion: 2 }]) {
    const r = reconcile(input([approval()], [value]));
    assert.equal(r.invalidAudit, 1);
    assert.equal(r.matchedSyntheticPairs, 0);
    locked(r);
  }
});

test('different consumption and audit timestamps cannot reconcile', () => {
  const r = reconcile(input([approval('pair-001', { consumedAtMs: T + 1 })]));
  assert.equal(r.timestampMismatch, 1);
  assert.equal(r.matchedSyntheticPairs, 0);
  locked(r);
});

test('scope tampering is rejected regardless of matching hash chain', () => {
  for (const change of [
    { targetCollection: 'public_profiles' }, { candidateCount: 3 },
    { legacyEntryCount: 7 }, { projectId: 'unsafe' },
    { purpose: 'RECOVERY_WRITE' },
  ]) {
    const r = reconcile(input([approval('pair-001', change)]));
    assert.equal(r.invalidScope, 1);
    assert.equal(r.matchedSyntheticPairs, 0);
    locked(r);
  }
});

test('audit attached to unconsumed approval is not a valid pair', () => {
  const a = approval('pair-001', {
    status: 'APPROVED_FOR_REVIEW_ONLY', revision: 1, consumedAtMs: null,
  });
  const r = reconcile(input([a]));
  assert.equal(r.auditWithoutConsumption, 1);
  assert.equal(r.matchedSyntheticPairs, 0);
  locked(r);
});

test('revoked and expired approvals must not be paired with consumption audit', () => {
  const variants = [
    approval('pair-001', { status: 'REVOKED', revision: 2,
      consumedAtMs: null, revokedAtMs: T }),
    approval('pair-001', { status: 'EXPIRED', revision: 2,
      consumedAtMs: null, expiredAtMs: T + 840_000 }),
  ];
  for (const a of variants) {
    const r = reconcile(input([a]));
    assert.equal(r.auditWithoutConsumption, 1);
    assert.equal(r.matchedSyntheticPairs, 0);
    locked(r);
  }
});

test('invalid approval timeline cannot be reconciled', () => {
  for (const change of [
    { consumedAtMs: T - 70_000 }, { consumedAtMs: T + 900_000 },
    { expiresAtMs: T + 1 }, { requestedAtMs: T + 1 },
  ]) {
    const r = reconcile(input([approval('pair-001', change)]));
    assert.equal(r.invalidTimeline, 1);
    assert.equal(r.matchedSyntheticPairs, 0);
    locked(r);
  }
});

test('strict top level and nested keys reject unsafe input with a generic code', () => {
  const bad = [
    { ...input(), operatorUid: 'private' },
    { ...input(), approvals: [{ ...approval(), uid: 'private' }] },
    { ...input(), audits: [{ ...audit(), jwt: 'secret' }] },
    { ...input(), approvals: [{ ...approval(), syntheticKey: 'real-operation-001' }] },
    { ...input(), audits: [{ ...audit(), syntheticKey: 'users/uid' }] },
    { ...input(), nowMs: 0 },
    { ...input(), approvals: new Array(65).fill(approval()) },
    { ...input(), audits: new Array(65).fill(audit()) },
    null, {}, [],
  ];
  for (const value of bad) {
    assert.throws(() => reconcile(value), e =>
      e instanceof Error && e.message === 'B293D_UNTRUSTED_SYNTHETIC_INPUT');
  }
});

test('reports only aggregate numbers and safety flags, no synthetic IDs or hashes', () => {
  const r = reconcile(input());
  const serialized = JSON.stringify(r);
  for (const forbidden of [
    key('pair-001'), audit().entries[0].entryHash,
    'syntheticKey', 'operationId', 'uid', 'token', 'privateRaw',
    'previousHash', 'entryHash', 'atMs',
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
  locked(r);
});

test('30 days is only a review proposal, never deletion or TTL', () => {
  const prior = reconcile(input([approval()], [audit()], T + 29 * DAY));
  const future = reconcile(input([approval()], [audit()], T + 31 * DAY));
  assert.equal(prior.retentionReviewCandidates, 0);
  assert.equal(future.retentionReviewCandidates, 1);
  assert.equal(future.proposedRetentionDays, 30);
  locked(prior);
  locked(future);
});

test('empty collections never establish a positive reconciliation signal', () => {
  const r = reconcile(input([], []));
  assert.equal(r.totalIssues, 0);
  assert.equal(r.shapeReconciled, false);
  locked(r);
});

test('multiple pairs are deterministic without exposing association keys', () => {
  const r = reconcile(input(
    [approval('pair-001'), approval('pair-002')],
    [audit('pair-002'), audit('pair-001')],
  ));
  assert.equal(r.matchedSyntheticPairs, 2);
  assert.equal(r.totalIssues, 0);
  assert.equal(r.shapeReconciled, true);
  locked(r);
});

test('no data or forged authority can authorize repair or recovery', () => {
  for (const value of [undefined, null, {}, input(), reconcile(input())]) {
    assert.throws(() => assertSyntheticReconciliationMayRepair(value),
      /B293D_REPAIR_NOT_AUTHORIZED/);
  }
});

test('policy is strictly Node-only and does not add IO, SDK or backend writer', () => {
  const src = readFileSync(fileURLToPath(new URL(
    '../maintenance/discovery-legacy-approval-reconciliation.policy.mjs',
    import.meta.url
  )), 'utf8');
  const codeOnly = src.split('\n').filter(x => !x.trim().startsWith('//')).join('\n');
  for (const forbidden of [
    'firebase-admin', 'firebase-functions', 'initializeApp(',
    'runTransaction(', 'onCall(', 'onSchedule(', '.collection(',
    'tx.update(', 'tx.create(', 'tx.delete(',
    'writeFile(', 'fetch(', 'console.log(', 'process.env',
  ]) assert.equal(codeOnly.includes(forbidden), false, forbidden);
});
