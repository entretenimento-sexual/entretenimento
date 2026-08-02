import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import { deletePublishedPhotoAssetOrQueue } from './published-photo-asset.service';
import { deletePublishedVideoAssetOrQueue } from './published-video-asset.service';
import {
  applyPrivateMediaDraftReservation,
  calculatePrivateMediaDraftExpiry,
  calculatePrivateMediaDraftReservationBytes,
  evaluatePrivateMediaDraftCapacity,
  getPrivateMediaDraftLimit,
  normalizePrivateMediaDraftUsage,
  PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION,
  PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
  releasePrivateMediaDraftReservation,
  resolvePrivateMediaDraftPlan,
  type PrivateMediaDraftKind,
  type PrivateMediaDraftPlan,
} from './private-media-draft.policy';
import {
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
} from './video-processing-job';
import {
  extractOwnedPrivateVideoPath,
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedProcessedVideoPrefix,
} from './video-storage-path';

interface PrivateMediaDraftCapacityRequest {
  kind?: unknown;
  sourceSizeBytes?: unknown;
  auxiliarySizeBytes?: unknown;
}

interface PrivateMediaDraftCapacityResponse {
  allowed: boolean;
  reason: 'ALLOWED' | 'ITEM_LIMIT' | 'BYTE_LIMIT';
  plan: PrivateMediaDraftPlan;
  expiresAfterMs: number;
  currentItems: number;
  currentReservedBytes: number;
  maxItems: number;
  maxReservedBytes: number;
  requestedReservedBytes: number;
}

interface PrivateDraftDocument {
  path?: unknown;
  url?: unknown;
  thumbnailPath?: unknown;
  thumbnailUrl?: unknown;
  sizeBytes?: unknown;
  processedOutputPrefix?: unknown;
  draftLifecycleVersion?: unknown;
  draftLifecycleState?: unknown;
  draftReservationActive?: unknown;
  draftReservationId?: unknown;
  draftReservedBytes?: unknown;
  draftExpiresAt?: unknown;
}

interface PublicationDocument {
  isPublished?: unknown;
  publishedStoragePath?: unknown;
  publishedPosterStoragePath?: unknown;
}

interface ProcessingJobDocument {
  state?: unknown;
  outputPrefix?: unknown;
}

interface DraftReservationResult {
  shouldDelete: boolean;
  rejectionReason: 'ITEM_LIMIT' | 'BYTE_LIMIT' | null;
}

interface DraftAssetSnapshot {
  sourcePath: string;
  sourceSizeBytes: number;
  auxiliaryPath: string | null;
  auxiliarySizeBytes: number;
}

const USAGE_COLLECTION = 'media_private_draft_usage';
const RELEASE_MARKERS_COLLECTION = 'media_private_draft_release_markers';
const CLEANUP_BATCH_SIZE = 40;
const RELEASE_MARKER_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_SIZE_BYTES = 500 * 1024 * 1024;
const VIDEO_POSTER_MAX_SIZE_BYTES = 10 * 1024 * 1024;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return '';
  }

  return normalized;
}

function normalizePositiveInteger(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed));
}

function normalizeKind(value: unknown): PrivateMediaDraftKind | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'photo' || normalized === 'video'
    ? normalized
    : null;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function usageReference(ownerUid: string) {
  return db.collection(USAGE_COLLECTION).doc(ownerUid);
}

function publicationReference(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string
) {
  const collection = kind === 'photo'
    ? 'photo_publications'
    : 'video_publications';
  return db.doc(`users/${ownerUid}/${collection}/${mediaId}`);
}

function privateMediaReference(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string
) {
  const collection = kind === 'photo' ? 'photos' : 'videos';
  return db.doc(`users/${ownerUid}/${collection}/${mediaId}`);
}

function publicMediaReference(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string
) {
  const collection = kind === 'photo' ? 'public_photos' : 'public_videos';
  return db.doc(`public_profiles/${ownerUid}/${collection}/${mediaId}`);
}

function reservationId(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string,
  eventId: string,
  now: number
): string {
  return createHash('sha256')
    .update(`${kind}:${ownerUid}:${mediaId}:${eventId}:${now}`)
    .digest('hex');
}

function releaseMarkerId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isPublished(value: unknown): boolean {
  return (value as PublicationDocument | null | undefined)?.isPublished === true;
}

