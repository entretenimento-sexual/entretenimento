import { createHash } from 'node:crypto';

import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  applyPrivateMediaDraftReservation,
  calculatePrivateMediaDraftExpiry,
  calculatePrivateMediaDraftReservationBytes,
  evaluatePrivateMediaDraftCapacity,
  getPrivateMediaDraftLimit,
  normalizePrivateMediaDraftUsage,
  PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
  releasePrivateMediaDraftReservation,
  resolvePrivateMediaDraftPlan,
  type PrivateMediaDraftKind,
  type PrivateMediaDraftPlan,
} from './private-media-draft.policy';
import {
  evaluatePrivateMediaDraftEligibility,
} from './private-media-draft-eligibility.policy';
import { privateMediaDraftHttpsError } from './private-media-draft-error';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

export type PrivateMediaUploadOperation = 'CREATE' | 'REPLACE';
export type PrivateMediaUploadReservationState =
  | 'ACTIVE'
  | 'CONSUMED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface PrivateMediaUploadReservationDocument {
  reservationId: string;
  ownerUid: string;
  mediaId: string;
  kind: PrivateMediaDraftKind;
  operation: PrivateMediaUploadOperation;
  state: PrivateMediaUploadReservationState;
  sourceStoragePath: string;
  auxiliaryStoragePath: string | null;
  currentStoragePath: string | null;
  sourceSizeBytes: number;
  auxiliarySizeBytes: number;
  draftReservedBytes: number;
  previousDraftReservedBytes: number;
  reservedUsageBytes: number;
  reservedItemCount: number;
  plan: PrivateMediaDraftPlan;
  draftExpiresAt: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
  consumedAt?: Timestamp | null;
  cleanupAfter?: Timestamp | null;
}

