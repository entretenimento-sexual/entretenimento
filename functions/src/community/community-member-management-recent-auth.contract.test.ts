import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADULT_CONSENT_VERSION,
  TERMS_ACCEPTANCE_VERSION,
} from '../compliance/platform-legal.constants';

process.env.FUNCTIONS_EMULATOR = 'true';

interface DocumentProbe {
  path: string;
  collection(path: string): CollectionProbe;
}

interface CollectionProbe {
  doc(id?: string): DocumentProbe;
}

interface TransactionProbe {
  get(ref: DocumentProbe): Promise<{ exists: boolean; data(): unknown }>;
  set(ref: DocumentProbe, data: unknown): void;
  update(ref: DocumentProbe, data: unknown): void;
  create(ref: DocumentProbe, data: unknown): void;
}

interface FirestoreBoundary {
  collection(path: string): CollectionProbe;
  runTransaction(updateFunction: (transaction: TransactionProbe) => Promise<unknown>): Promise<unknown>;
}

interface RateLimitBoundary {
  consumeCommunityRateLimit(input: unknown): Promise<void>;
}

interface RecordedWrite {
  method: 'set' | 'update' | 'create';
  path: string;
  data: unknown;
}

interface CallableError {
  code?: unknown;
  details?: unknown;
}

interface Scenario {
  actorUid?: string;
  actorRole?: 'owner' | 'admin' | 'moderator' | 'member';
  targetRole?: 'admin' | 'moderator' | 'member';
  nextRole?: 'admin' | 'moderator' | 'member';
  authTime?: number;
  targetEligible?: boolean;
}

async function loadManageCallable() {
  const [handler, firebase] = await Promise.all([
    import('./community-member-management.handler.js'),
    import('../firebaseApp.js'),
  ]);
  const rateLimit = require('./community-rate-limit.service.js') as RateLimitBoundary;

  return { manageCommunityMember: handler.manageCommunityMember, db: firebase.db, rateLimit };
}