async function readStorageSize(
  storagePath: string,
  maximumBytes: number,
  label: string
): Promise<number> {
  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new HttpsError(
      'failed-precondition',
      `${label} não foi encontrado no armazenamento.`
    );
  }

  const [metadata] = await file.getMetadata();
  const sizeBytes = normalizePositiveInteger(metadata.size);

  if (!sizeBytes || sizeBytes > maximumBytes) {
    throw new HttpsError(
      'failed-precondition',
      `${label} está vazio ou excede o limite permitido.`
    );
  }

  return sizeBytes;
}

async function resolveDraftAssets(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string,
  media: PrivateDraftDocument
): Promise<DraftAssetSnapshot> {
  if (kind === 'photo') {
    const sourcePath =
      extractOwnedPrivatePhotoPath(ownerUid, media.path) ??
      extractOwnedPrivatePhotoPath(ownerUid, media.url);

    if (!sourcePath) {
      throw new HttpsError(
        'failed-precondition',
        'A foto não possui um arquivo privado válido.'
      );
    }

    const persistedSize = normalizePositiveInteger(media.sizeBytes);
    const sourceSizeBytes = persistedSize || await readStorageSize(
      sourcePath,
      PHOTO_MAX_SIZE_BYTES,
      'A foto privada'
    );

    return {
      sourcePath,
      sourceSizeBytes,
      auxiliaryPath: null,
      auxiliarySizeBytes: 0,
    };
  }

  const sourcePath =
    extractOwnedPrivateVideoPathForId(ownerUid, mediaId, media.path) ??
    extractOwnedPrivateVideoPathForId(ownerUid, mediaId, media.url) ??
    extractOwnedPrivateVideoPath(ownerUid, media.path) ??
    extractOwnedPrivateVideoPath(ownerUid, media.url);

  if (!sourcePath) {
    throw new HttpsError(
      'failed-precondition',
      'O vídeo não possui um arquivo privado válido.'
    );
  }

  const persistedSize = normalizePositiveInteger(media.sizeBytes);
  const sourceSizeBytes = persistedSize || await readStorageSize(
    sourcePath,
    VIDEO_MAX_SIZE_BYTES,
    'O vídeo privado'
  );
  const auxiliaryPath =
    extractOwnedPrivateVideoPosterPath(ownerUid, mediaId, media.thumbnailPath) ??
    extractOwnedPrivateVideoPosterPath(ownerUid, mediaId, media.thumbnailUrl);
  const auxiliarySizeBytes = auxiliaryPath
    ? await readStorageSize(
      auxiliaryPath,
      VIDEO_POSTER_MAX_SIZE_BYTES,
      'A capa privada do vídeo'
    )
    : 0;

  return {
    sourcePath,
    sourceSizeBytes,
    auxiliaryPath,
    auxiliarySizeBytes,
  };
}

function capacityErrorMessage(
  kind: PrivateMediaDraftKind,
  reason: 'ITEM_LIMIT' | 'BYTE_LIMIT'
): string {
  const mediaLabel = kind === 'photo' ? 'fotos' : 'vídeos';

  return reason === 'ITEM_LIMIT'
    ? `Você atingiu o limite de rascunhos de ${mediaLabel}. Publique ou exclua um rascunho antes de enviar outro.`
    : `Seus rascunhos de ${mediaLabel} atingiram o limite de armazenamento temporário.`;
}

