// Publicação com ativo físico REAL e sem origem privada: substituição canônica.
// Executa somente no Firebase Emulator Suite demo-*.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp as deleteClientApp, initializeApp as clientApp } from 'firebase/app';
import {
  connectAuthEmulator, createUserWithEmailAndPassword, deleteUser, getAuth,
} from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import {
  connectStorageEmulator, getStorage, ref, uploadBytes,
} from 'firebase/storage';
import {
  applicationDefault, deleteApp as deleteAdminApp, initializeApp as adminApp,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { seedPublicMediaCompliance } from './media-e2e-compliance-fixture.mjs';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const BUCKET = `${PROJECT_ID}.appspot.com`;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:18080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:19099';
process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:19199';
const IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function createClient(name) {
  const app = clientApp({
    apiKey: 'fake-api-key', authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID, storageBucket: BUCKET,
  }, name);
  const auth = getAuth(app);
  const functions = getFunctions(app, 'us-central1');
  const storage = getStorage(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:19099', {
    disableWarnings: true,
  });
  connectFunctionsEmulator(functions, '127.0.0.1', 15001);
  connectStorageEmulator(storage, '127.0.0.1', 19199);
  return { app, auth, functions, storage, user: null };
}
async function eventually(check, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timeout: ${description}`);
}
async function rejectCode(action, code) {
  await assert.rejects(action, (error) =>
    String(error?.code ?? '').includes(code));
}

async function run() {
  assert.match(PROJECT_ID, /^demo-/);
  const runId = randomUUID();
  const owner = createClient(`replace-owner-${runId}`);
  const visitor = createClient(`replace-visitor-${runId}`);
  const admin = adminApp({ credential: applicationDefault(),
    projectId: PROJECT_ID, storageBucket: BUCKET }, `replace-admin-${runId}`);
  const db = getFirestore(admin);
  const bucket = getAdminStorage(admin).bucket(BUCKET);
  let ownerUid = '';
  let visitorUid = '';
  try {
    const credentials = await Promise.all([
      createUserWithEmailAndPassword(owner.auth,
        `replace-owner-${runId}@example.test`, `Pass-${runId}-Aa1!`),
      createUserWithEmailAndPassword(visitor.auth,
        `replace-visitor-${runId}@example.test`, `Pass-${runId}-Aa1!`),
    ]);
    owner.user = credentials[0].user;
    visitor.user = credentials[1].user;
    ownerUid = owner.user.uid;
    visitorUid = visitor.user.uid;
    await eventually(async () => (await db.doc(`users/${ownerUid}`).get()).exists,
      'criação da conta');
    await seedPublicMediaCompliance(db, [ownerUid, visitorUid]);

    const photoId = `replacement-${runId}`;
    const revision = Date.now() - 20_000;
    const original = `users/${ownerUid}/published/images/${photoId}/initial`;
    const pubRef = db.doc(`users/${ownerUid}/photo_publications/${photoId}`);
    const projectionRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`);
    await bucket.file(original).save(IMAGE_BYTES, {
      metadata: { contentType: 'image/png' },
    });
    await Promise.all([
      pubRef.set({
        ownerUid, photoId, isPublished: true, visibility: 'FRIENDS',
        moderationStatus: 'APPROVED', publishedStoragePath: original,
        publishedAt: revision, assetVersion: revision, updatedAt: revision,
      }),
      projectionRef.set({
        ownerUid, id: photoId, visibility: 'FRIENDS',
        moderationStatus: 'APPROVED', publishedAt: revision,
        assetVersion: revision, assetAccess: 'SIGNED_URL',
        orderIndex: 0, mediaType: 'PHOTO', createdAt: revision,
      }),
    ]);
    assert.ok((await db.collection(`users/${ownerUid}/photos`).limit(1).get()).empty,
      'fixture sem acervo original privado');

    const staging = `users/${ownerUid}/uploads/images/replacement-${runId}.png`;
    const reserve = httpsCallable(owner.functions, 'reservePhotoUpload');
    const reservation = (await reserve({
      ownerUid, storagePath: staging,
      sizeBytes: IMAGE_BYTES.length, contentType: 'image/png',
    })).data.reservationId;
    assert.match(reservation, /^[a-f0-9]{64}$/i);
    await uploadBytes(ref(owner.storage, staging), IMAGE_BYTES, {
      contentType: 'image/png', customMetadata: {
        mediaPhotoReservationId: reservation,
      },
    });
    const input = {
      ownerUid, photoId, sourceStoragePath: staging,
      reservationId: reservation, expectedAssetVersion: revision,
    };
    const unauthorized = httpsCallable(visitor.functions, 'replacePublishedPhoto');
    await rejectCode(() => unauthorized(input), 'permission-denied');

    const replace = httpsCallable(owner.functions, 'replacePublishedPhoto');
    const outcome = (await replace(input)).data;
    assert.equal(outcome.replaced, true);
    assert.equal(outcome.photoId, photoId);
    const publication = (await pubRef.get()).data();
    const projection = (await projectionRef.get()).data();
    assert.notEqual(publication.publishedStoragePath, original);
    assert.equal(publication.sourceStoragePath, undefined);
    assert.equal(publication.visibility, 'FRIENDS');
    assert.equal(projection.assetVersion, outcome.assetVersion);
    assert.equal(publication.assetVersion, outcome.assetVersion);
    assert.equal((await bucket.file(publication.publishedStoragePath).exists())[0], true);
    assert.ok((await db.collection(`users/${ownerUid}/photos`).limit(1).get()).empty);

    await rejectCode(() => replace(input), 'failed-precondition');
    const freshVersion = publication.assetVersion;
    await pubRef.update({ moderationStatus: 'FLAGGED' });
    const second = `users/${ownerUid}/uploads/images/replacement2-${runId}.png`;
    const reservation2 = (await reserve({
      ownerUid, storagePath: second, sizeBytes: IMAGE_BYTES.length,
      contentType: 'image/png',
    })).data.reservationId;
    await uploadBytes(ref(owner.storage, second), IMAGE_BYTES, {
      contentType: 'image/png',
      customMetadata: { mediaPhotoReservationId: reservation2 },
    });
    await rejectCode(() => replace({
      ...input, sourceStoragePath: second, reservationId: reservation2,
      expectedAssetVersion: freshVersion,
    }), 'failed-precondition');
    assert.equal((await pubRef.get()).get('publishedStoragePath'),
      publication.publishedStoragePath);
    console.log('✔ substituir sem original: FRIENDS, geração, versão, reserva, outra conta, moderação');
  } finally {
    const tasks = [];
    for (const uid of [ownerUid, visitorUid]) {
      if (!uid) continue;
      tasks.push(db.recursiveDelete(db.doc(`users/${uid}`)).catch(() => undefined));
      tasks.push(db.recursiveDelete(db.doc(`public_profiles/${uid}`)).catch(() => undefined));
      tasks.push(bucket.deleteFiles({ prefix: `users/${uid}/`, force: true })
        .catch(() => undefined));
    }
    for (const client of [owner, visitor]) {
      if (client.user) tasks.push(deleteUser(client.user).catch(() => undefined));
    }
    await Promise.all(tasks);
    await Promise.all([
      deleteClientApp(owner.app).catch(() => undefined),
      deleteClientApp(visitor.app).catch(() => undefined),
      deleteAdminApp(admin).catch(() => undefined),
    ]);
  }
}
run().catch((error) => {
  console.error('✖ E2E de substituição de foto publicada falhou', error);
  process.exitCode = 1;
});
