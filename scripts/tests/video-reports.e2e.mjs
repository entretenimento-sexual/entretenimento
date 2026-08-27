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
import { getStorage as getAdminStorage } from 'firebase-admin/storage';

import { seedPublicMediaCompliance } from './media-e2e-compliance-fixture.mjs';

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
  const assetVersion = `e2e-${runId}`;
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
  const bucket = getAdminStorage(adminApp).bucket();
  const users = [];
  let ownerUid = '';
  let visitorAUid = '';
  let visitorBUid = '';
  let moderatorUid = '';
  let publishedStoragePath = '';
  let evidenceStoragePath = '';

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
    publishedStoragePath =
      `users/${ownerUid}/published/videos/${videoId}/assets/${assetVersion}`;

    await Promise.all([
      adminAuth.setCustomUserClaims(moderatorUid, { admin: true }),
      seedPublicMediaCompliance(db, [ownerUid, visitorAUid, visitorBUid]),
    ]);
    await credentials[3].user.getIdToken(true);

    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const commentRef = publicVideoRef.collection('comments').doc(commentId);
    const ratingRef = publicVideoRef.collection('ratings').doc(visitorAUid);

    await bucket.file(publishedStoragePath).save(
      Buffer.from(`video-evidence-${runId}`, 'utf8'),
      {
        contentType: 'video/mp4',
        resumable: false,
      }
    );

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
        publishWhenReady: false,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        publishedStoragePath,
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
    const commentEvidenceRef = db.doc(
      `moderation_evidence/${commentReport.data.reportId}`
    );
    const commentEvidence = await readDocumentData(commentEvidenceRef);

    assert.equal(commentEvidence?.evidenceType, 'TEXT_SNAPSHOT');
    assert.equal(commentEvidence?.mediaType, 'VIDEO_COMMENT');
    assert.equal(commentEvidence?.targetId, commentId);
    assert.equal(commentEvidence?.textSnapshot, 'Comentário denunciável.');

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
        evidence: await readDocumentData(commentEvidenceRef),
      }),
      (state) =>
        state.comment?.status === 'DELETED' &&
        state.comment?.content === '' &&
        state.video?.commentsCount === 0 &&
        state.video?.confirmedReportsCount === 1 &&
        state.evidence?.textSnapshot === 'Comentário denunciável.'
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
      details: 'Denúncia grave usada para validar quarentena e remoção total.',
    });
    const reportId = videoReportB.data.reportId;
    const videoReportBRef = db.doc(`moderation_reports/${reportId}`);
    const binaryEvidenceRef = db.doc(`moderation_evidence/${reportId}`);
    const legalReviewRef = db.doc(`moderation_legal_review_cases/${reportId}`);
    evidenceStoragePath = `system/moderation-evidence/${reportId}/video`;

    const quarantinedState = await waitFor(
      'denúncia grave retirar o vídeo e preservar evidência',
      async () => ({
        video: await readDocumentData(publicVideoRef),
        publication: await readDocumentData(publicationRef),
        report: await readDocumentData(videoReportBRef),
        evidence: await readDocumentData(binaryEvidenceRef),
        evidenceFileExists: await fileExists(bucket.file(evidenceStoragePath)),
      }),
      (state) =>
        state.video?.moderationStatus === 'HIDDEN' &&
        state.publication?.visibility === 'PUBLIC' &&
        state.publication?.moderationStatus === 'FLAGGED' &&
        state.report?.contentQuarantined === true &&
        state.report?.evidencePreservationStatus === 'PRESERVED' &&
        state.evidence?.retentionStatus === 'LEGAL_REVIEW_REQUIRED' &&
        state.evidence?.storagePath === evidenceStoragePath &&
        state.evidenceFileExists === true
    );
    assert.equal(quarantinedState.publication.isPublished, true);

    await expectCallableFailure(
      httpsCallable(ownerClient.functions, 'deleteProfileVideo'),
      { ownerUid, videoId }
    );

    await reviewAsAdmin({
      reportId,
      decision: 'REMOVE',
      resolution: 'Vídeo removido após confirmação da violação denunciada.',
    });

    await waitFor(
      'vídeo confirmado ser excluído e abrir revisão jurídica',
      async () => ({
        video: await readDocumentData(publicVideoRef),
        publication: await readDocumentData(publicationRef),
        report: await readDocumentData(videoReportBRef),
        evidence: await readDocumentData(binaryEvidenceRef),
        evidenceFileExists: await fileExists(bucket.file(evidenceStoragePath)),
        legalReview: await readDocumentData(legalReviewRef),
      }),
      (state) =>
        state.video === null &&
        state.publication === null &&
        state.report?.status === 'resolved' &&
        state.report?.moderationAction === 'REMOVE' &&
        state.report?.legalReviewStatus === 'PENDING_LEGAL_REVIEW' &&
        state.evidence?.retentionStatus === 'LEGAL_REVIEW_REQUIRED' &&
        state.evidenceFileExists === true &&
        state.legalReview?.status === 'PENDING_LEGAL_REVIEW' &&
        state.legalReview?.authorityDisclosureStatus === 'NOT_EVALUATED' &&
        state.legalReview?.automaticDisclosure === false
    );

    console.log('✔ denúncia duplicada e decisão por usuário comum foram bloqueadas');
    console.log('✔ denúncia comum isolada não retirou conteúdo legítimo');
    console.log('✔ comentário denunciado foi removido com snapshot preservado');
    console.log('✔ avaliação denunciada foi removida e reagrupada');
    console.log('✔ denúncia grave colocou o vídeo em quarentena e preservou o ativo');
    console.log('✔ proprietário não removeu conteúdo FLAGGED durante a análise');
    console.log('✔ REMOVE excluiu o produto sem destruir evidência preservada');
    console.log('✔ caso grave confirmado abriu revisão jurídica sem disclosure automático');
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

    if (publishedStoragePath) {
      cleanupTasks.push(
        bucket.file(publishedStoragePath).delete({ ignoreNotFound: true })
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
  console.error('✖ fluxo integrado de denúncias de vídeo falhou');
  console.error(error);
  process.exitCode = 1;
});