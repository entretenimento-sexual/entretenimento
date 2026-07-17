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
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FIRESTORE_PORT = 18080;
const FUNCTIONS_PORT = 15001;
const WAIT_TIMEOUT_MS = 20_000;
const WAIT_INTERVAL_MS = 150;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${AUTH_PORT}`;

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

async function expectCallableFailure(callable, payload) {
  try {
    await callable(payload);
  } catch (error) {
    assert.match(
      String(error?.code ?? ''),
      /failed-precondition/,
      'A restrição deveria retornar failed-precondition.'
    );
    return;
  }

  assert.fail('A Callable aceitou uma ação durante a revalidação.');
}

function createClient(name) {
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
  const functions = getFunctions(app, 'us-central1');

  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);

  return { app, auth, functions };
}

function registeredUser(uid, nickname) {
  return {
    uid,
    email: `${uid}@example.test`,
    nickname,
    nicknameNormalized: nickname,
    role: 'free',
    tier: 'free',
    emailVerified: true,
    profileCompleted: true,
    accountStatus: 'active',
    publicVisibility: 'visible',
    interactionBlocked: false,
    loginAllowed: true,
    suspended: false,
    registrationFlowVersion: 'v2',
    initialAdultConsentRequired: false,
    registrationCompletedAt: Date.now(),
    acceptedTerms: {
      accepted: true,
      version: 'v1',
      acceptedAt: Date.now(),
    },
    adultConsent: {
      accepted: true,
      version: 'v1',
      acceptedAt: Date.now(),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function readData(reference) {
  const snapshot = await reference.get();
  return snapshot.exists ? snapshot.data() : null;
}

async function run() {
  assert.match(PROJECT_ID, /^demo-/);

  const runId = randomUUID();
  const targetClient = createClient(`age-media-target-${runId}`);
  const reporterClient = createClient(`age-media-reporter-${runId}`);
  const moderatorClient = createClient(`age-media-admin-${runId}`);
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `age-media-admin-sdk-${runId}`
  );
  const db = getFirestore(adminApp);
  const adminAuth = getAdminAuth(adminApp);
  const authenticatedUsers = [];

  try {
    const [targetCredential, reporterCredential, moderatorCredential] =
      await Promise.all([
        createUserWithEmailAndPassword(
          targetClient.auth,
          `age-media-target-${runId}@example.test`,
          `Target-${runId}-Aa1!`
        ),
        createUserWithEmailAndPassword(
          reporterClient.auth,
          `age-media-reporter-${runId}@example.test`,
          `Reporter-${runId}-Aa1!`
        ),
        createUserWithEmailAndPassword(
          moderatorClient.auth,
          `age-media-admin-${runId}@example.test`,
          `Admin-${runId}-Aa1!`
        ),
      ]);

    authenticatedUsers.push(
      targetCredential.user,
      reporterCredential.user,
      moderatorCredential.user
    );

    const targetUid = targetCredential.user.uid;
    const reporterUid = reporterCredential.user.uid;
    const moderatorUid = moderatorCredential.user.uid;
    const nickname = `age-media-${runId}`;
    const videoId = `video-${runId}`;
    const photoId = `photo-${runId}`;
    const targetUserRef = db.doc(`users/${targetUid}`);
    const publicProfileRef = db.doc(`public_profiles/${targetUid}`);
    const nicknameIndexRef = db.doc(`public_index/nickname:${nickname}`);
    const publicVideoRef = db.doc(
      `public_profiles/${targetUid}/public_videos/${videoId}`
    );
    const publicPhotoRef = db.doc(
      `public_profiles/${targetUid}/public_photos/${photoId}`
    );
    const videoPublicationRef = db.doc(
      `users/${targetUid}/video_publications/${videoId}`
    );
    const photoPublicationRef = db.doc(
      `users/${targetUid}/photo_publications/${photoId}`
    );

    await Promise.all([
      adminAuth.updateUser(targetUid, { emailVerified: true }),
      adminAuth.setCustomUserClaims(moderatorUid, { admin: true }),
    ]);
    await Promise.all([
      targetCredential.user.getIdToken(true),
      moderatorCredential.user.getIdToken(true),
    ]);

    await Promise.all([
      targetUserRef.set(
        registeredUser(targetUid, nickname),
        { merge: true }
      ),
      db.doc(`users/${reporterUid}`).set(
        registeredUser(reporterUid, `reporter-${runId}`),
        { merge: true }
      ),
      db.doc(`users/${moderatorUid}`).set(
        registeredUser(moderatorUid, `admin-${runId}`),
        { merge: true }
      ),
      publicProfileRef.set({
        uid: targetUid,
        nickname,
        nicknameNormalized: nickname,
        role: 'free',
        municipio: 'Rio de Janeiro',
        publicVideosCount: 7,
        coverVideoId: 'cover-before-review',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      nicknameIndexRef.set({
        uid: targetUid,
        type: 'nickname',
        value: nickname,
        createdAt: 123456,
        lastChangedAt: 123456,
      }),
      publicVideoRef.set({
        id: videoId,
        ownerUid: targetUid,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        reactionsEnabled: true,
        commentsEnabled: true,
        ratingsEnabled: true,
        publishedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      publicPhotoRef.set({
        id: photoId,
        ownerUid: targetUid,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        reactionsEnabled: true,
        commentsEnabled: true,
        commentsPolicy: 'EVERYONE',
        publishedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      videoPublicationRef.set({
        videoId,
        ownerUid: targetUid,
        isPublished: true,
        visibility: 'PUBLIC',
        publishedStoragePath: `public/videos/${targetUid}/${videoId}/video.mp4`,
      }),
      photoPublicationRef.set({
        photoId,
        ownerUid: targetUid,
        isPublished: true,
        visibility: 'PUBLIC',
        publishedStoragePath: `public/photos/${targetUid}/${photoId}/photo.jpg`,
      }),
    ]);

    const reportProfileMinorSafety = httpsCallable(
      reporterClient.functions,
      'reportProfileMinorSafety'
    );
    const requestProfileAgeReverification = httpsCallable(
      moderatorClient.functions,
      'requestProfileAgeReverification'
    );
    const submitProfileAgeReverification = httpsCallable(
      targetClient.functions,
      'submitProfileAgeReverification'
    );
    const reviewProfileAgeReverification = httpsCallable(
      moderatorClient.functions,
      'reviewProfileAgeReverification'
    );
    const getPublicVideoAccessUrls = httpsCallable(
      reporterClient.functions,
      'getPublicVideoAccessUrls'
    );
    const getPublicPhotoAccessUrls = httpsCallable(
      reporterClient.functions,
      'getPublicPhotoAccessUrls'
    );
    const restrictedCallables = [
      [
        httpsCallable(targetClient.functions, 'toggleVideoReaction'),
        { ownerUid: reporterUid, videoId: 'other-video' },
      ],
      [
        httpsCallable(targetClient.functions, 'togglePhotoReaction'),
        { ownerUid: reporterUid, photoId: 'other-photo' },
      ],
      [
        httpsCallable(targetClient.functions, 'rateVideo'),
        { ownerUid: reporterUid, videoId: 'other-video', rating: 5 },
      ],
      [
        httpsCallable(targetClient.functions, 'createVideoComment'),
        {
          ownerUid: reporterUid,
          videoId: 'other-video',
          content: 'Ação que deve ser bloqueada.',
        },
      ],
      [
        httpsCallable(targetClient.functions, 'createPhotoComment'),
        {
          ownerUid: reporterUid,
          photoId: 'other-photo',
          content: 'Ação que deve ser bloqueada.',
        },
      ],
      [
        httpsCallable(targetClient.functions, 'publishVideo'),
        { ownerUid: targetUid, videoId },
      ],
      [
        httpsCallable(targetClient.functions, 'publishPhoto'),
        { ownerUid: targetUid, photoId },
      ],
      [
        httpsCallable(
          targetClient.functions,
          'updateVideoPublicationSettings'
        ),
        {
          ownerUid: targetUid,
          videoId,
          title: 'Alteração bloqueada',
        },
      ],
    ];

    const reportResponse = await reportProfileMinorSafety({
      targetUid,
      details: 'Caso de teste para ocultação transacional da mídia pública.',
    });
    const reportId = reportResponse.data.reportId;

    await requestProfileAgeReverification({
      reportId,
      resolution: 'Indícios suficientes para solicitar revalidação de idade.',
    });

    const hiddenMedia = await waitFor(
      'mídia pública e publicações ficarem privadas',
      async () => ({
        video: await readData(publicVideoRef),
        photo: await readData(publicPhotoRef),
        videoPublication: await readData(videoPublicationRef),
        photoPublication: await readData(photoPublicationRef),
        profile: await readData(publicProfileRef),
      }),
      (state) =>
        state.video?.visibility === 'PRIVATE' &&
        state.video?.ageReverificationHidden === true &&
        state.photo?.visibility === 'PRIVATE' &&
        state.photo?.ageReverificationHidden === true &&
        state.videoPublication?.visibility === 'PRIVATE' &&
        state.videoPublication?.ageReverificationHidden === true &&
        state.photoPublication?.visibility === 'PRIVATE' &&
        state.photoPublication?.ageReverificationHidden === true &&
        state.profile === null
    );
    const caseId = hiddenMedia.video.ageReverificationCaseId;
    const ageCaseRef = db.doc(`age_reverification_cases/${caseId}`);

    assert.equal(hiddenMedia.photo.ageReverificationCaseId, caseId);
    assert.equal(
      hiddenMedia.videoPublication.ageReverificationCaseId,
      caseId
    );
    assert.equal(
      hiddenMedia.photoPublication.ageReverificationCaseId,
      caseId
    );
    assert.equal(
      hiddenMedia.video.ageReverificationPreviousVisibility,
      'PUBLIC'
    );
    assert.equal(
      hiddenMedia.photo.ageReverificationPreviousVisibility,
      'PUBLIC'
    );

    for (const [callable, payload] of restrictedCallables) {
      await expectCallableFailure(callable, payload);
    }

    const [videoAccess, photoAccess] = await Promise.all([
      getPublicVideoAccessUrls({
        items: [{ ownerUid: targetUid, videoId }],
      }),
      getPublicPhotoAccessUrls({
        items: [{ ownerUid: targetUid, photoId }],
      }),
    ]);

    assert.deepEqual(videoAccess.data.items, []);
    assert.deepEqual(photoAccess.data.items, []);

    await submitProfileAgeReverification({
      birthDate: '2000-01-01',
      confirmsTruthfulness: true,
      acceptsRestrictedProcessing: true,
    });
    await reviewProfileAgeReverification({
      reportId,
      decision: 'VERIFY',
      resolution: 'Maioridade confirmada após revisão administrativa.',
    });

    const restoredState = await waitFor(
      'mídia, publicações e perfil serem restaurados',
      async () => ({
        video: await readData(publicVideoRef),
        photo: await readData(publicPhotoRef),
        videoPublication: await readData(videoPublicationRef),
        photoPublication: await readData(photoPublicationRef),
        profile: await readData(publicProfileRef),
        nicknameIndex: await readData(nicknameIndexRef),
        ageCase: await readData(ageCaseRef),
      }),
      (state) =>
        state.video?.visibility === 'PUBLIC' &&
        state.video?.ageReverificationHidden !== true &&
        state.photo?.visibility === 'PUBLIC' &&
        state.photo?.ageReverificationHidden !== true &&
        state.videoPublication?.visibility === 'PUBLIC' &&
        state.videoPublication?.ageReverificationHidden !== true &&
        state.photoPublication?.visibility === 'PUBLIC' &&
        state.photoPublication?.ageReverificationHidden !== true &&
        state.profile?.uid === targetUid &&
        state.nicknameIndex?.uid === targetUid &&
        state.ageCase?.publicProfileBackup === undefined &&
        state.ageCase?.nicknameIndexBackup === undefined
    );

    assert.equal(restoredState.profile.municipio, 'Rio de Janeiro');
    assert.equal(restoredState.profile.publicVideosCount, 7);
    assert.equal(restoredState.profile.coverVideoId, 'cover-before-review');
    assert.equal(restoredState.nicknameIndex.createdAt, 123456);

    console.log('✔ projeções e publicações foram ocultadas na mesma decisão');
    console.log('✔ chamadas manuais de publicação e interação foram bloqueadas');
    console.log('✔ Callables de URL recusaram mídia durante a revalidação');
    console.log('✔ perfil enriquecido, índice e visibilidade foram restaurados');
    console.log('✔ backups privados foram removidos ao encerrar o caso');
  } finally {
    await Promise.allSettled(
      authenticatedUsers.map((user) => deleteUser(user).catch(() => undefined))
    );
    await Promise.allSettled([
      deleteClientApp(targetClient.app),
      deleteClientApp(reporterClient.app),
      deleteClientApp(moderatorClient.app),
      deleteAdminApp(adminApp),
    ]);
  }
}

run().catch((error) => {
  console.error('Falha no E2E de mídia da revalidação de idade.', error);
  process.exitCode = 1;
});
