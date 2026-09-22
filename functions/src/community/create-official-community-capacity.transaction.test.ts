import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADULT_CONSENT_VERSION,
  TERMS_ACCEPTANCE_VERSION,
} from '../compliance/platform-legal.constants';
import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';

process.env.FUNCTIONS_EMULATOR = 'true';

const ACTOR_UID = 'owner-1';
const PROFILE_ID = 'profile-1';
const REQUEST_ID = 'request-capacity-1234567890';
const COMMUNITY_ID = `official-community-${REQUEST_ID}`;
const ASSOCIATION_KEY = `profile:${PROFILE_ID}`;
const ENTITLEMENT_ID =
  `business_official:user:${ACTOR_UID}`;

const VALID_DATA = {
  requestId: REQUEST_ID,
  target: { type: 'profile', id: PROFILE_ID },
  name: 'Comunidade Oficial',
  theme: 'interests',
  description: 'Comunidade oficial com capacidade contratada.',
  rules: 'Respeitar todas as pessoas desta Comunidade.',
  joinPolicy: 'approval',
  tagIds: ['intent:friendship'],
  declarationAccepted: true,
};

interface DocumentSnapshotProbe {
  exists: boolean;
  data(): unknown;
}

interface QuerySnapshotProbe {
  size: number;
}

interface QueryFilterProbe {
  fieldPath: string;
  operator: string;
  value: unknown;
}

interface QueryProbe {
  readonly kind: 'query';
  readonly path: string;
  readonly filters: readonly QueryFilterProbe[];
  readonly limitValue: number | null;
  where(fieldPath: string, operator: string, value: unknown): QueryProbe;
  limit(value: number): QueryProbe;
}

interface DocumentProbe {
  readonly kind: 'document';
  readonly path: string;
  collection(path: string): CollectionProbe;
  get(): Promise<DocumentSnapshotProbe>;
}

interface CollectionProbe {
  readonly path: string;
  doc(id?: string): DocumentProbe;
  where(fieldPath: string, operator: string, value: unknown): QueryProbe;
}

interface TransactionProbe {
  get(
    ref: DocumentProbe | QueryProbe
  ): Promise<DocumentSnapshotProbe | QuerySnapshotProbe>;
  create(ref: DocumentProbe, data: unknown): void;
  set(ref: DocumentProbe, data: unknown): void;
  update(ref: DocumentProbe, data: unknown): void;
}

interface FirestoreBoundary {
  collection(path: string): CollectionProbe;
  runTransaction(
    updateFunction: (transaction: TransactionProbe) => Promise<unknown>
  ): Promise<unknown>;
}

interface RateLimitBoundary {
  consumeCommunityRateLimit(input: unknown): Promise<void>;
}

interface CallableError {
  code?: unknown;
  details?: unknown;
}

interface RecordedWrite {
  operation: 'create' | 'set' | 'update';
  path: string;
  data: unknown;
}

async function loadCallable() {
  const [handler, firebase] = await Promise.all([
    import('./create-official-community.handler.js'),
    import('../firebaseApp.js'),
  ]);
  const rateLimit = require(
    './community-rate-limit.service.js'
  ) as RateLimitBoundary;

  return {
    createOfficialCommunity: handler.createOfficialCommunity,
    db: firebase.db,
    rateLimit,
  };
}

