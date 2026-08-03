import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  deleteApp as deleteClientApp,
  initializeApp as initializeClientApp,
} from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import {
  connectStorageEmulator,
  deleteObject,
  getDownloadURL,
  getMetadata,
  getStorage,
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

const PROJECT_ID = 'demo-entretenimento-media-draft-functions';
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FIRESTORE_PORT = 18080;
const FUNCTIONS_PORT = 15001;
const STORAGE_PORT = 19199;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${AUTH_PORT}`;
process.env.STORAGE_EMULATOR_HOST = `${HOST}:${STORAGE_PORT}`;

function eligibleUser(uid, overrides = {}) {
  return {
    uid,
    accountStatus: 'active',
    suspended: false,
    emailVerified: true,
    profileCompleted: true,
    adultConsent: { accepted: true },
    acceptedTerms: {
      accepted: true,
      adultAccessAcknowledgement: true,
    },
    billingProjectionVersion: 0,
    isSubscriber: false,
    role: 'user',
    ...overrides,
  };
}

async function createClient(name, email, password) {
  const app = initializeClientApp(
    {
      apiKey: 'fake-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      storageBucket: `${PROJECT_ID}.appspot.com`,
    },
    name
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  await signInWithEmailAndPassword(auth, email, password);
  const functions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);
  const storage = getStorage(app);
  connectStorageEmulator(storage, HOST, STORAGE_PORT);

  return { app, functions, storage };
}

async function assertMissingObject(storage, storagePath) {
  await assert.rejects(
    () => getMetadata(ref(storage, storagePath)),
    (error) => {
      assert.equal(error.code, 'storage/object-not-found');
      return true;
    }
  );
}

async function assertDirectDeleteDenied(storage, storagePath) {
  await assert.rejects(
    () => deleteObject(ref(storage, storagePath)),
    (error) => {
      assert.equal(error.code, 'storage/unauthorized');
      return true;
    }
  );
}

async function waitForValue(readValue, predicate, label, timeoutMs = 8000) {
  const startedAt = Date.now();
  let lastValue;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await readValue();

    if (predicate(lastValue)) {
      return lastValue;
    }

    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  throw new Error(
    `${label} não atingiu o estado esperado. Último valor: ${JSON.stringify(lastValue)}`
  );
}

async function run() {
  const runId = randomUUID();
  const password = `Photo-${runId}-Aa1!`;
  const email = `photo-owner-${runId}@example.test`;
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: `${PROJECT_ID}.appspot.com`,
    },
    `private-photo-admin-${runId}`
  );
  const adminAuth = getAdminAuth(adminApp);
  const adminDb = getAdminFirestore(adminApp);
  let client = null;
  let ownerUid = '';

  try {
    const userRecord = await adminAuth.createUser({
      email,
      password,
      emailVerified: true,
    });
    ownerUid = userRecord.uid;
    await adminDb.doc(`users/${ownerUid}`).set(eligibleUser(ownerUid));
    await adminDb.doc(`public_profiles/${ownerUid}`).set({
      uid: ownerUid,
      nickname: `photo-owner-${runId}`,
      accountStatus: 'active',
    });
    client = await createClient(
      `private-photo-client-${runId}`,
      email,
      password
    );

    const capacity = httpsCallable(
      client.functions,
      'getPrivateMediaDraftCapacity'
    );
    const reserve = httpsCallable(
      client.functions,
      'reservePrivateMediaUpload'
    );
    const cancel = httpsCallable(
      client.functions,
      'cancelPrivateMediaUploadReservation'
    );
    const register = httpsCallable(
      client.functions,
      'registerPrivatePhotoUpload'
    );
    const replace = httpsCallable(
      client.functions,
      'replacePrivatePhotoUpload'
    );
    const publishPhoto = httpsCallable(
      client.functions,
      'publishPhoto'
    );
    const unpublishPhoto = httpsCallable(
      client.functions,
      'unpublishPhoto'
    );
    const deleteProfilePhoto = httpsCallable(
      client.functions,
      'deleteProfilePhoto'
    );
    const usageRef = adminDb.doc(`media_private_draft_usage/${ownerUid}`);

    await adminDb.doc(`users/${ownerUid}`).set(
      { suspended: true },
      { merge: true }
    );
    let capacityErrorCode = '';
    let reservationErrorCode = '';

    await assert.rejects(
      () => capacity({
        kind: 'photo',
        sourceSizeBytes: 128,
        auxiliarySizeBytes: 0,
      }),
      (error) => {
        assert.equal(error.code, 'functions/permission-denied');
        capacityErrorCode = String(error.details?.code ?? '');
        return true;
      }
    );
    await assert.rejects(
      () => reserve({
        clientRequestId: `restricted-${runId}`,
        ownerUid,
        mediaId: `restricted-photo-${runId}`,
        kind: 'photo',
        operation: 'CREATE',
        sourceStoragePath:
          `users/${ownerUid}/uploads/images/restricted-${runId}.jpg`,
        auxiliaryStoragePath: null,
        currentStoragePath: null,
        sourceSizeBytes: 128,
        auxiliarySizeBytes: 0,
      }),
      (error) => {
        assert.equal(error.code, 'functions/permission-denied');
        reservationErrorCode = String(error.details?.code ?? '');
        return true;
      }
    );
    assert.equal(capacityErrorCode, reservationErrorCode);
    assert.equal(capacityErrorCode, 'MEDIA_UPLOAD_NOT_ALLOWED');
    await adminDb.doc(`users/${ownerUid}`).set(
      { suspended: false },
      { merge: true }
    );

    const photoId = `photo-${runId}`;
    const originalPath =
      `users/${ownerUid}/uploads/images/${photoId}-original.jpg`;
    const originalBytes = new Uint8Array(128).fill(1);
    const originalReservation = (
      await reserve({
        clientRequestId: `create-${runId}`,
        ownerUid,
        mediaId: photoId,
        kind: 'photo',
        operation: 'CREATE',
        sourceStoragePath: originalPath,
        auxiliaryStoragePath: null,
        currentStoragePath: null,
        sourceSizeBytes: originalBytes.byteLength,
        auxiliarySizeBytes: 0,
      })
    ).data;

    await uploadBytes(
      ref(client.storage, originalPath),
      originalBytes,
      {
        contentType: 'image/jpeg',
        customMetadata: {
          mediaReservationId: originalReservation.reservationId,
        },
      }
    );
    const originalUrl = await getDownloadURL(
      ref(client.storage, originalPath)
    );
    const registerPayload = {
      ownerUid,
      photoId,
      reservationId: originalReservation.reservationId,
      storagePath: originalPath,
      displayUrl: originalUrl,
      fileName: 'original.jpg',
      sizeBytes: originalBytes.byteLength,
      createdAt: Date.now(),
    };
    const firstRegistration = (await register(registerPayload)).data;
    const repeatedRegistration = (await register(registerPayload)).data;

    assert.equal(firstRegistration.photoId, photoId);
    assert.equal(firstRegistration.storagePath, originalPath);
    assert.equal(repeatedRegistration.photoId, photoId);
    assert.equal(repeatedRegistration.storagePath, originalPath);
    assert.equal(repeatedRegistration.sizeBytes, originalBytes.byteLength);
    await assertDirectDeleteDenied(client.storage, originalPath);

    const usageWhileTechnicalDraft = (await usageRef.get()).data();
    assert.equal(usageWhileTechnicalDraft.photoCount, 1);
    assert.equal(
      usageWhileTechnicalDraft.photoReservedBytes,
      originalBytes.byteLength
    );

    const publicationResult = (
      await publishPhoto({
        ownerUid,
        photoId,
        visibility: 'PUBLIC',
        caption: null,
        isCover: false,
        orderIndex: 0,
        commentsEnabled: true,
        commentsPolicy: 'EVERYONE',
        reactionsEnabled: true,
      })
    ).data;
    assert.equal(publicationResult.photoId, photoId);
    assert.equal(publicationResult.moderationStatus, 'APPROVED');

    const privatePublicationRef = adminDb.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const publicPhotoRef = adminDb.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const privatePublication = (await privatePublicationRef.get()).data();
    const publicPhoto = (await publicPhotoRef.get()).data();

    assert.equal(privatePublication.isPublished, true);
    assert.equal(privatePublication.visibility, 'PUBLIC');
    assert.equal(privatePublication.moderationStatus, 'APPROVED');
    assert.equal(publicPhoto.visibility, 'PUBLIC');
    assert.equal(publicPhoto.moderationStatus, 'APPROVED');

    await assert.rejects(
      () => unpublishPhoto({ ownerUid, photoId }),
      (error) => {
        assert.equal(error.code, 'functions/failed-precondition');
        return true;
      }
    );

    const publicationAfterBlockedUnpublish = (
      await privatePublicationRef.get()
    ).data();
    const publicPhotoAfterBlockedUnpublish = (
      await publicPhotoRef.get()
    ).data();
    assert.equal(publicationAfterBlockedUnpublish.isPublished, true);
    assert.equal(
      publicationAfterBlockedUnpublish.moderationStatus,
      'APPROVED'
    );
    assert.equal(publicPhotoAfterBlockedUnpublish.visibility, 'PUBLIC');

    const usageAfterPublication = await waitForValue(
      async () => (await usageRef.get()).data(),
      (usage) =>
        usage?.photoCount === 0 && usage?.photoReservedBytes === 0,
      'Liberação da quota após publicação'
    );
    assert.equal(usageAfterPublication.photoCount, 0);
    assert.equal(usageAfterPublication.photoReservedBytes, 0);

    const replacementPath =
      `users/${ownerUid}/uploads/images/${photoId}-replacement.jpg`;
    const replacementBytes = new Uint8Array(180).fill(2);
    const replacementReservation = (
      await reserve({
        clientRequestId: `replace-${runId}`,
        ownerUid,
        mediaId: photoId,
        kind: 'photo',
        operation: 'REPLACE',
        sourceStoragePath: replacementPath,
        auxiliaryStoragePath: null,
        currentStoragePath: originalPath,
        sourceSizeBytes: replacementBytes.byteLength,
        auxiliarySizeBytes: 0,
      })
    ).data;

    await uploadBytes(
      ref(client.storage, replacementPath),
      replacementBytes,
      {
        contentType: 'image/jpeg',
        customMetadata: {
          mediaReservationId: replacementReservation.reservationId,
        },
      }
    );
    const replacementUrl = await getDownloadURL(
      ref(client.storage, replacementPath)
    );
    const replacementPayload = {
      ownerUid,
      photoId,
      reservationId: replacementReservation.reservationId,
      currentStoragePath: originalPath,
      newStoragePath: replacementPath,
      newDisplayUrl: replacementUrl,
      fileName: 'replacement.jpg',
      sizeBytes: replacementBytes.byteLength,
    };
    const firstReplacement = (await replace(replacementPayload)).data;
    const repeatedReplacement = (await replace(replacementPayload)).data;

    assert.equal(firstReplacement.storagePath, replacementPath);
    assert.equal(repeatedReplacement.storagePath, replacementPath);
    assert.equal(repeatedReplacement.sizeBytes, replacementBytes.byteLength);
    await getMetadata(ref(client.storage, replacementPath));
    await assertMissingObject(client.storage, originalPath);
    await assertDirectDeleteDenied(client.storage, replacementPath);

    const usageAfterReplace = await waitForValue(
      async () => (await usageRef.get()).data(),
      (usage) =>
        usage?.photoCount === 0 && usage?.photoReservedBytes === 0,
      'Liberação da quota após substituição publicada'
    );
    assert.equal(usageAfterReplace.photoCount, 0);
    assert.equal(usageAfterReplace.photoReservedBytes, 0);

    const synchronizedPublication = await waitForValue(
      async () => (await privatePublicationRef.get()).data(),
      (publication) =>
        publication?.isPublished === true &&
        publication?.moderationStatus === 'APPROVED' &&
        publication?.sourceStoragePath === replacementPath,
      'Sincronização da substituição publicada'
    );
    assert.equal(synchronizedPublication.isPublished, true);
    assert.equal(synchronizedPublication.moderationStatus, 'APPROVED');

    const cancelledPhotoId = `cancelled-${runId}`;
    const cancelledPath =
      `users/${ownerUid}/uploads/images/${cancelledPhotoId}.jpg`;
    const cancelledBytes = new Uint8Array(64).fill(3);
    const cancelledReservation = (
      await reserve({
        clientRequestId: `cancel-${runId}`,
        ownerUid,
        mediaId: cancelledPhotoId,
        kind: 'photo',
        operation: 'CREATE',
        sourceStoragePath: cancelledPath,
        auxiliaryStoragePath: null,
        currentStoragePath: null,
        sourceSizeBytes: cancelledBytes.byteLength,
        auxiliarySizeBytes: 0,
      })
    ).data;

    await uploadBytes(
      ref(client.storage, cancelledPath),
      cancelledBytes,
      {
        contentType: 'image/jpeg',
        customMetadata: {
          mediaReservationId: cancelledReservation.reservationId,
        },
      }
    );
    const cancellation = await cancel({
      reservationId: cancelledReservation.reservationId,
    });
    assert.equal(cancellation.data.released, true);
    await assertMissingObject(client.storage, cancelledPath);

    const usageAfterCancel = await waitForValue(
      async () => (await usageRef.get()).data(),
      (usage) =>
        usage?.photoCount === 0 && usage?.photoReservedBytes === 0,
      'Liberação da quota após cancelamento'
    );
    assert.equal(usageAfterCancel.photoCount, 0);
    assert.equal(usageAfterCancel.photoReservedBytes, 0);

    const deletion = await deleteProfilePhoto({ ownerUid, photoId });
    assert.equal(deletion.data.photoId, photoId);
    await assertMissingObject(client.storage, replacementPath);
    const deletedPhoto = await adminDb
      .doc(`users/${ownerUid}/photos/${photoId}`)
      .get();
    const deletedPublication = await privatePublicationRef.get();
    const deletedPublicPhoto = await publicPhotoRef.get();
    assert.equal(deletedPhoto.exists, false);
    assert.equal(deletedPublication.exists, false);
    assert.equal(deletedPublicPhoto.exists, false);

    console.log('[private-photo-upload-flow] todos os cenários passaram');
  } finally {
    if (client?.app) {
      await deleteClientApp(client.app);
    }
    if (ownerUid) {
      await adminAuth.deleteUser(ownerUid).catch(() => undefined);
    }
    await deleteAdminApp(adminApp);
  }
}

await run();
