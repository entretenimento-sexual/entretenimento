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
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import {
  connectStorageEmulator,
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

import { seedPublicMediaCompliance } from './media-e2e-compliance-fixture.mjs';

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

  throw new Error(`Timeout aguardando ${label}: ${JSON.stringify(lastValue)}`);
}

async function readDocumentData(reference) {
  const snapshot = await reference.get();
  return snapshot.exists ? snapshot.data() : null;
}

async function fileExists(file) {
  const [exists] = await file.exists();
  return exists;
}

async function expectCallableFailure(callable, payload) {
  try {
    await callable(payload);
  } catch (error) {
    assert.ok(error, 'A Callable deveria rejeitar a operação.');
    return;
  }

  assert.fail('A Callable aceitou uma operação que deveria ser rejeitada.');
}

function createClientApp(name) {
  const app = initializeClientApp(
    {
      apiKey: 'fake-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    name
  );
  const auth = getAuth(app);
  const firestore = getClientFirestore(app);
  const storage = getClientStorage(app);
  const functions = getFunctions(app, 'us-central1');

  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(firestore, HOST, FIRESTORE_PORT);
  connectStorageEmulator(storage, HOST, STORAGE_PORT);
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);

  return { app, auth, firestore, storage, functions };
}

async function run() {
  assert.match(PROJECT_ID, /^demo-/);

  const runId = randomUUID();
  const photoId = `reported-photo-${runId}`;
  const ownerClient = createClientApp(`photo-report-owner-${runId}`);
  const visitorAClient = createClientApp(`photo-report-a-${runId}`);
  const visitorBClient = createClientApp(`photo-report-b-${runId}`);
  const moderatorClient = createClientApp(`photo-report-admin-${runId}`);
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `photo-report-admin-sdk-${runId}`
  );
  const adminDb = getAdminFirestore(adminApp);
  const adminAuth = getAdminAuth(adminApp);
  const bucket = getAdminStorage(adminApp).bucket(STORAGE_BUCKET);
  const users = [];
  let ownerUid = '';
  let visitorAUid = '';
  let visitorBUid = '';
  let moderatorUid = '';
  let privateStoragePath = '';
  let publishedStoragePath = '';
  let evidenceStoragePath = '';

  try {
    const credentials = await Promise.all([
      createUserWithEmailAndPassword(
        ownerClient.auth,
        `photo-owner-${runId}@example.test`,
        `Owner-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        visitorAClient.auth,
        `photo-a-${runId}@example.test`,
        `Visitor-a-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        visitorBClient.auth,
        `photo-b-${runId}@example.test`,
        `Visitor-b-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        moderatorClient.auth,
        `photo-admin-${runId}@example.test`,
        `Admin-${runId}-Aa1!`
      ),
    ]);
    users.push(...credentials.map((credential) => credential.user));
    ownerUid = credentials[0].user.uid;
    visitorAUid = credentials[1].user.uid;
    visitorBUid = credentials[2].user.uid;
    moderatorUid = credentials[3].user.uid;
    privateStoragePath = `users/${ownerUid}/uploads/images/${photoId}.png`;

    await Promise.all([
      adminAuth.setCustomUserClaims(moderatorUid, { admin: true }),
      seedPublicMediaCompliance(adminDb, [ownerUid, visitorAUid, visitorBUid]),
    ]);
    await credentials[3].user.getIdToken(true);

    await Promise.all([
      adminDb.doc(`public_profiles/${ownerUid}`).set({
        uid: ownerUid,
        nickname: 'Autor da foto',
      }),
      adminDb.doc(`public_profiles/${visitorAUid}`).set({
        uid: visitorAUid,
        nickname: 'Visitante A',
      }),
      adminDb.doc(`public_profiles/${visitorBUid}`).set({
        uid: visitorBUid,
        nickname: 'Visitante B',
      }),
    ]);

    const privateStorageRef = ref(ownerClient.storage, privateStoragePath);
    const privateBytes = new TextEncoder().encode(`photo-report-${runId}`);
    await uploadBytes(privateStorageRef, privateBytes, {
      contentType: 'image/png',
      cacheControl: 'private, max-age=0, no-store',
    });
    const privateDownloadUrl = await getDownloadURL(privateStorageRef);

    await setDoc(
      doc(ownerClient.firestore, `users/${ownerUid}/photos/${photoId}`),
      {
        id: photoId,
        url: privateDownloadUrl,
        path: privateStoragePath,
        fileName: 'reported-photo.png',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }
    );

    const publishPhoto = httpsCallable(ownerClient.functions, 'publishPhoto');
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
    assert.equal(publicationResponse.data.moderationStatus, 'APPROVED');

    const publicationRef = adminDb.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const publicPhotoRef = adminDb.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const initialPublication = await readDocumentData(publicationRef);
    publishedStoragePath = String(
      initialPublication?.publishedStoragePath ?? ''
    );
    assert.ok(publishedStoragePath);
    assert.equal(await fileExists(bucket.file(publishedStoragePath)), true);

    const reportAsA = httpsCallable(
      visitorAClient.functions,
      'reportPhotoContent'
    );
    const reportAsB = httpsCallable(
      visitorBClient.functions,
      'reportPhotoContent'
    );
    const reviewAsAdmin = httpsCallable(
      moderatorClient.functions,
      'reviewPhotoContentReport'
    );
    const reviewAsVisitor = httpsCallable(
      visitorAClient.functions,
      'reviewPhotoContentReport'
    );
    const deleteAsOwner = httpsCallable(
      ownerClient.functions,
      'deleteProfilePhoto'
    );

    const normalReport = await reportAsA({
      ownerUid,
      photoId,
      reason: 'privacy',
      details: 'Denúncia comum usada para validar manutenção da foto.',
    });
    const normalReportRef = adminDb.doc(
      `moderation_reports/${normalReport.data.reportId}`
    );

    await expectCallableFailure(reportAsA, {
      ownerUid,
      photoId,
      reason: 'privacy',
    });
    await expectCallableFailure(reviewAsVisitor, {
      reportId: normalReport.data.reportId,
      decision: 'KEEP',
      resolution: 'Usuário comum não pode revisar denúncia.',
    });

    const afterNormalReport = await readDocumentData(publicPhotoRef);
    assert.equal(afterNormalReport?.moderationStatus, 'APPROVED');

    await reviewAsAdmin({
      reportId: normalReport.data.reportId,
      decision: 'KEEP',
      resolution: 'Foto mantida após revisão da denúncia comum.',
    });

    await waitFor(
      'denúncia comum ser rejeitada sem retirar a foto',
      async () => ({
        report: await readDocumentData(normalReportRef),
        photo: await readDocumentData(publicPhotoRef),
      }),
      (state) =>
        state.report?.status === 'rejected' &&
        state.report?.moderationAction === 'KEEP' &&
        state.photo?.moderationStatus === 'APPROVED' &&
        state.photo?.openReportsCount === 0
    );

    const severeReport = await reportAsB({
      ownerUid,
      photoId,
      reason: 'illegal_content',
      details: 'Denúncia grave usada para validar quarentena e preservação.',
    });
    const reportId = severeReport.data.reportId;
    const severeReportRef = adminDb.doc(`moderation_reports/${reportId}`);
    const evidenceRef = adminDb.doc(`moderation_evidence/${reportId}`);
    const legalReviewRef = adminDb.doc(
      `moderation_legal_review_cases/${reportId}`
    );
    evidenceStoragePath = `system/moderation-evidence/${reportId}/photo`;

    const quarantined = await waitFor(
      'foto grave entrar em quarentena com evidência preservada',
      async () => ({
        report: await readDocumentData(severeReportRef),
        photo: await readDocumentData(publicPhotoRef),
        publication: await readDocumentData(publicationRef),
        evidence: await readDocumentData(evidenceRef),
        evidenceFileExists: await fileExists(bucket.file(evidenceStoragePath)),
      }),
      (state) =>
        state.report?.contentQuarantined === true &&
        state.report?.evidencePreservationStatus === 'PRESERVED' &&
        state.photo?.moderationStatus === 'HIDDEN' &&
        state.publication?.moderationStatus === 'FLAGGED' &&
        state.publication?.isPublished === true &&
        state.evidence?.mediaType === 'PHOTO' &&
        state.evidence?.retentionStatus === 'LEGAL_REVIEW_REQUIRED' &&
        state.evidenceFileExists === true
    );
    assert.equal(quarantined.publication.visibility, 'PUBLIC');

    await expectCallableFailure(deleteAsOwner, { ownerUid, photoId });
    await expectCallableFailure(publishPhoto, {
      ownerUid,
      photoId,
      visibility: 'PUBLIC',
    });

    await reviewAsAdmin({
      reportId,
      decision: 'REMOVE',
      resolution: 'Foto removida após confirmação da violação denunciada.',
    });

    await waitFor(
      'foto removida sem destruir evidência e com revisão jurídica',
      async () => ({
        report: await readDocumentData(severeReportRef),
        photo: await readDocumentData(publicPhotoRef),
        publication: await readDocumentData(publicationRef),
        evidence: await readDocumentData(evidenceRef),
        evidenceFileExists: await fileExists(bucket.file(evidenceStoragePath)),
        legalReview: await readDocumentData(legalReviewRef),
      }),
      (state) =>
        state.report?.status === 'resolved' &&
        state.report?.moderationAction === 'REMOVE' &&
        state.report?.legalReviewStatus === 'PENDING_LEGAL_REVIEW' &&
        state.photo === null &&
        state.publication === null &&
        state.evidence?.retentionStatus === 'LEGAL_REVIEW_REQUIRED' &&
        state.evidenceFileExists === true &&
        state.legalReview?.status === 'PENDING_LEGAL_REVIEW' &&
        state.legalReview?.authorityDisclosureStatus === 'NOT_EVALUATED' &&
        state.legalReview?.automaticDisclosure === false
    );

    console.log('✔ denúncia comum isolada manteve a foto aprovada');
    console.log('✔ usuário comum não revisou denúncia e duplicata foi bloqueada');
    console.log('✔ denúncia grave colocou a foto em quarentena e preservou o binário');
    console.log('✔ proprietário não excluiu nem republicou a foto FLAGGED');
    console.log('✔ REMOVE excluiu o produto mantendo a evidência preservada');
    console.log('✔ caso grave confirmado abriu revisão jurídica sem disclosure automático');
  } finally {
    const cleanupTasks = [];

    for (const uid of [ownerUid, visitorAUid, visitorBUid, moderatorUid]) {
      if (!uid) {
        continue;
      }
      cleanupTasks.push(
        adminDb.recursiveDelete(adminDb.doc(`users/${uid}`)).catch(() => undefined),
        adminDb
          .recursiveDelete(adminDb.doc(`public_profiles/${uid}`))
          .catch(() => undefined)
      );
    }

    for (const user of users) {
      cleanupTasks.push(deleteUser(user).catch(() => undefined));
    }

    if (ownerUid) {
      cleanupTasks.push(
        bucket.deleteFiles({ prefix: `users/${ownerUid}/` }).catch(() => undefined)
      );
    }
    if (evidenceStoragePath) {
      cleanupTasks.push(
        bucket.file(evidenceStoragePath).delete({ ignoreNotFound: true })
      );
    }

    await Promise.all(cleanupTasks);
    await Promise.all([
      deleteClientApp(ownerClient.app).catch(() => undefined),
      deleteClientApp(visitorAClient.app).catch(() => undefined),
      deleteClientApp(visitorBClient.app).catch(() => undefined),
      deleteClientApp(moderatorClient.app).catch(() => undefined),
      deleteAdminApp(adminApp).catch(() => undefined),
    ]);
  }
}

run().catch((error) => {
  console.error('✖ fluxo integrado de denúncias de foto falhou');
  console.error(error);
  process.exitCode = 1;
});