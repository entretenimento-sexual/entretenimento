import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, getDefaultStorageBucket } from '../../firebaseApp';
import {
  assertCallableAppCheck, REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import { assertMediaAuthoringEligibility } from './media-authoring-eligibility.service';
import { IMAGE_INPUT_MIME_TYPES, IMAGE_MAX_BYTES } from '../media-format.generated';
import {
  extractOwnedPrivatePhotoPath, normalizeOwnedPublishedPhotoPath,
} from './photo-storage-path';
import {
  copyPrivatePhotoToPublishedAsset, deletePublishedPhotoAssetOrQueue,
} from './published-photo-asset.service';
import { normalizeGcsGeneration, deleteGenerationPinnedVideoFile } from
  './video-deletion-storage-pages';
import { buildUnassessedPhotoScoreBreakdown } from
  './photo-publication-moderation.policy';
import { buildUnassessedMediaContentSafetyAssessment } from
  './media-content-safety-assessment.policy';

import { logPhotoOperation } from './photo-operation-telemetry';

interface ReplacePublishedPhotoRequest {
  ownerUid?: unknown;
  photoId?: unknown;
  sourceStoragePath?: unknown;
  reservationId?: unknown;
  expectedAssetVersion?: unknown;
}
interface Reservation {
  ownerUid?: unknown;
  storagePath?: unknown;
  sizeBytes?: unknown;
  contentType?: unknown;
  expiresAt?: unknown;
  consumedAt?: unknown;
}
interface Publication {
  ownerUid?: unknown;
  photoId?: unknown;
  isPublished?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
  publishedStoragePath?: unknown;
}
interface Projection {
  ownerUid?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
  assetVersion?: unknown;
  publishedAt?: unknown;
}
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const REGISTERED_FORMATS = new Set<string>(IMAGE_INPUT_MIME_TYPES);
const RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000, burstMax: 6,
  sustainedWindowMs: 600_000, sustainedMax: 20,
});
function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return SAFE_ID.test(normalized) ? normalized : '';
}
function expiresAtMs(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  return typeof (value as { toMillis?: () => number } | null)?.toMillis === 'function'
    ? Number((value as { toMillis: () => number }).toMillis()) : 0;
}
function validVisibility(value: unknown): boolean {
  return value === 'PUBLIC' || value === 'FRIENDS';
}
function revision(projection: Projection): number {
  return Number(projection.assetVersion ?? projection.publishedAt);
}
export function canReplacePublishedPhoto(
  ownerUid: string,
  photoId: string,
  expectedRevision: number,
  publication: Publication | null,
  projection: Projection | null,
  previousPath?: string
): boolean {
  return !!publication && !!projection &&
    publication.ownerUid === ownerUid &&
    publication.photoId === photoId &&
    projection.ownerUid === ownerUid &&
    publication.isPublished === true &&
    validVisibility(publication.visibility) &&
    publication.visibility === projection.visibility &&
    publication.moderationStatus === 'APPROVED' &&
    projection.moderationStatus === 'APPROVED' &&
    Number.isSafeInteger(expectedRevision) &&
    revision(projection) === expectedRevision &&
    !!normalizeOwnedPublishedPhotoPath(
      ownerUid, photoId, publication.publishedStoragePath
    ) &&
    (!previousPath || publication.publishedStoragePath === previousPath);
}

