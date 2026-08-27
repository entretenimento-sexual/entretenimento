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

function eligibleAdultAccessData() {
  return {
    accountStatus: 'active',
    suspended: false,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
    initialAdultConsentRequired: true,
    adultConsent: {
      accepted: true,
      version: 'v1',
    },
    ageReverification: {
      status: 'NONE',
    },
  };
}

async function expectCallableFailure(callable, payload) {
  try {
    await callable(payload);
  } catch (error) {
    assert.ok(error, 'A Callable deveria rejeitar a operação.');
    return error;
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
  const photoId = `social-photo-${runId}`;
  const ownerClient = createClientApp(`photo-social-owner-${runId}`);
  const visitorClient = createClientApp(`photo-social-visitor-${runId}`);
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `photo-social-admin-${runId}`
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
        `photo-owner-${runId}@example.test`,
        `Owner-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        visitorClient.auth,
        `photo-visitor-${runId}@example.test`,
        `Visitor-${runId}-Aa1!`
      ),
    ]);

    ownerUser = ownerCredential.user;
    visitorUser = visitorCredential.user;
    ownerUid = ownerUser.uid;
    visitorUid = visitorUser.uid;

    const ownerUserRef = db.doc(`users/${ownerUid}`);
    const visitorUserRef = db.doc(`users/${visitorUid}`);

    await waitFor(
      'documentos base dos usuários sociais de foto',
      async () => ({
        owner: await readDocumentData(ownerUserRef),
        visitor: await readDocumentData(visitorUserRef),
      }),
      (state) => Boolean(state.owner && state.visitor)
    );

    const publicPhotoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const likeRef = publicPhotoRef.collection('likes').doc(visitorUid);

    await Promise.all([
      db.doc(`public_profiles/${ownerUid}`).set({
        uid: ownerUid,
        nickname: 'Autor da foto',
      }),
      db.doc(`public_profiles/${visitorUid}`).set({
        uid: visitorUid,
        nickname: 'Visitante',
      }),
      publicPhotoRef.set({
        id: photoId,
        ownerUid,
        mediaType: 'PHOTO',
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        reactionsEnabled: true,
        commentsEnabled: false,
        commentsPolicy: 'EVERYONE',
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

    const togglePhotoReaction = httpsCallable(
      visitorClient.functions,
      'togglePhotoReaction'
    );
    const createVisitorComment = httpsCallable(
      visitorClient.functions,
      'createPhotoComment'
    );

    await expectCallableFailure(togglePhotoReaction, { ownerUid, photoId });

    await Promise.all([
      ownerUserRef.set(eligibleAdultAccessData(), { merge: true }),
      visitorUserRef.set(eligibleAdultAccessData(), { merge: true }),
    ]);

    const firstLike = await togglePhotoReaction({ ownerUid, photoId });
    assert.equal(firstLike.data.liked, true);
    assert.equal(firstLike.data.reactionsCount, 1);
    assert.ok(await readDocumentData(likeRef));

    const removedLike = await togglePhotoReaction({ ownerUid, photoId });
    assert.equal(removedLike.data.liked, false);
    assert.equal(removedLike.data.reactionsCount, 0);
    assert.equal(await readDocumentData(likeRef), null);

    await expectCallableFailure(createVisitorComment, {
      ownerUid,
      photoId,
      content: 'Comentário que ainda deve estar desabilitado.',
    });

    await publicPhotoRef.set(
      { commentsEnabled: true, updatedAt: Date.now() },
      { merge: true }
    );

    const commentResponse = await createVisitorComment({
      ownerUid,
      photoId,
      content: 'Comentário público da foto.',
    });
    const rootCommentId = commentResponse.data.commentId;
    const rootCommentRef = publicPhotoRef
      .collection('comments')
      .doc(rootCommentId);

    const rootState = await waitFor(
      'comentário raiz de foto e contador',
      async () => ({
        comment: await readDocumentData(rootCommentRef),
        photo: await readDocumentData(publicPhotoRef),
      }),
      (state) =>
        state.comment?.status === 'VISIBLE' &&
        state.photo?.commentsCount === 1
    );
    assert.equal(rootState.comment.authorUid, visitorUid);
    assert.equal(rootState.comment.authorNickname, 'Visitante');

    const createOwnerComment = httpsCallable(
      ownerClient.functions,
      'createPhotoComment'
    );
    const replyResponse = await createOwnerComment({
      ownerUid,
      photoId,
      parentCommentId: rootCommentId,
      content: 'Resposta do autor da foto.',
    });
    const replyRef = publicPhotoRef
      .collection('comments')
      .doc(replyResponse.data.commentId);
    const reply = await waitFor(
      'resposta do autor da foto',
      () => readDocumentData(replyRef),
      (value) => value?.status === 'VISIBLE'
    );
    assert.equal(reply.isOwnerReply, true);
    assert.equal(reply.parentCommentId, rootCommentId);
    assert.equal((await readDocumentData(publicPhotoRef)).commentsCount, 1);

    await ownerUserRef.set(
      { ageReverification: { status: 'REQUIRED' } },
      { merge: true }
    );

    await expectCallableFailure(createOwnerComment, {
      ownerUid,
      photoId,
      parentCommentId: rootCommentId,
      content: 'Nova resposta deve ser bloqueada durante reverificação.',
    });

    const moderatePhotoComment = httpsCallable(
      ownerClient.functions,
      'moderatePhotoComment'
    );
    const hidden = await moderatePhotoComment({
      ownerUid,
      photoId,
      commentId: rootCommentId,
      action: 'HIDE',
    });
    assert.equal(hidden.data.status, 'HIDDEN');
    assert.equal(hidden.data.commentsCount, 0);

    const restored = await moderatePhotoComment({
      ownerUid,
      photoId,
      commentId: rootCommentId,
      action: 'RESTORE',
    });
    assert.equal(restored.data.status, 'VISIBLE');
    assert.equal(restored.data.commentsCount, 1);

    console.log('✔ usuário sem elegibilidade adulta foi bloqueado na reação');
    console.log('✔ reação elegível alternou estado e contador no backend');
    console.log('✔ comentário respeitou preferência do autor e elegibilidade');
    console.log('✔ resposta do autor preservou contador de comentários raiz');
    console.log('✔ reverificação bloqueou nova interação social');
    console.log('✔ moderação defensiva permaneceu disponível ao proprietário');
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
  console.error('✖ fluxo social integrado de foto falhou');
  console.error(error);
  process.exitCode = 1;
});
