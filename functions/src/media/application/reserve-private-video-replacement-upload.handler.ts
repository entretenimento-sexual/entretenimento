import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  evaluatePrivateMediaDraftEligibility,
} from './private-media-draft-eligibility.policy';
import {
  calculatePrivateMediaDraftReservationBytes,
  resolvePrivateMediaDraftPlan,
} from './private-media-draft.policy';
import type {
  PrivateMediaUploadReservationDocument,
} from './private-media-upload-reservation.handler';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

interface ReservePrivateVideoReplacementUploadRequest {
  clientRequestId?: unknown;
  ownerUid?: unknown;
  mediaId?: unknown;
  kind?: unknown;
  operation?: unknown;
  sourceStoragePath?: unknown;
  auxiliaryStoragePath?: unknown;
  currentStoragePath?: unknown;
  sourceSizeBytes?: unknown;
  auxiliarySizeBytes?: unknown;
}

interface ReservePrivateVideoReplacementUploadResponse {
  reservationId: string;
  mediaId: string;
  kind: 'video';
  operation: 'REPLACE';
  plan: 'free' | 'basic' | 'premium' | 'vip';
  expiresAt: number;
  draftExpiresAt: null;
  reservedBytes: number;
}

interface PrivateVideoDocument {
  path?: unknown;
  url?: unknown;
  status?: unknown;
  replacementState?: unknown;
}

interface VideoPublicationDocument {
  isPublished?: unknown;
  moderationStatus?: unknown;
}

const RESERVATION_COLLECTION = 'media_private_upload_reservations';
const ACTIVE_RESERVATION_MS = 30 * 60 * 1000;
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_POSTER_SIZE_BYTES = 10 * 1024 * 1024;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizePositiveInteger(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : 0;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue >= 0
    ? Math.trunc(numberValue)
    : 0;
}

function reservationDocumentId(
  ownerUid: string,
  clientRequestId: string
): string {
  return createHash('sha256')
    .update(`${ownerUid}:${clientRequestId}`)
    .digest('hex');
}

function buildResponse(
  reservation: PrivateMediaUploadReservationDocument
): ReservePrivateVideoReplacementUploadResponse {
  return {
    reservationId: reservation.reservationId,
    mediaId: reservation.mediaId,
    kind: 'video',
    operation: 'REPLACE',
    plan: reservation.plan,
    expiresAt: reservation.expiresAt.toMillis(),
    draftExpiresAt: null,
    reservedBytes: reservation.draftReservedBytes,
  };
}

function sameRequest(
  reservation: PrivateMediaUploadReservationDocument,
  input: {
    ownerUid: string;
    mediaId: string;
    sourceStoragePath: string;
    auxiliaryStoragePath: string | null;
    currentStoragePath: string;
    sourceSizeBytes: number;
    auxiliarySizeBytes: number;
  }
): boolean {
  return reservation.ownerUid === input.ownerUid &&
    reservation.mediaId === input.mediaId &&
    reservation.kind === 'video' &&
    reservation.operation === 'REPLACE' &&
    reservation.sourceStoragePath === input.sourceStoragePath &&
    reservation.auxiliaryStoragePath === input.auxiliaryStoragePath &&
    reservation.currentStoragePath === input.currentStoragePath &&
    reservation.sourceSizeBytes === input.sourceSizeBytes &&
    reservation.auxiliarySizeBytes === input.auxiliarySizeBytes;
}

/**
 * Reserva específica para substituir um vídeo já publicado.
 *
 * A substituição não cria outro rascunho e não altera a quota temporária. O
 * vídeo público atual permanece ativo até a nova versão ser processada e
 * promovida pelo backend.
 */
