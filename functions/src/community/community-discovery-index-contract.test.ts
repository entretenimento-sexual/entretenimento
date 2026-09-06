// functions/src/community/community-discovery-index-contract.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { sanitizeCommunityDiscoveryProjection } from './community-preview.model';

interface FirestoreIndexField {
  fieldPath?: string;
  order?: string;
  arrayConfig?: string;
}

interface FirestoreIndexDefinition {
  collectionGroup?: string;
  queryScope?: string;
  fields?: FirestoreIndexField[];
}

interface FirestoreIndexesFile {
  indexes?: FirestoreIndexDefinition[];
}

function loadIndexes(): FirestoreIndexDefinition[] {
  const indexPath = path.resolve(
    __dirname,
    '../../../firestore.indexes.json'
  );
  const parsed = JSON.parse(
    readFileSync(indexPath, 'utf8')
  ) as FirestoreIndexesFile;

  return Array.isArray(parsed.indexes) ? parsed.indexes : [];
}

function hasIndex(expectedFields: FirestoreIndexField[]): boolean {
  return loadIndexes().some((index) =>
    index.collectionGroup === 'community_discovery_index'
      && index.queryScope === 'COLLECTION'
      && JSON.stringify(index.fields ?? []) === JSON.stringify(expectedFields)
  );
}

function publicDiscoveryProjection(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Casa Aurora',
    slug: 'casa-aurora',
    description: 'Comunidade pública da Casa Aurora.',
    source: { type: 'venue', id: 'venue-1' },
    avatarUrl: 'https://example.com/avatar.jpg',
    coverUrl: 'https://example.com/cover.jpg',
    metrics: { memberCount: 120, postCount: 18, mediaCount: 7 },
    access: { join: 'approval' },
    status: 'active',
    moderationState: 'active',
    visibility: 'public_preview',
    officialAssociation: {
      target: { type: 'venue', id: 'venue-1' },
      verified: true,
      // Campos deliberadamente hostis: o contrato público deve descartá-los.
      authority: { holderUid: 'private-user', role: 'owner' },
      sponsorOrganizationId: 'private-organization',
      evidenceReferences: [
        { type: 'organization_kyb_record', referenceId: 'private-kyb' },
      ],
      verificationSource: 'private-source',
      kycRecordId: 'private-kyc',
      kybRecordId: 'private-kyb',
    },
    ...overrides,
  };
}

const SOURCE_FIELD: FirestoreIndexField = {
  fieldPath: 'source.type',
  order: 'ASCENDING',
};
const TAG_FIELD: FirestoreIndexField = {
  fieldPath: 'tagIds',
  arrayConfig: 'CONTAINS',
};
const LEGACY_SCORE_FIELD: FirestoreIndexField = {
  fieldPath: 'rankScore',
  order: 'DESCENDING',
};
const DISCOVERY_SCORE_FIELD: FirestoreIndexField = {
  fieldPath: 'discoveryScore',
  order: 'DESCENDING',
};
const NAME_FIELD: FirestoreIndexField = {
  fieldPath: '__name__',
  order: 'DESCENDING',
};

test('mantém índice legado por tipo de origem', () => {
  assert.equal(
    hasIndex([SOURCE_FIELD, LEGACY_SCORE_FIELD, NAME_FIELD]),
    true
  );
});

test('mantém índice score v1 por tipo de origem', () => {
  assert.equal(
    hasIndex([SOURCE_FIELD, DISCOVERY_SCORE_FIELD, NAME_FIELD]),
    true
  );
});

test('mantém índice legado para filtro por interesse', () => {
  assert.equal(
    hasIndex([SOURCE_FIELD, TAG_FIELD, LEGACY_SCORE_FIELD, NAME_FIELD]),
    true
  );
});

test('mantém índice score v1 para filtro por interesse', () => {
  assert.equal(
    hasIndex([SOURCE_FIELD, TAG_FIELD, DISCOVERY_SCORE_FIELD, NAME_FIELD]),
    true
  );
});

test('read model público descarta autoridade, KYC, KYB e evidências do selo', () => {
  const card = sanitizeCommunityDiscoveryProjection(
    'community-1',
    publicDiscoveryProjection()
  );

  assert.ok(card);
  assert.deepEqual(card.officialAssociation, {
    target: { type: 'venue', id: 'venue-1' },
    verified: true,
  });

  const serialized = JSON.stringify(card);
  assert.equal(serialized.includes('private-user'), false);
  assert.equal(serialized.includes('private-organization'), false);
  assert.equal(serialized.includes('private-kyc'), false);
  assert.equal(serialized.includes('private-kyb'), false);
  assert.equal(serialized.includes('private-source'), false);
  assert.equal(serialized.includes('evidenceReferences'), false);
  assert.equal(serialized.includes('authority'), false);
  assert.equal(serialized.includes('sponsorOrganizationId'), false);
});

test('read model falha fechado para selo não verificado', () => {
  const card = sanitizeCommunityDiscoveryProjection(
    'community-1',
    publicDiscoveryProjection({
      officialAssociation: {
        target: { type: 'venue', id: 'venue-1' },
        verified: false,
      },
    })
  );

  assert.ok(card);
  assert.equal(card.officialAssociation, undefined);
});

test('read model não expõe comunidade fora do lifecycle público ativo', () => {
  for (const status of ['paused', 'dormant', 'archived', 'scheduled_for_deletion']) {
    const card = sanitizeCommunityDiscoveryProjection(
      'community-1',
      publicDiscoveryProjection({ status })
    );

    assert.equal(card, null);
  }
});
