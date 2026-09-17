import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.FUNCTIONS_EMULATOR = 'true';

interface FirestoreBoundary {
  collection(path: string): unknown;
  runTransaction(updateFunction: unknown): Promise<unknown>;
}

interface CallableError {
  code?: unknown;
  details?: unknown;
}

async function loadReviewCallable() {
  const [{ reviewCommunityOfficialClaim }, { db }] = await Promise.all([
    import('./community-official-claim.handler.js'),
    import('../firebaseApp.js'),
  ]);

  return { reviewCommunityOfficialClaim, db };
}

function installFirestoreProbe(db: unknown): {
  readonly operations: string[];
  restore(): void;
} {
  const firestore = db as FirestoreBoundary;
  const originalCollection = firestore.collection;
  const originalRunTransaction = firestore.runTransaction;
  const operations: string[] = [];

  firestore.collection = (path: string): never => {
    operations.push(`collection:${path}`);
    throw new Error('Firestore não deve ser acessado antes da autenticação recente.');
  };
  firestore.runTransaction = async (): Promise<never> => {
    operations.push('runTransaction');
    throw new Error('Transação Firestore não deve ser iniciada antes da autenticação recente.');
  };

  return {
    operations,
    restore: () => {
      firestore.collection = originalCollection;
      firestore.runTransaction = originalRunTransaction;
    },
  };
}

function assertCallableError(
  error: unknown,
  code: string,
  reason?: string
): boolean {
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

async function runReview(auth: Readonly<Record<string, unknown>>): Promise<unknown> {
  const { reviewCommunityOfficialClaim } = await loadReviewCallable();

  return reviewCommunityOfficialClaim.run({
    data: {},
    auth,
  } as never);
}

for (const scenario of [
  {
    name: 'sem auth_time',
    token: { admin: true },
  },
  {
    name: 'com auth_time antigo',
    token: {
      admin: true,
      auth_time: Math.floor(Date.now() / 1_000) - 601,
    },
  },
  {
    name: 'com auth_time excessivamente futuro',
    token: {
      admin: true,
      auth_time: Math.floor(Date.now() / 1_000) + 61,
    },
  },
] as const) {
  test(`reviewCommunityOfficialClaim rejeita admin ${scenario.name} antes do Firestore`, async () => {
    const { db } = await loadReviewCallable();
    const probe = installFirestoreProbe(db);

    try {
      await assert.rejects(
        runReview({ uid: 'admin-1', token: scenario.token }),
        (error: unknown) => assertCallableError(
          error,
          'failed-precondition',
          'recent-authentication-required'
        )
      );
      assert.deepEqual(probe.operations, []);
    } finally {
      probe.restore();
    }
  });
}

test('reviewCommunityOfficialClaim aceita auth_time recente e alcança a validação do comando', async () => {
  const { db } = await loadReviewCallable();
  const probe = installFirestoreProbe(db);

  try {
    await assert.rejects(
      runReview({
        uid: 'admin-1',
        token: {
          admin: true,
          auth_time: Math.floor(Date.now() / 1_000) - 30,
        },
      }),
      (error: unknown) => assertCallableError(error, 'invalid-argument')
    );
    assert.deepEqual(probe.operations, []);
  } finally {
    probe.restore();
  }
});

test('reviewCommunityOfficialClaim preserva autorização administrativa antes de recent-auth', async () => {
  const { db } = await loadReviewCallable();
  const probe = installFirestoreProbe(db);

  try {
    await assert.rejects(
      runReview({
        uid: 'user-1',
        token: { auth_time: Math.floor(Date.now() / 1_000) - 30 },
      }),
      (error: unknown) => assertCallableError(error, 'permission-denied')
    );
    assert.deepEqual(probe.operations, []);
  } finally {
    probe.restore();
  }
});
