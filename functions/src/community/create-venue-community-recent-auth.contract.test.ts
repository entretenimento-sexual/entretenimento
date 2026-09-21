import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADULT_CONSENT_VERSION,
  TERMS_ACCEPTANCE_VERSION,
} from '../compliance/platform-legal.constants';

process.env.FUNCTIONS_EMULATOR = 'true';

const REQUEST_ID = '4b7fb4a1-91e5-4dbf-9cc7-42fd4d77f779';
const VENUE_ID = `venue-${REQUEST_ID}`;
const COMMUNITY_ID = `community-${REQUEST_ID}`;
const VALID_DATA = {
  requestId: REQUEST_ID,
  name: 'Local Oficial',
  kind: 'event_space',
  region: { uf: 'SP', city: 'São Paulo' },
};

interface DocumentProbe {
  path: string;
  collection(path: string): CollectionProbe;
}

interface QueryProbe {
  path: string;
  where(): QueryProbe;
  limit(): QueryProbe;
}

interface CollectionProbe {
  doc(id: string): DocumentProbe;
  where(): QueryProbe;
}

interface TransactionProbe {
  get(ref: DocumentProbe | QueryProbe): Promise<unknown>;
  create(ref: DocumentProbe, data: unknown): void;
}

interface FirestoreBoundary {
  collection(path: string): CollectionProbe;
  runTransaction(updateFunction: (transaction: TransactionProbe) => Promise<unknown>): Promise<unknown>;
}

interface RateLimitBoundary {
  consumeCommunityRateLimit(input: unknown): Promise<void>;
}

interface CallableError {
  code?: unknown;
  details?: unknown;
}

interface RecordedWrite {
  path: string;
  data: unknown;
}

async function loadCallable() {
  const [handler, firebase] = await Promise.all([
    import('./create-venue-community.handler.js'),
    import('../firebaseApp.js'),
  ]);
  const rateLimit = require('./community-rate-limit.service.js') as RateLimitBoundary;
  return { createVenueCommunity: handler.createVenueCommunity, db: firebase.db, rateLimit };
}