async function reserveDraft(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string,
  eventId: string,
  enforceLimits: boolean
): Promise<DraftReservationResult> {
  const mediaRef = privateMediaReference(kind, ownerUid, mediaId);
  const publicationRef = publicationReference(kind, ownerUid, mediaId);
  const userRef = db.doc(`users/${ownerUid}`);
  const usageRef = usageReference(ownerUid);
  const initialMediaSnapshot = await mediaRef.get();

  if (!initialMediaSnapshot.exists) {
    return { shouldDelete: false, rejectionReason: null };
  }

  const media = initialMediaSnapshot.data() as PrivateDraftDocument;
  const assets = await resolveDraftAssets(kind, ownerUid, mediaId, media);
  const now = Date.now();
  const reservedBytes = calculatePrivateMediaDraftReservationBytes(
    kind,
    assets.sourceSizeBytes,
    assets.auxiliarySizeBytes
  );

  return db.runTransaction(async (transaction) => {
    const [currentMediaSnapshot, publicationSnapshot, userSnapshot, usageSnapshot] =
      await Promise.all([
        transaction.get(mediaRef),
        transaction.get(publicationRef),
        transaction.get(userRef),
        transaction.get(usageRef),
      ]);

    if (!currentMediaSnapshot.exists) {
      return { shouldDelete: false, rejectionReason: null };
    }

    const currentMedia = currentMediaSnapshot.data() as PrivateDraftDocument;

    if (currentMedia.draftReservationActive === true) {
      return { shouldDelete: false, rejectionReason: null };
    }

    if (isPublished(publicationSnapshot.data())) {
      transaction.set(
        mediaRef,
        {
          draftLifecycleVersion: PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION,
          draftLifecycleState: 'PUBLISHED',
          draftReservationActive: false,
          draftExpiresAt: FieldValue.delete(),
          draftUpdatedAt: now,
          sizeBytes: assets.sourceSizeBytes,
        },
        { merge: true }
      );
      return { shouldDelete: false, rejectionReason: null };
    }

    const plan = resolvePrivateMediaDraftPlan(
      userSnapshot.exists ? userSnapshot.data() : null,
      now
    );
    const usage = normalizePrivateMediaDraftUsage(
      usageSnapshot.exists ? usageSnapshot.data() : null
    );
    const decision = evaluatePrivateMediaDraftCapacity(
      kind,
      plan,
      usage,
      reservedBytes
    );

    if (enforceLimits && !decision.allowed) {
      transaction.set(
        mediaRef,
        {
          draftLifecycleVersion: PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION,
          draftLifecycleState: 'EXPIRING',
          draftReservationActive: false,
          draftRejectedReason: decision.reason,
          draftRejectedMessage: capacityErrorMessage(kind, decision.reason),
          draftPlanAtReservation: plan,
          draftReservedBytes: reservedBytes,
          draftExpiresAt: now,
          draftUpdatedAt: now,
          sizeBytes: assets.sourceSizeBytes,
        },
        { merge: true }
      );

      return {
        shouldDelete: true,
        rejectionReason: decision.reason,
      };
    }

    const expiresAt = calculatePrivateMediaDraftExpiry(kind, plan, now);
    const nextUsage = applyPrivateMediaDraftReservation(
      kind,
      usage,
      reservedBytes
    );

    transaction.set(
      usageRef,
      {
        ...nextUsage,
        version: PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
        updatedAt: now,
      },
      { merge: true }
    );
    transaction.set(
      mediaRef,
      {
        draftLifecycleVersion: PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION,
        draftLifecycleState: 'ACTIVE',
        draftReservationActive: true,
        draftReservationId: reservationId(
          kind,
          ownerUid,
          mediaId,
          eventId,
          now
        ),
        draftRejectedReason: FieldValue.delete(),
        draftRejectedMessage: FieldValue.delete(),
        draftPlanAtReservation: plan,
        draftReservedBytes: reservedBytes,
        draftExpiresAt: expiresAt,
        draftUpdatedAt: now,
        sizeBytes: assets.sourceSizeBytes,
      },
      { merge: true }
    );

    return { shouldDelete: false, rejectionReason: null };
  });
}

async function releaseLiveDraftReservation(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string,
  nextState: 'PUBLISHED' | 'EXPIRING'
): Promise<boolean> {
  const mediaRef = privateMediaReference(kind, ownerUid, mediaId);
  const usageRef = usageReference(ownerUid);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const [mediaSnapshot, usageSnapshot] = await Promise.all([
      transaction.get(mediaRef),
      transaction.get(usageRef),
    ]);

    if (!mediaSnapshot.exists) {
      return false;
    }

    const media = mediaSnapshot.data() as PrivateDraftDocument;

    if (media.draftReservationActive !== true) {
      transaction.set(
        mediaRef,
        {
          draftLifecycleVersion: PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION,
          draftLifecycleState: nextState,
          draftExpiresAt: nextState === 'PUBLISHED'
            ? FieldValue.delete()
            : media.draftExpiresAt ?? now,
          draftUpdatedAt: now,
        },
        { merge: true }
      );
      return false;
    }

    const usage = normalizePrivateMediaDraftUsage(
      usageSnapshot.exists ? usageSnapshot.data() : null
    );
    const reservedBytes = normalizePositiveInteger(media.draftReservedBytes);
    const nextUsage = releasePrivateMediaDraftReservation(
      kind,
      usage,
      reservedBytes
    );

    transaction.set(
      usageRef,
      {
        ...nextUsage,
        version: PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
        updatedAt: now,
      },
      { merge: true }
    );
    transaction.set(
      mediaRef,
      {
        draftLifecycleVersion: PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION,
        draftLifecycleState: nextState,
        draftReservationActive: false,
        draftExpiresAt: nextState === 'PUBLISHED'
          ? FieldValue.delete()
          : media.draftExpiresAt ?? now,
        draftUpdatedAt: now,
      },
      { merge: true }
    );

    return true;
  });
}

