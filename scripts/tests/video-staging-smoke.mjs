// scripts/tests/video-staging-smoke.mjs
// -----------------------------------------------------------------------------
// Smoke test REAL do pipeline de vídeos em staging.
//
// Proteções:
// - exige confirmação explícita do projectId;
// - rejeita projeto sem a palavra staging;
// - usa um usuário efêmero por formato;
// - inicializa App Check no Node com CustomProvider e token Admin efêmero;
// - valida o painel antes de remover a telemetria do teste;
// - limpa Auth, Firestore, Storage e filas técnicas ao final;
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
  CustomProvider,
  getToken as getClientAppCheckToken,
  initializeAppCheck,
} from 'firebase/app-check';
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
import { getAppCheck as getAdminAppCheck } from 'firebase-admin/app-check';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';

const DISPATCH_COLLECTION = 'media_video_processing_dispatches';
const DEAD_LETTER_COLLECTION = 'media_video_processing_dead_letters';
const JOB_COLLECTION = 'media_video_processing_jobs';
const RESERVATION_COLLECTION = 'media_private_video_upload_reservations';
const CAPACITY_COLLECTION = 'media_private_video_upload_capacity';
const PRIVATE_UPLOAD_CLEANUP_COLLECTION =
  'media_private_video_upload_cleanup_jobs';
const PROCESSING_OUTPUT_CLEANUP_COLLECTION =
  'media_video_processing_output_cleanup_jobs';
const PUBLISHED_ASSET_CLEANUP_COLLECTION =
  'media_published_video_asset_cleanup_jobs';
const OWNER_TECHNICAL_CLEANUP_COLLECTIONS = [
  PRIVATE_UPLOAD_CLEANUP_COLLECTION,
  PROCESSING_OUTPUT_CLEANUP_COLLECTION,
  PUBLISHED_ASSET_CLEANUP_COLLECTION,
];
const TERMINAL_JOB_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5_000;
const APP_CHECK_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
const MAX_POSTER_BYTES = 5 * 1024 * 1024;
const MIN_SOURCE_DURATION_MS = 5_000;
const MAX_SOURCE_DURATION_MS = 60_000;
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

