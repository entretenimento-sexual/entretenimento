// functions/src/community/community-discovery-index-contract.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

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
