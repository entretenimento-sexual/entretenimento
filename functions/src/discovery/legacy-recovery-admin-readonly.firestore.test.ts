import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

import {
  inspectLegacyRecoveryAdminReadOnly,
  LEGACY_RECOVERY_APPROVAL_COLLECTION,
  LEGACY_RECOVERY_READONLY_PROJECT,
  type LegacyRecoveryReadOnlyBackend,
} from './legacy-recovery-admin-readonly.firestore';

const NOW = 1_800_000_000_000;
const OPERATOR = 'synthetic-operator-id';
const REVIEWER = 'synthetic-reviewer-id';
const OPERATION = 'synthetic-operation-id';
const TOKEN = 'synthetic-only-verified-token';
const SAFE_ENV = Object.freeze({
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:28080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:29099',
  GCLOUD_PROJECT: LEGACY_RECOVERY_READONLY_PROJECT,
  FUNCTIONS_EMULATOR: 'true',
});

async function withSyntheticRuntime<T>(
  configured: NodeJS.ProcessEnv,
  work: () => Promise<T>
): Promise<T> {
  const keys = [
    ...Object.keys(SAFE_ENV), ...Object.keys(configured),
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT',
    'GCP_PROJECT',
  ];
  const previous = new Map<string, string | undefined>(
    keys.map((key): [string, string | undefined] => [key, process.env[key]])
  );
  try {
    for (const key of keys) {
      const value = configured[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await work();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function fixture() {
  const calls: string[] = [];
  const authUsers = new Map<string, Record<string, unknown>>([
    [OPERATOR, { uid: OPERATOR, disabled: false, emailVerified: true }],
    [REVIEWER, { uid: REVIEWER, disabled: false, emailVerified: true }],
  ]);
  const users = new Map<string, Record<string, unknown>>([
    [OPERATOR, {
      role: 'admin', accountStatus: 'active',
      privateRecoveryOperator: true,
    }],
    [REVIEWER, {
      role: 'admin', accountStatus: 'active',
      privateRecoveryReviewer: true,
    }],
  ]);
  const approvals = new Map<string, Record<string, unknown>>([
    [OPERATION, {
      operationId: OPERATION,
      purpose: 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW',
      status: 'APPROVED_FOR_REVIEW_ONLY',
      projectId: 'entretenimento-sexual',
      targetCollection: 'legacy_discovery_preference_recovery',
      candidateCount: 2,
      legacyEntryCount: 8,
      requestedByUid: OPERATOR,
      approvedByUid: REVIEWER,
      approvedAtMs: NOW - 60_000,
      expiresAtMs: NOW + 60_000,
      revokedAtMs: null,
      consumedAtMs: null,
    }],
  ]);
  let verified: Record<string, unknown> = {
    uid: OPERATOR,
    auth_time: (NOW - 60_000) / 1000,
    admin: true,
  };
  let authFailure = false;
  const auth = {
    verifyIdToken: async (idToken: string, checkRevoked: boolean) => {
      calls.push('verifyIdToken');
      assert.equal(idToken, TOKEN);
      assert.equal(checkRevoked, true);
      if (authFailure) throw new Error('synthetic-sensitive-jwt-value');
      return verified;
    },
    getUser: async (uid: string) => {
      calls.push('getUser');
      const user = authUsers.get(uid);
      if (!user) throw new Error('synthetic-user-not-found');
      return user;
    },
  } as unknown as Pick<Auth, 'verifyIdToken' | 'getUser'>;
  const firestore = {
    collection: (name: string) => {
      calls.push('collection:' + name);
      if (name !== 'users' && name !== LEGACY_RECOVERY_APPROVAL_COLLECTION) {
        throw new Error('DISALLOWED_READ');
      }
      return {
        doc: (uid: string) => ({
          get: async () => {
            calls.push('get:' + name);
            const value = name === 'users'
              ? users.get(uid) : approvals.get(uid);
            return {
              exists: value !== undefined,
              data: () => value,
            };
          },
        }),
      };
    },
  } as unknown as Pick<Firestore, 'collection'>;
  const backend: LegacyRecoveryReadOnlyBackend = { auth, firestore };
  const run = (env: NodeJS.ProcessEnv = SAFE_ENV, now = NOW) =>
    withSyntheticRuntime(env, () =>
      inspectLegacyRecoveryAdminReadOnly(backend, {
        operationId: OPERATION,
        operatorIdToken: TOKEN,
      }, now));
  return {
    run, backend, calls, users, authUsers, approvals,
    changeToken: (value: Record<string, unknown>) => { verified = value; },
    failVerification: () => { authFailure = true; },
  };
}

function alwaysBlocked(result: Awaited<ReturnType<typeof
  inspectLegacyRecoveryAdminReadOnly>>) {
  assert.equal(result.phase, 'B2_7_BACKEND_READ_ONLY');
  assert.equal(result.decision, 'BLOCKED');
  assert.equal(result.backendWriterIntegrated, false);
  assert.equal(result.approvalRecordConsumed, false);
  assert.equal(result.auditPersisted, false);
  assert.equal(result.privateRecoveryRead, false);
  assert.equal(result.privateRecoveryWritten, false);
  assert.equal(result.ownerConsentEstablished, false);
  assert.equal(result.persistentWritesAllowed, false);
  assert.equal(result.sourceFieldsDeletionAllowed, false);
  assert.equal(result.visibilityActivationAllowed, false);
  assert.equal(Object.isFrozen(result), true);
  for (const sensitive of [OPERATOR, REVIEWER, OPERATION, TOKEN,
    'legacyRaw', 'interestedInOrientations']) {
    assert.equal(JSON.stringify(result).includes(sensitive), false);
  }
}

test('verified Auth + current admin docs + review record stay BLOCKED', async () => {
  const f = fixture();
  const result = await f.run();
  alwaysBlocked(result);
  assert.equal(result.identityReadVerified, true);
  assert.equal(result.operatorPrivilegeCurrent, true);
  assert.equal(result.reviewerPrivilegeCurrent, true);
  assert.equal(result.reviewerIndependent, true);
  assert.equal(result.approvalRecordConsistent, true);
  assert.deepEqual(f.calls, [
    'verifyIdToken', 'getUser', 'collection:users', 'get:users',
    'collection:' + LEGACY_RECOVERY_APPROVAL_COLLECTION,
    'get:' + LEGACY_RECOVERY_APPROVAL_COLLECTION,
    'getUser', 'collection:users', 'get:users',
  ]);
});

test('revoked, stale or spoofed operator identity blocks all database reads', async () => {
  for (const token of [
    { uid: 'synthetic-unknown-id', auth_time: (NOW - 60_000) / 1000 },
    { uid: OPERATOR, auth_time: (NOW - 901_000) / 1000 },
    { uid: OPERATOR, auth_time: (NOW + 60_000) / 1000 },
    { uid: OPERATOR, auth_time: 'fake' },
  ]) {
    const f = fixture();
    f.changeToken(token);
    const result = await f.run();
    alwaysBlocked(result);
    assert.equal(result.identityReadVerified, false);
    assert.deepEqual(f.calls, token.uid === 'synthetic-unknown-id'
      ? ['verifyIdToken', 'getUser']
      : ['verifyIdToken']);
    assert.equal(f.calls.some(x => x.startsWith('collection:')), false);
  }

  const revoked = fixture();
  revoked.failVerification();
  const report = await revoked.run();
  alwaysBlocked(report);
  assert.equal(report.identityReadVerified, false);
  assert.deepEqual(revoked.calls, ['verifyIdToken']);
});

test('current operator account revocation overrides old admin JWT claims', async () => {
  for (const patch of [
    { role: 'free' }, { accountStatus: 'deleted' },
    { accountStatus: 'pending_deletion' },
    { privateRecoveryOperator: false },
    { adminPrivilegeRevokedAt: NOW - 1 },
    { deletionRequestedAt: NOW - 1 },
    { purgeLeaseOwner: 'some-lease' },
    { interactionBlocked: true },
    { accountLocked: true },
  ]) {
    const f = fixture();
    Object.assign(f.users.get(OPERATOR)!, patch);
    const result = await f.run();
    alwaysBlocked(result);
    assert.equal(result.operatorPrivilegeCurrent, false);
    assert.equal(result.approvalRecordConsistent, false);
    assert.equal(f.calls.includes('collection:' +
      LEGACY_RECOVERY_APPROVAL_COLLECTION), false);
  }
});

test('reviewer current revocation and changed approval are not accepted', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) =>
      f.users.get(REVIEWER)!['privateRecoveryReviewer'] = false,
    (f: ReturnType<typeof fixture>) =>
      f.users.get(REVIEWER)!['role'] = 'free',
    (f: ReturnType<typeof fixture>) =>
      f.authUsers.get(REVIEWER)!['disabled'] = true,
    (f: ReturnType<typeof fixture>) =>
      f.approvals.get(OPERATION)!['approvedByUid'] = OPERATOR,
    (f: ReturnType<typeof fixture>) =>
      f.approvals.get(OPERATION)!['status'] = 'REVOKED',
    (f: ReturnType<typeof fixture>) =>
      f.approvals.get(OPERATION)!['expiresAtMs'] = NOW,
    (f: ReturnType<typeof fixture>) =>
      f.approvals.get(OPERATION)!['consumedAtMs'] = NOW - 1,
  ]) {
    const f = fixture();
    change(f);
    const result = await f.run();
    alwaysBlocked(result);
    assert.equal(result.approvalRecordConsistent, false);
  }
});

