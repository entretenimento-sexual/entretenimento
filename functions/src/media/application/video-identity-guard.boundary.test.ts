import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const fromSource = (file: string) => readFileSync(
  join(__dirname, '../../../src/media/application', file), 'utf8'
);
const register = fromSource('register-private-video-upload.handler.ts');
const deletion = fromSource('delete-profile-video.handler.ts');
const guard = fromSource('video-identity-guard.firestore.ts');

test('all private video registrations claim an identity and check legacy deletion', () => {
  assert.match(register, /commitPrivateVideoRegistrationIfUnused\s*\(db,/);
  assert.match(register, /isVideoIdentityRetiring\s*\(db,/);
  assert.doesNotMatch(register, /batch\.create\(videoRef/);
  assert.match(guard, /tx\.get\(pendingDeletionRef\)/);
  assert.match(guard, /tx\.create\(guardRef,/);
  assert.match(guard, /tx\.create\(input\.videoRef,/);
  assert.match(guard, /tx\.set\(input\.publicationRef,/);
});

test('video deletion uses atomic commit and preserves identity guard', () => {
  const transaction = fromSource('video-profile-deletion-commit.firestore.ts');
  assert.match(deletion, /commitProfileVideoDeletionRequest/);
  assert.match(transaction, /retireVideoIdentityInTransaction/);
  assert.match(transaction, /transaction.create\(deletionJobRef/);
  assert.match(transaction, /transaction.get\(identityRef/);
  assert.match(transaction, /stageVideoTriageMutationInTransaction/);
  assert.match(guard, /lastUpdateTime: identitySnapshot.updateTime/);
  assert.match(deletion, /retireVideoIdentityForActiveClaim/);
  assert.doesNotMatch(deletion, /removalBatch.commit/);
});
test('duplicate video registration preserves idempotency without reviving retired IDs', () => {
  assert.match(register,
    /if\s*\(createError instanceof VideoIdentityUnavailableError\s*\|\|\s*isAlreadyExistsError\(createError\)\)/);
  assert.match(register,
    /if\s*\(concurrentResponse\s*&&\s*!\(await isVideoIdentityRetiring\(db,\s*ownerUid,\s*videoId\)\)\)/);
  assert.match(register,
    /if\s*\(createError instanceof VideoIdentityUnavailableError\)\s*\{\s*throw new HttpsError\(/);
});

test('async video settings writers fence retired identity and deletion', () => {
  for (const name of [
    'sync-published-video-settings.handler.ts',
    'update-video-publication-settings.handler.ts',
  ]) {
    const source = fromSource(name);
    assert.match(source, /transaction\.get\(identityRef\)/);
    assert.match(source, /transaction\.get\(deletionRef\)/);
    assert.match(source, /identitySnap\.get\('state'\) !== 'REGISTERED'/);
    assert.match(source, /deletionSnap\.exists/);
  }
});

test('report moderation cannot write to a retired or deleting video', () => {
  const source = fromSource('review-video-content-report.handler.ts');
  assert.match(source, /transaction\.get\(reference\)/);
  assert.match(source, /isVideoModerationIdentityCurrent\(/);
  assert.match(source, /users\/\$\{ownerUid\}\/video_identity_guards\/\$\{videoId\}/);
});
