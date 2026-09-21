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

interface FirestoreFieldOverride {
  collectionGroup?: string;
  fieldPath?: string;
  ttl?: boolean;
}

interface FirestoreIndexesFile {
  indexes?: FirestoreIndexDefinition[];
  fieldOverrides?: FirestoreFieldOverride[];
}

function loadConfig(): FirestoreIndexesFile {
  return JSON.parse(
    readFileSync(
      path.resolve(__dirname, '../../../firestore.indexes.json'),
      'utf8'
    )
  ) as FirestoreIndexesFile;
}

function hasIndex(fields: FirestoreIndexField[]): boolean {
  return (loadConfig().indexes ?? []).some((index) =>
    index.collectionGroup === 'community_boost_campaigns'
    && index.queryScope === 'COLLECTION'
    && JSON.stringify(index.fields ?? []) === JSON.stringify(fields)
  );
}

function hasTtl(collectionGroup: string): boolean {
  return (loadConfig().fieldOverrides ?? []).some((override) =>
    override.collectionGroup === collectionGroup
    && override.fieldPath === 'expiresAt'
    && override.ttl === true
  );
}

test('mantém índice próprio de seleção patrocinada, fora do ranking orgânico', () => {
  assert.equal(hasIndex([
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'targetSourceType', order: 'ASCENDING' },
    { fieldPath: 'startsAt', order: 'DESCENDING' },
    { fieldPath: '__name__', order: 'DESCENDING' },
  ]), true);
});

test('mantém índice de lifecycle de campanhas', () => {
  assert.equal(hasIndex([
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'endsAt', order: 'ASCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' },
  ]), true);
});

test('dados operacionais efêmeros usam TTL', () => {
  for (const collectionGroup of [
    'community_boost_placements',
    'community_boost_frequency_caps',
    'community_boost_campaign_requests',
    'community_boost_billing_config_requests',
    'community_boost_advertiser_account_requests',
    'community_boost_active_slots',
  ]) {
    assert.equal(hasTtl(collectionGroup), true);
  }
});
