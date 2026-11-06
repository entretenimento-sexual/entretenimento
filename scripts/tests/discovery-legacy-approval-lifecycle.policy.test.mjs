import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LEGACY_APPROVAL_STATE as S,
  LEGACY_APPROVAL_EVENT as E,
  createLegacyReviewRequest,
  proposeLegacyReviewTransition,
  assertLegacyReviewMayPersist,
} from '../maintenance/discovery-legacy-approval-lifecycle.policy.mjs';

const NOW = 1_800_000_000_000;
const OP = 'synthetic-operator-001';
const RE = 'synthetic-reviewer-002';
const ID = 'synthetic-operation-003';
const create = () => createLegacyReviewRequest({ operationId: ID, requestedByUid: OP, nowMs: NOW });
const step = (record, event, actorUid, nowMs, expectedRevision = record.revision) =>
  proposeLegacyReviewTransition({ record, event, actorUid, nowMs, expectedRevision });
const approve = () => step(create(), E.APPROVE, RE, NOW + 1000).proposedRecord;

test('request is tightly scoped, immutable, inactive, and review only', () => {
  const r = create();
  assert.equal(r.status, S.REQUESTED);
  assert.equal(r.revision, 0);
  assert.equal(r.projectId, 'entretenimento-sexual');
  assert.equal(r.targetCollection, 'legacy_discovery_preference_recovery');
  assert.equal(r.candidateCount, 2);
  assert.equal(r.legacyEntryCount, 8);
  assert.equal(r.approvedByUid, null);
  assert.ok(Object.isFrozen(r));
});

test('independent reviewer may propose a 15-minute review-only approval', () => {
  const { proposedRecord: a, report } = step(create(), E.APPROVE, RE, NOW + 1000);
  assert.equal(a.status, S.APPROVED);
  assert.equal(a.approvedByUid, RE);
  assert.equal(a.expiresAtMs - a.approvedAtMs, 900000);
  assert.equal(a.revision, 1);
  assert.equal(report.outcome, 'BLOCKED');
  assert.equal(report.proposalOnly, true);
  for (const key of ['backendAuthorityVerified', 'transactionCommitted',
    'approvalPersisted', 'auditPersisted', 'persistentRecoveryAllowed',
    'sourceDeletionAllowed', 'publicVisibilityAllowed']) assert.equal(report[key], false);
  for (const id of [OP, RE, ID]) assert.equal(JSON.stringify(report).includes(id), false);
});

test('self approval and stale request are denied', () => {
  assert.throws(() => step(create(), E.APPROVE, OP, NOW + 1), /TRANSITION_DENIED/);
  assert.throws(() => step(create(), E.APPROVE, null, NOW + 1), /TRANSITION_DENIED/);
  assert.throws(() => step(create(), E.APPROVE, RE, NOW + 900000), /TRANSITION_DENIED/);
  assert.throws(() => step(create(), E.APPROVE, RE, NOW - 1), /INVALID_TIME/);
});

test('expiration is exact and prevents all review consumption', () => {
  const r = create();
  assert.throws(() => step(r, E.EXPIRE, null, NOW + 899999), /TRANSITION_DENIED/);
  const old = step(r, E.EXPIRE, null, NOW + 900000).proposedRecord;
  assert.equal(old.status, S.EXPIRED);
  assert.equal(old.expiredAtMs, NOW + 900000);
  assert.throws(() => step(old, E.APPROVE, RE, NOW + 900001), /TRANSITION_DENIED/);
  const a = approve();
  assert.throws(() => step(a, E.CONSUME, OP, a.expiresAtMs), /TRANSITION_DENIED/);
  const exp = step(a, E.EXPIRE, null, a.expiresAtMs).proposedRecord;
  assert.equal(exp.status, S.EXPIRED);
  assert.equal(exp.expiredAtMs, a.expiresAtMs);
  assert.throws(() => step(exp, E.CONSUME, OP, a.expiresAtMs + 1), /TRANSITION_DENIED/);
});

