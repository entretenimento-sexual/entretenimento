// scripts/tests/video-staging-smoke.mjs
// -----------------------------------------------------------------------------
// Smoke test REAL do pipeline de vídeos em staging.
//
// Proteções:
// - exige confirmação explícita do projectId;
// - rejeita projeto sem a palavra staging;
// - usa usuários e mídias efêmeros;
// - limpa Auth, Firestore e Storage ao final;
// - não imprime credenciais, tokens nem URLs assinadas.
// -----------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  deleteApp as deleteClientApp,
  initializeApp as initializeClientApp,
} from 'firebase/app';
import {
  getAuth as getClientAuth,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
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

const DISPATCH_COLLECTION = 'media_video_processing_dispatches';
const DEAD_LETTER_COLLECTION = 'media_video_processing_dead_letters';
const JOB_COLLECTION = 'media_video_processing_jobs';
const RESERVATION_COLLECTION = 'media_private_video_upload_reservations';
const CAPACITY_COLLECTION = 'media_private_video_upload_capacity';
const TERMINAL_JOB_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const SUCCESS_JOB_STATE = 'SUCCEEDED';
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5_000;
const REPORT_DIRECTORY = path.resolve(
  process.env.VIDEO_STAGING_REPORT_DIR || 'artifacts/video-staging'
);
const REPORT_PATH = path.join(REPORT_DIRECTORY, 'smoke.json');

const FORMAT_CONFIG = {
  mp4: {
    environmentVariable: 'VIDEO_STAGING_MP4_PATH',
    extension: 'mp4',
    mimeType: 'video/mp4',
  },
  webm: {
    environmentVariable: 'VIDEO_STAGING_WEBM_PATH',
    extension: 'webm',
    mimeType: 'video/webm',
  },
  mov: {
    environmentVariable: 'VIDEO_STAGING_MOV_PATH',
    extension: 'mov',
    mimeType: 'video/quicktime',
  },
};

function requiredEnvironment(name, fallback = '') {
  const value = String(process.env[name] ?? fallback).trim();

  if (!value) {
    throw new Error(`Variável obrigatória ausente: ${name}.`);
  }

  return value;
}

function positiveIntegerEnvironment(name, fallback) {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Variável ${name} deve ser um inteiro positivo.`);
  }

  return Math.trunc(value);
}

function safeError(error) {
  const candidate = error && typeof error === 'object' ? error : {};
  const code = String(candidate.code ?? 'UNKNOWN').slice(0, 160);
  const message = String(candidate.message ?? error ?? 'Falha sem mensagem')
    .replace(/https?:\/\/\S+/gi, '[URL_REMOVIDA]')
    .slice(0, 700);

  return { code, message };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(label, readValue, predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;

  while (Date.now() < deadline) {
    lastValue = await readValue();

    if (predicate(lastValue)) {
      return lastValue;
    }

    await delay(intervalMs);
  }

  throw new Error(
    `Timeout aguardando ${label}. Último estado: ${JSON.stringify(lastValue)}`
  );
}

async function readDocument(reference) {
  const snapshot = await reference.get();
  return snapshot.exists ? snapshot.data() : null;
}

async function deleteQuery(query) {
  const snapshot = await query.get();
  await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  return snapshot.size;
}

function parseFormats() {
  const requested = String(process.env.VIDEO_STAGING_FORMATS ?? 'mp4')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(requested)];

  if (!unique.length) {
    throw new Error('VIDEO_STAGING_FORMATS não contém formatos válidos.');
  }

  return unique.map((format) => {
    const configuration = FORMAT_CONFIG[format];

    if (!configuration) {
      throw new Error(
        `Formato desconhecido em VIDEO_STAGING_FORMATS: ${format}.`
      );
    }

    const filePath = path.resolve(
      requiredEnvironment(configuration.environmentVariable)
    );

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(
        `${configuration.environmentVariable} não aponta para um arquivo.`
      );
    }

    return {
      name: format,
      filePath,
      ...configuration,
    };
  });
}

function buildConfiguration() {
  const projectId = requiredEnvironment(
    'VIDEO_STAGING_PROJECT_ID',
    'entretenimento-staging'
  );
  const confirmation = requiredEnvironment('VIDEO_STAGING_CONFIRM');
  const storageBucket = requiredEnvironment(
    'VIDEO_STAGING_STORAGE_BUCKET',
    `${projectId}.appspot.com`
  );
  const posterPath = path.resolve(
    requiredEnvironment('VIDEO_STAGING_POSTER_PATH')
  );

  assert.equal(
    confirmation,
    projectId,
    'VIDEO_STAGING_CONFIRM deve ser exatamente igual ao projectId.'
  );
  assert.match(
    projectId.toLowerCase(),
    /staging/,
    'Este script aceita somente projetos explicitamente identificados como staging.'
  );
  assert.notEqual(
    projectId,
    'entretenimento-sexual',
    'O projeto de produção é proibido neste smoke test.'
  );
  assert.equal(
    storageBucket.startsWith(`${projectId}.`),
    true,
    'O bucket deve pertencer ao projeto de staging confirmado.'
  );
  assert.equal(
    fs.existsSync(posterPath) && fs.statSync(posterPath).isFile(),
    true,
    'VIDEO_STAGING_POSTER_PATH deve apontar para um JPEG existente.'
  );

  return {
    projectId,
    storageBucket,
    posterPath,
    apiKey: requiredEnvironment('VIDEO_STAGING_API_KEY'),
    appId: requiredEnvironment('VIDEO_STAGING_APP_ID'),
    authDomain: requiredEnvironment(
      'VIDEO_STAGING_AUTH_DOMAIN',
      `${projectId}.firebaseapp.com`
    ),
    functionsRegion: requiredEnvironment(
      'VIDEO_STAGING_FUNCTIONS_REGION',
      'us-central1'
    ),
    durationMs: positiveIntegerEnvironment(
      'VIDEO_STAGING_DURATION_MS',
      6_000
    ),
    timeoutMs: positiveIntegerEnvironment(
      'VIDEO_STAGING_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS
    ),
    intervalMs: positiveIntegerEnvironment(
      'VIDEO_STAGING_INTERVAL_MS',
      DEFAULT_INTERVAL_MS
    ),
    cleanup: process.env.VIDEO_STAGING_CLEANUP !== 'false',
    keepOnFailure: process.env.VIDEO_STAGING_KEEP_ON_FAILURE === 'true',
    formats: parseFormats(),
  };
}

async function createAuthenticatedClient({
  adminAuth,
  firebaseConfig,
  functionsRegion,
  runId,
  role,
}) {
  const email = `video-staging-${role}-${runId}@example.test`;
  const userRecord = await adminAuth.createUser({
    email,
    emailVerified: true,
    disabled: false,
    displayName: `Video staging ${role}`,
  });
  const claims = role === 'admin'
    ? { admin: true, role: 'admin', roles: ['admin'], stagingSmoke: true }
    : { stagingSmoke: true };

  await adminAuth.setCustomUserClaims(userRecord.uid, claims);
  const customToken = await adminAuth.createCustomToken(userRecord.uid, claims);
  const clientApp = initializeClientApp(
    firebaseConfig,
    `video-staging-${role}-${runId}`
  );
  const clientAuth = getClientAuth(clientApp);
  const credential = await signInWithCustomToken(clientAuth, customToken);

  return {
    uid: userRecord.uid,
    email,
    clientApp,
    clientAuth,
    user: credential.user,
    functions: getFunctions(clientApp, functionsRegion),
    storage: getClientStorage(clientApp),
  };
}

async function closeClient(client) {
  if (!client) {
    return;
  }

  await signOut(client.clientAuth).catch(() => undefined);
  await deleteClientApp(client.clientApp).catch(() => undefined);
}

async function cleanupOwnerResources({ db, bucket, adminAuth, ownerUid, jobIds }) {
  const deleted = {
    storageObjects: 0,
    dispatches: 0,
    deadLetters: 0,
    reservations: 0,
  };

  const [files] = await bucket.getFiles({ prefix: `users/${ownerUid}/` });
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  deleted.storageObjects = files.length;

  for (const jobId of jobIds) {
    deleted.dispatches += await deleteQuery(
      db.collection(DISPATCH_COLLECTION).where('jobId', '==', jobId)
    );
    deleted.deadLetters += await deleteQuery(
      db.collection(DEAD_LETTER_COLLECTION).where('jobId', '==', jobId)
    );
    await db.collection(JOB_COLLECTION).doc(jobId).delete().catch(() => undefined);
  }

  deleted.reservations += await deleteQuery(
    db.collection(RESERVATION_COLLECTION).where('ownerUid', '==', ownerUid)
  );
  await db.collection(CAPACITY_COLLECTION).doc(ownerUid).delete()
    .catch(() => undefined);
  await db.recursiveDelete(db.doc(`users/${ownerUid}`)).catch(() => undefined);
  await db.recursiveDelete(db.doc(`public_profiles/${ownerUid}`))
    .catch(() => undefined);
  await adminAuth.deleteUser(ownerUid).catch(() => undefined);

  return deleted;
}

async function runFormat({
  format,
  configuration,
  adminAuth,
  db,
  bucket,
  firebaseConfig,
  report,
}) {
  const formatRunId = `${format.name}-${randomUUID()}`;
  const startedAt = Date.now();
  const sourceBuffer = fs.readFileSync(format.filePath);
  const posterBuffer = fs.readFileSync(configuration.posterPath);
  const client = await createAuthenticatedClient({
    adminAuth,
    firebaseConfig,
    functionsRegion: configuration.functionsRegion,
    runId: formatRunId,
    role: 'owner',
  });
  const ownerUid = client.uid;
  const videoId = `staging-${format.name}-${randomUUID()}`;
  const jobId = `${ownerUid}_${videoId}`;
  const sourcePath =
    `users/${ownerUid}/uploads/videos/${videoId}.${format.extension}`;
  const posterPath =
    `users/${ownerUid}/uploads/video-posters/${videoId}/poster.jpg`;
  const result = {
    format: format.name,
    mimeType: format.mimeType,
    ownerUid,
    videoId,
    jobId,
    startedAt: new Date(startedAt).toISOString(),
    steps: [],
    terminalState: null,
    moderationStatus: null,
    dispatchStates: [],
  };
  let failed = false;

  const step = (name, details = null) => {
    result.steps.push({
      name,
      at: new Date().toISOString(),
      details,
    });
    console.log(`✔ [${format.name}] ${name}`);
  };

  try {
    assert.ok(sourceBuffer.byteLength > 0, 'Arquivo de vídeo está vazio.');
    assert.ok(sourceBuffer.byteLength <= 500 * 1024 * 1024);
    assert.ok(posterBuffer.byteLength > 0, 'Poster está vazio.');
    assert.ok(configuration.durationMs >= 5_000);

    await db.doc(`users/${ownerUid}`).set({
      uid: ownerUid,
      email: client.email,
      emailVerified: true,
      profileCompleted: true,
      accountStatus: 'active',
      loginAllowed: true,
      interactionBlocked: false,
      suspended: false,
      accountLocked: false,
      stagingSmoke: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, { merge: true });
    await db.doc(`public_profiles/${ownerUid}`).set({
      uid: ownerUid,
      nickname: `Homologação ${format.name.toUpperCase()}`,
      publicVisibility: 'visible',
      stagingSmoke: true,
      updatedAt: Date.now(),
    }, { merge: true });
    step('Conta efêmera elegível e perfil público criados.');

    const reservePrivateVideoUpload = httpsCallable(
      client.functions,
      'reservePrivateVideoUpload'
    );
    const reservationResponse = await reservePrivateVideoUpload({
      clientRequestId: formatRunId,
      ownerUid,
      videoId,
      videoStoragePath: sourcePath,
      posterStoragePath: posterPath,
      videoSizeBytes: sourceBuffer.byteLength,
      posterSizeBytes: posterBuffer.byteLength,
      mimeType: format.mimeType,
    });
    const reservation = reservationResponse.data;
    const reservationId = String(reservation?.reservationId ?? '').trim();
    assert.ok(reservationId, 'Reserva não retornou identificador.');
    assert.equal(reservation?.ownerUid, ownerUid);
    assert.equal(reservation?.videoId, videoId);
    assert.ok(Number(reservation?.expiresAt ?? 0) > Date.now());
    step('Quota reservada antes da transferência.', {
      reservationId,
      reservedBytes: Number(reservation?.reservedBytes ?? 0),
    });

    const uploadMetadata = {
      cacheControl: 'private, max-age=0, no-store, no-transform',
      customMetadata: {
        videoReservationId: reservationId,
        videoId,
      },
    };
    await uploadBytes(ref(client.storage, sourcePath), sourceBuffer, {
      ...uploadMetadata,
      contentType: format.mimeType,
    });
    await uploadBytes(ref(client.storage, posterPath), posterBuffer, {
      ...uploadMetadata,
      contentType: 'image/jpeg',
    });
    step('Vídeo e poster enviados pelas Storage Rules com reserva.');

    const registerPrivateVideoUpload = httpsCallable(
      client.functions,
      'registerPrivateVideoUpload'
    );
    const registrationResponse = await registerPrivateVideoUpload({
      ownerUid,
      videoId,
      reservationId,
      videoStoragePath: sourcePath,
      posterStoragePath: posterPath,
      fileName: path.basename(format.filePath),
      mimeType: format.mimeType,
      sizeBytes: sourceBuffer.byteLength,
      durationMs: configuration.durationMs,
      title: `Homologação ${format.name.toUpperCase()} ${formatRunId}`,
      description: 'Conteúdo técnico efêmero para validar o pipeline de staging.',
      reactionsEnabled: false,
      commentsEnabled: false,
      ratingsEnabled: false,
      publishWhenReady: false,
    });
    assert.equal(registrationResponse.data?.ownerUid, ownerUid);
    assert.equal(registrationResponse.data?.videoId, videoId);
    step('Upload registrado com publicação obrigatória.');

    const reservationRef = db.collection(RESERVATION_COLLECTION)
      .doc(reservationId);
    const privateVideoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const jobRef = db.collection(JOB_COLLECTION).doc(jobId);

    await waitFor(
      'consumo da reserva e criação do job',
      async () => ({
        reservation: await readDocument(reservationRef),
        video: await readDocument(privateVideoRef),
        job: await readDocument(jobRef),
      }),
      (value) =>
        value.reservation?.state === 'CONSUMED' &&
        value.video?.videoReservationId === reservationId &&
        !!value.job?.state,
      configuration
    );
    step('Reserva consumida e job persistido.');

    await waitFor(
      'primeiro despacho do Cloud Tasks',
      async () => {
        const snapshot = await db.collection(DISPATCH_COLLECTION)
          .where('jobId', '==', jobId)
          .get();
        return snapshot.docs.map((document) => document.data());
      },
      (items) => items.length > 0,
      configuration
    );
    step('Dispatcher orientado a eventos criou registro técnico.');

    const terminal = await waitFor(
      'estado terminal do processamento real',
      async () => ({
        job: await readDocument(jobRef),
        video: await readDocument(privateVideoRef),
      }),
      (value) => TERMINAL_JOB_STATES.has(String(value.job?.state ?? '')),
      configuration
    );
    result.terminalState = String(terminal.job.state ?? '');

    if (result.terminalState !== SUCCESS_JOB_STATE) {
      const code = String(terminal.job.lastErrorCode ?? 'PROCESSING_FAILED');
      const message = String(terminal.job.lastError ?? 'Falha sem detalhes.');
      throw new Error(`Processamento terminou em ${result.terminalState}: ${code} - ${message}`);
    }
    step('Google Transcoder concluiu o processamento.', {
      processingVersion: String(terminal.job.processingVersion ?? ''),
    });

    const published = await waitFor(
      'derivado, publicação e projeção pública',
      async () => ({
        video: await readDocument(privateVideoRef),
        publication: await readDocument(publicationRef),
        publicVideo: await readDocument(publicVideoRef),
      }),
      (value) =>
        value.video?.status === 'ready' &&
        !!value.video?.processedStoragePath &&
        value.publication?.isPublished === true &&
        ['PENDING_REVIEW', 'APPROVED'].includes(
          String(value.publicVideo?.moderationStatus ?? '')
        ),
      configuration
    );
    const processedStoragePath = String(
      published.video.processedStoragePath ?? ''
    );
    const processedMimeType = String(
      published.video.processedMimeType ?? published.video.mimeType ?? ''
    );
    assert.match(
      processedStoragePath,
      new RegExp(`^users/${ownerUid}/processed/videos/${videoId}/`)
    );
    assert.equal(
      ['video/mp4', 'video/webm'].includes(processedMimeType),
      true,
      `Derivado recebeu MIME inesperado: ${processedMimeType}.`
    );
    result.moderationStatus = String(
      published.publicVideo.moderationStatus ?? ''
    );
    step('Derivado reproduzível e publicação automática confirmados.', {
      processedMimeType,
      moderationStatus: result.moderationStatus,
    });

    const dispatchSnapshot = await db.collection(DISPATCH_COLLECTION)
      .where('jobId', '==', jobId)
      .get();
    result.dispatchStates = dispatchSnapshot.docs
      .map((document) => String(document.data().state ?? ''))
      .filter(Boolean);
    assert.equal(
      result.dispatchStates.includes('COMPLETED'),
      true,
      'Nenhum despacho COMPLETED foi registrado.'
    );
    step('Despacho COMPLETED confirmado.', {
      states: result.dispatchStates,
    });

    const deadLetterSnapshot = await db.collection(DEAD_LETTER_COLLECTION)
      .where('jobId', '==', jobId)
      .get();
    assert.equal(deadLetterSnapshot.empty, true, 'Job bem-sucedido apareceu na DLQ.');
    step('Ausência indevida de DLQ confirmada.');

    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.now() - startedAt;
    result.status = 'PASS';
    return result;
  } catch (error) {
    failed = true;
    result.status = 'FAIL';
    result.error = safeError(error);
    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.now() - startedAt;
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      smokeResult: result,
    });
  } finally {
    await closeClient(client);

    const shouldCleanup = configuration.cleanup &&
      !(failed && configuration.keepOnFailure);

    if (shouldCleanup) {
      result.cleanup = await cleanupOwnerResources({
        db,
        bucket,
        adminAuth,
        ownerUid,
        jobIds: [jobId],
      });
      console.log(`✔ [${format.name}] Recursos efêmeros removidos.`);
    } else {
      result.cleanup = { skipped: true };
      console.warn(
        `⚠ [${format.name}] Limpeza ignorada por configuração explícita.`
      );
    }
  }
}

async function main() {
  const configuration = buildConfiguration();
  const runId = randomUUID();
  const startedAt = Date.now();
  const report = {
    runId,
    projectId: configuration.projectId,
    storageBucket: configuration.storageBucket,
    functionsRegion: configuration.functionsRegion,
    startedAt: new Date(startedAt).toISOString(),
    formats: [],
    operationalStatus: null,
    cleanup: null,
    status: 'RUNNING',
  };
  const firebaseConfig = {
    apiKey: configuration.apiKey,
    appId: configuration.appId,
    authDomain: configuration.authDomain,
    projectId: configuration.projectId,
    storageBucket: configuration.storageBucket,
  };
  const adminApp = initializeAdminApp({
    credential: applicationDefault(),
    projectId: configuration.projectId,
    storageBucket: configuration.storageBucket,
  }, `video-staging-admin-sdk-${runId}`);
  const adminAuth = getAdminAuth(adminApp);
  const db = getAdminFirestore(adminApp);
  const bucket = getAdminStorage(adminApp).bucket(configuration.storageBucket);
  let observer = null;

  fs.mkdirSync(REPORT_DIRECTORY, { recursive: true });
  console.log(
    `[video:staging] Projeto confirmado: ${configuration.projectId}. ` +
      `Formatos: ${configuration.formats.map((item) => item.name).join(', ')}.`
  );

  try {
    observer = await createAuthenticatedClient({
      adminAuth,
      firebaseConfig,
      functionsRegion: configuration.functionsRegion,
      runId,
      role: 'admin',
    });

    for (const format of configuration.formats) {
      try {
        const formatResult = await runFormat({
          format,
          configuration,
          adminAuth,
          db,
          bucket,
          firebaseConfig,
          report,
        });
        report.formats.push(formatResult);
      } catch (error) {
        if (error?.smokeResult) {
          report.formats.push(error.smokeResult);
        }
        throw error;
      }
    }

    const getOperationalStatus = httpsCallable(
      observer.functions,
      'getVideoProcessingOperationalStatus'
    );
    const operationalResponse = await getOperationalStatus({});
    const operational = operationalResponse.data;
    assert.notEqual(operational?.state, 'EMULATOR');
    assert.equal(
      operational?.provider?.status,
      'READY',
      `Provider não está READY: ${JSON.stringify(operational?.provider ?? {})}`
    );
    assert.ok(Number(operational?.checkedAt ?? 0) > 0);
    assert.ok(Number(operational?.dispatch?.latencySampleSize ?? 0) > 0);
    report.operationalStatus = {
      state: operational.state,
      providerStatus: operational.provider.status,
      activeJobs: Number(operational.queue?.activeTotal ?? 0),
      staleJobs: Number(operational.queue?.staleSampledJobs ?? 0),
      pendingDispatches: Number(operational.dispatch?.pendingTotal ?? 0),
      p50LatencyMs: operational.dispatch?.p50LatencyMs ?? null,
      p95LatencyMs: operational.dispatch?.p95LatencyMs ?? null,
      recentDeadLetters: Number(operational.deadLetters?.recentTotal ?? 0),
      alertCodes: Array.isArray(operational.alerts)
        ? operational.alerts.map((alert) => String(alert.code ?? ''))
        : [],
    };
    console.log('✔ Painel operacional respondeu com provider READY.');

    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.error = safeError(error);
    throw error;
  } finally {
    if (observer) {
      await closeClient(observer);
      await adminAuth.deleteUser(observer.uid).catch(() => undefined);
      report.cleanup = { observerUserDeleted: true };
    }

    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    await deleteAdminApp(adminApp).catch(() => undefined);
    console.log(`[video:staging] Relatório: ${REPORT_PATH}`);
  }
}

main().catch((error) => {
  console.error('[video:staging] Smoke test falhou.', safeError(error));
  process.exitCode = 1;
});