interface ReservePrivateMediaUploadRequest {
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

interface ReservePrivateMediaUploadResponse {
  reservationId: string;
  mediaId: string;
  kind: PrivateMediaDraftKind;
  operation: PrivateMediaUploadOperation;
  plan: PrivateMediaDraftPlan;
  expiresAt: number;
  draftExpiresAt: number | null;
  reservedBytes: number;
}

interface CancelPrivateMediaUploadRequest {
  reservationId?: unknown;
}

interface CancelPrivateMediaUploadResponse {
  reservationId: string;
  released: boolean;
}

interface PrivatePhotoDocument {
  path?: unknown;
  url?: unknown;
  draftReservationActive?: unknown;
  draftReservedBytes?: unknown;
  draftExpiresAt?: unknown;
}

interface PhotoPublicationDocument {
  isPublished?: unknown;
}

export interface ConsumePrivateMediaUploadReservationInput {
  reservationId: string;
  ownerUid: string;
  mediaId: string;
  kind: PrivateMediaDraftKind;
  operation: PrivateMediaUploadOperation;
  sourceStoragePath: string;
  auxiliaryStoragePath: string | null;
  sourceSizeBytes: number;
  auxiliarySizeBytes: number;
  now?: number;
}

const RESERVATIONS_COLLECTION = 'media_private_upload_reservations';
const USAGE_COLLECTION = 'media_private_draft_usage';
const ACTIVE_RESERVATION_MS = 30 * 60 * 1000;
const TERMINAL_RESERVATION_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 40;
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_VIDEO_POSTER_SIZE_BYTES = 10 * 1024 * 1024;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    containsControlCharacter(normalized)
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

function normalizeOperation(value: unknown): PrivateMediaUploadOperation | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'CREATE' || normalized === 'REPLACE'
    ? normalized
    : null;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function reservationDocumentId(
  ownerUid: string,
  clientRequestId: string
): string {
  return createHash('sha256')
    .update(`${ownerUid}:${clientRequestId}`)
    .digest('hex');
}

function reservationReference(reservationId: string) {
  return db.collection(RESERVATIONS_COLLECTION).doc(reservationId);
}

function usageReference(ownerUid: string) {
  return db.collection(USAGE_COLLECTION).doc(ownerUid);
}

function validateSourcePath(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string,
  value: unknown
): string | null {
  return kind === 'photo'
    ? extractOwnedPrivatePhotoPath(ownerUid, value)
    : extractOwnedPrivateVideoPathForId(ownerUid, mediaId, value);
}

function validateAuxiliaryPath(
  kind: PrivateMediaDraftKind,
  ownerUid: string,
  mediaId: string,
  value: unknown
): string | null {
  const raw = String(value ?? '').trim();

  if (!raw) {
    return null;
  }

  return kind === 'video'
    ? extractOwnedPrivateVideoPosterPath(ownerUid, mediaId, raw)
    : null;
}

function validateMaximumSizes(
  kind: PrivateMediaDraftKind,
  sourceSizeBytes: number,
  auxiliarySizeBytes: number
): void {
  const maximumSourceSize = kind === 'photo'
    ? MAX_PHOTO_SIZE_BYTES
    : MAX_VIDEO_SIZE_BYTES;

  if (!sourceSizeBytes || sourceSizeBytes > maximumSourceSize) {
    throw new HttpsError(
      'invalid-argument',
      'O arquivo excede o limite permitido ou está vazio.'
    );
  }

  if (
    kind === 'photo' && auxiliarySizeBytes > 0 ||
    auxiliarySizeBytes > MAX_VIDEO_POSTER_SIZE_BYTES
  ) {
    throw new HttpsError(
      'invalid-argument',
      'O arquivo auxiliar excede o limite permitido.'
    );
  }
}

function sameReservationRequest(
  reservation: PrivateMediaUploadReservationDocument,
  input: {
    ownerUid: string;
    mediaId: string;
    kind: PrivateMediaDraftKind;
    operation: PrivateMediaUploadOperation;
    sourceStoragePath: string;
    auxiliaryStoragePath: string | null;
    currentStoragePath: string | null;
    sourceSizeBytes: number;
    auxiliarySizeBytes: number;
  }
): boolean {
  return reservation.ownerUid === input.ownerUid &&
    reservation.mediaId === input.mediaId &&
    reservation.kind === input.kind &&
    reservation.operation === input.operation &&
    reservation.sourceStoragePath === input.sourceStoragePath &&
    reservation.auxiliaryStoragePath === input.auxiliaryStoragePath &&
    reservation.currentStoragePath === input.currentStoragePath &&
    reservation.sourceSizeBytes === input.sourceSizeBytes &&
    reservation.auxiliarySizeBytes === input.auxiliarySizeBytes;
}

function buildResponse(
  reservation: PrivateMediaUploadReservationDocument
): ReservePrivateMediaUploadResponse {
  return {
    reservationId: reservation.reservationId,
    mediaId: reservation.mediaId,
    kind: reservation.kind,
    operation: reservation.operation,
    plan: reservation.plan,
    expiresAt: reservation.expiresAt.toMillis(),
    draftExpiresAt: reservation.draftExpiresAt,
    reservedBytes: reservation.draftReservedBytes,
  };
}

function releaseUsageForReservation(
  reservation: PrivateMediaUploadReservationDocument,
  usageValue: unknown
) {
  const usage = normalizePrivateMediaDraftUsage(usageValue);

  if (reservation.reservedItemCount > 0) {
    return releasePrivateMediaDraftReservation(
      reservation.kind,
      usage,
      reservation.reservedUsageBytes
    );
  }

  if (reservation.kind === 'photo') {
    return {
      ...usage,
      photoReservedBytes: Math.max(
        0,
        usage.photoReservedBytes - reservation.reservedUsageBytes
      ),
    };
  }

  return {
    ...usage,
    videoReservedBytes: Math.max(
      0,
      usage.videoReservedBytes - reservation.reservedUsageBytes
    ),
  };
}

async function releaseActiveReservation(
  reservationId: string,
  terminalState: 'CANCELLED' | 'EXPIRED'
): Promise<PrivateMediaUploadReservationDocument | null> {
  const reservationRef = reservationReference(reservationId);
  const now = Timestamp.now();

  return db.runTransaction(async (transaction) => {
    const reservationSnapshot = await transaction.get(reservationRef);

    if (!reservationSnapshot.exists) {
      return null;
    }

    const reservation = reservationSnapshot.data() as
      PrivateMediaUploadReservationDocument;

    if (reservation.state !== 'ACTIVE') {
      return null;
    }

    const usageRef = usageReference(reservation.ownerUid);
    const usageSnapshot = await transaction.get(usageRef);
    const nextUsage = releaseUsageForReservation(
      reservation,
      usageSnapshot.exists ? usageSnapshot.data() : null
    );

    transaction.set(
      usageRef,
      {
        ...nextUsage,
        version: PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
        updatedAt: now.toMillis(),
      },
      { merge: true }
    );
    transaction.update(reservationRef, {
      state: terminalState,
      updatedAt: now,
      cleanupAfter: Timestamp.fromMillis(
        now.toMillis() + TERMINAL_RESERVATION_RETENTION_MS
      ),
    });

    return reservation;
  });
}

async function deleteReservedObjectsBestEffort(
  reservation: PrivateMediaUploadReservationDocument
): Promise<void> {
  const paths = [
    reservation.sourceStoragePath,
    ...(reservation.auxiliaryStoragePath
      ? [reservation.auxiliaryStoragePath]
      : []),
  ];

  await Promise.all(paths.map(async (storagePath) => {
    try {
      await storage
        .bucket()
        .file(storagePath)
        .delete({ ignoreNotFound: true });
    } catch (error) {
      logger.warn('[privateMediaUploadReservation] Limpeza pendente.', {
        reservationId: reservation.reservationId,
        kind: reservation.kind,
        error: normalizeErrorMessage(error),
      });
    }
  }));
}

export async function consumePrivateMediaUploadReservation(
  transaction: Transaction,
  input: ConsumePrivateMediaUploadReservationInput
): Promise<PrivateMediaUploadReservationDocument> {
  const reservationId = cleanId(input.reservationId);

  if (!reservationId) {
    throw privateMediaDraftHttpsError(
      'failed-precondition',
      'MEDIA_UPLOAD_RESERVATION_EXPIRED',
      'A reserva de upload não foi informada.',
      'Inicie o envio novamente para gerar uma nova reserva.'
    );
  }

  const reservationRef = reservationReference(reservationId);
  const snapshot = await transaction.get(reservationRef);

  if (!snapshot.exists) {
    throw privateMediaDraftHttpsError(
      'failed-precondition',
      'MEDIA_UPLOAD_RESERVATION_EXPIRED',
      'A reserva de upload não existe ou expirou.',
      'Inicie o envio novamente para gerar uma nova reserva.'
    );
  }

  const reservation = snapshot.data() as PrivateMediaUploadReservationDocument;
  const now = input.now ?? Date.now();

  if (
    reservation.state !== 'ACTIVE' ||
    reservation.expiresAt.toMillis() <= now
  ) {
    throw privateMediaDraftHttpsError(
      'failed-precondition',
      'MEDIA_UPLOAD_RESERVATION_EXPIRED',
      'A reserva de upload expirou ou já foi utilizada.',
      'Inicie o envio novamente para gerar uma nova reserva.'
    );
  }

  if (
    reservation.ownerUid !== input.ownerUid ||
    reservation.mediaId !== input.mediaId ||
    reservation.kind !== input.kind ||
    reservation.operation !== input.operation ||
    reservation.sourceStoragePath !== input.sourceStoragePath ||
    reservation.auxiliaryStoragePath !== input.auxiliaryStoragePath ||
    reservation.sourceSizeBytes !== input.sourceSizeBytes ||
    reservation.auxiliarySizeBytes !== input.auxiliarySizeBytes
  ) {
    throw privateMediaDraftHttpsError(
      'failed-precondition',
      'MEDIA_UPLOAD_RESERVATION_MISMATCH',
      'A reserva não corresponde ao arquivo enviado.',
      'Selecione novamente o arquivo e reinicie o envio.'
    );
  }

  transaction.update(reservationRef, {
    state: 'CONSUMED',
    consumedAt: Timestamp.fromMillis(now),
    updatedAt: Timestamp.fromMillis(now),
    cleanupAfter: Timestamp.fromMillis(
      now + TERMINAL_RESERVATION_RETENTION_MS
    ),
  });

  return reservation;
}

export async function cancelPrivateMediaUploadReservationById(
  reservationIdValue: unknown
): Promise<boolean> {
  const reservationId = cleanId(reservationIdValue);

  if (!reservationId) {
    return false;
  }

  const reservation = await releaseActiveReservation(
    reservationId,
    'CANCELLED'
  );

  if (!reservation) {
    return false;
  }

  await deleteReservedObjectsBestEffort(reservation);
  return true;
}

export const reservePrivateMediaUpload = onCall<
  ReservePrivateMediaUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ReservePrivateMediaUploadResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const mediaId = cleanId(request.data?.mediaId);
    const clientRequestId = cleanId(request.data?.clientRequestId);
    const kind = normalizeKind(request.data?.kind);
    const operation = normalizeOperation(request.data?.operation);
    const authenticatedEmailVerified =
      request.auth?.token?.['email_verified'] === true;

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (
      !ownerUid ||
      requesterUid !== ownerUid ||
      !mediaId ||
      !clientRequestId ||
      !kind ||
      !operation
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Os dados da reserva de upload são inválidos.'
      );
    }

    if (operation === 'REPLACE' && kind !== 'photo') {
      throw new HttpsError(
        'invalid-argument',
        'A substituição reservada está disponível apenas para fotos.'
      );
    }

    const sourceStoragePath = validateSourcePath(
      kind,
      ownerUid,
      mediaId,
      request.data?.sourceStoragePath
    );
    const auxiliaryStoragePath = validateAuxiliaryPath(
      kind,
      ownerUid,
      mediaId,
      request.data?.auxiliaryStoragePath
    );
    const rawAuxiliaryPath = String(
      request.data?.auxiliaryStoragePath ?? ''
    ).trim();
    const currentStoragePath = operation === 'REPLACE'
      ? extractOwnedPrivatePhotoPath(
        ownerUid,
        request.data?.currentStoragePath
      )
      : null;
    const sourceSizeBytes = normalizePositiveInteger(
      request.data?.sourceSizeBytes
    );
    const auxiliarySizeBytes = normalizePositiveInteger(
      request.data?.auxiliarySizeBytes
    );

    if (
      !sourceStoragePath ||
      (rawAuxiliaryPath && !auxiliaryStoragePath) ||
      (operation === 'REPLACE' && !currentStoragePath)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Os caminhos da reserva de upload são inválidos.'
      );
    }

    validateMaximumSizes(kind, sourceSizeBytes, auxiliarySizeBytes);

    if (
      (auxiliaryStoragePath === null) !== (auxiliarySizeBytes === 0)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'O tamanho auxiliar não corresponde ao arquivo reservado.'
      );
    }

    const reservationId = reservationDocumentId(
      ownerUid,
      clientRequestId
    );
    const reservationRef = reservationReference(reservationId);
    const userRef = db.doc(`users/${ownerUid}`);
    const usageRef = usageReference(ownerUid);
    const photoRef = operation === 'REPLACE'
      ? db.doc(`users/${ownerUid}/photos/${mediaId}`)
      : null;
    const publicationRef = operation === 'REPLACE'
      ? db.doc(`users/${ownerUid}/photo_publications/${mediaId}`)
      : null;
    const now = Date.now();
    const expiresAt = Timestamp.fromMillis(now + ACTIVE_RESERVATION_MS);
    const draftReservedBytes = calculatePrivateMediaDraftReservationBytes(
      kind,
      sourceSizeBytes,
      auxiliarySizeBytes
    );

    return db.runTransaction(async (transaction) => {
      const [
        existingReservationSnapshot,
        userSnapshot,
        usageSnapshot,
        photoSnapshot,
        publicationSnapshot,
      ] = await Promise.all([
        transaction.get(reservationRef),
        transaction.get(userRef),
        transaction.get(usageRef),
        photoRef ? transaction.get(photoRef) : Promise.resolve(null),
        publicationRef
          ? transaction.get(publicationRef)
          : Promise.resolve(null),
      ]);
      const eligibility = evaluatePrivateMediaDraftEligibility(
        userSnapshot.exists ? userSnapshot.data() : null,
        ownerUid,
        authenticatedEmailVerified
      );

      if (!eligibility.allowed) {
        throw privateMediaDraftHttpsError(
          'permission-denied',
          eligibility.errorCode ?? 'MEDIA_UPLOAD_NOT_ALLOWED',
          eligibility.message ?? 'A conta não está liberada para enviar mídia.',
          eligibility.recovery ?? 'Regularize a conta antes de continuar.'
        );
      }

      const requestIdentity = {
        ownerUid,
        mediaId,
        kind,
        operation,
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
          sameReservationRequest(existing, requestIdentity)
        ) {
          return buildResponse(existing);
        }

        throw new HttpsError(
          'already-exists',
          'O identificador desta tentativa de upload já foi utilizado.'
        );
      }

      const plan = resolvePrivateMediaDraftPlan(
        userSnapshot.exists ? userSnapshot.data() : null,
        now
      );
      const usage = normalizePrivateMediaDraftUsage(
        usageSnapshot.exists ? usageSnapshot.data() : null
      );
      let nextUsage = usage;
      let reservedItemCount = 0;
      let reservedUsageBytes = 0;
      let previousDraftReservedBytes = 0;
      let draftExpiresAt: number | null = null;

      if (operation === 'CREATE') {
        const capacity = evaluatePrivateMediaDraftCapacity(
          kind,
          plan,
          usage,
          draftReservedBytes
        );

        if (!capacity.allowed) {
          const mediaLabel = kind === 'photo' ? 'fotos' : 'vídeos';
          const itemMessage =
            `Você atingiu o limite de rascunhos de ${mediaLabel}. ` +
            'Publique ou exclua um rascunho antes de enviar outro.';
          const byteMessage =
            `Seus rascunhos de ${mediaLabel} atingiram o limite ` +
            'de armazenamento temporário.';

          throw privateMediaDraftHttpsError(
            'resource-exhausted',
            capacity.reason === 'ITEM_LIMIT'
              ? 'MEDIA_DRAFT_ITEM_LIMIT'
              : 'MEDIA_DRAFT_BYTE_LIMIT',
            capacity.reason === 'ITEM_LIMIT' ? itemMessage : byteMessage,
            'Publique ou exclua um rascunho antes de continuar.'
          );
        }

        nextUsage = applyPrivateMediaDraftReservation(
          kind,
          usage,
          draftReservedBytes
        );
        reservedItemCount = 1;
        reservedUsageBytes = draftReservedBytes;
        draftExpiresAt = calculatePrivateMediaDraftExpiry(kind, plan, now);
      } else {
        if (!photoSnapshot?.exists) {
          throw new HttpsError('not-found', 'A foto original não existe.');
        }

        const photo = photoSnapshot.data() as PrivatePhotoDocument;
        const registeredCurrentPath =
          extractOwnedPrivatePhotoPath(ownerUid, photo.path) ??
          extractOwnedPrivatePhotoPath(ownerUid, photo.url);

        if (registeredCurrentPath !== currentStoragePath) {
          throw new HttpsError(
            'failed-precondition',
            'A foto foi alterada em outro dispositivo. Recarregue antes de editar.'
          );
        }

        const publication = publicationSnapshot?.exists
          ? publicationSnapshot.data() as PhotoPublicationDocument
          : null;
        const isPublished = publication?.isPublished === true;
        const reservationActive = photo.draftReservationActive === true;

        if (!isPublished && reservationActive) {
          previousDraftReservedBytes = normalizePositiveInteger(
            photo.draftReservedBytes
          );
          const positiveDelta = Math.max(
            0,
            draftReservedBytes - previousDraftReservedBytes
          );
          const nextTotalReservedBytes =
            usage.photoReservedBytes + positiveDelta;
          const limit = getPrivateMediaDraftLimit('photo', plan);

          if (nextTotalReservedBytes > limit.maxReservedBytes) {
            throw privateMediaDraftHttpsError(
              'resource-exhausted',
              'MEDIA_DRAFT_BYTE_LIMIT',
              'A nova versão ultrapassa o armazenamento temporário disponível.',
              'Reduza a imagem ou libere espaço antes de tentar novamente.'
            );
          }

          nextUsage = {
            ...usage,
            photoReservedBytes: nextTotalReservedBytes,
          };
          reservedUsageBytes = positiveDelta;
          draftExpiresAt =
            normalizePositiveInteger(photo.draftExpiresAt) || null;
        }
      }

      const createdAt = Timestamp.fromMillis(now);
      const reservation: PrivateMediaUploadReservationDocument = {
        reservationId,
        ownerUid,
        mediaId,
        kind,
        operation,
        state: 'ACTIVE',
        sourceStoragePath,
        auxiliaryStoragePath,
        currentStoragePath,
        sourceSizeBytes,
        auxiliarySizeBytes,
        draftReservedBytes,
        previousDraftReservedBytes,
        reservedUsageBytes,
        reservedItemCount,
        plan,
        draftExpiresAt,
        createdAt,
        updatedAt: createdAt,
        expiresAt,
        consumedAt: null,
        cleanupAfter: null,
      };

      transaction.set(
        usageRef,
        {
          ...nextUsage,
          version: PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
          updatedAt: now,
        },
        { merge: true }
      );
      transaction.create(reservationRef, reservation);

      return buildResponse(reservation);
    });
  }
);