async function waitFor(label, readValue, predicate, options) {
  const deadline = Date.now() + options.timeoutMs;
  let lastValue = null;

  while (Date.now() < deadline) {
    lastValue = await readValue();

    if (predicate(lastValue)) {
      return lastValue;
    }

    await delay(options.intervalMs);
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

  return unique.map((name) => {
    const format = FORMAT_CONFIG[name];

    if (!format) {
      throw new Error(`Formato desconhecido: ${name}.`);
    }

    const filePath = path.resolve(requiredEnvironment(format.environmentVariable));

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`${format.environmentVariable} não aponta para um arquivo.`);
    }

    return { name, filePath, ...format };
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
    'Este script aceita somente projetos identificados como staging.'
  );
  assert.notEqual(
    projectId,
    'entretenimento-sexual',
    'O projeto de produção é proibido neste smoke test.'
  );
  assert.equal(
    storageBucket.startsWith(`${projectId}.`),
    true,
    'O bucket deve pertencer ao projeto confirmado.'
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
    durationMs: positiveIntegerEnvironment('VIDEO_STAGING_DURATION_MS', 6_000),
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

function createNodeAppCheckProvider(adminAppCheck, appId) {
  return new CustomProvider({
    getToken: async () => {
      const issuedAt = Date.now();
      const token = await adminAppCheck.createToken(appId, {
        ttlMillis: APP_CHECK_TOKEN_TTL_MS,
      });

      return {
        token: token.token,
        expireTimeMillis: issuedAt + token.ttlMillis,
      };
    },
  });
}

async function createAuthenticatedClient({
  adminAuth,
  adminAppCheck,
  firebaseConfig,
  functionsRegion,
  runId,
  role,
}) {
  const email = `video-staging-${role}-${runId}@example.test`;
  let userRecord = null;
  let clientApp = null;

  try {
    userRecord = await adminAuth.createUser({
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
    clientApp = initializeClientApp(
      firebaseConfig,
      `video-staging-${role}-${runId}`
    );
    const clientAppCheck = initializeAppCheck(clientApp, {
      provider: createNodeAppCheckProvider(adminAppCheck, firebaseConfig.appId),
      isTokenAutoRefreshEnabled: true,
    });

    await getClientAppCheckToken(clientAppCheck, true);

    const clientAuth = getClientAuth(clientApp);
    const credential = await signInWithCustomToken(clientAuth, customToken);

    return {
      uid: userRecord.uid,
      email,
      clientApp,
      clientAppCheck,
      clientAuth,
      functions: getFunctions(clientApp, functionsRegion),
      storage: getClientStorage(clientApp),
      user: credential.user,
    };
  } catch (error) {
    if (clientApp) {
      await deleteClientApp(clientApp).catch(() => undefined);
    }

    if (userRecord?.uid) {
      await adminAuth.deleteUser(userRecord.uid).catch(() => undefined);
    }

    throw error;
  }
}

async function closeClient(client) {
  if (!client) {
    return;
  }

  await signOut(client.clientAuth).catch(() => undefined);
  await deleteClientApp(client.clientApp).catch(() => undefined);
}

async function cleanupOwnerResources({ db, bucket, adminAuth, resource }) {
  const deleted = {
    storageObjects: 0,
    dispatches: 0,
    deadLetters: 0,
    reservations: 0,
    technicalCleanupJobs: {},
    jobDeleted: false,
    authUserDeleted: false,
  };

  const [files] = await bucket.getFiles({ prefix: `users/${resource.ownerUid}/` });
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  deleted.storageObjects = files.length;

  deleted.dispatches = await deleteQuery(
    db.collection(DISPATCH_COLLECTION).where('jobId', '==', resource.jobId)
  );
  deleted.deadLetters = await deleteQuery(
    db.collection(DEAD_LETTER_COLLECTION).where('jobId', '==', resource.jobId)
  );
  await db.collection(JOB_COLLECTION).doc(resource.jobId).delete();
  deleted.jobDeleted = true;

  deleted.reservations = await deleteQuery(
    db.collection(RESERVATION_COLLECTION)
      .where('ownerUid', '==', resource.ownerUid)
  );

  for (const collectionName of OWNER_TECHNICAL_CLEANUP_COLLECTIONS) {
    deleted.technicalCleanupJobs[collectionName] = await deleteQuery(
      db.collection(collectionName).where('ownerUid', '==', resource.ownerUid)
    );
  }

  await db.collection(CAPACITY_COLLECTION).doc(resource.ownerUid).delete()
    .catch((error) => {
      if (error?.code !== 5) {
        throw error;
      }
    });
  await db.recursiveDelete(db.doc(`users/${resource.ownerUid}`));
  await db.recursiveDelete(db.doc(`public_profiles/${resource.ownerUid}`));
  await adminAuth.deleteUser(resource.ownerUid);
  deleted.authUserDeleted = true;

  return deleted;
}

async function runFormat({
  format,
  configuration,
  adminAuth,
  adminAppCheck,
  db,
  firebaseConfig,
  resources,
}) {
  const formatRunId = `${format.name}-${randomUUID()}`;
  const startedAt = Date.now();
  const sourceBuffer = fs.readFileSync(format.filePath);
  const posterBuffer = fs.readFileSync(configuration.posterPath);
  const client = await createAuthenticatedClient({
    adminAuth,
    adminAppCheck,
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
  const resource = { ownerUid, videoId, jobId, format: format.name };
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
    cleanup: null,
  };

  resources.push({ ...resource, result });

  const step = (name, details = null) => {
    result.steps.push({ name, at: new Date().toISOString(), details });
    console.log(`✔ [${format.name}] ${name}`);
  };

  try {
    assert.ok(sourceBuffer.byteLength > 0, 'Arquivo de vídeo está vazio.');
    assert.ok(
      sourceBuffer.byteLength <= MAX_SOURCE_BYTES,
      'Arquivo de vídeo excede 80 MiB.'
    );
    assert.ok(posterBuffer.byteLength > 0, 'Poster está vazio.');
    assert.ok(
      posterBuffer.byteLength <= MAX_POSTER_BYTES,
      'Poster excede 5 MiB.'
    );
    assert.ok(
      configuration.durationMs >= MIN_SOURCE_DURATION_MS &&
        configuration.durationMs <= MAX_SOURCE_DURATION_MS,
      'Duração sintética deve ficar entre 5 e 60 segundos.'
    );

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
    step('Conta elegível e perfil público efêmeros criados.');

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
      sourceDurationMs: configuration.durationMs,
      mimeType: format.mimeType,
    });
    const reservation = reservationResponse.data;
    const reservationId = String(reservation?.reservationId ?? '').trim();
    assert.ok(reservationId, 'Reserva não retornou identificador.');
    assert.equal(reservation?.ownerUid, ownerUid);
    assert.equal(reservation?.videoId, videoId);
    assert.ok(Number(reservation?.expiresAt ?? 0) > Date.now());
    result.reservationId = reservationId;
    step('Quota reservada antes da transferência.', {
      reservationId,
      reservedBytes: Number(reservation?.reservedBytes ?? 0),
    });

    const uploadMetadata = {
      cacheControl: 'private, max-age=0, no-store, no-transform',
      customMetadata: { videoReservationId: reservationId, videoId },
    };
    await uploadBytes(ref(client.storage, sourcePath), sourceBuffer, {
      ...uploadMetadata,
      contentType: format.mimeType,
    });
    await uploadBytes(ref(client.storage, posterPath), posterBuffer, {
      ...uploadMetadata,
      contentType: 'image/jpeg',
    });
    step('Vídeo e poster autorizados pelas Storage Rules.');

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

    if (result.terminalState !== 'SUCCEEDED') {
      const code = String(terminal.job.lastErrorCode ?? 'PROCESSING_FAILED');
      const message = String(terminal.job.lastError ?? 'Falha sem detalhes.');
      throw new Error(
        `Processamento terminou em ${result.terminalState}: ${code} - ${message}`
      );
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
    step('Derivado e publicação automática confirmados.', {
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

    result.status = 'PASS';
    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.now() - startedAt;
    return result;
  } catch (error) {
    result.status = 'FAIL';
    result.error = safeError(error);
    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.now() - startedAt;
    throw Object.assign(
      error instanceof Error ? error : new Error(String(error)),
      { smokeResult: result }
    );
  } finally {
    await closeClient(client);
  }
}

async function validateOperationalPanel(observer, report) {
  const callable = httpsCallable(
    observer.functions,
    'getVideoProcessingOperationalStatus'
  );
  const response = await callable({});
  const status = response.data;

  assert.notEqual(status?.state, 'EMULATOR');
  assert.equal(
    status?.provider?.status,
    'READY',
    `Provider não está READY: ${JSON.stringify(status?.provider ?? {})}`
  );
  assert.ok(Number(status?.checkedAt ?? 0) > 0);
  assert.ok(
    Number(status?.dispatch?.latencySampleSize ?? 0) > 0,
    'O painel não encontrou amostra de latência antes da limpeza.'
  );

  report.operationalStatus = {
    state: status.state,
    providerStatus: status.provider.status,
    activeJobs: Number(status.queue?.activeTotal ?? 0),
    staleJobs: Number(status.queue?.staleSampledJobs ?? 0),
    pendingDispatches: Number(status.dispatch?.pendingTotal ?? 0),
    latencySampleSize: Number(status.dispatch?.latencySampleSize ?? 0),
    p50LatencyMs: status.dispatch?.p50LatencyMs ?? null,
    p95LatencyMs: status.dispatch?.p95LatencyMs ?? null,
    recentDeadLetters: Number(status.deadLetters?.recentTotal ?? 0),
    alertCodes: Array.isArray(status.alerts)
      ? status.alerts.map((alert) => String(alert.code ?? ''))
      : [],
  };
  console.log('✔ Painel operacional respondeu com provider READY.');
}

async function cleanupAll({
  configuration,
  report,
  resources,
  observer,
  db,
  bucket,
  adminAuth,
}) {
  const failedRun = report.status === 'FAIL';
  const shouldCleanupOwners = configuration.cleanup &&
    !(failedRun && configuration.keepOnFailure);
  const cleanupErrors = [];

  if (shouldCleanupOwners) {
    for (const resource of resources) {
      try {
        resource.result.cleanup = await cleanupOwnerResources({
          db,
          bucket,
          adminAuth,
          resource,
        });
        console.log(`✔ [${resource.format}] Recursos efêmeros removidos.`);
      } catch (error) {
        const normalized = safeError(error);
        resource.result.cleanup = { status: 'FAIL', error: normalized };
        cleanupErrors.push({ resource: resource.jobId, ...normalized });
      }
    }
  } else {
    resources.forEach((resource) => {
      resource.result.cleanup = { skipped: true };
    });
    console.warn('⚠ Limpeza dos usuários de mídia ignorada por configuração.');
  }

  if (observer) {
    await closeClient(observer);
    try {
      await adminAuth.deleteUser(observer.uid);
      report.observerCleanup = { authUserDeleted: true };
    } catch (error) {
      const normalized = safeError(error);
      report.observerCleanup = { authUserDeleted: false, error: normalized };
      cleanupErrors.push({ resource: observer.uid, ...normalized });
    }
  }

  if (cleanupErrors.length > 0) {
    report.cleanupErrors = cleanupErrors;
    report.status = 'FAIL';
    throw new Error(
      `A limpeza de staging falhou para ${cleanupErrors.length} recurso(s).`
    );
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
    status: 'RUNNING',
  };
  const resources = [];
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
  const adminAppCheck = getAdminAppCheck(adminApp);
  const db = getAdminFirestore(adminApp);
  const bucket = getAdminStorage(adminApp).bucket(configuration.storageBucket);
  let observer = null;
  let primaryError = null;

  fs.mkdirSync(REPORT_DIRECTORY, { recursive: true });
  console.log(
    `[video:staging] Projeto confirmado: ${configuration.projectId}. ` +
      `Formatos: ${configuration.formats.map((item) => item.name).join(', ')}.`
  );

  try {
    observer = await createAuthenticatedClient({
      adminAuth,
      adminAppCheck,
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
          adminAppCheck,
          db,
          firebaseConfig,
          resources,
        });
        report.formats.push(formatResult);
      } catch (error) {
        if (error?.smokeResult) {
          report.formats.push(error.smokeResult);
        }
        throw error;
      }
    }

    await validateOperationalPanel(observer, report);
    report.status = 'PASS';
  } catch (error) {
    primaryError = error;
    report.status = 'FAIL';
    report.error = safeError(error);
  }

  try {
    await cleanupAll({
      configuration,
      report,
      resources,
      observer,
      db,
      bucket,
      adminAuth,
    });
  } catch (cleanupError) {
    primaryError ??= cleanupError;
    report.error ??= safeError(cleanupError);
  } finally {
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    await deleteAdminApp(adminApp).catch(() => undefined);
    console.log(`[video:staging] Relatório: ${REPORT_PATH}`);
  }

  if (primaryError) {
    throw primaryError;
  }
}

main().catch((error) => {
  console.error('[video:staging] Smoke test falhou.', safeError(error));
  process.exitCode = 1;
});
