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

async function run() {
  assert.match(PROJECT_ID, /^demo-/);

  const runId = randomUUID();
  const videoId = `social-video-${runId}`;
  const ownerClient = createClientApp(`video-social-owner-${runId}`);
  const visitorClient = createClientApp(`video-social-visitor-${runId}`);
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `video-social-admin-${runId}`
  );
  const db = getFirestore(adminApp);
  let ownerUser = null;
  let visitorUser = null;
  let ownerUid = '';
  let visitorUid = '';

  try {
    const [ownerCredential, visitorCredential] = await Promise.all([
      createUserWithEmailAndPassword(
        ownerClient.auth,
        `video-owner-${runId}@example.test`,
        `Owner-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        visitorClient.auth,
        `video-visitor-${runId}@example.test`,
        `Visitor-${runId}-Aa1!`
      ),
    ]);
    ownerUser = ownerCredential.user;
    visitorUser = visitorCredential.user;
    ownerUid = ownerUser.uid;
    visitorUid = visitorUser.uid;

    const privateVideoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const likeRef = publicVideoRef.collection('likes').doc(visitorUid);

    await Promise.all([
      db.doc(`public_profiles/${ownerUid}`).set({
        uid: ownerUid,
        nickname: 'Autor do vídeo',
      }),
      db.doc(`public_profiles/${visitorUid}`).set({
        uid: visitorUid,
        nickname: 'Visitante',
      }),
      privateVideoRef.set({
        id: videoId,
        ownerUid,
        fileName: 'social-video.mp4',
        status: 'ready',
      }),
      publicationRef.set({
        ownerUid,
        videoId,
        isPublished: true,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        title: 'Vídeo social',
        description: 'Teste de interações sociais.',
        reactionsEnabled: true,
        commentsEnabled: false,
        ratingsEnabled: false,
        updatedAt: Date.now(),
      }),
      publicVideoRef.set({
        id: videoId,
        ownerUid,
        mediaType: 'VIDEO',
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        title: 'Vídeo social',
        reactionsEnabled: true,
        commentsEnabled: false,
        ratingsEnabled: false,
        reactionsCount: 0,
        likesCount: 0,
        commentsCount: 0,
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

    const toggleVideoReaction = httpsCallable(
      visitorClient.functions,
      'toggleVideoReaction'
    );
    const firstLike = await toggleVideoReaction({ ownerUid, videoId });
    assert.equal(firstLike.data.liked, true);
    assert.equal(firstLike.data.reactionsCount, 1);
    assert.ok(await readDocumentData(likeRef));

    const removedLike = await toggleVideoReaction({ ownerUid, videoId });
    assert.equal(removedLike.data.liked, false);
    assert.equal(removedLike.data.reactionsCount, 0);
    assert.equal(await readDocumentData(likeRef), null);

    const finalLike = await toggleVideoReaction({ ownerUid, videoId });
    assert.equal(finalLike.data.liked, true);
    assert.equal(finalLike.data.reactionsCount, 1);

    const createVisitorComment = httpsCallable(
      visitorClient.functions,
      'createVideoComment'
    );
    await expectCallableFailure(createVisitorComment, {
      ownerUid,
      videoId,
      content: 'Este comentário deve ser bloqueado.',
    });

    const updateVideoPublicationSettings = httpsCallable(
      ownerClient.functions,
      'updateVideoPublicationSettings'
    );
    await updateVideoPublicationSettings({
      ownerUid,
      videoId,
      title: 'Vídeo social',
      description: 'Teste de interações sociais.',
      reactionsEnabled: true,
      commentsEnabled: true,
      ratingsEnabled: false,
    });

    await waitFor(
      'comentários serem habilitados na projeção pública',
      () => readDocumentData(publicVideoRef),
      (video) => video?.commentsEnabled === true
    );

    const commentResponse = await createVisitorComment({
      ownerUid,
      videoId,
      content: 'Um comentário público e moderável.',
    });
    const rootCommentId = commentResponse.data.commentId;
    const rootCommentRef = publicVideoRef
      .collection('comments')
      .doc(rootCommentId);

    const rootState = await waitFor(
      'comentário raiz e contador',
      async () => ({
        comment: await readDocumentData(rootCommentRef),
        video: await readDocumentData(publicVideoRef),
      }),
      (state) =>
        state.comment?.status === 'VISIBLE' &&
        state.video?.commentsCount === 1
    );
    assert.equal(rootState.comment.authorUid, visitorUid);
    assert.equal(rootState.comment.authorNickname, 'Visitante');

    const createOwnerComment = httpsCallable(
      ownerClient.functions,
      'createVideoComment'
    );
    const replyResponse = await createOwnerComment({
      ownerUid,
      videoId,
      parentCommentId: rootCommentId,
      content: 'Resposta do autor do vídeo.',
    });
    const replyRef = publicVideoRef
      .collection('comments')
      .doc(replyResponse.data.commentId);
    const reply = await waitFor(
      'resposta do autor',
      () => readDocumentData(replyRef),
      (value) => value?.status === 'VISIBLE'
    );
    assert.equal(reply.isOwnerReply, true);
    assert.equal(reply.parentCommentId, rootCommentId);
    assert.equal((await readDocumentData(publicVideoRef)).commentsCount, 1);

    const moderateVideoComment = httpsCallable(
      ownerClient.functions,
      'moderateVideoComment'
    );
    const hidden = await moderateVideoComment({
      ownerUid,
      videoId,
      commentId: rootCommentId,
      action: 'HIDE',
    });
    assert.equal(hidden.data.status, 'HIDDEN');
    assert.equal(hidden.data.commentsCount, 0);

    const restored = await moderateVideoComment({
      ownerUid,
      videoId,
      commentId: rootCommentId,
      action: 'RESTORE',
    });
    assert.equal(restored.data.status, 'VISIBLE');
    assert.equal(restored.data.commentsCount, 1);

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
      'interações serem removidas após despublicação',
      async () => ({
        video: await readDocumentData(publicVideoRef),
        like: await readDocumentData(likeRef),
        root: await readDocumentData(rootCommentRef),
        reply: await readDocumentData(replyRef),
      }),
      (state) =>
        state.video === null &&
        state.like === null &&
        state.root === null &&
        state.reply === null
    );

    console.log('✔ curtida única e alternância validadas no backend');
    console.log('✔ preferência do autor bloqueou comentário desabilitado');
    console.log('✔ comentário e resposta do autor atualizaram contadores');
    console.log('✔ ocultação e restauração foram autorizadas ao proprietário');
    console.log('✔ despublicação removeu curtidas e comentários recursivamente');
  } finally {
    const cleanupTasks = [];

    if (ownerUid) {
      cleanupTasks.push(
        db.recursiveDelete(db.doc(`users/${ownerUid}`)).catch(() => undefined),
        db.recursiveDelete(db.doc(`public_profiles/${ownerUid}`))
          .catch(() => undefined)
      );
    }
    if (visitorUid) {
      cleanupTasks.push(
        db.recursiveDelete(db.doc(`users/${visitorUid}`)).catch(() => undefined),
        db.recursiveDelete(db.doc(`public_profiles/${visitorUid}`))
          .catch(() => undefined)
      );
    }
    if (ownerUser) {
      cleanupTasks.push(deleteUser(ownerUser).catch(() => undefined));
    }
    if (visitorUser) {
      cleanupTasks.push(deleteUser(visitorUser).catch(() => undefined));
    }

    await Promise.all(cleanupTasks);
    await Promise.all([
      deleteClientApp(ownerClient.app).catch(() => undefined),
      deleteClientApp(visitorClient.app).catch(() => undefined),
      deleteAdminApp(adminApp).catch(() => undefined),
    ]);
  }
}

run().catch((error) => {
  console.error('✖ fluxo social integrado de vídeo falhou');
  console.error(error);
  process.exitCode = 1;
});