test('invalid runtime, token or operation never touches any Auth or Firestore', async () => {
  for (const patch of [
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    { FIREBASE_AUTH_EMULATOR_HOST: 'auth.googleapis.com:443' },
    { GCLOUD_PROJECT: 'entretenimento-sexual' },
    { FUNCTIONS_EMULATOR: 'false' },
    { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' },
  ]) {
    const f = fixture();
    const result = await f.run({ ...SAFE_ENV, ...patch });
    alwaysBlocked(result);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  const result = await withSyntheticRuntime(SAFE_ENV, () =>
    inspectLegacyRecoveryAdminReadOnly(f.backend, {
      operationId: '../other-account',
      operatorIdToken: TOKEN,
    }, NOW));
  alwaysBlocked(result);
  assert.deepEqual(f.calls, []);
});

test('read failures return a redacted blocked report without throwing', async () => {
  const f = fixture();
  f.approvals.clear();
  const result = await f.run();
  alwaysBlocked(result);
  assert.equal(result.approvalRecordConsistent, false);
});

test('Firestore read failure is redacted and does not expose service errors', async () => {
  const f = fixture();
  const failing: LegacyRecoveryReadOnlyBackend = {
    auth: f.backend.auth,
    firestore: {
      collection: () => { throw new Error('synthetic-sensitive-db-context'); },
    } as unknown as Pick<Firestore, 'collection'>,
  };
  const result = await withSyntheticRuntime(SAFE_ENV, () =>
    inspectLegacyRecoveryAdminReadOnly(failing, {
      operationId: OPERATION,
      operatorIdToken: TOKEN,
    }, NOW));
  alwaysBlocked(result);
  assert.equal(result.identityReadVerified, false);
  assert.equal(JSON.stringify(result).includes('synthetic-sensitive-db-context'), false);
});

test('backend integration is not an exported callable or a Firestore writer', () => {
  const source = readFileSync(path.resolve(
    process.cwd(), 'src/discovery/legacy-recovery-admin-readonly.firestore.ts'
  ), 'utf8');
  const index = readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8');
  assert.equal(index.includes('inspectLegacyRecoveryAdminReadOnly'), false);
  assert.equal(index.includes('legacy-recovery-admin-readonly'), false);
  for (const forbidden of [
    'onCall(', 'onRequest(', 'onSchedule(', 'initializeApp(', 'getAuth(',
    'getFirestore(', '.set(', '.update(', '.delete(', 'tx.create(',
    'tx.set(', 'tx.update(', 'tx.delete(', 'runTransaction(',
    'console.log(', 'console.error(',
  ]) {
    const executable = source.split('\n')
      .filter(line => !line.trim().startsWith('//')).join('\n');
    assert.equal(executable.includes(forbidden), false, forbidden);
  }
});
