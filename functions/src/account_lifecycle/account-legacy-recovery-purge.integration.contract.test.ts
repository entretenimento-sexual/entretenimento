import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = readFileSync(
  path.resolve(__dirname, '../../src/account_lifecycle/account-data-deletion.firestore.ts'),
  'utf8'
);
const executor = readFileSync(
  path.resolve(__dirname, '../../src/account_lifecycle/account-data-deletion.executor.ts'),
  'utf8'
);
const scheduler = readFileSync(
  path.resolve(__dirname, '../../src/account_lifecycle/purgeDeletedAccounts.ts'),
  'utf8'
);

test('private legacy recovery cleanup is part of the existing preferences domain', () => {
  assert.match(
    source,
    /async deletePreferences\(uid: string\): Promise<number>[\s\S]*await purgeLegacyDiscoveryRecoveryOnAccountDeletion/
  );
  assert.match(source,
    /collection\('legacy_discovery_preference_recovery'\)\.doc\(uid\)/);
  assert.match(source, /await db\.recursiveDelete\(recoveryRef\)/);
  assert.match(source, /await recoveryRef\.listCollections\(\)/);
  assert.match(source,
    /return legacyRecoveryRemoved \+ \(snapshot\.exists \? 1 : 0\)/);
  assert.match(source,
    /await db\.recursiveDelete\([\s\S]*community_notification_preferences/);
});

test('failed private recovery cleanup blocks the normal pre-finalize domain', () => {
  assert.match(executor,
    /async function executePreferencesDomain[\s\S]*await adapter\.deletePreferences\(uid\)/);
  assert.match(
    executor,
    /async function executePreferencesDomain[\s\S]*catch \(error: unknown\)[\s\S]*failedResult\('preferences', error\)/
  );
  assert.match(scheduler, /executeAccountDataDeletionDomains\(/);
  assert.match(scheduler, /if \(!canFinalizePrivateUserDeletion\(dataPlan\)\)/);
  assert.match(scheduler, /'blocked'/);
});

test('no recovery restoration or public-profile mutation is part of this purge', () => {
  const start = source.indexOf('  async deletePreferences(uid: string)');
  const end = source.indexOf('  async deletePresence(', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  for (const mutation of [
    "collection('public_profiles')",
    "collection('users').doc(uid).delete",
    'FieldValue.delete(', 'transaction.create(', '.set(', 'showIntentPublicly',
    'showSeekingPublicly', 'showPreferenceBadges',
  ]) assert.equal(body.includes(mutation), false, mutation);
});
