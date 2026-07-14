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

async function readDocumentData(reference) {
  const snapshot = await reference.get();
  return snapshot.exists ? snapshot.data() : null;
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
  const functions = getFunctions(app, 'us-central1');

  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);

  return { app, auth, functions };
}

async function createTestUser(client, email, password) {
  return createUserWithEmailAndPassword(client.auth, email, password);
}

async function run() {
  assert.match(PROJECT_ID, /^demo-/);

  const runId = randomUUID();
  const videoId = `ratings-video-${runId}`;
  const ownerClient = createClientApp(`video-ratings-owner-${runId}`);
  const visitorAClient = createClientApp(`video-ratings-a-${runId}`);
  const visitorBClient = createClientApp(`video-ratings-b-${runId}`);
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `video-ratings-admin-${runId}`
  );
  const db = getFirestore(adminApp);
  const users = [];
  let ownerUid = '';
  let visitorAUid = '';
  let visitorBUid = '';

  try {
    const [ownerCredential, visitorACredential, visitorBCredential] =
      await Promise.all([
        createTestUser(
          ownerClient,
          `ratings-owner-${runId}@example.test`,
          `Owner-${runId}-Aa1!`
        ),
        createTestUser(
          visitorAClient,
          `ratings-a-${runId}@example.test`,
          `Visitor-a-${runId}-Aa1!`
        ),
        createTestUser(
          visitorBClient,
          `ratings-b-${runId}@example.test`,
          `Visitor-b-${runId}-Aa1!`
        ),
      ]);
    users.push(ownerCredential.user, visitorACredential.user, visitorBCredential.user);
    ownerUid = ownerCredential.user.uid;
    visitorAUid = visitorACredential.user.uid;
    visitorBUid = visitorBCredential.user.uid;

    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const ratingARef = publicVideoRef.collection('ratings').doc(visitorAUid);
    const ratingBRef = publicVideoRef.collection('ratings').doc(visitorBUid);

    await Promise.all([
      db.doc(`public_profiles/${ownerUid}`).set({
        uid: ownerUid,
        nickname: 'Autor',
      }),
      db.doc(`public_profiles/${visitorAUid}`).set({
        uid: visitorAUid,
        nickname: 'Visitante A',
      }),
      db.doc(`public_profiles/${visitorBUid}`).set({
        uid: visitorBUid,
        nickname: 'Visitante B',
      }),
      publicationRef.set({
        ownerUid,
        videoId,
        isPublished: true,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        ratingsEnabled: false,
        updatedAt: Date.now(),
      }),
      publicVideoRef.set({
        id: videoId,
        ownerUid,
        mediaType: 'VIDEO',
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        reactionsEnabled: true,
        commentsEnabled: true,
        ratingsEnabled: false,
        reactionsCount: 0,
        commentsCount: 0,
        ratingsCount: 0,
        ratingTotal: 0,
        ratingAverage: 0,
        score: 0,
        scoreBreakdown: {
          rankingScore: 0,
          qualityScore: 60,
          engagementScore: 0,
          safetyScore: 100,
        },
        publishedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ]);

    const rateAsVisitorA = httpsCallable(visitorAClient.functions, 'rateVideo');
    const rateAsVisitorB = httpsCallable(visitorBClient.functions, 'rateVideo');
    const rateAsOwner = httpsCallable(ownerClient.functions, 'rateVideo');

    await expectCallableFailure(rateAsVisitorA, {
      ownerUid,
      videoId,
      rating: 4,
    });

    await Promise.all([
      publicationRef.set(
        { ratingsEnabled: true, updatedAt: Date.now() },
        { merge: true }
      ),
      publicVideoRef.set(
        { ratingsEnabled: true, updatedAt: Date.now() },
        { merge: true }
      ),
    ]);

    const firstRating = await rateAsVisitorA({
      ownerUid,
      videoId,
      rating: 4,
    });
    assert.equal(firstRating.data.rating, 4);
    assert.equal(firstRating.data.ratingsCount, 1);
    assert.equal(firstRating.data.ratingAverage, 4);

    const updatedRating = await rateAsVisitorA({
      ownerUid,
      videoId,
      rating: 5,
    });
    assert.equal(updatedRating.data.rating, 5);
    assert.equal(updatedRating.data.ratingsCount, 1);
    assert.equal(updatedRating.data.ratingAverage, 5);

    const secondRating = await rateAsVisitorB({
      ownerUid,
      videoId,
      rating: 3,
    });
    assert.equal(secondRating.data.rating, 3);
    assert.equal(secondRating.data.ratingsCount, 2);
    assert.equal(secondRating.data.ratingAverage, 4);

    await expectCallableFailure(rateAsOwner, {
      ownerUid,
      videoId,
      rating: 5,
    });
    await expectCallableFailure(rateAsVisitorA, {
      ownerUid,
      videoId,
      rating: 4.5,
    });

    const aggregate = await waitFor(
      'média e quantidade das avaliações',
      async () => ({
        video: await readDocumentData(publicVideoRef),
        ratingA: await readDocumentData(ratingARef),
        ratingB: await readDocumentData(ratingBRef),
      }),
      (state) =>
        state.video?.ratingsCount === 2 &&
        state.video?.ratingTotal === 8 &&
        state.video?.ratingAverage === 4 &&
        state.ratingA?.rating === 5 &&
        state.ratingB?.rating === 3
    );
    assert.ok(aggregate.video.score > 0);
    assert.ok(aggregate.video.scoreBreakdown.engagementScore > 0);

    await publicationRef.set(
      {
        isPublished: false,
        visibility: 'PRIVATE',
        moderationStatus: 'PRIVATE',
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    await waitFor(
      'avaliações serem removidas após despublicação',
      async () => ({
        video: await readDocumentData(publicVideoRef),
        ratingA: await readDocumentData(ratingARef),
        ratingB: await readDocumentData(ratingBRef),
      }),
      (state) =>
        state.video === null &&
        state.ratingA === null &&
        state.ratingB === null
    );

    console.log('✔ preferência do autor bloqueou avaliações desabilitadas');
    console.log('✔ primeira nota criou quantidade e média');
    console.log('✔ alteração da própria nota preservou a quantidade');
    console.log('✔ duas notas produziram média agregada correta');
    console.log('✔ autor e nota fracionária foram bloqueados');
    console.log('✔ despublicação removeu avaliações recursivamente');
  } finally {
    const cleanupTasks = [];

    for (const uid of [ownerUid, visitorAUid, visitorBUid]) {
      if (!uid) {
        continue;
      }
      cleanupTasks.push(
        db.recursiveDelete(db.doc(`users/${uid}`)).catch(() => undefined),
        db.recursiveDelete(db.doc(`public_profiles/${uid}`))
          .catch(() => undefined)
      );
    }

    for (const user of users) {
      cleanupTasks.push(deleteUser(user).catch(() => undefined));
    }

    await Promise.all(cleanupTasks);
    await Promise.all([
      deleteClientApp(ownerClient.app).catch(() => undefined),
      deleteClientApp(visitorAClient.app).catch(() => undefined),
      deleteClientApp(visitorBClient.app).catch(() => undefined),
      deleteAdminApp(adminApp).catch(() => undefined),
    ]);
  }
}

run().catch((error) => {
  console.error('✖ fluxo integrado de avaliação de vídeo falhou');
  console.error(error);
  process.exitCode = 1;
});
