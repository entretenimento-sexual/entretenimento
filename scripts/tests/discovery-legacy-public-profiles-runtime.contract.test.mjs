import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const projection = read('functions/src/discovery/public-profile-discovery-projection.ts');
const policy = read('functions/src/discovery/legacy-public-profile-preservation.policy.ts');
const sync = read('functions/src/discovery/sync-public-profile-discovery.handler.ts');
const preference = read('functions/src/discovery/sync-public-preference-projection.handler.ts');
const backfill = read('functions/src/discovery/backfill-public-profile-discovery.handler.ts');
const discovery = read('functions/src/discovery/get-public-profiles-page.handler.ts');
const oldBackfill = read('scripts/maintenance/backfill-public-profile-discovery-admin.mjs');
const workflow = read('.github/workflows/discovery-legacy-recovery-transaction-guard.yml');

function before(source, first, last) {
  const i = source.indexOf(first);
  const j = source.indexOf(last);
  assert.ok(i >= 0, `missing ${first}`);
  assert.ok(j >= 0, `missing ${last}`);
  assert.ok(i < j, `${first} must precede ${last}`);
}

test('shared policy consumes canonical 21-field list without copying names', () => {
  assert.match(projection, /export const PRIVATE_DISCOVERY_INTEREST_FIELDS = \[/);
  assert.match(policy, /import \{ PRIVATE_DISCOVERY_INTEREST_FIELDS \}/);
  assert.match(policy, /Object\.prototype\.hasOwnProperty\.call/);
  assert.match(policy, /deletionRequestedAt/);
  for (const forbidden of ['firebase-admin', 'firebase-functions', 'onCall(', 'onDocumentWritten(', 'db.collection(', 'tx.update(', 'FieldValue.delete(']) {
    assert.equal(policy.includes(forbidden), false, forbidden);
  }
});

test('user trigger protects legacy before visibility deletion and projection writes', () => {
  assert.match(sync, /mustHoldLegacyPublicProfileMutation\(/);
  before(sync, 'if (!userSnapshot.exists)', 'if (mustHoldLegacyPublicProfileMutation(');
  before(sync, 'if (mustHoldLegacyPublicProfileMutation(', 'if (isPublicProfileProjectionBlocked(user))');
  before(sync, 'if (mustHoldLegacyPublicProfileMutation(', 'publicProfileDiscoveryProjectionMatches(');
});

test('preferences trigger retains intent moderation but holds profile deletion and writes', () => {
  assert.match(preference, /mustHoldLegacyPublicProfileMutation\(/);
  before(preference, 'if (intentStatusSnapshot.exists && !showIntentPublicly)', 'if (mustHoldLegacyPublicProfileMutation(');
  before(preference, 'if (mustHoldLegacyPublicProfileMutation(', 'if (isPublicProfileProjectionBlocked(user))');
  before(preference, 'if (mustHoldLegacyPublicProfileMutation(', 'publicPreferenceProjectionMatches(');
});

test('administrative backfill is read-only regardless of dryRun input', () => {
  assert.match(backfill, /export function normalizeBackfillDryRun\(_value: unknown\): boolean \{\s*return true;/);
  assert.match(backfill, /dryRun === false/);
  assert.match(backfill, /mustHoldLegacyPublicProfileMutation\(/);
  for (const forbidden of ['batch.commit(', 'batch.set(', 'batch.update(', 'batch.delete(', 'publicProfileRef.set(', 'FieldValue.delete(']) {
    assert.equal(backfill.includes(forbidden), false, forbidden);
  }
  assert.match(oldBackfill, /process\.exitCode = 2/);
});

test('backend discovery cards refuse contaminated documents before serialization', () => {
  assert.match(discovery, /hasLegacyPrivateDiscoveryFields\(data\)/);
  before(discovery, 'hasLegacyPrivateDiscoveryFields(data)', 'return {\n    uid,');
  assert.match(discovery, /serializePublicProfileForDiscovery\(/);
});

test('GitHub protects the exact guard on Windows and Linux', () => {
  const normalized = workflow.replace(/\r\n/g, '\n');
  assert.match(normalized, /discovery-legacy-public-profiles-runtime\.contract\.test\.mjs/);
  assert.match(normalized, /legacy-public-profile-preservation\.policy\.test\.js/);
  assert.match(normalized, /os: \[ubuntu-latest, windows-latest\]/);
});
