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
    sourceStoragePath:
      `users/${ownerUid}/uploads/videos/${mediaId}-source.mp4`,
    auxiliaryStoragePath: null,
    currentStoragePath: null,
    sourceSizeBytes: 1_000,
    auxiliarySizeBytes: 0,
  };
}

function reconciliationReservation({
  reservationId,
  ownerUid,
  kind,
  operation,
  reservedItemCount,
  reservedUsageBytes,
  now,
}) {
  return {
    reservationId,
    ownerUid,
    mediaId: `${reservationId}-media`,
    kind,
    operation,
    state: 'ACTIVE',
    reservedItemCount,
    reservedUsageBytes,
    expiresAt: Timestamp.fromMillis(now + 60_000),
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

    await adminDb.doc(`users/${ownerUid}`).set(
      { suspended: true },
      { merge: true }
    );
    await assert.rejects(
      () => reserve(videoReservationPayload(
        ownerUid,
        `video-restricted-${runId}`,
        `request-restricted-${runId}`
      )),
      (error) => {
        assert.equal(error.code, 'functions/permission-denied');
        assert.equal(error.details?.code, 'MEDIA_UPLOAD_NOT_ALLOWED');
        return true;
      }
    );
    await adminDb.doc(`users/${ownerUid}`).set(
      { suspended: false },
      { merge: true }
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

    assert.equal(
      fulfilled.length,
      1,
      'somente uma reserva deve ocupar o último slot'
    );
    assert.equal(rejected.length, 1, 'a segunda reserva deve ser recusada');
    assert.equal(
      rejected[0].reason.details?.code,
      'MEDIA_DRAFT_ITEM_LIMIT'
    );

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
    const photoCreateId = `reconcile-photo-create-${runId}`;
    const photoReplaceId = `reconcile-photo-replace-${runId}`;
    const videoCreateId = `reconcile-video-create-${runId}`;

    await Promise.all([
      adminDb.doc(`media_private_upload_reservations/${photoCreateId}`).set(
        reconciliationReservation({
          reservationId: photoCreateId,
          ownerUid,
          kind: 'photo',
          operation: 'CREATE',
          reservedItemCount: 1,
          reservedUsageBytes: 20,
          now,
        })
      ),
      adminDb.doc(`media_private_upload_reservations/${photoReplaceId}`).set(
        reconciliationReservation({
          reservationId: photoReplaceId,
          ownerUid,
          kind: 'photo',
          operation: 'REPLACE',
          reservedItemCount: 0,
          reservedUsageBytes: 100,
          now,
        })
      ),
      adminDb.doc(`media_private_upload_reservations/${videoCreateId}`).set(
        reconciliationReservation({
          reservationId: videoCreateId,
          ownerUid,
          kind: 'video',
          operation: 'CREATE',
          reservedItemCount: 1,
          reservedUsageBytes: 500,
          now,
        })
      ),
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
      photoCount: 1,
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
    assert.equal(repairedUsage.photoCount, 1);
    assert.equal(repairedUsage.photoReservedBytes, 120);
    assert.equal(repairedUsage.videoCount, 1);
    assert.equal(repairedUsage.videoReservedBytes, 500);

    const repeated = await reconcile({ ownerUid, apply: true, operationId });
    assert.equal(repeated.data.applied, true, 'retry deve ser idempotente');

    const orderedVideoIds = [
      `profile-video-a-${runId}`,
      `profile-video-b-${runId}`,
      `profile-video-c-${runId}`,
    ];

    await Promise.all(
      orderedVideoIds.flatMap((videoId, orderIndex) => [
        adminDb
          .doc(`users/${ownerUid}/video_publications/${videoId}`)
          .set({
            ownerUid,
            videoId,
            title: `Vídeo ${orderIndex + 1}`,
            isPublished: true,
            moderationStatus: 'APPROVED',
            orderIndex,
            publishedAt: now + orderIndex,
            updatedAt: now,
          }),
        adminDb
          .doc(`public_profiles/${ownerUid}/public_videos/${videoId}`)
          .set({
            id: videoId,
            ownerUid,
            mediaType: 'VIDEO',
            visibility: 'PUBLIC',
            moderationStatus: 'APPROVED',
            orderIndex,
            publishedAt: now + orderIndex,
            updatedAt: now,
          }),
      ])
    );

    const reorder = httpsCallable(
      ownerClient.functions,
      'reorderProfileVideos'
    );
    const requestedOrder = [
      orderedVideoIds[2],
      orderedVideoIds[0],
      orderedVideoIds[1],
    ];
    const reorderResult = await reorder({
      ownerUid,
      orderedVideoIds: requestedOrder,
    });
    assert.equal(reorderResult.data.updatedCount, 3);
    assert.equal(reorderResult.data.unchanged, false);

    for (const [orderIndex, videoId] of requestedOrder.entries()) {
      const [publication, publicProjection] = await Promise.all([
        adminDb.doc(`users/${ownerUid}/video_publications/${videoId}`).get(),
        adminDb.doc(`public_profiles/${ownerUid}/public_videos/${videoId}`).get(),
      ]);
      assert.equal(publication.get('orderIndex'), orderIndex);
      assert.equal(publicProjection.get('orderIndex'), orderIndex);
    }

    const reorderRetry = await reorder({
      ownerUid,
      orderedVideoIds: requestedOrder,
    });
    assert.equal(reorderRetry.data.updatedCount, 0);
    assert.equal(reorderRetry.data.unchanged, true);

    await assert.rejects(
      () => reorder({
        ownerUid,
        orderedVideoIds: requestedOrder.slice(0, 2),
      }),
      (error) => {
        assert.equal(error.code, 'functions/failed-precondition');
        return true;
      }
    );

    const unauthorizedReorder = httpsCallable(
      adminClient.functions,
      'reorderProfileVideos'
    );
    await assert.rejects(
      () => unauthorizedReorder({
        ownerUid,
        orderedVideoIds: requestedOrder,
      }),
      (error) => {
        assert.equal(error.code, 'functions/permission-denied');
        return true;
      }
    );

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
