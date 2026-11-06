import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import {
  inspectLegacyRecoveryReviewAuthorityReadOnly,
} from './legacy-recovery-review-authority-readonly.firestore';
import type {
  LegacyRecoveryReadOnlyBackend,
} from './legacy-recovery-admin-readonly.firestore';

const NOW = 1_800_000_000_000;
const OP = 'synthetic-operator-001';
const RE = 'synthetic-reviewer-002';
const ID = 'synthetic-operation-003';
const TOKEN = 'synthetic-valid-token-123456';
const SAFE = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:28080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:29099',
  GCLOUD_PROJECT: 'demo-entretenimento-legacy-governance',
  FUNCTIONS_EMULATOR: 'true',
};

async function withEnv<T>(work: () => Promise<T>, changes: Partial<Record<string, string>> = {}) {
  const keys = [
    ...Object.keys(SAFE), ...Object.keys(changes),
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT',
  ];
  const old = new Map(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, SAFE, changes);
    return await work();
  } finally {
    for (const [k, v] of old) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function fixture() {
  const calls: string[] = [];
  const principal = new Map<string, Record<string, unknown>>([
    [OP, {uid: OP, disabled: false, emailVerified: true}],
    [RE, {uid: RE, disabled: false, emailVerified: true}],
  ]);
  const users = new Map<string, Record<string, unknown>>([
    [OP, {role: 'admin', accountStatus: 'active', privateRecoveryOperator: true}],
    [RE, {role: 'admin', accountStatus: 'active', privateRecoveryReviewer: true}],
  ]);
  const approval: Record<string, unknown> = {
    schemaVersion: 1, operationId: ID,
    purpose: 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW',
    projectId: 'entretenimento-sexual',
    targetCollection: 'legacy_discovery_preference_recovery',
    candidateCount: 2, legacyEntryCount: 8,
    requestedByUid: OP, requestedAtMs: NOW - 120_000,
    approvedByUid: RE, approvedAtMs: NOW - 60_000,
    expiresAtMs: NOW + 840_000,
    revokedAtMs: null, consumedAtMs: null, expiredAtMs: null,
    status: 'APPROVED_FOR_REVIEW_ONLY', revision: 1,
  };
  let verified = {uid: OP, auth_time: (NOW - 60_000) / 1000};
  let failToken = false;
  let approvalReadCount = 0;
  let beforeSecondApprovalRead: (() => void) | undefined;
  const auth = {
    verifyIdToken: async (value: string, revoked: boolean) => {
      calls.push('verify');
      assert.equal(value, TOKEN);
      assert.equal(revoked, true);
      if (failToken) throw new Error('SENSITIVE_TOKEN');
      return verified;
    },
    getUser: async (uid: string) => {
      calls.push('getAuth');
      const value = principal.get(uid);
      if (!value) throw new Error('not-found');
      return value;
    },
  } as unknown as Pick<Auth, 'verifyIdToken' | 'getUser'>;
  const firestore = {
    collection: (name: string) => {
      calls.push('collection:' + name);
      assert.ok(['users', 'legacy_discovery_recovery_approvals'].includes(name));
      return {
        doc: (id: string) => ({
          get: async () => {
            calls.push('get:' + name);
            if (name === 'legacy_discovery_recovery_approvals') {
              approvalReadCount++;
              if (approvalReadCount === 2) beforeSecondApprovalRead?.();
            }
            const data = name === 'users' ? users.get(id) :
              id === ID ? approval : undefined;
            return {exists: data !== undefined, data: () => data};
          },
        }),
      };
    },
  } as unknown as Pick<Firestore, 'collection'>;
  const backend: LegacyRecoveryReadOnlyBackend = {auth, firestore};
  const run = (now = NOW, env: Partial<Record<string, string>> = {}) =>
    withEnv(() => inspectLegacyRecoveryReviewAuthorityReadOnly(
      backend, {operationId: ID, operatorIdToken: TOKEN}, now
    ), env);
  return {
    approval, principal, users, calls, run,
    revokeToken: () => {failToken = true;},
    changeToken: (patch: typeof verified) => {verified = patch;},
    onSecondApprovalRead: (work: () => void) => {beforeSecondApprovalRead = work;},
  };
}

function permanentlyBlocked(result: Awaited<ReturnType<
  typeof inspectLegacyRecoveryReviewAuthorityReadOnly>>) {
  assert.equal(result.phase, 'B2_9_2A_BACKEND_READ_ONLY');
  assert.equal(result.decision, 'BLOCKED');
  assert.equal(result.sequentialReadsOnly, true);
  for (const key of [
    'transactionAtomicityProven', 'approvalWriterIntegrated',
    'approvalConsumed', 'auditPersisted', 'privateRecoveryRead',
    'privateRecoveryWritten', 'persistentWritesAllowed',
    'sourceDeletionAllowed', 'publicVisibilityAllowed',
  ] as const) assert.equal(result[key], false);
  assert.ok(Object.isFrozen(result));
  const json = JSON.stringify(result);
  for (const text of [OP, RE, ID, TOKEN, 'legacyRaw']) {
    assert.ok(!json.includes(text));
  }
}

test('B2.9.1 approved lifecycle matches real B2.7 authority reads, stays blocked', async () => {
  const f = fixture();
  const result = await f.run();
  permanentlyBlocked(result);
  assert.equal(result.b27EvidenceCompatible, true);
  assert.equal(result.lifecycleSchemaCompatible, true);
  assert.equal(result.lifecycleRevisionCurrent, true);
  assert.equal(result.principalsRechecked, true);
  assert.equal(result.reviewEvidenceConsistent, true);
  assert.ok(f.calls.filter(c => c === 'verify').length >= 2);
  assert.equal(f.calls.includes('collection:legacy_discovery_preference_recovery'), false);
});

test('old B2.7 record without B2.9.1 schema is rejected, without breaking B2.7', async () => {
  const f = fixture();
  delete f.approval['revision'];
  const r = await f.run();
  permanentlyBlocked(r);
  assert.equal(r.b27EvidenceCompatible, true);
  assert.equal(r.lifecycleSchemaCompatible, false);
});

test('revision mismatch and lifecycle terminal statuses fail closed', async () => {
  for (const patch of [
    {revision: 2}, {status: 'CONSUMED_FOR_REVIEW_ONLY'},
    {status: 'REVOKED'}, {status: 'EXPIRED'},
    {revokedAtMs: NOW - 1}, {consumedAtMs: NOW - 1},
    {expiredAtMs: NOW - 1}, {schemaVersion: 2},
    {extra: 'secret'},
  ]) {
    const f = fixture();
    Object.assign(f.approval, patch);
    const r = await f.run();
    permanentlyBlocked(r);
    assert.equal(r.reviewEvidenceConsistent, false);
  }
});

test('strict 15-minute window and request timestamp, no time replay', async () => {
  for (const patch of [
    {requestedAtMs: NOW - 1_000_000},
    {approvedAtMs: NOW + 1},
    {expiresAtMs: NOW + 839_999},
    {expiresAtMs: NOW},
    {requestedAtMs: NOW - 30_000},
  ]) {
    const f = fixture();
    Object.assign(f.approval, patch);
    const r = await f.run();
    permanentlyBlocked(r);
    assert.equal(r.reviewEvidenceConsistent, false);
  }
});

test('operator and reviewer revocations override B2.9.1 approval record', async () => {
  for (const patch of [
    {which: 'operator', role: 'user'},
    {which: 'operator', privateRecoveryOperator: false},
    {which: 'reviewer', privateRecoveryReviewer: false},
    {which: 'reviewer', accountStatus: 'deleted'},
    {which: 'reviewer', adminPrivilegeRevokedAt: NOW - 1},
  ]) {
    const f = fixture();
    const which = patch.which === 'operator' ? OP : RE;
    const {which: _, ...update} = patch;
    Object.assign(f.users.get(which)!, update);
    const r = await f.run();
    permanentlyBlocked(r);
    assert.equal(r.reviewEvidenceConsistent, false);
  }
});

test('self-approval, scope tampering and unknown fields never count as valid', async () => {
  for (const patch of [
    {approvedByUid: OP},
    {requestedByUid: RE},
    {targetCollection: 'public_profiles'},
    {projectId: 'production'},
    {candidateCount: 3},
    {legacyRaw: ['secret']},
  ]) {
    const f = fixture();
    Object.assign(f.approval, patch);
    const r = await f.run();
    permanentlyBlocked(r);
    assert.equal(r.reviewEvidenceConsistent, false);
  }
});

test('revocation or revision changed between read phases is rejected', async () => {
  const revisionChanged = fixture();
  revisionChanged.onSecondApprovalRead(() => {
    revisionChanged.approval['revision'] = 2;
  });
  const stale = await revisionChanged.run();
  permanentlyBlocked(stale);
  assert.equal(stale.b27EvidenceCompatible, true);
  assert.equal(stale.reviewEvidenceConsistent, false);

  const roleChanged = fixture();
  roleChanged.onSecondApprovalRead(() => {
    roleChanged.users.get(OP)!['role'] = 'user';
  });
  const role = await roleChanged.run();
  permanentlyBlocked(role);
  assert.equal(role.lifecycleSchemaCompatible, true);
  assert.equal(role.principalsRechecked, false);
  assert.equal(role.reviewEvidenceConsistent, false);
});

test('revoked or stale ID token is rejected without disclosing identity', async () => {
  for (const mode of ['revoked', 'stale']) {
    const f = fixture();
    if (mode === 'revoked') f.revokeToken();
    else f.changeToken({uid: OP, auth_time: (NOW - 1_000_000) / 1000});
    const r = await f.run();
    permanentlyBlocked(r);
    assert.equal(r.reviewEvidenceConsistent, false);
  }
});

test('wrong emulator project or ADC prevents any backend reads', async () => {
  for (const env of [
    {GCLOUD_PROJECT: 'entretenimento-sexual'},
    {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'},
    {GOOGLE_APPLICATION_CREDENTIALS: 'unsafe-key.json'},
  ]) {
    const f = fixture();
    const r = await f.run(NOW, env);
    permanentlyBlocked(r);
    assert.equal(f.calls.length, 0);
  }
});

test('source has no writes, callable exports, logs or production entrypoint', () => {
  const file = path.join(process.cwd(), 'src/discovery/legacy-recovery-review-authority-readonly.firestore.ts');
  const source = readFileSync(file, 'utf8');
  const index = readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf8');
  assert.ok(!index.includes('legacy-recovery-review-authority-readonly'));
  assert.ok(!index.includes('inspectLegacyRecoveryReviewAuthorityReadOnly'));
  const code = source.split('\n').filter(line => !line.trim().startsWith('//') &&
    !line.trim().startsWith('*')).join('\n');
  for (const banned of [
    'onCall(', 'onRequest(', 'onSchedule(', 'initializeApp(',
    'runTransaction(', 'tx.create(', 'tx.update(', 'tx.delete(',
    '.set(', '.update(', '.delete(', 'console.log(', 'console.error(',
    'writeFile(', 'firebase deploy',
  ]) assert.ok(!code.includes(banned), banned);
});
