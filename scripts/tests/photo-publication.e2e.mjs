// scripts/tests/photo-publication.e2e.mjs
// -----------------------------------------------------------------------------
// Integração isolada: upload privado -> publishPhoto -> edição -> sincronização.
// Usa somente emuladores em portas dedicadas e um projectId demo-*.
// -----------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  deleteApp as deleteClientApp,
  initializeApp as initializeClientApp,
} from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
} from 'firebase/auth';
import {
  Timestamp,
  connectFirestoreEmulator,
  doc,
  getFirestore as getClientFirestore,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import {
  connectStorageEmulator,
  deleteObject,
  getDownloadURL,
  getStorage as getClientStorage,
  ref,
  uploadBytes,
} from 'firebase/storage';
import {
  applicationDefault,
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FIRESTORE_PORT = 18080;
const FUNCTIONS_PORT = 15001;
const STORAGE_PORT = 19199;
const WAIT_TIMEOUT_MS = 20_000;
const WAIT_INTERVAL_MS = 150;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${AUTH_PORT}`;
process.env.STORAGE_EMULATOR_HOST = `http://${HOST}:${STORAGE_PORT}`;

function assertSafeEnvironment() {
  assert.match(PROJECT_ID, /^demo-/);
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, `${HOST}:${FIRESTORE_PORT}`);
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, `${HOST}:${AUTH_PORT}`);
  assert.equal(
    process.env.STORAGE_EMULATOR_HOST,
    `http://${HOST}:${STORAGE_PORT}`
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(label, readValue, predicate) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let lastValue;

  while (Date.now() < deadline) {
    lastValue = await readValue();

    if (predicate(lastValue)) {
      return lastValue;
    }

    await delay(WAIT_INTERVAL_MS);
  }

  throw new Error(`Timeout aguardando: ${label}. Último valor: ${String(lastValue)}`);
}

async function readDocumentData(reference) {
  const snapshot = await reference.get();
  return snapshot.exists ? snapshot.data() : null;
}

async function readFileExists(file) {
  const [exists] = await file.exists();
  return exists;
}

async function removeBucketPrefix(bucket, prefix) {
  const [files] = await bucket.getFiles({ prefix });
  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
}

async function run() {
  assertSafeEnvironment();

  const runId = randomUUID();
  const photoId = `photo-${runId}`;
  const email = `media-e2e-${runId}@example.test`;
  const password = `E2e-${runId}-Aa1!`;
  const originalPath = `users/pending/uploads/images/original-${runId}.png`;
  const editedPath = `users/pending/uploads/images/edited-${runId}.png`;
  const originalBytes = new TextEncoder().encode(`original-image-${runId}`);
  const editedBytes = new TextEncoder().encode(`edited-image-${runId}`);

  const clientApp = initializeClientApp(
    {
      apiKey: 'fake-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `media-e2e-client-${runId}`
  );
  const clientAuth = getAuth(clientApp);
  const clientDb = getClientFirestore(clientApp);
  const clientStorage = getClientStorage(clientApp);
  const clientFunctions = getFunctions(clientApp, 'us-central1');

  connectAuthEmulator(clientAuth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(clientDb, HOST, FIRESTORE_PORT);
  connectStorageEmulator(clientStorage, HOST, STORAGE_PORT);
  connectFunctionsEmulator(clientFunctions, HOST, FUNCTIONS_PORT);

  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `media-e2e-admin-${runId}`
  );
  const adminDb = getAdminFirestore(adminApp);
  const bucket = getAdminStorage(adminApp).bucket(STORAGE_BUCKET);

  let authenticatedUser = null;
  let ownerUid = '';
  let resolvedOriginalPath = '';
  let resolvedEditedPath = '';

  try {
    const credential = await createUserWithEmailAndPassword(
      clientAuth,
      email,
      password
    );
    authenticatedUser = credential.user;
    ownerUid = credential.user.uid;
    resolvedOriginalPath = originalPath.replace('/pending/', `/${ownerUid}/`);
    resolvedEditedPath = editedPath.replace('/pending/', `/${ownerUid}/`);

    const originalStorageRef = ref(clientStorage, resolvedOriginalPath);
    await uploadBytes(originalStorageRef, originalBytes, {
      contentType: 'image/png',
      cacheControl: 'private, max-age=0, no-store',
    });
    const originalDownloadUrl = await getDownloadURL(originalStorageRef);

    const privatePhotoRef = doc(
      clientDb,
      `users/${ownerUid}/photos/${photoId}`
    );
    const now = Timestamp.now();

    await setDoc(privatePhotoRef, {
      id: photoId,
      url: originalDownloadUrl,
      path: resolvedOriginalPath,
      fileName: 'original.png',
      createdAt: now,
      updatedAt: now,
    });

    const publishPhoto = httpsCallable(clientFunctions, 'publishPhoto');
    const publicationResponse = await publishPhoto({
      ownerUid,
      photoId,
      visibility: 'PUBLIC',
      isCover: false,
      orderIndex: 0,
      commentsEnabled: true,
      commentsPolicy: 'EVERYONE',
      reactionsEnabled: true,
    });

    assert.equal(publicationResponse.data.photoId, photoId);
    assert.equal(publicationResponse.data.moderationStatus, 'APPROVED');

    const publicationRef = adminDb.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const publicPhotoRef = adminDb.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );

    const initialPublication = await readDocumentData(publicationRef);
    const initialPublicPhoto = await readDocumentData(publicPhotoRef);

    assert.ok(initialPublication);
    assert.ok(initialPublicPhoto);
    assert.equal(initialPublication.isPublished, true);
    assert.equal(initialPublication.sourceStoragePath, resolvedOriginalPath);
    assert.equal(initialPublication.moderationStatus, 'APPROVED');
    assert.equal(initialPublicPhoto.moderationStatus, 'APPROVED');

    const originalPublishedPath = String(
      initialPublication.publishedStoragePath ?? ''
    );
    assert.ok(originalPublishedPath);

    const originalPublishedFile = bucket.file(originalPublishedPath);
    assert.equal(await readFileExists(originalPublishedFile), true);
    const [originalPublishedBytes] = await originalPublishedFile.download();
    assert.deepEqual(originalPublishedBytes, Buffer.from(originalBytes));

    await Promise.all([
      publicationRef.set(
        {
          commentsCount: 7,
          reactionsCount: 5,
          reportsCount: 2,
        },
        { merge: true }
      ),
      publicPhotoRef.set(
        {
          commentsCount: 7,
          reactionsCount: 5,
          reportsCount: 2,
        },
        { merge: true }
      ),
    ]);

    const editedStorageRef = ref(clientStorage, resolvedEditedPath);
    await uploadBytes(editedStorageRef, editedBytes, {
      contentType: 'image/png',
      cacheControl: 'private, max-age=0, no-store',
    });
    const editedDownloadUrl = await getDownloadURL(editedStorageRef);

    await updateDoc(privatePhotoRef, {
      url: editedDownloadUrl,
      path: resolvedEditedPath,
      fileName: 'edited.png',
      updatedAt: Timestamp.now(),
    });

    const synchronizedPublication = await waitFor(
      'publicação apontar para o arquivo editado',
      () => readDocumentData(publicationRef),
      (value) =>
        value?.sourceStoragePath === resolvedEditedPath &&
        typeof value?.publishedStoragePath === 'string' &&
        value.publishedStoragePath !== originalPublishedPath
    );
    const editedPublishedPath = synchronizedPublication.publishedStoragePath;

    const synchronizedPublicPhoto = await waitFor(
      'projeção pública receber metadados editados',
      () => readDocumentData(publicPhotoRef),
      (value) => value?.alt === 'edited.png'
    );

    assert.equal(synchronizedPublication.commentsCount, 7);
    assert.equal(synchronizedPublication.reactionsCount, 5);
    assert.equal(synchronizedPublication.reportsCount, 2);
    assert.equal(synchronizedPublication.moderationStatus, 'APPROVED');
    assert.equal(synchronizedPublicPhoto.commentsCount, 7);
    assert.equal(synchronizedPublicPhoto.reactionsCount, 5);
    assert.equal(synchronizedPublicPhoto.reportsCount, 2);
    assert.equal(synchronizedPublicPhoto.moderationStatus, 'APPROVED');

    const editedPublishedFile = bucket.file(editedPublishedPath);
    await waitFor(
      'novo arquivo público existir',
      () => readFileExists(editedPublishedFile),
      Boolean
    );
    const [editedPublishedBytes] = await editedPublishedFile.download();
    assert.deepEqual(editedPublishedBytes, Buffer.from(editedBytes));

    await waitFor(
      'versão pública anterior ser removida',
      () => readFileExists(originalPublishedFile),
      (exists) => exists === false
    );

    await deleteObject(originalStorageRef);
    assert.equal(
      await readFileExists(bucket.file(resolvedOriginalPath)),
      false
    );

    console.log('✔ usuário temporário autenticado no Auth Emulator');
    console.log('✔ upload privado criado pelo SDK cliente e publicado pela callable');
    console.log('✔ edição sincronizada por trigger para uma nova versão pública');
    console.log('✔ conteúdo binário editado validado no Storage Emulator');
    console.log('✔ versão pública anterior removida');
    console.log('✔ configuração e métricas preservadas');
  } finally {
    const cleanupTasks = [];

    if (ownerUid) {
      cleanupTasks.push(
        removeBucketPrefix(bucket, `users/${ownerUid}/`).catch(() => undefined),
        adminDb
          .recursiveDelete(adminDb.doc(`users/${ownerUid}`))
          .catch(() => undefined),
        adminDb
          .recursiveDelete(adminDb.doc(`public_profiles/${ownerUid}`))
          .catch(() => undefined)
      );
    }

    if (authenticatedUser) {
      cleanupTasks.push(deleteUser(authenticatedUser).catch(() => undefined));
    }

    await Promise.all(cleanupTasks);
    await Promise.all([
      deleteClientApp(clientApp).catch(() => undefined),
      deleteAdminApp(adminApp).catch(() => undefined),
    ]);
  }
}

run().catch((error) => {
  console.error('✖ fluxo integrado de publicação de foto falhou');
  console.error(error);
  process.exitCode = 1;
});
