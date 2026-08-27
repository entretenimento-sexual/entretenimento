// scripts/tests/video-publication.e2e.mjs
// -----------------------------------------------------------------------------
// Integração isolada de vídeo:
// fonte protegida -> registro com intenção pública -> fila -> processamento
// -> publicação automática -> edição -> acesso temporário -> exclusão total;
// também cobre descarte automático após falha de processamento.
// -----------------------------------------------------------------------------

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
  connectStorageEmulator,
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

function assertSafeEnvironment() {
  assert.match(PROJECT_ID, /^demo-/);
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, `${HOST}:${FIRESTORE_PORT}`);
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, `${HOST}:${AUTH_PORT}`);
  assert.equal(
    process.env.STORAGE_EMULATOR_HOST,
    `http://${HOST}:${STORAGE_PORT}`
  );
}

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

  throw new Error(`Timeout aguardando: ${label}. Último valor: ${String(lastValue)}`);
}

async function readDocumentData(reference) {
  const snapshot = await reference.get();
  return snapshot.exists ? snapshot.data() : null;
}

async function readFileExists(file) {
  const [exists] = await file.exists();
  return exists;
}

async function removeBucketPrefix(bucket, prefix) {
  const [files] = await bucket.getFiles({ prefix });
  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
}

async function downloadTemporaryUrl(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `Falha ao ler URL temporária: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function registerVideo({
  registerCallable,
  ownerUid,
  videoId,
  sourcePath,
  posterPath,
  sourceBytes,
  title,
  description,
}) {
  return registerCallable({
    ownerUid,
    videoId,
    videoStoragePath: sourcePath,
    posterStoragePath: posterPath,
    fileName: `${videoId}.mp4`,
    mimeType: 'video/mp4',
    sizeBytes: sourceBytes.byteLength,
    durationMs: 10_000,
    title,
    description,
    reactionsEnabled: false,
    commentsEnabled: true,
    ratingsEnabled: false,
    // O cliente não controla a intenção pública do upload.
    publishWhenReady: false,
  });
}

async function run() {
  assertSafeEnvironment();

  const runId = randomUUID();
  const videoId = `video-${runId}`;
  const failedVideoId = `video-failed-${runId}`;
  const email = `video-e2e-${runId}@example.test`;
  const password = `Video-e2e-${runId}-Aa1!`;
  const sourceBytes = new TextEncoder().encode(`source-video-${runId}`);
  const posterBytes = new TextEncoder().encode(`source-poster-${runId}`);
  const processedBytes = new TextEncoder().encode(`processed-video-${runId}`);
  const failedSourceBytes = new TextEncoder().encode(`failed-video-${runId}`);
  const failedPosterBytes = new TextEncoder().encode(`failed-poster-${runId}`);
  const draftTitle = 'Uma noite especial';
  const draftDescription = 'A história original desse momento.';
  const editedTitle = 'Uma noite ainda mais especial';
  const editedDescription = 'A história revisada depois da publicação.';
  const failedReason = 'Não foi possível preparar uma versão compatível deste vídeo.';

  const clientApp = initializeClientApp(
    {
      apiKey: 'fake-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `video-e2e-client-${runId}`
  );
  const clientAuth = getAuth(clientApp);
  const clientStorage = getClientStorage(clientApp);
  const clientFunctions = getFunctions(clientApp, 'us-central1');

  connectAuthEmulator(clientAuth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  connectStorageEmulator(clientStorage, HOST, STORAGE_PORT);
  connectFunctionsEmulator(clientFunctions, HOST, FUNCTIONS_PORT);

  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `video-e2e-admin-${runId}`
  );
  const adminAuth = getAdminAuth(adminApp);
  const adminDb = getAdminFirestore(adminApp);
  const bucket = getAdminStorage(adminApp).bucket(STORAGE_BUCKET);

  let authenticatedUser = null;
  let ownerUid = '';
  const processingJobRefs = [];

  try {
    const credential = await createUserWithEmailAndPassword(
      clientAuth,
      email,
      password
    );
    authenticatedUser = credential.user;
    ownerUid = credential.user.uid;

    const ownerUserRef = adminDb.doc(`users/${ownerUid}`);
    const recoverRegistrationSeed = httpsCallable(
      clientFunctions,
      'recoverRegistrationSeed'
    );
    const recoveryResponse = await recoverRegistrationSeed({});

    assert.equal(recoveryResponse.data.ok, true);
    assert.equal(recoveryResponse.data.uid, ownerUid);

    const ownerSeed = await readDocumentData(ownerUserRef);
    assert.notEqual(
      ownerSeed,
      null,
      'O seed canônico do usuário E2E deve existir antes do fluxo de vídeo.'
    );

    await adminAuth.updateUser(ownerUid, {
      emailVerified: true,
      disabled: false,
    });

    await ownerUserRef.set(
      {
        uid: ownerUid,
        emailVerified: true,
        profileCompleted: true,
        accountStatus: 'active',
        suspended: false,
        interactionBlocked: false,
        accountLocked: false,
        loginAllowed: true,
        acceptedTerms: {
          accepted: true,
          version: 'v3',
          acknowledgedPrivacyNotice: true,
        },
        initialAdultConsentRequired: false,
        ageReverification: null,
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    await authenticatedUser.reload();
    await authenticatedUser.getIdToken(true);

    const sourcePath =
      `users/${ownerUid}/uploads/videos/${videoId}-${runId}.mp4`;
    const posterPath =
      `users/${ownerUid}/uploads/video-posters/${videoId}/poster-${runId}.jpg`;
    const sourceStorageRef = ref(clientStorage, sourcePath);
    const posterStorageRef = ref(clientStorage, posterPath);

    await uploadBytes(sourceStorageRef, sourceBytes, {
      contentType: 'video/mp4',
      cacheControl: 'private, max-age=0, no-store, no-transform',
    });
    await uploadBytes(posterStorageRef, posterBytes, {
      contentType: 'image/jpeg',
      cacheControl: 'private, max-age=0, no-store, no-transform',
    });

    const registerPrivateVideoUpload = httpsCallable(
      clientFunctions,
      'registerPrivateVideoUpload'
    );
    const registrationResponse = await registerVideo({
      registerCallable: registerPrivateVideoUpload,
      ownerUid,
      videoId,
      sourcePath,
      posterPath,
      sourceBytes,
      title: draftTitle,
      description: draftDescription,
    });

    assert.equal(registrationResponse.data.videoId, videoId);
    assert.equal(registrationResponse.data.ownerUid, ownerUid);
    assert.equal(registrationResponse.data.status, 'ready');

    const ownerVideoRef = adminDb.doc(
      `users/${ownerUid}/videos/${videoId}`
    );
    const publicationRef = adminDb.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicProfileRef = adminDb.doc(`public_profiles/${ownerUid}`);
    const publicVideoRef = adminDb.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const jobRef = adminDb.doc(
      `media_video_processing_jobs/${ownerUid}_${videoId}`
    );
    processingJobRefs.push(jobRef);

    const registeredPublication = await readDocumentData(publicationRef);
    assert.equal(registeredPublication?.isPublished, false);
    assert.equal(registeredPublication?.publishWhenReady, true);
    assert.equal(registeredPublication?.visibility, 'PUBLIC');
    assert.equal(registeredPublication?.moderationStatus, 'APPROVED');
    assert.equal(registeredPublication?.title, draftTitle);
    assert.equal(registeredPublication?.description, draftDescription);
    assert.equal(registeredPublication?.reactionsEnabled, false);
    assert.equal(registeredPublication?.commentsEnabled, true);
    assert.equal(registeredPublication?.ratingsEnabled, false);

    await publicProfileRef.set({
      uid: ownerUid,
      nickname: 'Autor do vídeo E2E',
      publicVisibility: 'visible',
      updatedAt: Date.now(),
    });
    assert.ok(await readDocumentData(publicProfileRef));

    const queuedState = await waitFor(
      'vídeo entrar na fila de processamento',
      async () => ({
        video: await readDocumentData(ownerVideoRef),
        job: await readDocumentData(jobRef),
      }),
      (value) =>
        value.video?.status === 'queued' &&
        value.video?.processingJobId === `${ownerUid}_${videoId}` &&
        value.job?.state === 'QUEUED'
    );

    const outputPrefix = String(queuedState.job.outputPrefix ?? '');
    assert.match(
      outputPrefix,
      new RegExp(`^users/${ownerUid}/processed/videos/${videoId}/[^/]+/$`)
    );

    const processedPath = `${outputPrefix}playback.mp4`;
    await bucket.file(processedPath).save(Buffer.from(processedBytes), {
      resumable: false,
      metadata: {
        contentType: 'video/mp4',
        cacheControl: 'private, max-age=0, no-store, no-transform',
      },
    });

    const completedAt = Date.now();
    await Promise.all([
      jobRef.set(
        {
          state: 'SUCCEEDED',
          providerState: 'SUCCEEDED',
          outputStoragePath: processedPath,
          outputMimeType: 'video/mp4',
          outputSizeBytes: processedBytes.byteLength,
          completedAt,
          updatedAt: completedAt,
        },
        { merge: true }
      ),
      ownerVideoRef.set(
        {
          sourceMimeType: 'video/mp4',
          sourceSizeBytes: sourceBytes.byteLength,
          mimeType: 'video/mp4',
          sizeBytes: processedBytes.byteLength,
          status: 'ready',
          playbackPath: processedPath,
          processedStoragePath: processedPath,
          processedOutputPrefix: outputPrefix,
          processedMimeType: 'video/mp4',
          processedSizeBytes: processedBytes.byteLength,
          processingStage: 'ready',
          processingErrorCode: null,
          processingErrorMessage: null,
          processingCompletedAt: completedAt,
          updatedAt: completedAt,
        },
        { merge: true }
      ),
    ]);

    await waitFor(
      'vídeo ficar pronto com derivado processado',
      () => readDocumentData(ownerVideoRef),
      (value) =>
        value?.status === 'ready' &&
        value?.processedStoragePath === processedPath
    );

    const publishedState = await waitFor(
      'upload ser publicado automaticamente após o processamento',
      async () => ({
        publication: await readDocumentData(publicationRef),
        publicVideo: await readDocumentData(publicVideoRef),
      }),
      (value) =>
        value.publication?.isPublished === true &&
        value.publication?.autoPublishState === 'COMPLETED' &&
        value.publicVideo?.moderationStatus === 'APPROVED' &&
        value.publicVideo?.title === draftTitle &&
        value.publicVideo?.description === draftDescription
    );
    const publication = publishedState.publication;
    const publicVideo = publishedState.publicVideo;

    assert.equal(publication.publishWhenReady, false);
    assert.equal(publication.visibility, 'PUBLIC');
    assert.equal(publication.moderationStatus, 'APPROVED');
    assert.equal(publication.reactionsEnabled, false);
    assert.equal(publication.commentsEnabled, true);
    assert.equal(publication.ratingsEnabled, false);
    assert.equal(publicVideo.mimeType, 'video/mp4');
    assert.equal(publicVideo.durationMs, 10_000);
    assert.equal(publicVideo.reactionsEnabled, false);
    assert.equal(publicVideo.commentsEnabled, true);
    assert.equal(publicVideo.ratingsEnabled, false);

    const publishedVideoPath = String(publication.publishedStoragePath ?? '');
    const publishedPosterPath = String(
      publication.publishedPosterStoragePath ?? ''
    );
    assert.ok(publishedVideoPath);
    assert.ok(publishedPosterPath);

    const publishedVideoFile = bucket.file(publishedVideoPath);
    const publishedPosterFile = bucket.file(publishedPosterPath);
    assert.equal(await readFileExists(publishedVideoFile), true);
    assert.equal(await readFileExists(publishedPosterFile), true);

    const [publishedVideoBytes] = await publishedVideoFile.download();
    const [publishedPosterBytes] = await publishedPosterFile.download();
    assert.deepEqual(publishedVideoBytes, Buffer.from(processedBytes));
    assert.deepEqual(publishedPosterBytes, Buffer.from(posterBytes));

    const updateVideoPublicationSettings = httpsCallable(
      clientFunctions,
      'updateVideoPublicationSettings'
    );
    const editedResponse = await updateVideoPublicationSettings({
      ownerUid,
      videoId,
      title: editedTitle,
      description: editedDescription,
      reactionsEnabled: true,
      commentsEnabled: false,
      ratingsEnabled: true,
    });

    assert.equal(editedResponse.data.videoId, videoId);
    assert.equal(editedResponse.data.isPublished, true);
    assert.equal(editedResponse.data.moderationStatus, 'APPROVED');

    const editedState = await waitFor(
      'edição pública de metadados e preferências',
      async () => ({
        publication: await readDocumentData(publicationRef),
        publicVideo: await readDocumentData(publicVideoRef),
      }),
      (value) =>
        value.publication?.title === editedTitle &&
        value.publication?.description === editedDescription &&
        value.publicVideo?.title === editedTitle &&
        value.publicVideo?.description === editedDescription &&
        value.publicVideo?.commentsEnabled === false
    );

    assert.equal(editedState.publication.reactionsEnabled, true);
    assert.equal(editedState.publication.commentsEnabled, false);
    assert.equal(editedState.publication.ratingsEnabled, true);
    assert.equal(editedState.publicVideo.reactionsEnabled, true);
    assert.equal(editedState.publicVideo.commentsEnabled, false);
    assert.equal(editedState.publicVideo.ratingsEnabled, true);

    const getPublicVideoAccessUrls = httpsCallable(
      clientFunctions,
      'getPublicVideoAccessUrls'
    );
    const accessResponse = await getPublicVideoAccessUrls({
      items: [{ ownerUid, videoId }],
    });

    assert.equal(accessResponse.data.items.length, 1);
    const access = accessResponse.data.items[0];
    assert.equal(access.ownerUid, ownerUid);
    assert.equal(access.videoId, videoId);
    assert.ok(access.url);
    assert.ok(access.posterUrl);
    assert.ok(access.expiresAt > Date.now());

    assert.deepEqual(
      await downloadTemporaryUrl(access.url),
      Buffer.from(processedBytes)
    );
    assert.deepEqual(
      await downloadTemporaryUrl(access.posterUrl),
      Buffer.from(posterBytes)
    );

    const unpublishVideo = httpsCallable(clientFunctions, 'unpublishVideo');
    await assert.rejects(
      () => unpublishVideo({ ownerUid, videoId }),
      (error) => {
        assert.equal(error?.code, 'functions/failed-precondition');
        return true;
      }
    );

    const stillPublished = await readDocumentData(publicationRef);
    assert.equal(stillPublished?.isPublished, true);
    assert.equal(stillPublished?.visibility, 'PUBLIC');
    assert.equal(stillPublished?.moderationStatus, 'APPROVED');
    assert.ok(await readDocumentData(publicVideoRef));
    assert.equal(await readFileExists(publishedVideoFile), true);
    assert.equal(await readFileExists(publishedPosterFile), true);

    const deleteProfileVideo = httpsCallable(
      clientFunctions,
      'deleteProfileVideo'
    );
    const deletionResponse = await deleteProfileVideo({ ownerUid, videoId });
    assert.equal(deletionResponse.data.videoId, videoId);

    await waitFor(
      'exclusão total remover documentos do produto',
      async () => ({
        video: await readDocumentData(ownerVideoRef),
        publication: await readDocumentData(publicationRef),
        publicVideo: await readDocumentData(publicVideoRef),
      }),
      (value) =>
        value.video === null &&
        value.publication === null &&
        value.publicVideo === null
    );

    assert.equal(await readFileExists(bucket.file(sourcePath)), false);
    assert.equal(await readFileExists(bucket.file(posterPath)), false);
    assert.equal(await readFileExists(bucket.file(processedPath)), false);
    assert.equal(await readFileExists(publishedVideoFile), false);
    assert.equal(await readFileExists(publishedPosterFile), false);

    const failedSourcePath =
      `users/${ownerUid}/uploads/videos/${failedVideoId}-${runId}.mp4`;
    const failedPosterPath =
      `users/${ownerUid}/uploads/video-posters/${failedVideoId}/poster-${runId}.jpg`;

    await uploadBytes(ref(clientStorage, failedSourcePath), failedSourceBytes, {
      contentType: 'video/mp4',
      cacheControl: 'private, max-age=0, no-store, no-transform',
    });
    await uploadBytes(ref(clientStorage, failedPosterPath), failedPosterBytes, {
      contentType: 'image/jpeg',
      cacheControl: 'private, max-age=0, no-store, no-transform',
    });

    await registerVideo({
      registerCallable: registerPrivateVideoUpload,
      ownerUid,
      videoId: failedVideoId,
      sourcePath: failedSourcePath,
      posterPath: failedPosterPath,
      sourceBytes: failedSourceBytes,
      title: 'Vídeo que falhará',
      description: 'Cenário de descarte automático.',
    });

    const failedOwnerVideoRef = adminDb.doc(
      `users/${ownerUid}/videos/${failedVideoId}`
    );
    const failedPublicationRef = adminDb.doc(
      `users/${ownerUid}/video_publications/${failedVideoId}`
    );
    const failedPublicVideoRef = adminDb.doc(
      `public_profiles/${ownerUid}/public_videos/${failedVideoId}`
    );
    const failedJobRef = adminDb.doc(
      `media_video_processing_jobs/${ownerUid}_${failedVideoId}`
    );
    processingJobRefs.push(failedJobRef);

    await waitFor(
      'segundo vídeo entrar na fila',
      async () => ({
        video: await readDocumentData(failedOwnerVideoRef),
        job: await readDocumentData(failedJobRef),
      }),
      (value) =>
        value.video?.status === 'queued' && value.job?.state === 'QUEUED'
    );

    await failedOwnerVideoRef.set(
      {
        status: 'failed',
        processingStage: 'failed',
        processingErrorCode: 'E2E_INCOMPATIBLE',
        processingErrorMessage: failedReason,
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    await waitFor(
      'falha descartar upload e publicação automaticamente',
      async () => ({
        video: await readDocumentData(failedOwnerVideoRef),
        publication: await readDocumentData(failedPublicationRef),
        publicVideo: await readDocumentData(failedPublicVideoRef),
      }),
      (value) =>
        value.video === null &&
        value.publication === null &&
        value.publicVideo === null
    );

    assert.equal(await readFileExists(bucket.file(failedSourcePath)), false);
    assert.equal(await readFileExists(bucket.file(failedPosterPath)), false);

    const notificationSnapshot = await adminDb
      .collection('notifications')
      .where('userId', '==', ownerUid)
      .get();
    const failureNotification = notificationSnapshot.docs
      .map((document) => document.data())
      .find((notification) => notification.type === 'video.processing_failed');

    assert.ok(failureNotification);
    assert.equal(failureNotification.title, 'Vídeo descartado');
    assert.match(String(failureNotification.body ?? ''), /versão compatível/i);
    assert.match(String(failureNotification.body ?? ''), /removido da plataforma/i);

    console.log('✔ arquivo-fonte protegido pelas Storage Rules');
    console.log('✔ registro nasceu com intenção PUBLIC + PENDING_REVIEW');
    console.log('✔ fila de processamento criada e publicação automática concluída');
    console.log('✔ título, descrição e permissões propagados à projeção pública');
    console.log('✔ edição pós-publicação sincronizada pelo backend');
    console.log('✔ derivado processado usado na publicação, não o arquivo original');
    console.log('✔ vídeo e poster públicos validados no Storage Emulator');
    console.log('✔ URL temporária pública validada com conteúdo binário');
    console.log('✔ despublicação legada bloqueada sem criar estado privado');
    console.log('✔ lixeira removeu documentos, interações e todos os ativos');
    console.log('✔ falha de processamento gerou feedback e descarte automático');
  } finally {
    const cleanupTasks = [];

    if (ownerUid) {
      cleanupTasks.push(
        removeBucketPrefix(bucket, `users/${ownerUid}/`).catch(() => undefined),
        adminDb
          .recursiveDelete(adminDb.doc(`users/${ownerUid}`))
          .catch(() => undefined),
        adminDb
          .recursiveDelete(adminDb.doc(`public_profiles/${ownerUid}`))
          .catch(() => undefined)
      );
    }

    for (const processingJobRef of processingJobRefs) {
      cleanupTasks.push(processingJobRef.delete().catch(() => undefined));
    }

    if (authenticatedUser) {
      cleanupTasks.push(deleteUser(authenticatedUser).catch(() => undefined));
    }

    await Promise.all(cleanupTasks);
    await Promise.all([
      deleteClientApp(clientApp).catch(() => undefined),
      deleteAdminApp(adminApp).catch(() => undefined),
    ]);
  }
}

run().catch((error) => {
  console.error('✖ fluxo integrado de publicação de vídeo falhou');
  console.error(error);
  process.exitCode = 1;
});