async function releaseDeletedDraftReservation(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string,
  media: PrivateDraftDocument
): Promise<void> {
  if (media.draftReservationActive !== true) {
    return;
  }

  const draftReservationId = String(media.draftReservationId ?? '').trim();

  if (!draftReservationId) {
    logger.error('[privateMediaDraft] Reserva ativa sem identificador.', {
      kind,
      ownerUid,
      mediaId,
    });
    return;
  }

  const usageRef = usageReference(ownerUid);
  const markerRef = db
    .collection(RELEASE_MARKERS_COLLECTION)
    .doc(releaseMarkerId(draftReservationId));
  const now = Date.now();

  await db.runTransaction(async (transaction) => {
    const [usageSnapshot, markerSnapshot] = await Promise.all([
      transaction.get(usageRef),
      transaction.get(markerRef),
    ]);

    if (markerSnapshot.exists) {
      return;
    }

    const usage = normalizePrivateMediaDraftUsage(
      usageSnapshot.exists ? usageSnapshot.data() : null
    );
    const nextUsage = releasePrivateMediaDraftReservation(
      kind,
      usage,
      media.draftReservedBytes
    );

    transaction.set(
      usageRef,
      {
        ...nextUsage,
        version: PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
        updatedAt: now,
      },
      { merge: true }
    );
    transaction.create(markerRef, {
      ownerUid,
      mediaId,
      kind,
      draftReservationId,
      releasedAt: now,
      expiresAt: now + RELEASE_MARKER_RETENTION_MS,
    });
  });
}

async function cleanupPhotoDraft(
  ownerUid: string,
  photoId: string,
  photo: PrivateDraftDocument
): Promise<void> {
  const storagePath =
    extractOwnedPrivatePhotoPath(ownerUid, photo.path) ??
    extractOwnedPrivatePhotoPath(ownerUid, photo.url);

  if (!storagePath) {
    throw new Error('Rascunho de foto sem path privado válido.');
  }

  const publicationRef = publicationReference('photo', ownerUid, photoId);
  const publicPhotoRef = publicMediaReference('photo', ownerUid, photoId);
  const publicationSnapshot = await publicationRef.get();
  const publication = publicationSnapshot.exists
    ? publicationSnapshot.data() as PublicationDocument
    : null;

  if (isPublished(publication)) {
    await releaseLiveDraftReservation('photo', ownerUid, photoId, 'PUBLISHED');
    return;
  }

  await storage.bucket().file(storagePath).delete({ ignoreNotFound: true });
  await deletePublishedPhotoAssetOrQueue({
    ownerUid,
    photoId,
    storagePath: String(publication?.publishedStoragePath ?? '').trim() || null,
    reason: 'expired-private-photo-draft',
  });

  const batch = db.batch();
  batch.delete(publicationRef);
  batch.delete(publicPhotoRef);
  await batch.commit();
  await db.recursiveDelete(privateMediaReference('photo', ownerUid, photoId));
}

