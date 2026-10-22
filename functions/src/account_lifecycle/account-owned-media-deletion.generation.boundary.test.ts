import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(
  join(__dirname, '../../src/account_lifecycle/account-owned-media-deletion.firestore.ts'),
  'utf8'
);

test('account photo deletion uses canonical transactional media cleanup', () => {
  assert.match(source, /await deleteProfilePhotoResources\(uid, photoSnapshot\.id, \{/);
  assert.match(source, /allowQuarantined: true/);
  assert.match(source, /if \(result\.cleanupPending\)/);
  assert.doesNotMatch(source, /hideBatch\.delete\(publicationRef\)/);
});

test('account cleanup paths require GCS object generations for every deletion', () => {
  assert.match(source, /deleteGenerationPinnedVideoFile\(file\.metadata\?\.generation,/);
  assert.match(source, /await deleteProfileVideoResources\(uid, videoSnapshot\.id/);
  assert.match(source, /deleteVideoStoragePrefixBounded\(prefix,/);
  assert.match(source, /ifGenerationMatch: generation/);
  assert.doesNotMatch(source, /\.delete\(\{ ignoreNotFound: true \}\)/);
});

test('account video deletion uses canonical transactional media cleanup', () => {
  assert.match(source, /await deleteProfileVideoResources\(uid, videoSnapshot\.id, \{/);
  assert.match(source, /allowQuarantined: true/);
  assert.match(source, /if \(result\.cleanupPending\)/);
  assert.doesNotMatch(source, /privateDeleteTasks/);
  assert.doesNotMatch(source, /extractOwnedPrivateVideoPath\(/);
});