export const cancelPrivateMediaUploadReservation = onCall<
  CancelPrivateMediaUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CancelPrivateMediaUploadResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const reservationId = cleanId(request.data?.reservationId);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!reservationId) {
      throw new HttpsError('invalid-argument', 'Reserva inválida.');
    }

    const snapshot = await reservationReference(reservationId).get();

    if (!snapshot.exists) {
      return { reservationId, released: false };
    }

    const reservation = snapshot.data() as PrivateMediaUploadReservationDocument;

    if (reservation.ownerUid !== requesterUid) {
      throw new HttpsError(
        'permission-denied',
        'A reserva não pertence ao usuário autenticado.'
      );
    }

    const released = await cancelPrivateMediaUploadReservationById(
      reservationId
    );

    return { reservationId, released };
  }
);

export const cleanupPrivateMediaUploadReservations = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 30 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const now = Timestamp.now();
    const expiredSnapshot = await db
      .collection(RESERVATIONS_COLLECTION)
      .where('state', '==', 'ACTIVE')
      .where('expiresAt', '<=', now)
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    for (const document of expiredSnapshot.docs) {
      try {
        const reservation = await releaseActiveReservation(
          document.id,
          'EXPIRED'
        );

        if (reservation) {
          await deleteReservedObjectsBestEffort(reservation);
        }
      } catch (error) {
        logger.error('[privateMediaUploadReservation] Falha ao expirar.', {
          reservationId: document.id,
          error: normalizeErrorMessage(error),
        });
      }
    }

    const terminalSnapshot = await db
      .collection(RESERVATIONS_COLLECTION)
      .where('cleanupAfter', '<=', now)
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    if (!terminalSnapshot.empty) {
      const batch = db.batch();
      terminalSnapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
  }
);