async function cleanupVideoDraft(
  ownerUid: string,
  videoId: string,
  video: PrivateDraftDocument
): Promise<void> {
  const sourcePath =
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url) ??
    extractOwnedPrivateVideoPath(ownerUid, video.path) ??
    extractOwnedPrivateVideoPath(ownerUid, video.url);

  if (!sourcePath) {
    throw new Error('Rascunho de vídeo sem path privado válido.');
  }

  const posterPath =
    extractOwnedPrivateVideoPosterPath(ownerUid, videoId, video.thumbnailPath) ??
    extractOwnedPrivateVideoPosterPath(ownerUid, videoId, video.thumbnailUrl);
  const publicationRef = publicationReference('video', ownerUid, videoId);
  const publicVideoRef = publicMediaReference('video', ownerUid, videoId);
  const processingJobRef = db
    .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .doc(buildVideoProcessingJobId(ownerUid, videoId));
  const [publicationSnapshot, processingJobSnapshot] = await Promise.all([
    publicationRef.get(),
    processingJobRef.get(),
  ]);
  const publication = publicationSnapshot.exists
    ? publicationSnapshot.data() as PublicationDocument
    : null;

  if (isPublished(publication)) {
    await releaseLiveDraftReservation('video', ownerUid, videoId, 'PUBLISHED');
    return;
  }

  const processingJob = processingJobSnapshot.exists
    ? processingJobSnapshot.data() as ProcessingJobDocument
    : null;
  const now = Date.now();
  const processingState = String(processingJob?.state ?? '').trim().toUpperCase();

  if (
    processingJob &&
    processingState !== 'CANCELLED' &&
    processingState !== 'CANCEL_REQUESTED'
  ) {
    await processingJobRef.set(
      {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: now,
        leaseUntil: null,
        updatedAt: now,
        lastErrorCode: 'PRIVATE_VIDEO_DRAFT_EXPIRED',
        lastError: 'O rascunho privado expirou antes da publicação.',
      },
      { merge: true }
    );
  }

  const processedPrefix =
    normalizeOwnedProcessedVideoPrefix(
      ownerUid,
      videoId,
      video.processedOutputPrefix
    ) ??
    normalizeOwnedProcessedVideoPrefix(
      ownerUid,
      videoId,
      processingJob?.outputPrefix
    );
  const deleteTasks: Promise<unknown>[] = [
    storage.bucket().file(sourcePath).delete({ ignoreNotFound: true }),
  ];

  if (posterPath) {
    deleteTasks.push(
      storage.bucket().file(posterPath).delete({ ignoreNotFound: true })
    );
  }

  if (processedPrefix) {
    const [processedFiles] = await storage.bucket().getFiles({
      prefix: processedPrefix,
    });
    deleteTasks.push(...processedFiles.map((file) =>
      file.delete({ ignoreNotFound: true })
    ));
  }

  await Promise.all(deleteTasks);
  await Promise.all([
    deletePublishedVideoAssetOrQueue({
      ownerUid,
      videoId,
      storagePath: String(publication?.publishedStoragePath ?? '').trim() || null,
      assetKind: 'video',
      reason: 'expired-private-video-draft',
    }),
    deletePublishedVideoAssetOrQueue({
      ownerUid,
      videoId,
      storagePath:
        String(publication?.publishedPosterStoragePath ?? '').trim() || null,
      assetKind: 'poster',
      reason: 'expired-private-video-poster-draft',
    }),
  ]);

  const batch = db.batch();
  batch.delete(publicationRef);
  batch.delete(publicVideoRef);
  await batch.commit();
  await db.recursiveDelete(privateMediaReference('video', ownerUid, videoId));
}

async function cleanupDraftDocument(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string
): Promise<void> {
  const mediaRef = privateMediaReference(kind, ownerUid, mediaId);
  const mediaSnapshot = await mediaRef.get();

  if (!mediaSnapshot.exists) {
    return;
  }

  const publicationSnapshot = await publicationReference(
    kind,
    ownerUid,
    mediaId
  ).get();

  if (isPublished(publicationSnapshot.data())) {
    await releaseLiveDraftReservation(kind, ownerUid, mediaId, 'PUBLISHED');
    return;
  }

  await releaseLiveDraftReservation(kind, ownerUid, mediaId, 'EXPIRING');
  const refreshedSnapshot = await mediaRef.get();

  if (!refreshedSnapshot.exists) {
    return;
  }

  const media = refreshedSnapshot.data() as PrivateDraftDocument;

  if (kind === 'photo') {
    await cleanupPhotoDraft(ownerUid, mediaId, media);
  } else {
    await cleanupVideoDraft(ownerUid, mediaId, media);
  }
}

