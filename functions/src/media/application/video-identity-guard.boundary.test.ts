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

test('video deletion retires the identity in the unpublication batch', () => {
  assert.match(deletion, /removalBatch\.create\(jobRef,/);
  assert.match(deletion, /retireVideoIdentityInBatch\s*\(db, removalBatch, ownerUid, videoId, now, identitySnap\)/);
  assert.match(guard, /batch\.create\(ref, /);
  assert.match(guard, /lastUpdateTime: identitySnapshot\.updateTime/);
  assert.match(deletion, /await removalBatch\.commit\(\)/);
  assert.match(deletion, /retireVideoIdentityForActiveClaim\s*\(/);
  assert.match(deletion, /identity === 'CONFLICT'/);
  assert.match(deletion, /kind: 'BLOCKED'/);
  assert.match(guard, /state: 'RETIRED'/);
  assert.doesNotMatch(deletion, /video_identity_guards[^\n]*\.delete\(/);
});

test('duplicate video registration preserves idempotency without reviving retired IDs', () => {
  assert.match(register,
    /if\s*\(createError instanceof VideoIdentityUnavailableError\s*\|\|\s*isAlreadyExistsError\(createError\)\)/);
  assert.match(register,
    /if\s*\(concurrentResponse\s*&&\s*!\(await isVideoIdentityRetiring\(db,\s*ownerUid,\s*videoId\)\)\)/);
  assert.match(register,
    /if\s*\(createError instanceof VideoIdentityUnavailableError\)\s*\{\s*throw new HttpsError\(/);
});
