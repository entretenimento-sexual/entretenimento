// scripts/tests/photo-publication.e2e.mjs
// -----------------------------------------------------------------------------
// Integração isolada: upload privado -> publishPhoto -> edição -> sincronização.
// Em seguida executa a suíte de denúncia/quarentena de foto no mesmo conjunto
// de emuladores iniciado por test:media:e2e.
// -----------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
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
  const validPngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const originalBytes = new Uint8Array(validPngBytes);
  const editedBytes = new Uint8Array(validPngBytes);

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
  const adminAuth = getAdminAuth(adminApp);
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

    await adminAuth.updateUser(ownerUid, {
      emailVerified: true,
      disabled: false,
    });

    const verifiedAtMs = Date.now() - 1_000;
    await Promise.all([
      adminDb.doc(`users/${ownerUid}`).set(
        {
          uid: ownerUid,
          emailVerified: true,
          profileCompleted: true,
          accountStatus: 'active',
          suspended: false,
          interactionBlocked: false,
          accountLocked: false,
          loginAllowed: true,
          acceptedTerms: {
            accepted: true,
            version: 'v3',
            acknowledgedPrivacyNotice: true,
          },
          adultConsent: {
            accepted: true,
            version: 'v1',
          },
          initialAdultConsentRequired: false,
          ageReverification: null,
          updatedAt: Date.now(),
        },
        { merge: true }
      ),
      adminDb.doc(`age_eligibility_records/${ownerUid}`).set({
        uid: ownerUid,
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'INITIAL_VERIFICATION',
        method: 'EXTERNAL_PROVIDER',
        caseId: `photo-e2e-${runId}`,
        verifiedAtMs,
        verifiedAt: new Date(verifiedAtMs),
        decidedAtMs: verifiedAtMs,
        decidedAt: new Date(verifiedAtMs),
        expiresAtMs: null,
        expiresAt: null,
        updatedAtMs: verifiedAtMs,
        updatedAt: new Date(verifiedAtMs),
      }),
    ]);

    await authenticatedUser.reload();
    await authenticatedUser.getIdToken(true);

    resolvedOriginalPath = originalPath.replace('/pending/', `/${ownerUid}/`);
    resolvedEditedPath = editedPath.replace('/pending/', `/${ownerUid}/`);

    const reservePhotoUpload = httpsCallable(
      clientFunctions,
      'reservePhotoUpload'
    );
    const originalReservation = await reservePhotoUpload({
      ownerUid,
      storagePath: resolvedOriginalPath,
      sizeBytes: originalBytes.byteLength,
      contentType: 'image/png',
    });
    const originalReservationId = String(
      originalReservation.data.reservationId ?? ''
    );
    assert.ok(originalReservationId);

    const originalStorageRef = ref(clientStorage, resolvedOriginalPath);
    await uploadBytes(originalStorageRef, originalBytes, {
      contentType: 'image/png',
      cacheControl: 'private, max-age=0, no-store',
      customMetadata: {
        mediaPhotoReservationId: originalReservationId,
      },
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
    assert.equal(publicationResponse.data.moderationStatus, 'PENDING_REVIEW');

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
    assert.equal(initialPublication.moderationStatus, 'PENDING_REVIEW');
    assert.equal(initialPublication.safetyScore, null);
    assert.equal(initialPublication.scoreBreakdown?.safetyScore, null);
    assert.equal(initialPublication.lastModeratedAt, null);
    assert.equal(initialPublicPhoto.moderationStatus, 'PENDING_REVIEW');
    assert.equal(initialPublicPhoto.safetyScore, null);
    assert.equal(initialPublicPhoto.scoreBreakdown?.safetyScore, null);

    const preventiveReportId = String(
      initialPublication.preventiveReviewReportId ?? ''
    );
    assert.ok(preventiveReportId);

    const preventiveReportRef = adminDb
      .collection('moderation_reports')
      .doc(preventiveReportId);
    const preventiveReport = await readDocumentData(preventiveReportRef);
    assert.equal(preventiveReport?.source, 'system');
    assert.equal(preventiveReport?.reason, 'preventive_media_review');
    assert.equal(preventiveReport?.contentQuarantined, true);

    await adminAuth.setCustomUserClaims(ownerUid, { admin: true });
    await authenticatedUser.getIdToken(true);

    const reviewPhotoContentReport = httpsCallable(
      clientFunctions,
      'reviewPhotoContentReport'
    );
    await reviewPhotoContentReport({
      reportId: preventiveReportId,
      decision: 'KEEP',
      resolution: 'Conteúdo aprovado na revisão preventiva de teste.',
    });

    const approvedPublication = await waitFor(
      'aprovação explícita da publicação',
      () => readDocumentData(publicationRef),
      (value) =>
        value?.moderationStatus === 'APPROVED' &&
        value?.safetyScore === 100 &&
        value?.scoreBreakdown?.safetyScore === 100
    );
    const approvedPublicPhoto = await waitFor(
      'aprovação explícita da projeção pública',
      () => readDocumentData(publicPhotoRef),
      (value) =>
        value?.moderationStatus === 'APPROVED' &&
        value?.safetyScore === 100 &&
        value?.scoreBreakdown?.safetyScore === 100
    );
    assert.equal(approvedPublication.preventiveReviewReportId, undefined);
    assert.equal(approvedPublicPhoto.preventiveReviewReportId, undefined);

    const originalPublishedPath = String(
      initialPublication.publishedStoragePath ?? ''
    );
    assert.ok(originalPublishedPath);

    const originalPublishedFile = bucket.file(originalPublishedPath);
    assert.equal(await readFileExists(originalPublishedFile), true);
    const [originalPublishedBytes] = await originalPublishedFile.download();
    const [originalPublishedMetadata] = await originalPublishedFile.getMetadata();
    assert.ok(originalPublishedBytes.byteLength > 0);
    assert.equal(originalPublishedMetadata.contentType, 'image/png');
    assert.equal(
      originalPublishedMetadata.metadata?.mediaPhotoReservationId,
      undefined
    );

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

    const editedReservation = await reservePhotoUpload({
      ownerUid,
      storagePath: resolvedEditedPath,
      sizeBytes: editedBytes.byteLength,
      contentType: 'image/png',
    });
    const editedReservationId = String(
      editedReservation.data.reservationId ?? ''
    );
    assert.ok(editedReservationId);

    const editedStorageRef = ref(clientStorage, resolvedEditedPath);
    await uploadBytes(editedStorageRef, editedBytes, {
      contentType: 'image/png',
      cacheControl: 'private, max-age=0, no-store',
      customMetadata: {
        mediaPhotoReservationId: editedReservationId,
      },
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
    assert.equal(synchronizedPublication.moderationStatus, 'PENDING_REVIEW');
    assert.equal(synchronizedPublication.safetyScore, null);
    assert.equal(synchronizedPublication.scoreBreakdown?.safetyScore, null);
    assert.equal(synchronizedPublicPhoto.commentsCount, 7);
    assert.equal(synchronizedPublicPhoto.reactionsCount, 5);
    assert.equal(synchronizedPublicPhoto.reportsCount, 2);
    assert.equal(synchronizedPublicPhoto.moderationStatus, 'PENDING_REVIEW');
    assert.equal(synchronizedPublicPhoto.safetyScore, null);
    assert.equal(synchronizedPublicPhoto.scoreBreakdown?.safetyScore, null);

    const editedPreventiveReportId = String(
      synchronizedPublication.preventiveReviewReportId ?? ''
    );
    assert.ok(editedPreventiveReportId);
    assert.notEqual(editedPreventiveReportId, preventiveReportId);
    const editedPreventiveReport = await readDocumentData(
      adminDb.collection('moderation_reports').doc(editedPreventiveReportId)
    );
    assert.equal(editedPreventiveReport?.reason, 'preventive_media_review');
    assert.equal(editedPreventiveReport?.status, 'open');

    const editedPublishedFile = bucket.file(editedPublishedPath);
    await waitFor(
      'novo arquivo público existir',
      () => readFileExists(editedPublishedFile),
      Boolean
    );
    const [editedPublishedBytes] = await editedPublishedFile.download();
    const [editedPublishedMetadata] = await editedPublishedFile.getMetadata();
    assert.ok(editedPublishedBytes.byteLength > 0);
    assert.equal(editedPublishedMetadata.contentType, 'image/png');
    assert.equal(
      editedPublishedMetadata.metadata?.mediaPhotoReservationId,
      undefined
    );

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
    console.log('✔ upload privado autorizado por reserva e retido em revisão preventiva');
    console.log('✔ aprovação explícita libera o ativo e estabelece safetyScore avaliado');
    console.log('✔ edição binária reabre revisão preventiva e bloqueia distribuição');
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

function runPhotoReportsE2e() {
  const result = spawnSync(
    process.execPath,
    ['scripts/tests/photo-reports.e2e.mjs'],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `E2E de denúncias de foto terminou com código ${result.status ?? 'desconhecido'}.`
    );
  }
}

run()
  .then(() => runPhotoReportsE2e())
  .catch((error) => {
    console.error('✖ fluxo integrado de mídia de foto falhou');
    console.error(error);
    process.exitCode = 1;
  });