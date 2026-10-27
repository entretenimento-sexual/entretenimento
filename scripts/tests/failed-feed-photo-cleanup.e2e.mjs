// Isolated integration test: only project demo-entretenimento-media-e2e.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const STORAGE_BUCKET = PROJECT_ID + '.appspot.com';
const FIRESTORE_HOST = '127.0.0.1:18080';
const STORAGE_HOST = '127.0.0.1:19199';
const AUTH_HOST = '127.0.0.1:19099';

// Initialize the environment BEFORE loading any production Functions module.
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET});
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
process.env.FIREBASE_STORAGE_EMULATOR_HOST = STORAGE_HOST;
process.env.STORAGE_EMULATOR_HOST = 'http://' + STORAGE_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
process.env.FUNCTIONS_EMULATOR = 'true';

function assertDemoOnly() {
  assert.match(PROJECT_ID, /^demo-/);
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, FIRESTORE_HOST);
  assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, STORAGE_HOST);
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, AUTH_HOST);
}

assertDemoOnly();
const app = initializeApp({projectId:PROJECT_ID,storageBucket:STORAGE_BUCKET});
const db = getFirestore(app);
const bucket = getStorage(app).bucket(STORAGE_BUCKET);
const require = createRequire(import.meta.url);
const { runExpiredFeedPhotoCleanupOnce } = require('../../functions/lib/media/application/cleanup-expired-feed-photo-uploads.handler.js');
const ownerUid = 'test_feed_cleanup_' + randomUUID().replaceAll('-', '');
const now = Date.now();
const cases = { expired: 'expired', published: 'published', partial: 'partial', fresh: 'fresh', legacy: 'legacy' };
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const doc = (id) => db.doc('users/' + ownerUid + '/photos/' + id);
const objectPath = (id) => 'users/' + ownerUid + '/uploads/images/' + id + '.png';
const file = (id) => bucket.file(objectPath(id));
async function exists(fileRef) { const [value] = await fileRef.exists(); return value; }

try {
  for (const id of Object.values(cases)) {
    await file(id).save(imageBytes, {resumable:false, metadata:{contentType:'image/png'}});
    await doc(id).set({
      id, path:objectPath(id), fileName:id+'.png', createdAt:now,
      ...(id !== cases.legacy ? {
        feedPublicationPending:true,
        feedPublicationExpiresAtMs:id===cases.fresh ? now+3_600_000 : now-60_000,
      } : {}),
    });
  }
  await db.doc('users/' + ownerUid + '/photo_publications/' + cases.published).set({isPublished:true, moderationStatus:'APPROVED'});
  await db.doc('public_profiles/' + ownerUid + '/public_photos/' + cases.published).set({moderationStatus:'APPROVED', visibility:'PUBLIC'});
  await db.doc('users/' + ownerUid + '/photo_publications/' + cases.partial).set({isPublished:true});

  await runExpiredFeedPhotoCleanupOnce();

  assert.equal((await doc(cases.expired).get()).exists, false, 'Expired draft private Firestore doc must be removed');
  assert.equal(await exists(file(cases.expired)), false, 'Expired draft Storage object must be removed');
  console.log('[feed-cleanup:e2e] PASS: expired draft private doc and Storage object deleted');

  const kept = await doc(cases.published).get();
  assert.equal(kept.exists, true, 'Published photo must survive');
  assert.equal(kept.get('feedPublicationPending'), undefined, 'Published intent must be cleared');
  assert.equal(kept.get('feedPublicationExpiresAtMs'), undefined, 'Published expiry must be cleared');
  assert.equal(await exists(file(cases.published)), true, 'Published private original must survive');
  assert.equal((await db.doc('users/' + ownerUid + '/photo_publications/' + cases.published).get()).exists, true);
  assert.equal((await db.doc('public_profiles/' + ownerUid + '/public_photos/' + cases.published).get()).exists, true);
  console.log('[feed-cleanup:e2e] PASS: confirmed publication protected and expiry marker cleared');

  const partial = await doc(cases.partial).get();
  assert.equal(partial.exists, true, 'Incomplete projection must not be automatically deleted');
  assert.equal(partial.get('feedPublicationPending'), true);
  assert.equal(partial.get('feedPublicationExpiresAtMs'), undefined,
    'Partial publication should no longer block the expiration scan');
  assert.ok(Number(partial.get('feedPublicationCleanupHoldAtMs')) > 0,
    'Partial publication requires a durable hold marker');
  assert.equal(await exists(file(cases.partial)), true);
  console.log('[feed-cleanup:e2e] PASS: incomplete publication held for review without starving batch');

  for (const id of [cases.fresh, cases.legacy]) {
    assert.equal((await doc(id).get()).exists, true);
    assert.equal(await exists(file(id)), true);
  }
  console.log('[feed-cleanup:e2e] PASS: unexpired and non-feed photos untouched');
  await runExpiredFeedPhotoCleanupOnce();
  assert.equal((await doc(cases.expired).get()).exists, false);
  assert.equal(await exists(file(cases.published)), true);
  console.log('[feed-cleanup:e2e] PASS: idempotent reconciliation');
} finally {
  await db.recursiveDelete(db.doc('users/' + ownerUid)).catch(() => undefined);
  await db.recursiveDelete(db.doc('public_profiles/' + ownerUid)).catch(() => undefined);
  await bucket.deleteFiles({prefix:'users/' + ownerUid + '/'}).catch(() => undefined);
  await deleteApp(app).catch(() => undefined);
}
