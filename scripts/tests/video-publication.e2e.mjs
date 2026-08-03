// scripts/tests/video-publication.e2e.mjs
// -----------------------------------------------------------------------------
// Integração isolada de vídeo:
// elegibilidade -> reserva de quota -> upload privado autorizado -> registro
// obrigatório -> fila -> conclusão simulada -> publicação automática -> edição
// -> acesso temporário -> bloqueio da despublicação.
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
  reload,
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

async function run() {
  assertSafeEnvironment();

  const runId = randomUUID();
  const videoId = `video-${runId}`;
  const email = `video-e2e-${runId}@example.test`;
  const password = `Video-e2e-${runId}-Aa1!`;
  const sourceBytes = new TextEncoder().encode(`private-video-${runId}`);
  const posterBytes = new TextEncoder().encode(`private-poster-${runId}`);
  const processedBytes = new TextEncoder().encode(`processed-video-${runId}`);
  const draftTitle = 'Uma noite especial';
  const draftDescription = 'A história original desse momento.';
  const editedTitle = 'Uma noite ainda mais especial';
  const editedDescription = 'A história revisada depois da publicação.';

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
  let jobRef = null;
  let reservationRef = null;
  let capacityRef = null;

  try {
    const credential = await createUserWithEmailAndPassword(
      clientAuth,
      email,
      password
    );
    authenticatedUser = credential.user;
    ownerUid = credential.user.uid;

    await Promise.all([
      adminAuth.updateUser(ownerUid, { emailVerified: true }),
      adminDb.doc(`users/${ownerUid}`).set({
        uid: ownerUid,
        profileCompleted: true,
        accountStatus: 'active',
        loginAllowed: true,
        interactionBlocked: false,
        updatedAt: Date.now(),
      }),
    ]);
    await reload(authenticatedUser);
    await authenticatedUser.getIdToken(true);

    const sourcePath =
      `users/${ownerUid}/uploads/videos/${videoId}-${runId}.mp4`;
    const posterPath =
      `users/${ownerUid}/uploads/video-posters/${videoId}/poster-${runId}.jpg`;
    const sourceStorageRef = ref(clientStorage, sourcePath);
    const posterStorageRef = ref(clientStorage, posterPath);

    const reservePrivateVideoUpload = httpsCallable(
      clientFunctions,
      'reservePrivateVideoUpload'
    );
    const reservationResponse = await reservePrivateVideoUpload({
      clientRequestId: runId,
      ownerUid,
      videoId,
      videoStoragePath: sourcePath,
      posterStoragePath: posterPath,
      videoSizeBytes: sourceBytes.byteLength,
      posterSizeBytes: posterBytes.byteLength,
      mimeType: 'video/mp4',
    });
    const reservation = reservationResponse.data;
    const reservationId = String(reservation.reservationId ?? '');
    assert.ok(reservationId);
    assert.equal(reservation.ownerUid, ownerUid);
    assert.equal(reservation.videoId, videoId);
    assert.equal(reservation.plan, 'free');
    assert.ok(reservation.expiresAt > Date.now());
    assert.equal(
      reservation.reservedBytes,
      sourceBytes.byteLength * 2 + posterBytes.byteLength
    );

    reservationRef = adminDb.doc(
      `media_private_video_upload_reservations/${reservationId}`
    );
    capacityRef = adminDb.doc(
      `media_private_video_upload_capacity/${ownerUid}`
    );
    assert.equal(
      (await readDocumentData(reservationRef))?.state,
      'ACTIVE'
    );

    const uploadMetadata = {
      cacheControl: 'private, max-age=0, no-store, no-transform',
      customMetadata: {
        videoReservationId: reservationId,
        videoId,
      },
    };

    await uploadBytes(sourceStorageRef, sourceBytes, {
      ...uploadMetadata,
      contentType: 'video/mp4',
    });
    await uploadBytes(posterStorageRef, posterBytes, {
      ...uploadMetadata,
      contentType: 'image/jpeg',
    });

    const registerPrivateVideoUpload = httpsCallable(
      clientFunctions,
      'registerPrivateVideoUpload'
    );
    const registrationResponse = await registerPrivateVideoUpload({
      ownerUid,
      videoId,
      reservationId,
      videoStoragePath: sourcePath,
      posterStoragePath: posterPath,
      fileName: 'video-e2e.mp4',
      mimeType: 'video/mp4',
      sizeBytes: sourceBytes.byteLength,
      durationMs: 10_000,
      title: draftTitle,
      description: draftDescription,
      reactionsEnabled: false,
      commentsEnabled: true,
      ratingsEnabled: false,
      // O backend deve ignorar a tentativa de manter o vídeo privado.
      publishWhenReady: false,
    });

    assert.equal(registrationResponse.data.videoId, videoId);
    assert.equal(registrationResponse.data.ownerUid, ownerUid);
    assert.equal(registrationResponse.data.status, 'ready');

    const privateVideoRef = adminDb.doc(
      `users/${ownerUid}/videos/${videoId}`
    );
    const publicationRef = adminDb.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicProfileRef = adminDb.doc(`public_profiles/${ownerUid}`);
    const publicVideoRef = adminDb.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    jobRef = adminDb.doc(
      `media_video_processing_jobs/${ownerUid}_${videoId}`
    );

    const consumedReservation = await waitFor(
      'reserva ser consumida pelo registro do vídeo',
      async () => ({
        reservation: await readDocumentData(reservationRef),
        video: await readDocumentData(privateVideoRef),
      }),
      (value) =>
        value.reservation?.state === 'CONSUMED' &&
        value.video?.videoReservationId === reservationId &&
        value.video?.quotaReservedBytes === reservation.reservedBytes
    );
    assert.equal(consumedReservation.video.quotaPlanAtUpload, 'free');
    assert.equal(
      consumedReservation.video.posterSizeBytes,
      posterBytes.byteLength
    );

    await publicProfileRef.set({
      uid: ownerUid,
      nickname: 'Autor do vídeo E2E',
      publicVisibility: 'visible',
      updatedAt: Date.now(),
    });
    assert.ok(await readDocumentData(publicProfileRef));

    const queuedState = await waitFor(
      'vídeo privado entrar na fila de processamento',
      async () => ({
        video: await readDocumentData(privateVideoRef),
        publication: await readDocumentData(publicationRef),
        job: await readDocumentData(jobRef),
      }),
      (value) =>
        value.video?.status === 'queued' &&
        value.video?.processingJobId === `${ownerUid}_${videoId}` &&
        value.publication?.publishWhenReady === true &&
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
      privateVideoRef.set(
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
      'vídeo privado ficar pronto com derivado processado',
      () => readDocumentData(privateVideoRef),
      (value) =>
        value?.status === 'ready' &&
        value?.processedStoragePath === processedPath
    );

    const publishedState = await waitFor(
      'publicação automática e projeção pública',
      async () => ({
        publication: await readDocumentData(publicationRef),
        publicVideo: await readDocumentData(publicVideoRef),
      }),
      (value) =>
        value.publication?.isPublished === true &&
        value.publication?.publishWhenReady === false &&
        value.publicVideo?.moderationStatus === 'APPROVED' &&
        value.publicVideo?.title === draftTitle &&
        value.publicVideo?.description === draftDescription
    );
    const publication = publishedState.publication;
    const publicVideo = publishedState.publicVideo;

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
        assert.match(
          String(error?.code ?? ''),
          /failed-precondition/
        );
        return true;
      }
    );

    const publicationAfterBlockedUnpublish = await readDocumentData(
      publicationRef
    );
    assert.equal(publicationAfterBlockedUnpublish?.isPublished, true);
    assert.equal(
      publicationAfterBlockedUnpublish?.moderationStatus,
      'APPROVED'
    );
    assert.ok(await readDocumentData(publicVideoRef));
    assert.equal(await readFileExists(publishedVideoFile), true);
    assert.equal(await readFileExists(publishedPosterFile), true);

    console.log('✔ conta elegível validada antes da transferência');
    console.log('✔ quota reservada antes do primeiro byte');
    console.log('✔ upload privado autorizado pela reserva nas Storage Rules');
    console.log('✔ reserva consumida e vinculada ao vídeo registrado');
    console.log('✔ registro autenticado e fila de processamento criados');
    console.log('✔ intenção de publicação obrigatória aplicada pelo backend');
    console.log('✔ publicação automática concluída após o processamento');
    console.log('✔ título, descrição e permissões propagados à projeção pública');
    console.log('✔ edição pós-publicação sincronizada pelo backend');
    console.log('✔ derivado processado usado na publicação, não o arquivo original');
    console.log('✔ vídeo e poster públicos validados no Storage Emulator');
    console.log('✔ URL temporária pública validada com conteúdo binário');
    console.log('✔ despublicação bloqueada sem remover projeção ou ativos');
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

    if (jobRef) {
      cleanupTasks.push(jobRef.delete().catch(() => undefined));
    }

    if (reservationRef) {
      cleanupTasks.push(reservationRef.delete().catch(() => undefined));
    }

    if (capacityRef) {
      cleanupTasks.push(capacityRef.delete().catch(() => undefined));
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
