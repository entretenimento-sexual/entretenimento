import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCommunityCapacityForOwnerInTransaction,
} from './community-capacity.service';

const NOW = 1_800_000_000_000;
const ASSOCIATION_KEY = 'profile:profile-1';
const ENTITLEMENT_ID = 'business_official:organization:organization-1';

interface DocumentSnapshotProbe {
  exists: boolean;
  data(): unknown;
}

interface DocumentProbe {
  readonly path: string;
}

interface CollectionProbe {
  doc(id: string): DocumentProbe;
}

interface TransactionProbe {
  get(ref: DocumentProbe): Promise<DocumentSnapshotProbe>;
}

interface FirestoreBoundary {
  collection(path: string): CollectionProbe;
}

function officialCommunity(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    moderation: { state: 'active' },
    ownerUid: 'owner-1',
    officialAssociationKey: ASSOCIATION_KEY,
    source: { type: 'community', id: 'community-1' },
    capacity: {
      sponsorType: 'official',
      entitlementCapability: 'officialCommunityCreation',
      memberLimit: 500,
      policyVersion: 1,
    },
    metrics: { memberCount: 249 },
    lifecycle: { state: 'active' },
    ...overrides,
  };
}

function activeAssociation() {
  return {
    associationKey: ASSOCIATION_KEY,
    communityId: 'community-1',
    status: 'verified',
    sponsorOrganizationId: 'organization-1',
    authority: {
      holderUid: 'owner-1',
      role: 'authorized_representative',
    },
  };
}

function activeEntitlement(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'business_official',
    policyVersion: 1,
    subjectType: 'organization',
    subjectId: 'organization-1',
    capabilities: {
      officialCommunityCreation: {
        memberLimit: 250,
        maxOwned: 3,
      },
      officialVenueCreation: {
        memberLimit: 100,
        maxOwned: 2,
      },
    },
    active: true,
    startsAt: NOW - 1_000,
    endsAt: NOW + 10_000,
    ...overrides,
  };
}

function installProbe(
  db: unknown,
  documents: Readonly<Record<string, unknown>>
): {
  readonly reads: string[];
  readonly transaction: TransactionProbe;
  restore(): void;
} {
  const firestore = db as FirestoreBoundary;
  const originalCollection = firestore.collection;
  const reads: string[] = [];

  firestore.collection = (path: string): CollectionProbe => ({
    doc: (id: string): DocumentProbe => ({
      path: `${path}/${id}`,
    }),
  });

  const transaction: TransactionProbe = {
    get: async (ref) => {
      reads.push(ref.path);
      return {
        exists: Object.hasOwn(documents, ref.path),
        data: () => documents[ref.path],
      };
    },
  };

  return {
    reads,
    transaction,
    restore: () => {
      firestore.collection = originalCollection;
    },
  };
}

async function loadDb() {
  const firebase = await import('../firebaseApp.js');
  return firebase.db;
}

test('admissão Official revalida associação e entitlement na mesma transação', async () => {
  const db = await loadDb();
  const probe = installProbe(db, {
    [`community_official_associations/${ASSOCIATION_KEY}`]:
      activeAssociation(),
    [`entitlements/${ENTITLEMENT_ID}`]: activeEntitlement(),
  });

  try {
    const state = await getCommunityCapacityForOwnerInTransaction(
      probe.transaction as never,
      officialCommunity(),
      NOW
    );

    assert.ok(state);
    assert.deepEqual(probe.reads, [
      `community_official_associations/${ASSOCIATION_KEY}`,
      `entitlements/${ENTITLEMENT_ID}`,
    ]);
    assert.equal(state.configuredLimit, 500);
    assert.equal(state.ownerPlanLimit, 250);
    assert.equal(state.effectiveLimit, 250);
    assert.equal(state.acceptingNewMembers, true);
    assert.equal(state.regularizationRequired, true);
    assert.equal(state.regularizationReason, 'capacity_over_entitlement');
  } finally {
    probe.restore();
  }
});

test('revogação do entitlement pausa novas admissões sem apagar membros', async () => {
  const db = await loadDb();
  const probe = installProbe(db, {
    [`community_official_associations/${ASSOCIATION_KEY}`]:
      activeAssociation(),
    [`entitlements/${ENTITLEMENT_ID}`]:
      activeEntitlement({ active: false }),
  });

  try {
    const state = await getCommunityCapacityForOwnerInTransaction(
      probe.transaction as never,
      officialCommunity({
        metrics: { memberCount: 180 },
      }),
      NOW
    );

    assert.ok(state);
    assert.equal(state.memberCount, 180);
    assert.equal(state.effectiveLimit, 0);
    assert.equal(state.acceptingNewMembers, false);
    assert.equal(state.regularizationRequired, true);
    assert.equal(state.regularizationReason, 'official_entitlement_required');
  } finally {
    probe.restore();
  }
});

test('capability explícita distingue Espaço Oficial de Comunidade Oficial', async () => {
  const db = await loadDb();
  const probe = installProbe(db, {
    [`community_official_associations/${ASSOCIATION_KEY}`]:
      activeAssociation(),
    [`entitlements/${ENTITLEMENT_ID}`]: activeEntitlement(),
  });

  try {
    const state = await getCommunityCapacityForOwnerInTransaction(
      probe.transaction as never,
      officialCommunity({
        source: { type: 'venue', id: 'venue-1' },
        lifecycle: undefined,
        capacity: {
          sponsorType: 'official',
          entitlementCapability: 'officialVenueCreation',
          memberLimit: 250,
          policyVersion: 1,
        },
        metrics: { memberCount: 99 },
      }),
      NOW
    );

    assert.ok(state);
    assert.equal(state.ownerPlanLimit, 100);
    assert.equal(state.effectiveLimit, 100);
    assert.equal(state.acceptingNewMembers, true);
  } finally {
    probe.restore();
  }
});
