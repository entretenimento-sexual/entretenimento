import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  REVIEW_AUDIT_PHASE,
  REVIEW_AUDIT_PROPOSED_RETENTION_DAYS,
  REVIEW_AUDIT_KINDS as K,
  appendSyntheticReviewAuditEvent as append,
  verifySyntheticReviewAuditChain as verify,
  assessSyntheticReviewAudit as assess,
  assertReviewAuditMayPersist,
} from '../maintenance/discovery-legacy-approval-audit-integrity.policy.mjs';
const T = 1_850_000_000_000;
const DAY = 24 * 60 * 60_000;
const event = (kind, atMs) => ({ kind, atMs });
const initial = () => append([], event(K.PRECHECK_BLOCKED, T));
const consumed = () => append(initial(), event(K.CONSUMED_SYNTHETIC, T + 1));
const assertBlocked = report => {
  for (const key of [
    'trustAnchorVerified', 'backendAuthorityVerified', 'auditPersisted',
    'retentionPolicyApproved', 'expirationJobImplemented', 'deletionAllowed',
    'approvalWriterIntegrated', 'approvalConsumed', 'privateRecoveryRead',
    'privateRecoveryWritten', 'persistentWritesAllowed',
    'sourceDeletionAllowed', 'publicVisibilityAllowed',
  ]) assert.equal(report[key], false, key);
  assert.equal(report.decision, 'BLOCKED');
  assert.equal(Object.isFrozen(report), true);
};

test('a single anonymous synthetic stream has deterministic canonical digest', () => {
  const first = initial();
  const again = initial();
  assert.deepEqual(first, again);
  assert.equal(verify(first), true);
  assert.equal(first[0].previousHash, '0'.repeat(64));
  assert.match(first[0].entryHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(first[0]), true);
  assert.equal(Object.isFrozen(first), true);
});

test('a consumed synthetic review permits only blocked replay observations', () => {
  const events = consumed();
  assert.equal(verify(events), true);
  assert.throws(() => append(events, event(K.CONSUMED_SYNTHETIC, T + 2)),
    /B293B_AUDIT_EVENT_DENIED/);
  assert.throws(() => append(events, event(K.REVOKED_SYNTHETIC, T + 2)),
    /B293B_AUDIT_EVENT_DENIED/);
  const replay = append(events, event(K.REPLAY_BLOCKED, T + 2));
  assert.equal(verify(replay), true);
  assert.equal(replay.length, 3);
});

test('revoked or expired terminal streams cannot consume a review', () => {
  for (const terminal of [K.REVOKED_SYNTHETIC, K.EXPIRED_SYNTHETIC]) {
    const chain = append(initial(), event(terminal, T + 1));
    assert.throws(() => append(chain, event(K.CONSUMED_SYNTHETIC, T + 2)),
      /B293B_AUDIT_EVENT_DENIED/);
    assert.throws(() => append(chain, event(K.REPLAY_BLOCKED, T + 2)),
      /B293B_AUDIT_EVENT_DENIED/);
  }
});

test('detects one-field alteration and forged digest in the middle', () => {
  const chain = append(consumed(), event(K.REPLAY_BLOCKED, T + 2));
  const corrupted = chain.map(e => ({ ...e }));
  corrupted[1].kind = K.REVOKED_SYNTHETIC;
  assert.equal(verify(corrupted), false);
  corrupted[1] = { ...chain[1], entryHash: 'f'.repeat(64) };
  assert.equal(verify(corrupted), false);
  assert.equal(assess(corrupted, T + 10).eventsValidated, 0);
});

test('detects removal, reorder, sequence gaps and conflicting previous digest', () => {
  const chain = append(consumed(), event(K.REPLAY_BLOCKED, T + 2));
  for (const variant of [
    chain.slice(1),
    [chain[1], chain[0], chain[2]],
    [chain[0], chain[2]],
    chain.map((e, i) => i === 1 ? { ...e, sequence: 7 } : e),
    chain.map((e, i) => i === 2 ? { ...e, previousHash: '1'.repeat(64) } : e),
  ]) assert.equal(verify(variant), false);
});