async function initializeDraftLifecycle(
  kind: PrivateMediaDraftKind,
  ownerUidValue: unknown,
  mediaIdValue: unknown,
  eventId: string
): Promise<void> {
  const ownerUid = cleanId(ownerUidValue);
  const mediaId = cleanId(mediaIdValue);

  if (!ownerUid || !mediaId) {
    logger.error('[privateMediaDraft] Evento de criação inválido.', {
      kind,
    });
    return;
  }

  const result = await reserveDraft(
    kind,
    ownerUid,
    mediaId,
    eventId,
    true
  );

  if (result.shouldDelete) {
    logger.warn('[privateMediaDraft] Upload rejeitado pela quota.', {
      kind,
      ownerUid,
      mediaId,
      reason: result.rejectionReason,
    });
    await cleanupDraftDocument(kind, ownerUid, mediaId);
  }
}

async function handlePublicationTransition(
  kind: PrivateMediaDraftKind,
  ownerUidValue: unknown,
  mediaIdValue: unknown,
  before: PublicationDocument | null,
  after: PublicationDocument | null,
  eventId: string
): Promise<void> {
  const ownerUid = cleanId(ownerUidValue);
  const mediaId = cleanId(mediaIdValue);

  if (!ownerUid || !mediaId) {
    return;
  }

  const wasPublished = isPublished(before);
  const isNowPublished = isPublished(after);

  if (!wasPublished && isNowPublished) {
    await releaseLiveDraftReservation(kind, ownerUid, mediaId, 'PUBLISHED');
    return;
  }

  if (wasPublished && !isNowPublished && after !== null) {
    await reserveDraft(kind, ownerUid, mediaId, eventId, false);
  }
}

async function cleanupExpiredDraftCollection(
  kind: PrivateMediaDraftKind,
  now: number
): Promise<void> {
  const collection = kind === 'photo' ? 'photos' : 'videos';
  const snapshot = await db
    .collectionGroup(collection)
    .where(
      'draftLifecycleVersion',
      '==',
      PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION
    )
    .where('draftExpiresAt', '<=', now)
    .limit(CLEANUP_BATCH_SIZE)
    .get();

  for (const document of snapshot.docs) {
    const segments = document.ref.path.split('/');
    const ownerUid = cleanId(segments[1]);
    const mediaId = cleanId(segments[3]);

    if (
      segments.length !== 4 ||
      segments[0] !== 'users' ||
      segments[2] !== collection ||
      !ownerUid ||
      !mediaId
    ) {
      logger.error('[privateMediaDraft] Documento expirado inválido.', {
        kind,
        path: document.ref.path,
      });
      continue;
    }

    try {
      await cleanupDraftDocument(kind, ownerUid, mediaId);
    } catch (error) {
      logger.error('[privateMediaDraft] Falha ao limpar rascunho expirado.', {
        kind,
        ownerUid,
        mediaId,
        error: normalizeErrorMessage(error),
      });
    }
  }
}

async function cleanupReleaseMarkers(now: number): Promise<void> {
  const snapshot = await db
    .collection(RELEASE_MARKERS_COLLECTION)
    .where('expiresAt', '<=', now)
    .limit(CLEANUP_BATCH_SIZE)
    .get();

  if (snapshot.empty) {
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((document) => batch.delete(document.ref));
  await batch.commit();
}

export const getPrivateMediaDraftCapacity = onCall<
  PrivateMediaDraftCapacityRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PrivateMediaDraftCapacityResponse> => {
    const ownerUid = cleanId(request.auth?.uid);
    const kind = normalizeKind(request.data?.kind);

    if (!ownerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!kind) {
      throw new HttpsError('invalid-argument', 'Tipo de mídia inválido.');
    }

    const sourceSizeBytes = normalizePositiveInteger(
      request.data?.sourceSizeBytes
    );
    const auxiliarySizeBytes = normalizePositiveInteger(
      request.data?.auxiliarySizeBytes
    );

    if (!sourceSizeBytes) {
      throw new HttpsError(
        'invalid-argument',
        'Informe o tamanho do arquivo antes do upload.'
      );
    }

    const maximumSourceSize = kind === 'photo'
      ? PHOTO_MAX_SIZE_BYTES
      : VIDEO_MAX_SIZE_BYTES;

    if (sourceSizeBytes > maximumSourceSize) {
      throw new HttpsError(
        'invalid-argument',
        'O arquivo excede o limite permitido para upload.'
      );
    }

    const [userSnapshot, usageSnapshot] = await Promise.all([
      db.doc(`users/${ownerUid}`).get(),
      usageReference(ownerUid).get(),
    ]);
    const now = Date.now();
    const plan = resolvePrivateMediaDraftPlan(
      userSnapshot.exists ? userSnapshot.data() : null,
      now
    );
    const reservedBytes = calculatePrivateMediaDraftReservationBytes(
      kind,
      sourceSizeBytes,
      auxiliarySizeBytes
    );
    const decision = evaluatePrivateMediaDraftCapacity(
      kind,
      plan,
      usageSnapshot.exists ? usageSnapshot.data() : null,
      reservedBytes
    );
    const limit = getPrivateMediaDraftLimit(kind, plan);

    return {
      allowed: decision.allowed,
      reason: decision.reason,
      plan,
      expiresAfterMs: limit.retentionMs,
      currentItems: decision.currentItems,
      currentReservedBytes: decision.currentReservedBytes,
      maxItems: limit.maxItems,
      maxReservedBytes: limit.maxReservedBytes,
      requestedReservedBytes: reservedBytes,
    };
  }
);

