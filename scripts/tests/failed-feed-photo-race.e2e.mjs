// M6-A3.38.5: real Firestore/Storage/Functions race checks in a demo project only.
// Does not create deployments, external resources, or change production settings.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp as initClient, deleteApp as deleteClient } from 'firebase/app';
import {
  getAuth as getClientAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
} from 'firebase/auth';
import {
  getFunctions, connectFunctionsEmulator, httpsCallable,
} from 'firebase/functions';
import {
  getStorage as getClientStorage, connectStorageEmulator, uploadBytes, ref,
} from 'firebase/storage';
import {
  initializeApp as initAdmin, deleteApp as deleteAdmin, applicationDefault,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';

const PROJECT = 'demo-entretenimento-media-e2e';
const BUCKET = `${PROJECT}.appspot.com`;
const HOST = '127.0.0.1';
const PORTS = Object.freeze({auth: 19099, firestore: 18080, functions: 15001, storage: 19199});
const ENDPOINTS = Object.freeze({
  FIREBASE_AUTH_EMULATOR_HOST: `${HOST}:${PORTS.auth}`,
  FIRESTORE_EMULATOR_HOST: `${HOST}:${PORTS.firestore}`,
  FIREBASE_STORAGE_EMULATOR_HOST: `${HOST}:${PORTS.storage}`,
});

assert.match(PROJECT, /^demo-/);
for (const [key, expected] of Object.entries(ENDPOINTS)) {
  const existing = String(process.env[key] ?? '').trim();
  if (existing && existing !== expected) {
    throw new Error(`${key} inesperado (${existing}). Teste bloqueado.`);
  }
  process.env[key] = expected;
}
process.env.STORAGE_EMULATOR_HOST = `http://${HOST}:${PORTS.storage}`;
process.env.GCLOUD_PROJECT = PROJECT;
process.env.GCP_PROJECT = PROJECT;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId: PROJECT, storageBucket: BUCKET});
process.env.FUNCTIONS_EMULATOR = 'true';

// The worker uses the same code as the onSchedule callback. No Pub/Sub required.
const require = createRequire(import.meta.url);
const {runExpiredFeedPhotoCleanupOnce} = require('../../functions/lib/media/application/cleanup-expired-feed-photo-uploads.handler.js');
assert.equal(typeof runExpiredFeedPhotoCleanupOnce, 'function');

const runId = randomUUID();
const imageBytes = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
));
const clientApp = initClient({
  apiKey: 'fake-api-key', authDomain: `${PROJECT}.firebaseapp.com`,
  projectId: PROJECT, storageBucket: BUCKET,
}, `feed-race-client-${runId}`);
const clientAuth = getClientAuth(clientApp);
const clientFunctions = getFunctions(clientApp, 'us-central1');
const clientStorage = getClientStorage(clientApp);
connectAuthEmulator(clientAuth, `http://${HOST}:${PORTS.auth}`, {disableWarnings:true});
connectFunctionsEmulator(clientFunctions, HOST, PORTS.functions);
connectStorageEmulator(clientStorage, HOST, PORTS.storage);
const adminApp = initAdmin({
  credential: applicationDefault(), projectId: PROJECT, storageBucket: BUCKET,
}, `feed-race-admin-${runId}`);
const adminAuth = getAdminAuth(adminApp);
const db = getFirestore(adminApp);
const bucket = getAdminStorage(adminApp).bucket(BUCKET);
const reserve = httpsCallable(clientFunctions, 'reservePhotoUpload');
const register = httpsCallable(clientFunctions, 'registerPrivatePhotoUpload');
const publish = httpsCallable(clientFunctions, 'publishPhoto');
let ownerUid = '';
let authenticatedUser = null;

const privateRef = id => db.doc(`users/${ownerUid}/photos/${id}`);
const publicationRef = id => db.doc(`users/${ownerUid}/photo_publications/${id}`);
const projectionRef = id => db.doc(`public_profiles/${ownerUid}/public_photos/${id}`);
const jobRef = id => db.doc(`media_photo_deletion_jobs/${ownerUid}_${id}`);
const pathFor = id => `users/${ownerUid}/uploads/images/${id}.png`;
async function exists(file) { const [value] = await file.exists(); return value; }
async function data(ref) { const snap = await ref.get(); return snap.exists ? snap.data() : null; }