export const reservePrivateVideoReplacementUpload = onCall<
  ReservePrivateVideoReplacementUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ReservePrivateVideoReplacementUploadResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const mediaId = cleanId(request.data?.mediaId);
    const clientRequestId = cleanId(request.data?.clientRequestId);
    const authenticatedEmailVerified =
      request.auth?.token?.['email_verified'] === true;

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (
      requesterUid !== ownerUid ||
      !mediaId ||
      !clientRequestId ||
      request.data?.kind !== 'video' ||
      request.data?.operation !== 'REPLACE'
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Os dados da substituição do vídeo são inválidos.'
      );
    }

    const sourceStoragePath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      mediaId,
      request.data?.sourceStoragePath
    );
    const currentStoragePath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      mediaId,
      request.data?.currentStoragePath
    );
    const rawAuxiliaryPath = String(
      request.data?.auxiliaryStoragePath ?? ''
    ).trim();
    const auxiliaryStoragePath = rawAuxiliaryPath
      ? extractOwnedPrivateVideoPosterPath(
        ownerUid,
        mediaId,
        rawAuxiliaryPath
      )
      : null;
    const sourceSizeBytes = normalizePositiveInteger(
      request.data?.sourceSizeBytes
    );
    const auxiliarySizeBytes = normalizeNonNegativeInteger(
      request.data?.auxiliarySizeBytes
    );

    if (
      !sourceStoragePath ||
      !currentStoragePath ||
      sourceStoragePath === currentStoragePath ||
      (rawAuxiliaryPath && !auxiliaryStoragePath) ||
      !sourceSizeBytes ||
      sourceSizeBytes > MAX_VIDEO_SIZE_BYTES ||
      auxiliarySizeBytes > MAX_POSTER_SIZE_BYTES ||
      (auxiliaryStoragePath === null) !== (auxiliarySizeBytes === 0)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Os arquivos reservados para substituição são inválidos.'
      );
    }

    const now = Date.now();
    const reservationId = reservationDocumentId(
      ownerUid,
      clientRequestId
    );
    const reservationRef = db
      .collection(RESERVATION_COLLECTION)
      .doc(reservationId);
    const userRef = db.doc(`users/${ownerUid}`);
    const videoRef = db.doc(`users/${ownerUid}/videos/${mediaId}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${mediaId}`
    );

    return db.runTransaction(async (transaction) => {
      const [
        existingReservationSnapshot,
        userSnapshot,
        videoSnapshot,
        publicationSnapshot,
      ] = await Promise.all([
        transaction.get(reservationRef),
        transaction.get(userRef),
        transaction.get(videoRef),
        transaction.get(publicationRef),
      ]);
      const eligibility = evaluatePrivateMediaDraftEligibility(
        userSnapshot.exists ? userSnapshot.data() : null,
        ownerUid,
        authenticatedEmailVerified
      );

      if (!eligibility.allowed) {
        throw new HttpsError(
          'permission-denied',
          eligibility.message ??
            'A conta não está liberada para substituir vídeos.'
        );
      }

      const identity = {
        ownerUid,
        mediaId,
        sourceStoragePath,
        auxiliaryStoragePath,
        currentStoragePath,
        sourceSizeBytes,
        auxiliarySizeBytes,
      };

      if (existingReservationSnapshot.exists) {
        const existing = existingReservationSnapshot.data() as
          PrivateMediaUploadReservationDocument;

        if (
          existing.state === 'ACTIVE' &&
          existing.expiresAt.toMillis() > now &&
          sameRequest(existing, identity)
        ) {
          return buildResponse(existing);
        }

        throw new HttpsError(
          'already-exists',
          'O identificador desta tentativa de substituição já foi utilizado.'
        );
      }

      if (!videoSnapshot.exists || !publicationSnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'O vídeo publicado não foi encontrado.'
        );
      }

      const video = videoSnapshot.data() as PrivateVideoDocument;
      const publication =
        publicationSnapshot.data() as VideoPublicationDocument;
      const registeredPath =
        extractOwnedPrivateVideoPathForId(ownerUid, mediaId, video.path) ??
        extractOwnedPrivateVideoPathForId(ownerUid, mediaId, video.url);
      const status = String(video.status ?? '').trim().toLowerCase();
      const replacementState = String(video.replacementState ?? '')
        .trim()
        .toUpperCase();
      const moderationStatus = String(publication.moderationStatus ?? '')
        .trim()
        .toUpperCase();

      if (registeredPath !== currentStoragePath) {
        throw new HttpsError(
          'failed-precondition',
          'O vídeo foi alterado em outro dispositivo. Recarregue antes de editar.'
        );
      }

      if (
        status !== 'ready' ||
        publication.isPublished !== true ||
        moderationStatus !== 'APPROVED'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Somente um vídeo publicado e pronto pode ser substituído.'
        );
      }

      if (
        replacementState === 'PROCESSING' ||
        replacementState === 'REGISTERED'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Este vídeo já possui uma substituição em andamento.'
        );
      }

      const createdAt = Timestamp.fromMillis(now);
      const draftReservedBytes = calculatePrivateMediaDraftReservationBytes(
        'video',
        sourceSizeBytes,
        auxiliarySizeBytes
      );
      const reservation: PrivateMediaUploadReservationDocument = {
        reservationId,
        ownerUid,
        mediaId,
        kind: 'video',
        operation: 'REPLACE',
        state: 'ACTIVE',
        sourceStoragePath,
        auxiliaryStoragePath,
        currentStoragePath,
        sourceSizeBytes,
        auxiliarySizeBytes,
        draftReservedBytes,
        previousDraftReservedBytes: 0,
        reservedUsageBytes: 0,
        reservedItemCount: 0,
        plan: resolvePrivateMediaDraftPlan(
          userSnapshot.exists ? userSnapshot.data() : null,
          now
        ),
        draftExpiresAt: null,
        createdAt,
        updatedAt: createdAt,
        expiresAt: Timestamp.fromMillis(now + ACTIVE_RESERVATION_MS),
        consumedAt: null,
        cleanupAfter: null,
      };

      transaction.create(reservationRef, reservation);
      return buildResponse(reservation);
    });
  }
);
