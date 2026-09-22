import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADULT_CONSENT_VERSION,
  TERMS_ACCEPTANCE_VERSION,
} from '../compliance/platform-legal.constants';

process.env.FUNCTIONS_EMULATOR = 'true';

interface FirestoreBoundary {
  collection(path: string): unknown;
  runTransaction(updateFunction: unknown): Promise<unknown>;
}

interface RateLimitBoundary {
  consumeCommunityRateLimit(input: unknown): Promise<void>;
}

interface CallableError {
  code?: unknown;
  details?: unknown;
}

async function loadSubmitCallable() {
  const [handler, firebase] = await Promise.all([
    import('./community-official-claim.handler.js'),
    import('../firebaseApp.js'),
  ]);
  const rateLimit = require('./community-rate-limit.service.js') as RateLimitBoundary;

  return {
    submitCommunityOfficialClaim: handler.submitCommunityOfficialClaim,
    db: firebase.db,
    rateLimit,
  };
}

function installBoundaryProbe(
  db: unknown,
  rateLimitModule: unknown,
  allowSocialAccess = false
): {
  readonly firestoreOperations: string[];
  readonly rateLimitOperations: unknown[];
  restore(): void;
} {
  const firestore = db as FirestoreBoundary;
  const rateLimit = rateLimitModule as RateLimitBoundary;
  const originalCollection = firestore.collection;
  const originalRunTransaction = firestore.runTransaction;
  const originalRateLimit = rateLimit.consumeCommunityRateLimit;
  const firestoreOperations: string[] = [];
  const rateLimitOperations: unknown[] = [];

  firestore.collection = (path: string): unknown => {
    firestoreOperations.push(`collection:${path}`);
    if (!allowSocialAccess || !['users', 'age_eligibility_records'].includes(path)) {
      throw new Error('Firestore acessado antes da autenticação recente.');
    }
    return {
      doc: (uid: string) => ({
        get: async () => ({
          exists: true,
          data: () => path === 'users'
            ? {
              uid,
              interactionBlocked: false,
              acceptedTerms: {
                accepted: true,
                version: TERMS_ACCEPTANCE_VERSION,
                acknowledgedPrivacyNotice: true,
              },
              adultConsent: {
                accepted: true,
                version: ADULT_CONSENT_VERSION,
              },
            }
            : {
              uid,
              status: 'VERIFIED_ADULT',
              policyVersion: 1,
              source: 'INITIAL_VERIFICATION',
              method: 'EXTERNAL_PROVIDER',
              caseId: 'contract-age-1',
              verifiedAtMs: Date.now() - 1_000,
              expiresAtMs: null,
            },
        }),
      }),
    };
  };
  firestore.runTransaction = async (): Promise<never> => {
    firestoreOperations.push('runTransaction');
    throw new Error('Transação Firestore iniciada antes da validação do comando.');
  };
  rateLimit.consumeCommunityRateLimit = async (input: unknown): Promise<never> => {
    rateLimitOperations.push(input);
    throw new Error('Rate limit consumido antes da validação do comando.');
  };

  return {
    firestoreOperations,
    rateLimitOperations,
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

async function runSubmit(auth: Readonly<Record<string, unknown>> | undefined): Promise<unknown> {
  const { submitCommunityOfficialClaim } = await loadSubmitCallable();
  return submitCommunityOfficialClaim.run({ data: {}, auth } as never);
}

for (const scenario of [
  { name: 'sem auth_time', authTime: undefined },
  { name: 'com auth_time antigo', authTime: -601 },
  { name: 'com auth_time excessivamente futuro', authTime: 120 },
] as const) {
  test(`submitCommunityOfficialClaim rejeita ${scenario.name} antes do Firestore e rate limit`, async () => {
    const { db, rateLimit } = await loadSubmitCallable();
    const probe = installBoundaryProbe(db, rateLimit);
    const token = {
      email_verified: true,
      ...(scenario.authTime === undefined
        ? {}
        : { auth_time: Math.floor(Date.now() / 1_000) + scenario.authTime }),
    };

    try {
      await assert.rejects(
        runSubmit({ uid: 'owner-1', token }),
        (error: unknown) => assertCallableError(
          error,
          'failed-precondition',
          'recent-authentication-required'
        )
      );
      assert.deepEqual(probe.firestoreOperations, []);
      assert.deepEqual(probe.rateLimitOperations, []);
    } finally {
      probe.restore();
    }
  });
}

test('submitCommunityOfficialClaim aceita auth_time recente e alcança a validação do comando', async () => {
  const { db, rateLimit } = await loadSubmitCallable();
  const probe = installBoundaryProbe(db, rateLimit, true);

  try {
    await assert.rejects(
      runSubmit({
        uid: 'owner-1',
        token: {
          email_verified: true,
          auth_time: Math.floor(Date.now() / 1_000) - 30,
        },
      }),
      (error: unknown) => assertCallableError(error, 'invalid-argument')
    );
    assert.deepEqual(
      probe.firestoreOperations,
      ['collection:users', 'collection:age_eligibility_records']
    );
    assert.deepEqual(probe.rateLimitOperations, []);
  } finally {
    probe.restore();
  }
});

test('submitCommunityOfficialClaim preserva unauthenticated antes de recent-auth', async () => {
  const { db, rateLimit } = await loadSubmitCallable();
  const probe = installBoundaryProbe(db, rateLimit);

  try {
    await assert.rejects(
      runSubmit(undefined),
      (error: unknown) => assertCallableError(error, 'unauthenticated')
    );
    assert.deepEqual(probe.firestoreOperations, []);
    assert.deepEqual(probe.rateLimitOperations, []);
  } finally {
    probe.restore();
  }
});