test('revocation is terminal and does not permit re-approval or consumption', () => {
  const r = step(create(), E.REVOKE, OP, NOW + 1).proposedRecord;
  assert.equal(r.status, S.REVOKED);
  assert.throws(() => step(r, E.APPROVE, RE, NOW + 2), /TRANSITION_DENIED/);
  const a = approve();
  const revoked = step(a, E.REVOKE, RE, NOW + 2000).proposedRecord;
  assert.equal(revoked.status, S.REVOKED);
  assert.throws(() => step(revoked, E.CONSUME, OP, NOW + 3000), /TRANSITION_DENIED/);
  assert.throws(() => step(a, E.REVOKE, 'synthetic-outsider-003', NOW + 2000), /TRANSITION_DENIED/);
  assert.throws(() => step(a, E.REVOKE, RE, NOW + 500), /TRANSITION_DENIED/);
  assert.throws(() => step(a, E.REVOKE, RE, a.expiresAtMs), /TRANSITION_DENIED/);
});

test('review-only consumption is at most once in the pure state model', () => {
  const a = approve();
  assert.throws(() => step(a, E.CONSUME, RE, NOW + 2000), /TRANSITION_DENIED/);
  const c = step(a, E.CONSUME, OP, NOW + 2000).proposedRecord;
  assert.equal(c.status, S.CONSUMED);
  assert.equal(c.revision, 2);
  assert.throws(() => step(c, E.CONSUME, OP, NOW + 3000), /TRANSITION_DENIED/);
  assert.throws(() => step(c, E.REVOKE, RE, NOW + 3000), /TRANSITION_DENIED/);
});

test('expected revision prevents stale proposals on the latest in-memory state', () => {
  const a = approve();
  const latest = step(a, E.CONSUME, OP, NOW + 2000).proposedRecord;
  assert.throws(
    () => step(latest, E.CONSUME, OP, NOW + 2001, a.revision),
    /STALE_REVISION/
  );
  // This models CAS validation only. No real concurrent Firestore transaction occurs.
});

test('rejects scope tampering, extra fields, bad revision and malformed timestamps', () => {
  for (const patch of [
    { projectId: 'production' }, { targetCollection: 'public_profiles' },
    { purpose: 'PUBLIC_ACTIVATION' }, { candidateCount: 3 },
    { legacyEntryCount: 9 }, { requestedByUid: 'bad' },
    { legacyRaw: ['PRIVATE'] }, { revision: 99 },
    { approvedByUid: OP }, { requestedAtMs: 1 },
    { expiredAtMs: NOW + 1 },
  ]) assert.throws(() => step({ ...create(), ...patch }, E.APPROVE, RE, NOW + 1), /INVALID_RECORD/);
  assert.throws(() => createLegacyReviewRequest({ operationId: ID, requestedByUid: OP, nowMs: NOW, secret: 1 }), /INVALID_REQUEST/);
  assert.throws(() => step(create(), E.APPROVE, RE, Number.NaN), /INVALID_TRANSITION/);
  assert.throws(() => step(create(), 'PERSIST_RECOVERY', RE, NOW + 1), /INVALID_TRANSITION/);
});

test('no transition or forged approval can enable persistence', () => {
  for (const supplied of [undefined, create(), approve(),
    { status: 'APPROVED_FOR_REVIEW_ONLY', persistentRecoveryAllowed: true }]) {
    assert.throws(() => assertLegacyReviewMayPersist(supplied),
      /LEGACY_APPROVAL_PERSISTENCE_NOT_AUTHORIZED/);
  }
});

test('policy remains pure and never imports Firebase or opens a write path', () => {
  const source = readFileSync(new URL('../maintenance/discovery-legacy-approval-lifecycle.policy.mjs', import.meta.url), 'utf8');
  const executable = source.split('\n').filter(x => !x.trim().startsWith('//')).join('\n');
  for (const banned of [
    'firebase-admin', 'firebase-functions', 'initializeApp(',
    'runTransaction(', 'tx.create(', 'tx.set(', 'tx.update(',
    'setDoc(', 'updateDoc(', '.collection(', 'onCall(', 'onSchedule(',
    'fetch(', 'spawn(', 'writeFile(', 'console.log(',
  ]) assert.equal(executable.includes(banned), false, banned);
});
