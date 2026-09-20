import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  COMMUNITY_OPERATIONAL_REQUEST_COLLECTIONS,
} from './community-operational-retention.policy';
import {
  COMMUNITY_PURGE_PROTECTED_COLLECTIONS,
} from './community-purge.firestore.policy';

interface FirestoreFieldOverride {
  collectionGroup?: string;
  fieldPath?: string;
  ttl?: boolean;
  indexes?: unknown[];
}

interface FirestoreIndexesFile {
  fieldOverrides?: FirestoreFieldOverride[];
}

function loadFieldOverrides(): FirestoreFieldOverride[] {
  const indexPath = path.resolve(__dirname, '../../../firestore.indexes.json');
  const parsed = JSON.parse(
    readFileSync(indexPath, 'utf8')
  ) as FirestoreIndexesFile;

  return Array.isArray(parsed.fieldOverrides) ? parsed.fieldOverrides : [];
}

function ttlOverride(collectionGroup: string): FirestoreFieldOverride | null {
  return loadFieldOverrides().find(
    (entry) =>
      entry.collectionGroup === collectionGroup
      && entry.fieldPath === 'expiresAt'
      && entry.ttl === true
  ) ?? null;
}

test('habilita TTL somente nos receipts operacionais de Comunidades', () => {
  for (const collectionGroup of Object.keys(
    COMMUNITY_OPERATIONAL_REQUEST_COLLECTIONS
  )) {
    const override = ttlOverride(collectionGroup);
    assert.ok(override, `TTL ausente para ${collectionGroup}`);
    assert.deepEqual(override.indexes ?? [], []);
  }
});

test('usa expiresAt também para expurgar convites já expirados', () => {
  const override = ttlOverride('invites');
  assert.ok(override);
  assert.deepEqual(override.indexes ?? [], []);
});

test('evidência protegida nunca recebe TTL', () => {
  const ttlGroups = new Set(
    loadFieldOverrides()
      .filter((entry) => entry.ttl === true)
      .map((entry) => entry.collectionGroup)
      .filter((value): value is string => typeof value === 'string')
  );

  for (const protectedCollection of COMMUNITY_PURGE_PROTECTED_COLLECTIONS) {
    assert.equal(
      ttlGroups.has(protectedCollection),
      false,
      `evidência protegida não pode ter TTL: ${protectedCollection}`
    );
  }
});