/** A reservation authorizes one temporary upload, never a personal archive. */
export const replacePublishedPhoto = onCall<ReplacePublishedPhotoRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request) => {
    assertCallableAppCheck(request.app);
    const ownerUid = cleanId(request.auth?.uid);
    const requestedOwner = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);
    const reservationId = String(request.data?.reservationId ?? '').trim();
    const sourcePath = extractOwnedPrivatePhotoPath(
      ownerUid, request.data?.sourceStoragePath
    );
    const expectedRevision = Number(request.data?.expectedAssetVersion);

    if (!ownerUid) throw new HttpsError('unauthenticated', 'Sessão encerrada.');
    if (!requestedOwner || ownerUid !== requestedOwner) {
      throw new HttpsError('permission-denied', 'Foto indisponível.');
    }
    if (!photoId || !sourcePath || !/^[a-f0-9]{64}$/i.test(reservationId) ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
      throw new HttpsError('invalid-argument', 'Substituição inválida.');
    }

    await consumeBackendRateLimitQuota({
      action: 'replace-published-photo',
      subject: ownerUid,
      config: RATE_LIMIT,
      message: 'Muitas substituições de fotos foram solicitadas.',
    });
    await assertMediaAuthoringEligibility(ownerUid);

    const publicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const projectionRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const reservationRef = db.collection('media_photo_upload_reservations')
      .doc(reservationId);
    const deletionRef = db.collection('media_photo_deletion_jobs')
      .doc(`${ownerUid}_${photoId}`);

    const [publicationSnap, projectionSnap, reservationSnap, deletionSnap] =
      await Promise.all([
        publicationRef.get(), projectionRef.get(), reservationRef.get(),
        deletionRef.get(),
      ]);
    const publication = publicationSnap.exists
      ? publicationSnap.data() as Publication : null;
    const projection = projectionSnap.exists
      ? projectionSnap.data() as Projection : null;
    if (deletionSnap.exists || !canReplacePublishedPhoto(
      ownerUid, photoId, expectedRevision, publication, projection
    )) {
      throw new HttpsError('failed-precondition',
        'Esta foto foi alterada, removida ou está em revisão. Atualize a galeria.');
    }
    const reservation = reservationSnap.exists
      ? reservationSnap.data() as Reservation : null;
    const sizeBytes = Number(reservation?.sizeBytes);
    const contentType = String(reservation?.contentType ?? '').toLowerCase();
    if (!reservation || reservation.consumedAt ||
        reservation.ownerUid !== ownerUid ||
        reservation.storagePath !== sourcePath ||
        expiresAtMs(reservation.expiresAt) <= Date.now() ||
        !REGISTERED_FORMATS.has(contentType) ||
        !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 ||
        sizeBytes > IMAGE_MAX_BYTES) {
      throw new HttpsError('failed-precondition',
        'O upload temporário não possui reserva válida.');
    }

    // A reserva de substituição não pode ser também o acervo técnico de outra
    // publicação. O registro privado consome a mesma reserva transacionalmente.
    const privateReferences = await db
      .collection(`users/${ownerUid}/photos`)
      .where('path', '==', sourcePath).limit(1).get();
    if (!privateReferences.empty) {
      throw new HttpsError('failed-precondition',
        'O upload já está associado a outra operação de mídia.');
    }

    const sourceFile = getDefaultStorageBucket().file(sourcePath);
    const [metadata] = await sourceFile.getMetadata();
    const sourceGeneration = normalizeGcsGeneration(metadata.generation);
    if (!sourceGeneration ||
        metadata.metadata?.['mediaPhotoReservationId'] !== reservationId ||
        String(metadata.contentType ?? '').toLowerCase() !== contentType ||
        Number(metadata.size) !== sizeBytes) {
      throw new HttpsError('failed-precondition',
        'Os bytes do upload não correspondem à reserva validada.');
    }

    const previousPath = String(publication?.publishedStoragePath ?? '');
    const startedAt = Date.now();
    let candidatePath = '';
    let committed = false;
    let committedVersion = 0;
    try {
      candidatePath = await copyPrivatePhotoToPublishedAsset({
        ownerUid, photoId, sourceStoragePath: sourcePath,
      });

      // The staging object must still be the exact reserved generation, not
      // a different upload at the same path during the sanitization copy.
      const [freshSourceMetadata] = await sourceFile.getMetadata();
      if (normalizeGcsGeneration(freshSourceMetadata.generation) !== sourceGeneration) {
        throw new HttpsError('aborted', 'O upload mudou durante a preparação.');
      }

      await db.runTransaction(async (tx) => {
        const [currentPublication, currentProjection, currentReservation,
          currentDeletion] = await Promise.all([
          tx.get(publicationRef), tx.get(projectionRef),
          tx.get(reservationRef), tx.get(deletionRef),
        ]);
        const currentReservationData = currentReservation.exists
          ? currentReservation.data() as Reservation : null;
        if (currentDeletion.exists ||
            !canReplacePublishedPhoto(
              ownerUid, photoId, expectedRevision,
              currentPublication.exists
                ? currentPublication.data() as Publication : null,
              currentProjection.exists
                ? currentProjection.data() as Projection : null,
              previousPath
            ) ||
            !currentReservationData ||
            currentReservationData.consumedAt ||
            currentReservationData.ownerUid !== ownerUid ||
            currentReservationData.storagePath !== sourcePath ||
            expiresAtMs(currentReservationData.expiresAt) <= Date.now()) {
          throw new HttpsError('aborted',
            'Outra atualização mudou a publicação ou o upload temporário.');
        }
        const now = Date.now();
        committedVersion = now;
        const safety = buildUnassessedMediaContentSafetyAssessment(now);
        const scoreBreakdown = buildUnassessedPhotoScoreBreakdown();
        tx.update(publicationRef, {
          publishedStoragePath: candidatePath,
          sourceStoragePath: FieldValue.delete(),
          assetVersion: now,
          updatedAt: now,
          contentSafetyAssessment: safety,
          safetyScore: null,
          score: 0,
          scoreBreakdown,
        });
        tx.update(projectionRef, {
          assetVersion: now,
          updatedAt: now,
          contentSafetyAssessment: safety,
          safetyScore: null,
          score: 0,
          scoreBreakdown,
        });
        // Keep the reservation as a durable cleanup obligation until the
        // existing expiry reconciler observes deletion of this staging object.
        tx.update(reservationRef, {
          consumedAt: now,
          sourceGeneration,
          expiresAt: Timestamp.fromMillis(now),
        });
      });
      committed = true;
    } catch (error) {
      if (candidatePath && !committed) {
        await deletePublishedPhotoAssetOrQueue({
          ownerUid, photoId, storagePath: candidatePath,
          reason: 'replace-published-photo-rollback',
        });
      }
      throw error;
    }

    // The published asset is now authoritative. Cleanup failures are retried
    // by the existing reservation sweeper and published-asset cleanup queue.
    try {
      await deletePublishedPhotoAssetOrQueue({
        ownerUid, photoId, storagePath: previousPath,
        reason: 'replace-published-photo-previous-asset',
      });
    } catch (error) {
      logger.error('[replacePublishedPhoto] Previous asset cleanup not queued.', {
        reason: error instanceof Error ? error.message : String(error ?? ''),
      });
    }
    try {
      await deleteGenerationPinnedVideoFile(sourceGeneration, (generation) =>
        sourceFile.delete({ ignoreNotFound: true, ifGenerationMatch: generation })
      );
    } catch (error) {
      logger.warn('[replacePublishedPhoto] Staging cleanup pending.', {
        reason: error instanceof Error ? error.message : String(error ?? ''),
      });
    }

    logPhotoOperation({
      operation: 'photo.replace_published_asset',
      outcome: 'success', startedAt,
    });
    return { photoId, assetVersion: committedVersion, replaced: true };
  }
);