function installBoundaryProbe(
  db: unknown,
  rateLimitModule: unknown,
  actorUid: string,
  mode: 'deny' | 'grant' | 'admin'
): {
  readonly firestoreOperations: string[];
  readonly rateLimitOperations: unknown[];
  readonly writes: RecordedWrite[];
  restore(): void;
} {
  const firestore = db as FirestoreBoundary;
  const rateLimit = rateLimitModule as RateLimitBoundary;
  const originalCollection = firestore.collection;
  const originalRunTransaction = firestore.runTransaction;
  const originalRateLimit = rateLimit.consumeCommunityRateLimit;
  const firestoreOperations: string[] = [];
  const rateLimitOperations: unknown[] = [];
  const writes: RecordedWrite[] = [];

  if (mode === 'deny') {
    firestore.collection = (path: string): never => {
      firestoreOperations.push(`collection:${path}`);
      throw new Error('Firestore acessado antes da autenticação recente.');
    };
    firestore.runTransaction = async (): Promise<never> => {
      firestoreOperations.push('runTransaction');
      throw new Error('Transação iniciada antes da autenticação recente.');
    };
    rateLimit.consumeCommunityRateLimit = async (input: unknown): Promise<never> => {
      rateLimitOperations.push(input);
      throw new Error('Rate limit consumido antes da autenticação recente.');
    };
  } else {
    const query = (path: string): QueryProbe => ({
      path: `query:${path}`,
      where: () => query(path),
      limit: () => query(path),
    });
    const collection = (path: string): CollectionProbe => ({
      doc: (id: string): DocumentProbe => ({
        path: `${path}/${id}`,
        collection: (name: string): CollectionProbe => collection(`${path}/${id}/${name}`),
      }),
      where: () => query(path),
    });
    const now = Date.now();
    const documents: Record<string, unknown> = {
      [`users/${actorUid}`]: {
        uid: actorUid,
        role: mode === 'admin' ? 'admin' : 'vip',
        profileCompleted: true,
        acceptedTerms: {
          accepted: true,
          version: TERMS_ACCEPTANCE_VERSION,
          acknowledgedPrivacyNotice: true,
        },
        adultConsent: { accepted: true, version: ADULT_CONSENT_VERSION },
      },
      ...(mode === 'grant'
        ? {
          [`official_space_creation_grants/${actorUid}`]: {
            holderUid: actorUid,
            organizationId: 'organization-1',
            scope: 'verified_commercial_authority',
            verificationStatus: 'verified',
            policyVersion: 3,
            active: true,
            startsAt: now - 1_000,
            endsAt: now + 60_000,
          },
          ['entitlements/business_official:organization:organization-1']: {
            scope: 'business_official',
            policyVersion: 1,
            subjectType: 'organization',
            subjectId: 'organization-1',
            capabilities: {
              officialCommunityCreation: null,
              officialVenueCreation: {
                memberLimit: 250,
                maxOwned: 10,
              },
            },
            active: true,
            startsAt: now - 1_000,
            endsAt: now + 60_000,
          },
        }
        : {
          ['entitlements/business_official:organization:platform-administration']: {
            scope: 'business_official',
            policyVersion: 1,
            subjectType: 'organization',
            subjectId: 'platform-administration',
            capabilities: {
              officialCommunityCreation: null,
              officialVenueCreation: {
                memberLimit: 250,
                maxOwned: null,
              },
            },
            active: true,
            startsAt: now - 1_000,
            endsAt: now + 60_000,
          },
        }),
    };
    const transaction: TransactionProbe = {
      get: async (ref) => ref.path.startsWith('query:')
        ? { size: 0 }
        : {
          exists: Object.hasOwn(documents, ref.path),
          data: () => documents[ref.path],
        },
      create: (ref, data) => { writes.push({ path: ref.path, data }); },
    };

    firestore.collection = (path: string): CollectionProbe => {
      firestoreOperations.push(`collection:${path}`);
      return collection(path);
    };
    firestore.runTransaction = async (updateFunction) => {
      firestoreOperations.push('runTransaction');
      return updateFunction(transaction);
    };
    rateLimit.consumeCommunityRateLimit = async (input: unknown) => {
      rateLimitOperations.push(input);
    };
  }

  return {
    firestoreOperations,
    rateLimitOperations,
    writes,
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

async function runVenue(
  auth: Readonly<Record<string, unknown>> | undefined,
  data: unknown = {}
): Promise<unknown> {
  const { createVenueCommunity } = await loadCallable();
  return createVenueCommunity.run({ auth, data } as never);
}

for (const entry of [
  { name: 'sem auth_time', authTime: undefined },
  { name: 'com auth_time antigo', authTime: -601 },
  { name: 'com auth_time excessivamente futuro', authTime: 120 },
] as const) {
  test(`createVenueCommunity rejeita ${entry.name} antes do rate limit e Firestore`, async () => {
    const { db, rateLimit } = await loadCallable();
    const probe = installBoundaryProbe(db, rateLimit, 'owner-1', 'deny');
    const token = {
      email_verified: true,
      ...(entry.authTime === undefined
        ? {}
        : { auth_time: Math.floor(Date.now() / 1_000) + entry.authTime }),
    };

    try {
      await assert.rejects(
        runVenue({ uid: 'owner-1', token }, VALID_DATA),
        (error: unknown) => assertCallableError(
          error,
          'failed-precondition',
          'recent-authentication-required'
        )
      );
      assert.deepEqual(probe.rateLimitOperations, []);
      assert.deepEqual(probe.firestoreOperations, []);
      assert.deepEqual(probe.writes, []);
    } finally {
      probe.restore();
    }
  });
}

test('createVenueCommunity aceita auth_time recente e alcança a validação do comando', async () => {
  const { db, rateLimit } = await loadCallable();
  const probe = installBoundaryProbe(db, rateLimit, 'owner-1', 'deny');

  try {
    await assert.rejects(
      runVenue({
        uid: 'owner-1',
        token: {
          email_verified: true,
          auth_time: Math.floor(Date.now() / 1_000) - 30,
        },
      }),
      (error: unknown) => assertCallableError(error, 'invalid-argument')
    );
    assert.deepEqual(probe.rateLimitOperations, []);
    assert.deepEqual(probe.firestoreOperations, []);
  } finally {
    probe.restore();
  }
});

test('createVenueCommunity preserva unauthenticated antes de recent-auth', async () => {
  const { db, rateLimit } = await loadCallable();
  const probe = installBoundaryProbe(db, rateLimit, 'owner-1', 'deny');

  try {
    await assert.rejects(
      runVenue(undefined),
      (error: unknown) => assertCallableError(error, 'unauthenticated')
    );
    assert.deepEqual(probe.rateLimitOperations, []);
    assert.deepEqual(probe.firestoreOperations, []);
  } finally {
    probe.restore();
  }
});

for (const mode of ['grant', 'admin'] as const) {
  test(`createVenueCommunity mantém criação oficial com ${mode} e auth_time recente`, async () => {
    const { db, rateLimit } = await loadCallable();
    const actorUid = mode === 'admin' ? 'admin-1' : 'owner-1';
    const probe = installBoundaryProbe(db, rateLimit, actorUid, mode);

    try {
      const result = await runVenue({
        uid: actorUid,
        token: {
          email_verified: true,
          auth_time: Math.floor(Date.now() / 1_000) - 30,
        },
      }, VALID_DATA);
      assert.deepEqual(result, {
        venueId: VENUE_ID,
        communityId: COMMUNITY_ID,
        created: true,
      });
      assert.equal(probe.rateLimitOperations.length, 1);
      assert.ok(probe.firestoreOperations.includes('runTransaction'));
      const association = probe.writes.find((write) =>
        write.path === `community_official_associations/venue:${VENUE_ID}`
      )?.data as { status?: unknown; authority?: { holderUid?: unknown } } | undefined;
      assert.equal(association?.status, 'verified');
      assert.equal(association.authority?.holderUid, actorUid);
      const community = probe.writes.find((write) =>
        write.path === `communities/${COMMUNITY_ID}`
      )?.data as { officialAssociationKey?: unknown } | undefined;
      assert.equal(
        community?.officialAssociationKey,
        `venue:${VENUE_ID}`
      );
      assert.equal(
        (community as {
          capacity?: { memberLimit?: unknown };
        } | undefined)?.capacity?.memberLimit,
        250
      );
      assert.equal(
        (probe.writes.find((write) =>
          write.path === `communities/${COMMUNITY_ID}/members/${actorUid}`
        )?.data as { role?: unknown } | undefined)?.role,
        'owner'
      );
    } finally {
      probe.restore();
    }
  });
}
