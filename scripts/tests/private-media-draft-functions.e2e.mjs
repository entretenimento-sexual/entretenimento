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
  applicationDefault,
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import {
  Timestamp,
  getFirestore as getAdminFirestore,
} from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-entretenimento-media-draft-functions';
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FIRESTORE_PORT = 18080;
const FUNCTIONS_PORT = 15001;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${AUTH_PORT}`;

function eligibleUser(uid) {
  return {
    uid,
    accountStatus: 'active',
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
  };
}

function videoReservationPayload(ownerUid, mediaId, clientRequestId) {
  return {
    clientRequestId,
    ownerUid,
    mediaId,
    kind: 'video',
    operation: 'CREATE',
    sourceStoragePath: `users/${ownerUid}/uploads/videos/${mediaId}.mp4`,
    auxiliaryStoragePath: null,
    currentStoragePath: null,
    sourceSizeBytes: 1_000,
    auxiliarySizeBytes: 0,
  };
}

async function createClientApp(name, email, password) {
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
  return { app, functions };
}

async function run() {
  const runId = randomUUID();
  const password = `E2e-${runId}-Aa1!`;
  const ownerEmail = `owner-${runId}@example.test`;
  const adminEmail = `admin-${runId}@example.test`;
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    },
    `media-draft-admin-${runId}`
  );
  const adminAuth = getAdminAuth(adminApp);
  const adminDb = getAdminFirestore(adminApp);
  let ownerClient = null;
  let adminClient = null;
  let ownerUid = '';
  let adminUid = '';

  try {
    const ownerRecord = await adminAuth.createUser({
      email: ownerEmail,
      password,
      emailVerified: true,
    });
    ownerUid = ownerRecord.uid;
    const adminRecord = await adminAuth.createUser({
      email: adminEmail,
      password,
      emailVerified: true,
    });
    adminUid = adminRecord.uid;
    await adminAuth.setCustomUserClaims(adminUid, { admin: true });
    await Promise.all([
      adminDb.doc(`users/${ownerUid}`).set(eligibleUser(ownerUid)),
      adminDb.doc(`users/${adminUid}`).set({
        ...eligibleUser(adminUid),
        role: 'admin',
      }),
    ]);

    ownerClient = await createClientApp(
      `media-draft-owner-${runId}`,
      ownerEmail,
      password
    );
    adminClient = await createClientApp(
      `media-draft-admin-client-${runId}`,
      adminEmail,
      password
    );

    const reserve = httpsCallable(
      ownerClient.functions,
      'reservePrivateMediaUpload'
    );
    const attempts = await Promise.allSettled([
      reserve(videoReservationPayload(
        ownerUid,
        `video-a-${runId}`,
        `request-a-${runId}`
      )),
      reserve(videoReservationPayload(
        ownerUid,
        `video-b-${runId}`,
        `request-b-${runId}`
      )),
    ]);
    const fulfilled = attempts.filter((result) => result.status === 'fulfilled');
    const rejected = attempts.filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'somente uma reserva deve ocupar o último slot');
    assert.equal(rejected.length, 1, 'a segunda reserva deve ser recusada');

    const successfulReservation = fulfilled[0].value.data;
    const usageAfterReservation = (
      await adminDb.doc(`media_private_draft_usage/${ownerUid}`).get()
    ).data();
    assert.equal(usageAfterReservation.videoCount, 1);
    assert.equal(usageAfterReservation.videoReservedBytes, 2_000);

    const cancel = httpsCallable(
      ownerClient.functions,
      'cancelPrivateMediaUploadReservation'
    );
    const cancelResult = await cancel({
      reservationId: successfulReservation.reservationId,
    });
    assert.equal(cancelResult.data.released, true);

    const usageAfterCancel = (
      await adminDb.doc(`media_private_draft_usage/${ownerUid}`).get()
    ).data();
    assert.equal(usageAfterCancel.videoCount, 0);
    assert.equal(usageAfterCancel.videoReservedBytes, 0);

    const now = Date.now();
    await Promise.all([
      adminDb.doc(`users/${ownerUid}/photos/photo-active`).set({
        id: 'photo-active',
        ownerUid,
        draftReservationActive: true,
        draftReservedBytes: 100,
        draftExpiresAt: now + 60_000,
      }),
      adminDb.doc(`users/${ownerUid}/videos/video-active`).set({
        id: 'video-active',
        ownerUid,
        draftReservationActive: true,
        draftReservedBytes: 500,
        draftExpiresAt: now + 60_000,
      }),
      adminDb.doc(`media_private_upload_reservations/reconcile-active-${runId}`).set({
        reservationId: `reconcile-active-${runId}`,
        ownerUid,
        mediaId: `photo-pending-${runId}`,
        kind: 'photo',
        operation: 'CREATE',
        state: 'ACTIVE',
        reservedItemCount: 1,
        reservedUsageBytes: 20,
        expiresAt: Timestamp.fromMillis(now + 60_000),
      }),
      adminDb.doc(`media_private_draft_usage/${ownerUid}`).set({
        photoCount: 99,
        photoReservedBytes: 9_999,
        videoCount: 99,
        videoReservedBytes: 9_999,
        updatedAt: now,
      }),
    ]);

    const reconcile = httpsCallable(
      adminClient.functions,
      'reconcilePrivateMediaDraftUsageAdmin'
    );
    const diagnosis = await reconcile({ ownerUid, apply: false });
    assert.equal(diagnosis.data.applied, false);
    assert.equal(diagnosis.data.consistent, false);
    assert.deepEqual(diagnosis.data.expected, {
      photoCount: 2,
      photoReservedBytes: 120,
      videoCount: 1,
      videoReservedBytes: 500,
    });

    const operationId = `repair-${runId}`;
    const applied = await reconcile({ ownerUid, apply: true, operationId });
    assert.equal(applied.data.applied, true);

    const repairedUsage = (
      await adminDb.doc(`media_private_draft_usage/${ownerUid}`).get()
    ).data();
    assert.equal(repairedUsage.photoCount, 2);
    assert.equal(repairedUsage.photoReservedBytes, 120);
    assert.equal(repairedUsage.videoCount, 1);
    assert.equal(repairedUsage.videoReservedBytes, 500);

    const repeated = await reconcile({ ownerUid, apply: true, operationId });
    assert.equal(repeated.data.applied, true, 'retry deve ser idempotente');

    console.log('[media-draft-functions] todos os cenários passaram');
  } finally {
    if (ownerClient?.app) {
      await deleteClientApp(ownerClient.app);
    }
    if (adminClient?.app) {
      await deleteClientApp(adminClient.app);
    }
    if (ownerUid) {
      await adminAuth.deleteUser(ownerUid).catch(() => undefined);
    }
    if (adminUid) {
      await adminAuth.deleteUser(adminUid).catch(() => undefined);
    }
    await deleteAdminApp(adminApp);
  }
}

await run();