function installBoundaryProbe(
  db: unknown,
  rateLimitModule: unknown,
  quotaCount: number
): {
  readonly transactionReads: string[];
  readonly transactionQueries: QueryProbe[];
  readonly writes: RecordedWrite[];
  readonly rateLimitOperations: unknown[];
  restore(): void;
} {
  const firestore = db as FirestoreBoundary;
  const rateLimit = rateLimitModule as RateLimitBoundary;
  const originalCollection = firestore.collection;
  const originalRunTransaction = firestore.runTransaction;
  const originalRateLimit = rateLimit.consumeCommunityRateLimit;
  const transactionReads: string[] = [];
  const transactionQueries: QueryProbe[] = [];
  const writes: RecordedWrite[] = [];
  const rateLimitOperations: unknown[] = [];
  let autoId = 0;
  const now = Date.now();

  const documents: Readonly<Record<string, unknown>> = {
    [`users/${ACTOR_UID}`]: {
      uid: ACTOR_UID,
      profileId: PROFILE_ID,
      profileCompleted: true,
      accountStatus: 'active',
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
    },
    [`age_eligibility_records/${ACTOR_UID}`]: {
      uid: ACTOR_UID,
      status: 'VERIFIED_ADULT',
      policyVersion: 1,
      source: 'INITIAL_VERIFICATION',
      method: 'EXTERNAL_PROVIDER',
      caseId: 'capacity-age-1',
      verifiedAtMs: now - 10_000,
      expiresAtMs: null,
    },
    [`profile_kyc_records/${ACTOR_UID}`]: {
      uid: ACTOR_UID,
      profileId: PROFILE_ID,
      status: 'verified',
      policyVersion: 2,
      verifiedAt: now - 10_000,
      revalidationDueAt: now + 60_000,
      expiresAt: now + 120_000,
      revokedAt: null,
    },
    [`entitlements/${ENTITLEMENT_ID}`]: {
      scope: 'business_official',
      policyVersion: 1,
      subjectType: 'user',
      subjectId: ACTOR_UID,
      capabilities: {
        officialCommunityCreation: {
          memberLimit: 250,
          maxOwned: 2,
        },
        officialVenueCreation: null,
      },
      active: true,
      startsAt: now - 10_000,
      endsAt: now + 120_000,
    },
  };

  const snapshot = (path: string): DocumentSnapshotProbe => ({
    exists: Object.hasOwn(documents, path),
    data: () => documents[path],
  });

  const query = (
    path: string,
    filters: readonly QueryFilterProbe[] = [],
    limitValue: number | null = null
  ): QueryProbe => ({
    kind: 'query',
    path,
    filters,
    limitValue,
    where: (fieldPath, operator, value) => query(
      path,
      [...filters, { fieldPath, operator, value }],
      limitValue
    ),
    limit: (value) => query(path, filters, value),
  });

  const collection = (path: string): CollectionProbe => ({
    path,
    doc: (id?: string): DocumentProbe => {
      const resolvedId = id ?? `auto-${++autoId}`;
      const documentPath = `${path}/${resolvedId}`;
      return {
        kind: 'document',
        path: documentPath,
        collection: (name: string) =>
          collection(`${documentPath}/${name}`),
        get: async () => snapshot(documentPath),
      };
    },
    where: (fieldPath, operator, value) =>
      query(path, [{ fieldPath, operator, value }]),
  });

  const transaction: TransactionProbe = {
    get: async (ref) => {
      if (ref.kind === 'query') {
        transactionQueries.push(ref);
        return { size: quotaCount };
      }
      transactionReads.push(ref.path);
      return snapshot(ref.path);
    },
    create: (ref, data) => {
      writes.push({ operation: 'create', path: ref.path, data });
    },
    set: (ref, data) => {
      writes.push({ operation: 'set', path: ref.path, data });
    },
    update: (ref, data) => {
      writes.push({ operation: 'update', path: ref.path, data });
    },
  };

  firestore.collection = (path: string) => collection(path);
  firestore.runTransaction = async (updateFunction) =>
    updateFunction(transaction);
  rateLimit.consumeCommunityRateLimit = async (input: unknown) => {
    rateLimitOperations.push(input);
  };

  return {
    transactionReads,
    transactionQueries,
    writes,
    rateLimitOperations,
    restore: () => {
      firestore.collection = originalCollection;
      firestore.runTransaction = originalRunTransaction;
      rateLimit.consumeCommunityRateLimit = originalRateLimit;
    },
  };
}

async function runCreateOfficialCommunity(): Promise<unknown> {
  const { createOfficialCommunity } = await loadCallable();
  return createOfficialCommunity.run({
    auth: {
      uid: ACTOR_UID,
      token: {
        email_verified: true,
        auth_time: Math.floor(Date.now() / 1_000) - 30,
      },
    },
    data: VALID_DATA,
  } as never);
}

function capacityFromWrite(
  writes: readonly RecordedWrite[],
  path: string
): Readonly<Record<string, unknown>> {
  const raw = writes.find((write) => write.path === path)?.data;
  const document = (raw ?? {}) as Record<string, unknown>;
  return (document['capacity'] ?? {}) as Record<string, unknown>;
}