export const initializePrivatePhotoDraftLifecycle = onDocumentCreated(
  {
    region: FUNCTIONS_REGION,
    document: 'users/{ownerUid}/photos/{photoId}',
    retry: true,
  },
  async (event) => {
    await initializeDraftLifecycle(
      'photo',
      event.params.ownerUid,
      event.params.photoId,
      event.id
    );
  }
);

export const initializePrivateVideoDraftLifecycle = onDocumentCreated(
  {
    region: FUNCTIONS_REGION,
    document: 'users/{ownerUid}/videos/{videoId}',
    retry: true,
  },
  async (event) => {
    await initializeDraftLifecycle(
      'video',
      event.params.ownerUid,
      event.params.videoId,
      event.id
    );
  }
);

export const syncPhotoDraftLifecycleFromPublication = onDocumentWritten(
  {
    region: FUNCTIONS_REGION,
    document: 'users/{ownerUid}/photo_publications/{photoId}',
    retry: true,
  },
  async (event) => {
    await handlePublicationTransition(
      'photo',
      event.params.ownerUid,
      event.params.photoId,
      event.data?.before.exists
        ? event.data.before.data() as PublicationDocument
        : null,
      event.data?.after.exists
        ? event.data.after.data() as PublicationDocument
        : null,
      event.id
    );
  }
);

export const syncVideoDraftLifecycleFromPublication = onDocumentWritten(
  {
    region: FUNCTIONS_REGION,
    document: 'users/{ownerUid}/video_publications/{videoId}',
    retry: true,
  },
  async (event) => {
    await handlePublicationTransition(
      'video',
      event.params.ownerUid,
      event.params.videoId,
      event.data?.before.exists
        ? event.data.before.data() as PublicationDocument
        : null,
      event.data?.after.exists
        ? event.data.after.data() as PublicationDocument
        : null,
      event.id
    );
  }
);

export const releaseDeletedPrivatePhotoDraftUsage = onDocumentDeleted(
  {
    region: FUNCTIONS_REGION,
    document: 'users/{ownerUid}/photos/{photoId}',
    retry: true,
  },
  async (event) => {
    if (!event.data) {
      return;
    }

    await releaseDeletedDraftReservation(
      'photo',
      cleanId(event.params.ownerUid),
      cleanId(event.params.photoId),
      event.data.data() as PrivateDraftDocument
    );
  }
);

export const releaseDeletedPrivateVideoDraftUsage = onDocumentDeleted(
  {
    region: FUNCTIONS_REGION,
    document: 'users/{ownerUid}/videos/{videoId}',
    retry: true,
  },
  async (event) => {
    if (!event.data) {
      return;
    }

    await releaseDeletedDraftReservation(
      'video',
      cleanId(event.params.ownerUid),
      cleanId(event.params.videoId),
      event.data.data() as PrivateDraftDocument
    );
  }
);

export const cleanupExpiredPrivateMediaDrafts = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const now = Date.now();

    await cleanupExpiredDraftCollection('photo', now);
    await cleanupExpiredDraftCollection('video', now);
    await cleanupReleaseMarkers(now);
  }
);