async function createPending(id) {
  const storagePath = pathFor(id);
  const result = await reserve({
    ownerUid, storagePath, sizeBytes: imageBytes.byteLength, contentType: 'image/png',
  });
  const reservationId = String(result.data?.reservationId ?? '');
  assert.ok(reservationId, `Missing reservation for ${id}`);
  await uploadBytes(ref(clientStorage, storagePath), imageBytes, {
    contentType: 'image/png', cacheControl: 'private, max-age=0, no-store',
    customMetadata: {mediaPhotoReservationId: reservationId},
  });
  await register({ownerUid, photoId:id, reservationId, fileName:`${id}.png`, mode:'create', publishToFeed:true});
  const saved = await privateRef(id).get();
  assert.equal(saved.get('feedPublicationPending'), true);
  assert.ok(saved.get('feedPublicationExpiresAtMs') > Date.now());
  return storagePath;
}

async function expire(id) {
  await privateRef(id).update({feedPublicationExpiresAtMs: Date.now() - 1_000});
}

async function publishPhoto(id) {
  return publish({
    ownerUid, photoId:id, visibility:'PUBLIC', isCover:false, orderIndex:0,
    commentsEnabled:true, commentsPolicy:'EVERYONE', reactionsEnabled:true,
  });
}

async function assertPublishedSurvives(id, path) {
  const [privateSnap, pub, projection, job, storageExists] = await Promise.all([
    privateRef(id).get(), data(publicationRef(id)), data(projectionRef(id)),
    jobRef(id).get(), exists(bucket.file(path)),
  ]);
  assert.equal(privateSnap.exists, true, 'Published private document missing');
  assert.equal(privateSnap.get('feedPublicationPending'), undefined);
  assert.equal(privateSnap.get('feedPublicationExpiresAtMs'), undefined);
  assert.ok(pub && pub.isPublished === true, 'Published record missing');
  assert.ok(projection, 'Public projection missing');
  assert.equal(job.exists, false, 'Deletion job exists for published photo');
  assert.equal(storageExists, true, 'Published private original deleted');
  assert.ok(pub.publishedStoragePath, 'Published Storage path missing');
  assert.equal(await exists(bucket.file(pub.publishedStoragePath)), true, 'Published binary missing');
}