test('createOfficialCommunity persiste a capacidade do entitlement, não o teto técnico', async () => {
  const { db, rateLimit } = await loadCallable();
  const probe = installBoundaryProbe(db, rateLimit, 1);

  try {
    const result = await runCreateOfficialCommunity();

    assert.deepEqual(result, {
      communityId: COMMUNITY_ID,
      associationKey: ASSOCIATION_KEY,
      target: { type: 'profile', id: PROFILE_ID },
      created: true,
    });
    assert.equal(probe.rateLimitOperations.length, 1);
    assert.ok(
      probe.transactionReads.includes(`entitlements/${ENTITLEMENT_ID}`)
    );

    const quotaQuery = probe.transactionQueries.find(
      (queryProbe) =>
        queryProbe.path === 'community_official_associations'
        && queryProbe.filters.some(
          (filter) =>
            filter.fieldPath === 'authority.holderUid'
            && filter.value === ACTOR_UID
        )
        && queryProbe.filters.some(
          (filter) =>
            filter.fieldPath === 'status'
            && filter.value === 'verified'
        )
    );
    assert.ok(quotaQuery);
    assert.equal(quotaQuery.limitValue, 3);

    const communityCapacity = capacityFromWrite(
      probe.writes,
      `communities/${COMMUNITY_ID}`
    );
    const discoveryCapacity = capacityFromWrite(
      probe.writes,
      `community_discovery_index/${COMMUNITY_ID}`
    );

    assert.equal(communityCapacity['memberLimit'], 250);
    assert.equal(
      communityCapacity['entitlementCapability'],
      'officialCommunityCreation'
    );
    assert.equal(discoveryCapacity['memberLimit'], 250);
    assert.notEqual(
      communityCapacity['memberLimit'],
      COMMUNITY_PRODUCT_LIMITS.officialTechnicalSafety.maxMemberLimit
    );

    const receipt = probe.writes.find(
      (write) =>
        write.path
        === `official_community_creation_requests/${ACTOR_UID}:${REQUEST_ID}`
    )?.data as Record<string, unknown> | undefined;
    assert.equal(receipt?.['capacityEntitlementId'], ENTITLEMENT_ID);
    assert.equal(receipt?.['grantedMemberLimit'], 250);
    assert.equal(receipt?.['maxOfficialCommunities'], 2);

    const associationAudit = probe.writes.find(
      (write) =>
        write.path
        === `community_official_association_audit/official-create-${REQUEST_ID}`
    )?.data as Record<string, unknown> | undefined;
    assert.ok(associationAudit);
    assert.equal('grantedMemberLimit' in associationAudit, false);
    assert.equal('maxOfficialCommunities' in associationAudit, false);
    assert.equal('capacityEntitlementId' in associationAudit, false);

    const entitlementUsageAudit = probe.writes.find(
      (write) =>
        write.path
        === `business_official_entitlement_usage_audit/official-create-${REQUEST_ID}`
    )?.data as Record<string, unknown> | undefined;
    assert.equal(entitlementUsageAudit?.['entitlementId'], ENTITLEMENT_ID);
    assert.equal(entitlementUsageAudit?.['capability'], 'officialCommunityCreation');
  } finally {
    probe.restore();
  }
});

test('createOfficialCommunity aplica a quota dentro da transação antes de persistir', async () => {
  const { db, rateLimit } = await loadCallable();
  const probe = installBoundaryProbe(db, rateLimit, 2);

  try {
    await assert.rejects(
      runCreateOfficialCommunity(),
      (error: unknown) => {
        const callableError = error as CallableError;
        assert.equal(callableError.code, 'resource-exhausted');
        assert.equal(
          (callableError.details as Record<string, unknown> | undefined)
            ?.['reason'],
          'official_creation_limit_reached'
        );
        return true;
      }
    );

    assert.ok(
      probe.transactionReads.includes(`entitlements/${ENTITLEMENT_ID}`)
    );
    assert.equal(probe.transactionQueries.length, 1);
    assert.deepEqual(probe.writes, []);
  } finally {
    probe.restore();
  }
});
