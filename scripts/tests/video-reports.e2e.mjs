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
  const videoId = `reports-video-${runId}`;
  const commentId = `reported-comment-${runId}`;
  const ownerClient = createClientApp(`video-reports-owner-${runId}`);
  const visitorAClient = createClientApp(`video-reports-a-${runId}`);
  const visitorBClient = createClientApp(`video-reports-b-${runId}`);
  const moderatorClient = createClientApp(`video-reports-admin-${runId}`);
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `video-reports-admin-sdk-${runId}`
  );
  const db = getFirestore(adminApp);
  const adminAuth = getAdminAuth(adminApp);
  const users = [];
  let ownerUid = '';
  let visitorAUid = '';
  let visitorBUid = '';
  let moderatorUid = '';

  try {
    const credentials = await Promise.all([
      createUserWithEmailAndPassword(
        ownerClient.auth,
        `reports-owner-${runId}@example.test`,
        `Owner-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        visitorAClient.auth,
        `reports-a-${runId}@example.test`,
        `Visitor-a-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        visitorBClient.auth,
        `reports-b-${runId}@example.test`,
        `Visitor-b-${runId}-Aa1!`
      ),
      createUserWithEmailAndPassword(
        moderatorClient.auth,
        `reports-admin-${runId}@example.test`,
        `Admin-${runId}-Aa1!`
      ),
    ]);
    users.push(...credentials.map((credential) => credential.user));
    ownerUid = credentials[0].user.uid;
    visitorAUid = credentials[1].user.uid;
    visitorBUid = credentials[2].user.uid;
    moderatorUid = credentials[3].user.uid;

    await adminAuth.setCustomUserClaims(moderatorUid, { admin: true });
    await credentials[3].user.getIdToken(true);

    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const commentRef = publicVideoRef.collection('comments').doc(commentId);
    const ratingRef = publicVideoRef.collection('ratings').doc(visitorAUid);

    await Promise.all([
      db.doc(`public_profiles/${ownerUid}`).set({
        uid: ownerUid,
        nickname: 'Autor do vídeo',
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
        ratingsEnabled: true,
        reactionsCount: 0,
        commentsCount: 1,
        ratingsCount: 1,
        ratingTotal: 4,
        ratingAverage: 4,
        reportsCount: 0,
        openReportsCount: 0,
        confirmedReportsCount: 0,
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
      commentRef.set({
        ownerUid,
        videoId,
        authorUid: visitorAUid,
        authorNickname: 'Visitante A',
        content: 'Comentário denunciável.',
        status: 'VISIBLE',
        parentCommentId: null,
        reportsCount: 0,
        openReportsCount: 0,
        confirmedReportsCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      ratingRef.set({
        uid: visitorAUid,
        rating: 4,
        reportsCount: 0,
        openReportsCount: 0,
        confirmedReportsCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ]);

    const reportVideoAsA = httpsCallable(
      visitorAClient.functions,
      'reportVideoContent'
    );
    const reportVideoAsB = httpsCallable(
      visitorBClient.functions,
      'reportVideoContent'
    );
    const reportAsOwner = httpsCallable(
      ownerClient.functions,
      'reportVideoContent'
    );
    const reviewAsVisitor = httpsCallable(
      visitorAClient.functions,
      'reviewVideoContentReport'
    );
    const reviewAsAdmin = httpsCallable(
      moderatorClient.functions,
      'reviewVideoContentReport'
    );

    const videoReportA = await reportVideoAsA({
      targetType: 'video',
      ownerUid,
      videoId,
      reason: 'privacy',
      details: 'Primeira denúncia para validar manutenção do conteúdo.',
    });
    const videoReportARef = db.doc(
      `moderation_reports/${videoReportA.data.reportId}`
    );

    await expectCallableFailure(reportVideoAsA, {
      targetType: 'video',
      ownerUid,
      videoId,
      reason: 'privacy',
    });
    await expectCallableFailure(reviewAsVisitor, {
      reportId: videoReportA.data.reportId,
      decision: 'KEEP',
      resolution: 'Usuário comum não pode decidir denúncia.',
    });

    await reviewAsAdmin({
      reportId: videoReportA.data.reportId,
      decision: 'KEEP',
      resolution: 'Conteúdo revisado e mantido por não violar a política.',
    });

    const keptState = await waitFor(
      'denúncia improcedente restaurar segurança',
      async () => ({
        report: await readDocumentData(videoReportARef),
        video: await readDocumentData(publicVideoRef),
      }),
      (state) =>
        state.report?.status === 'rejected' &&
        state.report?.moderationAction === 'KEEP' &&
        state.video?.openReportsCount === 0 &&
        state.video?.confirmedReportsCount === 0 &&
        state.video?.scoreBreakdown?.safetyScore === 100
    );
    assert.equal(keptState.video.reportsCount, 1);

    const commentReport = await reportAsOwner({
      targetType: 'video_comment',
      ownerUid,
      videoId,
      targetId: commentId,
      reason: 'harassment',
      details: 'Comentário incompatível com as regras da plataforma.',
    });
    await reviewAsAdmin({
      reportId: commentReport.data.reportId,
      decision: 'REMOVE',
      resolution: 'Comentário removido após confirmação da denúncia.',
    });

    await waitFor(
      'comentário denunciado ser removido',
      async () => ({
        comment: await readDocumentData(commentRef),
        video: await readDocumentData(publicVideoRef),
      }),
      (state) =>
        state.comment?.status === 'DELETED' &&
        state.comment?.content === '' &&
        state.video?.commentsCount === 0 &&
        state.video?.confirmedReportsCount === 1
    );

    const ratingReport = await reportAsOwner({
      targetType: 'video_rating',
      ownerUid,
      videoId,
      targetId: visitorAUid,
      reason: 'spam',
      details: 'Avaliação coordenada para manipular a reputação do conteúdo.',
    });
    await reviewAsAdmin({
      reportId: ratingReport.data.reportId,
      decision: 'REMOVE',
      resolution: 'Avaliação removida por manipulação confirmada.',
    });

    await waitFor(
      'avaliação denunciada ser removida',
      async () => ({
        rating: await readDocumentData(ratingRef),
        video: await readDocumentData(publicVideoRef),
      }),
      (state) =>
        state.rating === null &&
        state.video?.ratingsCount === 0 &&
        state.video?.ratingTotal === 0 &&
        state.video?.ratingAverage === 0 &&
        state.video?.confirmedReportsCount === 2
    );

    const videoReportB = await reportVideoAsB({
      targetType: 'video',
      ownerUid,
      videoId,
      reason: 'illegal_content',
      details: 'Segunda denúncia usada para validar remoção do vídeo.',
    });
    await reviewAsAdmin({
      reportId: videoReportB.data.reportId,
      decision: 'REMOVE',
      resolution: 'Vídeo removido após confirmação da violação denunciada.',
    });

    await waitFor(
      'vídeo denunciado sair da publicação',
      async () => ({
        video: await readDocumentData(publicVideoRef),
        publication: await readDocumentData(publicationRef),
        report: await readDocumentData(
          db.doc(`moderation_reports/${videoReportB.data.reportId}`)
        ),
      }),
      (state) =>
        state.video === null &&
        state.publication?.isPublished === false &&
        state.publication?.moderationStatus === 'REJECTED' &&
        state.report?.status === 'resolved' &&
        state.report?.moderationAction === 'REMOVE'
    );

    console.log('✔ denúncia duplicada e decisão por usuário comum foram bloqueadas');
    console.log('✔ conteúdo mantido restaurou o score de segurança');
    console.log('✔ comentário denunciado foi removido e recontado');
    console.log('✔ avaliação denunciada foi removida e reagrupada');
    console.log('✔ vídeo confirmado foi retirado da publicação');
  } finally {
    const cleanupTasks = [];

    for (const uid of [ownerUid, visitorAUid, visitorBUid, moderatorUid]) {
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
      deleteClientApp(moderatorClient.app).catch(() => undefined),
      deleteAdminApp(adminApp).catch(() => undefined),
    ]);
  }
}

run().catch((error) => {
  console.error('✖ fluxo integrado de denúncias de vídeo falhou');
  console.error(error);
  process.exitCode = 1;
});