function installTransactionProbe(
  db: unknown,
  rateLimitModule: unknown,
  scenario: Scenario
): {
  readonly writes: RecordedWrite[];
  readonly transactionCalls: number;
  readonly rateLimitCalls: number;
  restore(): void;
} {
  const firestore = db as FirestoreBoundary;
  const rateLimit = rateLimitModule as RateLimitBoundary;
  const originalCollection = firestore.collection;
  const originalRunTransaction = firestore.runTransaction;
  const originalRateLimit = rateLimit.consumeCommunityRateLimit;
  const writes: RecordedWrite[] = [];
  const actorUid = scenario.actorUid ?? 'owner-1';
  let transactionCalls = 0;
  let rateLimitCalls = 0;

  const collection = (path: string): CollectionProbe => ({
    doc: (id = 'audit-1'): DocumentProbe => ({
      path: `${path}/${id}`,
      collection: (name: string): CollectionProbe => collection(`${path}/${id}/${name}`),
    }),
  });

  const documents: Record<string, unknown> = {
    'communities/community-1': {
      ownerUid: 'owner-1',
      name: 'Comunidade 1',
      source: { type: 'community', id: 'community-1' },
      status: 'active',
      moderation: { state: 'active' },
      metrics: { memberCount: 2 },
    },
    [`communities/community-1/members/${actorUid}`]: {
      status: 'active',
      role: scenario.actorRole ?? 'owner',
    },
    'communities/community-1/members/member-1': {
      status: 'active',
      role: scenario.targetRole ?? 'member',
    },
    [`users/${actorUid}`]: {
      uid: actorUid,
      profileCompleted: true,
      interactionBlocked: false,
      acceptedTerms: {
        accepted: true,
        version: TERMS_ACCEPTANCE_VERSION,
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: { accepted: true, version: ADULT_CONSENT_VERSION },
    },
    [`age_eligibility_records/${actorUid}`]: {
      uid: actorUid,
      status: 'VERIFIED_ADULT',
      policyVersion: 1,
      source: 'INITIAL_VERIFICATION',
      method: 'EXTERNAL_PROVIDER',
      caseId: 'contract-age-1',
      verifiedAtMs: Date.now() - 1_000,
      expiresAtMs: null,
    },
    'users/member-1': {
      uid: 'member-1',
      profileCompleted: true,
      interactionBlocked: false,
      acceptedTerms: {
        accepted: true,
        version: TERMS_ACCEPTANCE_VERSION,
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: { accepted: true, version: ADULT_CONSENT_VERSION },
    },
    ...(scenario.targetEligible === false
      ? {}
      : {
        'age_eligibility_records/member-1': {
          uid: 'member-1',
          status: 'VERIFIED_ADULT',
          policyVersion: 1,
          source: 'INITIAL_VERIFICATION',
          method: 'EXTERNAL_PROVIDER',
          caseId: 'contract-age-target-1',
          verifiedAtMs: Date.now() - 1_000,
          expiresAtMs: null,
        },
      }),
  };
  const transaction: TransactionProbe = {
    get: async (ref) => ({
      exists: Object.hasOwn(documents, ref.path),
      data: () => documents[ref.path],
    }),
    set: (ref, data) => { writes.push({ method: 'set', path: ref.path, data }); },
    update: (ref, data) => { writes.push({ method: 'update', path: ref.path, data }); },
    create: (ref, data) => { writes.push({ method: 'create', path: ref.path, data }); },
  };

  firestore.collection = collection;
  firestore.runTransaction = async (updateFunction) => {
    transactionCalls++;
    return updateFunction(transaction);
  };
  rateLimit.consumeCommunityRateLimit = async () => { rateLimitCalls++; };

  return {
    writes,
    get transactionCalls() { return transactionCalls; },
    get rateLimitCalls() { return rateLimitCalls; },
    restore: () => {
      firestore.collection = originalCollection;
      firestore.runTransaction = originalRunTransaction;
      rateLimit.consumeCommunityRateLimit = originalRateLimit;
    },
  };
}

function assertCallableError(error: unknown, code: string, reason?: string): boolean {
  const callableError = error as CallableError;
  assert.equal(callableError.code, code);
  if (reason !== undefined) {
    assert.equal(
      (callableError.details as Record<string, unknown> | undefined)?.['reason'],
      reason
    );
  }
  return true;
}

async function runScenario(scenario: Scenario): Promise<{
  result: unknown;
  writes: RecordedWrite[];
  transactionCalls: number;
  rateLimitCalls: number;
}> {
  const { manageCommunityMember, db, rateLimit } = await loadManageCallable();
  const probe = installTransactionProbe(db, rateLimit, scenario);
  const actorUid = scenario.actorUid ?? 'owner-1';
  const token = {
    email_verified: true,
    ...(scenario.authTime === undefined
      ? {}
      : { auth_time: Math.floor(Date.now() / 1_000) + scenario.authTime }),
  };

  try {
    const result = await manageCommunityMember.run({
      data: {
        communityId: 'community-1',
        memberId: 'member-1',
        action: 'set_role',
        nextRole: scenario.nextRole ?? 'moderator',
      },
      auth: { uid: actorUid, token },
    } as never);
    return {
      result,
      writes: [...probe.writes],
      transactionCalls: probe.transactionCalls,
      rateLimitCalls: probe.rateLimitCalls,
    };
  } finally {
    probe.restore();
  }
}

async function runRejectedScenario(
  scenario: Scenario,
  code: string,
  reason: string
): Promise<void> {
  const { manageCommunityMember, db, rateLimit } = await loadManageCallable();
  const probe = installTransactionProbe(db, rateLimit, scenario);
  const actorUid = scenario.actorUid ?? 'owner-1';
  const token = {
    email_verified: true,
    ...(scenario.authTime === undefined
      ? {}
      : { auth_time: Math.floor(Date.now() / 1_000) + scenario.authTime }),
  };

  try {
    await assert.rejects(
      manageCommunityMember.run({
        data: {
          communityId: 'community-1',
          memberId: 'member-1',
          action: 'set_role',
          nextRole: scenario.nextRole ?? 'moderator',
        },
        auth: { uid: actorUid, token },
      } as never),
      (error: unknown) => assertCallableError(error, code, reason)
    );
    assert.equal(probe.transactionCalls, 1);
    assert.equal(probe.rateLimitCalls, 1);
    assert.deepEqual(probe.writes, []);
  } finally {
    probe.restore();
  }
}

for (const entry of [
  { name: 'sem auth_time', authTime: undefined },
  { name: 'com auth_time antigo', authTime: -601 },
  { name: 'com auth_time excessivamente futuro', authTime: 120 },
] as const) {
  test(`manageCommunityMember impede promoção member → moderator ${entry.name} antes de gravar`, async () => {
    await runRejectedScenario(
      { authTime: entry.authTime },
      'failed-precondition',
      'recent-authentication-required'
    );
  });
}

test('manageCommunityMember promove member → moderator com autenticação recente', async () => {
  const result = await runScenario({ authTime: -30 });
  assert.equal((result.result as { role: string }).role, 'moderator');
  assert.equal(result.transactionCalls, 1);
  assert.equal(result.rateLimitCalls, 1);
  assert.equal(result.writes[0]?.path, 'communities/community-1/members/member-1');
  assert.equal((result.writes[0]?.data as { role: string }).role, 'moderator');
});

test('manageCommunityMember nega promoção quando destinatário não está elegível', async () => {
  await runRejectedScenario(
    { authTime: -30, targetEligible: false },
    'failed-precondition',
    'verification_required'
  );
});

test('manageCommunityMember preserva recent-auth para member → admin', async () => {
  await runRejectedScenario(
    { nextRole: 'admin' },
    'failed-precondition',
    'recent-authentication-required'
  );
});

test('manageCommunityMember não exige recent-auth para member → member', async () => {
  const result = await runScenario({ nextRole: 'member' });
  assert.equal((result.result as { role: string }).role, 'member');
  assert.deepEqual(result.writes, []);
});

test('manageCommunityMember preserva rebaixamento moderator → member sem recent-auth', async () => {
  const result = await runScenario({ targetRole: 'moderator', nextRole: 'member' });
  assert.equal((result.result as { role: string }).role, 'member');
  assert.equal((result.writes[0]?.data as { role: string }).role, 'member');
});

test('manageCommunityMember nega promoção por moderador antes de recent-auth', async () => {
  await runRejectedScenario(
    { actorUid: 'moderator-1', actorRole: 'moderator' },
    'permission-denied',
    'role_change_forbidden'
  );
});