test('rejects arbitrary metadata, IDs, tokens and private payload fields', () => {
  const base = initial();
  for (const field of ['operationId', 'uid', 'actorId', 'jwt',
    'legacyRaw', 'notes', 'privateRecoveryRead']) {
    assert.equal(verify([{ ...base[0], [field]: 'synthetic-private' }]), false);
    assert.throws(() => append(base, {
      ...event(K.REPLAY_BLOCKED, T + 1), [field]: 'synthetic-private',
    }), /B293B_AUDIT_EVENT_DENIED/);
  }
});

test('rejects invalid time, unknown kinds, nonmonotonic clock and excessive limits', () => {
  const base = initial();
  for (const candidate of [
    event('APPROVE_PERSISTENT_RECOVERY', T + 1),
    event(K.REPLAY_BLOCKED, T + 1),
    event(K.CONSUMED_SYNTHETIC, T),
    event(K.CONSUMED_SYNTHETIC, 'invalid'),
    event(K.CONSUMED_SYNTHETIC, 4_000_000_000_000),
  ]) assert.throws(() => append(base, candidate), /B293B_AUDIT_EVENT_DENIED/);
  assert.equal(verify(new Array(129).fill(base[0])), false);
});

test('retention is a 30-day review PROPOSAL; no deletion or TTL action', () => {
  const chain = consumed();
  const before = assess(chain, T + 29 * DAY);
  const after = assess(chain, T + 31 * DAY);
  assert.equal(REVIEW_AUDIT_PROPOSED_RETENTION_DAYS, 30);
  assert.equal(before.retentionReviewCandidates, 0);
  assert.equal(after.retentionReviewCandidates, 2);
  assert.equal(after.eventsValidated, 2);
  assert.equal(after.integrityShapeCompatible, true);
  assertBlocked(before);
  assertBlocked(after);
});

test('report is aggregate-only, immutable, and never claims trusted authority', () => {
  const chain = consumed();
  const report = assess(chain, T + 3);
  assert.equal(report.phase, REVIEW_AUDIT_PHASE);
  assert.equal(report.integrityShapeCompatible, true);
  assertBlocked(report);
  const serialized = JSON.stringify(report);
  for (const forbidden of ['operationId', 'uid', 'token', 'entryHash',
    'previousHash', 'legacyRaw', 'personalData']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.throws(() => assess(chain, 0), /B293B_INVALID_ASSESSMENT_TIME/);
});

test('synthetic hashes are not externally anchored; whole-chain rewrite is possible', () => {
  const original = consumed();
  const rewritten = append([], event(K.REVOKED_SYNTHETIC, T));
  assert.equal(verify(original), true);
  assert.equal(verify(rewritten), true);
  assert.equal(assess(rewritten, T + 1).trustAnchorVerified, false);
});

test('untrusted inputs cannot unlock recovery persistence', () => {
  for (const value of [undefined, null, { role: 'admin' },
    consumed(), assess(consumed(), T + 10)]) {
    assert.throws(() => assertReviewAuditMayPersist(value),
      /B293B_PERSISTENCE_NOT_AUTHORIZED/);
  }
});

test('source is Node-only policy, not a Firebase writer, callable or IO path', () => {
  const src = readFileSync(fileURLToPath(new URL(
    '../maintenance/discovery-legacy-approval-audit-integrity.policy.mjs',
    import.meta.url
  )), 'utf8');
  const code = src.split('\n').filter(s => !s.trim().startsWith('//')).join('\n');
  for (const forbidden of ['firebase-admin', 'firebase-functions',
    'initializeApp(', 'onCall(', 'onSchedule(', 'runTransaction(',
    '.collection(', '.set(', 'tx.create(', 'tx.update(', 'tx.delete(',
    'fetch(', 'writeFile(', 'console.log(', 'process.env',
  ]) assert.equal(code.includes(forbidden), false, forbidden);
});