try {
  const credential = await createUserWithEmailAndPassword(
    clientAuth, `feed-race-${runId}@example.test`, `E2e-${runId}-Aa1!`
  );
  authenticatedUser = credential.user;
  ownerUid = authenticatedUser.uid;
  await adminAuth.updateUser(ownerUid, {emailVerified:true,disabled:false});
  const verifiedAtMs = Date.now() - 1000;
  await Promise.all([
    db.doc(`users/${ownerUid}`).set({
      uid: ownerUid, emailVerified:true, profileCompleted:true,
      accountStatus:'active', suspended:false, publicVisibility:'visible',
      interactionBlocked:false, accountLocked:false, loginAllowed:true,
      acceptedTerms:{accepted:true,version:'v3',acknowledgedPrivacyNotice:true},
      adultConsent:{accepted:true,version:'v1'}, initialAdultConsentRequired:false,
      ageReverification:null, updatedAt:Date.now(),
    }, {merge:true}),
    db.doc(`age_eligibility_records/${ownerUid}`).set({
      uid:ownerUid,status:'VERIFIED_ADULT',policyVersion:1,
      source:'INITIAL_VERIFICATION',method:'EXTERNAL_PROVIDER',
      caseId:`feed-race-${runId}`,verifiedAtMs,verifiedAt:new Date(verifiedAtMs),
      decidedAtMs:verifiedAtMs,decidedAt:new Date(verifiedAtMs),
      expiresAtMs:null,expiresAt:null,updatedAtMs:verifiedAtMs,
      updatedAt:new Date(verifiedAtMs),
    }),
  ]);
  await authenticatedUser.reload();
  await authenticatedUser.getIdToken(true);

  // Order 1: publication commits before cleanup examines an expired candidate.
  const publishedId = `feed-published-${runId}`;
  const publishedPath = await createPending(publishedId);
  await expire(publishedId);
  const publicationResult = await publishPhoto(publishedId);
  assert.equal(publicationResult.data.photoId, publishedId);
  await runExpiredFeedPhotoCleanupOnce();
  await assertPublishedSurvives(publishedId, publishedPath);
  console.log('[feed-race:e2e] PASS: publication before cleanup protects private and public assets');

  // Order 2: cleanup commits before an owner tries to publish the expired upload.
  const discardedId = `feed-discarded-${runId}`;
  const discardedPath = await createPending(discardedId);
  await expire(discardedId);
  await runExpiredFeedPhotoCleanupOnce();
  assert.equal((await privateRef(discardedId).get()).exists, false);
  assert.equal(await exists(bucket.file(discardedPath)), false);
  await assert.rejects(publishPhoto(discardedId));
  assert.equal((await publicationRef(discardedId).get()).exists, false);
  assert.equal((await projectionRef(discardedId).get()).exists, false);
  console.log('[feed-race:e2e] PASS: completed cleanup prevents late publication');

  // Order 3: actual callable and cleanup worker compete for the same expired photo.
  // Both outcomes are valid; a published record plus staged deletion is not.
  const racingId = `feed-racing-${runId}`;
  const racingPath = await createPending(racingId);
  await expire(racingId);
  const [publicationAttempt, cleanupAttempt] = await Promise.allSettled([
    publishPhoto(racingId), runExpiredFeedPhotoCleanupOnce(),
  ]);
  assert.equal(cleanupAttempt.status, 'fulfilled', 'Cleanup worker crashed');
  const [photo, pub, projection, job, binaryExists] = await Promise.all([
    privateRef(racingId).get(), data(publicationRef(racingId)),
    data(projectionRef(racingId)), jobRef(racingId).get(),
    exists(bucket.file(racingPath)),
  ]);
  if (pub || projection) {
    assert.ok(pub && projection && pub.isPublished === true, 'Partial public projection');
    assert.equal(photo.exists, true, 'Published photo lost its private original');
    assert.equal(job.exists, false, 'Published photo has deletion job');
    assert.equal(binaryExists, true, 'Published photo lost its source binary');
    assert.equal(photo.get('feedPublicationPending'), undefined);
    assert.equal(photo.get('feedPublicationExpiresAtMs'), undefined);
    assert.equal(await exists(bucket.file(pub.publishedStoragePath)), true);
  } else if (photo.exists) {
    assert.equal(job.exists, true, 'Unpublished surviving draft requires durable deletion job');
    assert.ok(Number(photo.get('feedPublicationCleanupStagedAtMs')) > 0,
      'Staged cleanup needs tombstone');
  } else {
    assert.equal(binaryExists, false, 'Deleted draft left behind a private binary');
  }
  console.log('[feed-race:e2e] PASS: parallel publish/cleanup stays consistent (' +
    (pub ? 'published' : photo.exists ? 'deletion-pending' : 'deleted') +
    '; callable=' + publicationAttempt.status + ')');

  // Deterministic Firestore CAS: publication read before cleanup's tombstone
  // cannot commit stale public projections after a competing write.
  const casId = `feed-cas-${runId}`;
  await createPending(casId);
  const beforeStage = await privateRef(casId).get();
  assert.ok(beforeStage.updateTime);
  await privateRef(casId).update({feedPublicationCleanupStagedAtMs:Date.now()});
  const stalePublish = db.batch();
  stalePublish.update(privateRef(casId), {
    feedPublicationPending: FieldValue.delete(),
    feedPublicationExpiresAtMs: FieldValue.delete(),
  }, {lastUpdateTime:beforeStage.updateTime});
  stalePublish.create(publicationRef(casId), {ownerUid,isPublished:true});
  stalePublish.create(projectionRef(casId), {ownerUid,mediaType:'PHOTO'});
  await assert.rejects(stalePublish.commit());
  assert.equal((await publicationRef(casId).get()).exists, false);
  assert.equal((await projectionRef(casId).get()).exists, false);
  console.log('[feed-race:e2e] PASS: stale publish CAS cannot resurrect publication after a competing tombstone');

  console.log('[feed-race:e2e] PASS: all concurrency checks');
} finally {
  if (ownerUid) {
    await Promise.all([
      db.recursiveDelete(db.doc(`users/${ownerUid}`)).catch(() => undefined),
      db.recursiveDelete(db.doc(`public_profiles/${ownerUid}`)).catch(() => undefined),
      bucket.deleteFiles({prefix:`users/${ownerUid}/`}).catch(() => undefined),
      bucket.deleteFiles({prefix:`public_profiles/${ownerUid}/`}).catch(() => undefined),
    ]);
    for (const id of [
      `feed-published-${runId}`, `feed-discarded-${runId}`,
      `feed-racing-${runId}`, `feed-cas-${runId}`,
    ]) {
      await jobRef(id).delete().catch(() => undefined);
    }
    await db.doc(`age_eligibility_records/${ownerUid}`).delete().catch(() => undefined);
  }
  if (authenticatedUser) {
    await deleteUser(authenticatedUser).catch(() => undefined);
  }
  await Promise.all([
    deleteClient(clientApp).catch(() => undefined),
    deleteAdmin(adminApp).catch(() => undefined),
  ]);
}
