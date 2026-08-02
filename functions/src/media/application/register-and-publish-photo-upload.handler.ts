import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onObjectFinalized } from 'firebase-functions/v2/storage';

import {
  assertInteractionAccessData,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { auth, db, storage } from '../../firebaseApp';
import {
  publishPhoto as publishPhotoCore,
} from './manage-photo-publication.handler';
import {
  extractOwnedPrivatePhotoPathForId,
  parseOwnedPrivatePhotoStagingPath,
} from './photo-storage-path';

type PhotoVisibility = 'FRIENDS' | 'SUBSCRIBERS' | 'PREMIUM' | 'PUBLIC';
type CommentsPolicy = 'OFF' | 'FRIENDS' | 'SUBSCRIBERS' | 'EVERYONE';
type ModerationStatus = 'PENDING_REVIEW' | 'APPROVED';

interface RegisterAndPublishPhotoUploadRequest {
  ownerUid?: string;
  photoId?: string;
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  visibility?: PhotoVisibility;
  caption?: string | null;
  isCover?: boolean;
  orderIndex?: number;
  commentsEnabled?: boolean;
  commentsPolicy?: CommentsPolicy;
  reactionsEnabled?: boolean;
}

interface RegisterAndPublishPhotoUploadResponse {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  moderationStatus: ModerationStatus;
}

interface PrivatePhotoDocument {
  path?: unknown;
  url?: unknown;
  fileName?: unknown;
  createdAt?: unknown;
}

interface PhotoPublicationDocument {
  isPublished?: unknown;
  moderationStatus?: unknown;
  sourceStoragePath?: unknown;
}

interface PhotoUploadCleanupJob {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

interface UploadAccountSnapshot {
  uid?: unknown;
  profileCompleted?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
  accountStatus?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  ageReverification?: {
    status?: unknown;
  } | null;
}

const CLEANUP_COLLECTION = 'media_private_photo_upload_cleanup_jobs';
const CLEANUP_DELAY_MS = 6 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 100;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanFileName(value: unknown): string {
  const raw = String(value ?? '');
  let normalized = '';

  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);

    if (code > 31 && code !== 127) {
      normalized += raw[index];
    }
  }

  return normalized.trim().slice(0, 160) || 'Foto';
}

function normalizeMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizePositiveInteger(value: unknown): number | null {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.trunc(numeric);
}

function normalizeModerationStatus(value: unknown): ModerationStatus {
  return String(value ?? '').trim().toUpperCase() === 'APPROVED'
    ? 'APPROVED'
    : 'PENDING_REVIEW';
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function timestampToMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  const timestamp = value as { toMillis?: () => number } | null | undefined;

  if (typeof timestamp?.toMillis === 'function') {
    return timestamp.toMillis();
  }

  return Date.now();
}

function cleanupJobId(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

async function assertUploadEligibility(ownerUid: string): Promise<void> {
  const [authUser, userSnapshot] = await Promise.all([
    auth.getUser(ownerUid),
    db.doc(`users/${ownerUid}`).get(),
  ]);

  if (!userSnapshot.exists) {
    throw new HttpsError(
      'failed-precondition',
      'Seu perfil não está disponível para publicar fotos.'
    );
  }

  const user = userSnapshot.data() as UploadAccountSnapshot;
  const documentUid = String(user.uid ?? ownerUid).trim();

  if (documentUid && documentUid !== ownerUid) {
    throw new HttpsError(
      'permission-denied',
      'O perfil informado não corresponde à conta autenticada.'
    );
  }

  if (
    authUser.disabled === true ||
    user.accountLocked === true ||
    user.loginAllowed === false
  ) {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não está disponível para publicar fotos.'
    );
  }

  assertInteractionAccessData(user);

  if (authUser.emailVerified !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail antes de publicar fotos.'
    );
  }

  if (user.profileCompleted !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Complete seu perfil antes de publicar fotos.'
    );
  }
}

async function readRequiredPhotoMetadata(storagePath: string): Promise<{
  mimeType: string;
  sizeBytes: number;
}> {
  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new HttpsError(
      'failed-precondition',
      'A foto enviada não foi encontrada no armazenamento.'
    );
  }

  const [metadata] = await file.getMetadata();
  const mimeType = normalizeMimeType(metadata.contentType);
  const sizeBytes = normalizePositiveInteger(metadata.size);

  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new HttpsError(
      'failed-precondition',
      'A foto armazenada não possui um formato permitido.'
    );
  }

  if (!sizeBytes || sizeBytes > MAX_IMAGE_SIZE_BYTES) {
    throw new HttpsError(
      'failed-precondition',
      'A foto armazenada está vazia ou excede o limite de 10 MB.'
    );
  }

  return { mimeType, sizeBytes };
}

async function clearCleanupJobBestEffort(storagePath: string): Promise<void> {
  try {
    await db
      .collection(CLEANUP_COLLECTION)
      .doc(cleanupJobId(storagePath))
      .delete();
  } catch {
    // A rotina agendada também remove jobs já resolvidos.
  }
}

async function deleteStagingAssetBestEffort(
  storagePath: string,
  context: Record<string, unknown>
): Promise<void> {
  try {
    await storage
      .bucket()
      .file(storagePath)
      .delete({ ignoreNotFound: true });
    await clearCleanupJobBestEffort(storagePath);
  } catch (error) {
    logger.warn('[photoUpload] Limpeza de staging pendente.', {
      ...context,
      error: normalizeErrorMessage(error),
    });
  }
}

async function findExistingPublishedResponse(
  ownerUid: string,
  photoId: string,
  storagePath: string
): Promise<RegisterAndPublishPhotoUploadResponse | null> {
  const [privateSnapshot, publicationSnapshot] = await Promise.all([
    db.doc(`users/${ownerUid}/photos/${photoId}`).get(),
    db.doc(`users/${ownerUid}/photo_publications/${photoId}`).get(),
  ]);

  if (!privateSnapshot.exists || !publicationSnapshot.exists) {
    return null;
  }

  const privatePhoto = privateSnapshot.data() as PrivatePhotoDocument;
  const publication = publicationSnapshot.data() as PhotoPublicationDocument;
  const registeredPath = extractOwnedPrivatePhotoPathForId(
    ownerUid,
    photoId,
    privatePhoto.path ?? privatePhoto.url
  );
  const publishedSourcePath = extractOwnedPrivatePhotoPathForId(
    ownerUid,
    photoId,
    publication.sourceStoragePath
  );

  if (
    publication.isPublished !== true ||
    registeredPath !== storagePath ||
    publishedSourcePath !== storagePath
  ) {
    return null;
  }

  const metadata = await readRequiredPhotoMetadata(storagePath);

  return {
    ownerUid,
    photoId,
    storagePath,
    fileName: cleanFileName(privatePhoto.fileName),
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    createdAt: timestampToMillis(privatePhoto.createdAt),
    moderationStatus: normalizeModerationStatus(
      publication.moderationStatus
    ),
  };
}

export const registerAndPublishPhotoUpload = onCall<
  RegisterAndPublishPhotoUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RegisterAndPublishPhotoUploadResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !photoId || requesterUid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'A foto só pode ser publicada no perfil autenticado.'
      );
    }

    const storagePath = extractOwnedPrivatePhotoPathForId(
      ownerUid,
      photoId,
      request.data?.storagePath
    );

    if (!storagePath) {
      throw new HttpsError(
        'invalid-argument',
        'O caminho da foto não pertence ao staging informado.'
      );
    }

    const existingResponse = await findExistingPublishedResponse(
      ownerUid,
      photoId,
      storagePath
    );

    if (existingResponse) {
      await clearCleanupJobBestEffort(storagePath);
      return existingResponse;
    }

    try {
      await assertUploadEligibility(ownerUid);
    } catch (error) {
      await deleteStagingAssetBestEffort(storagePath, {
        ownerUid,
        photoId,
        reason: 'eligibility-denied',
      });
      throw error;
    }

    const metadata = await readRequiredPhotoMetadata(storagePath);
    const requestedMimeType = normalizeMimeType(request.data?.mimeType);
    const requestedSize = normalizePositiveInteger(request.data?.sizeBytes);

    if (
      (requestedMimeType && requestedMimeType !== metadata.mimeType) ||
      (requestedSize && requestedSize !== metadata.sizeBytes)
    ) {
      await deleteStagingAssetBestEffort(storagePath, {
        ownerUid,
        photoId,
        reason: 'metadata-mismatch',
      });
      throw new HttpsError(
        'failed-precondition',
        'Os metadados da foto enviada não correspondem ao arquivo armazenado.'
      );
    }

    const privatePhotoRef = db.doc(`users/${ownerUid}/photos/${photoId}`);
    const previousPrivateSnapshot = await privatePhotoRef.get();
    let createdPrivateDocument = false;
    const now = Date.now();
    const fileName = cleanFileName(request.data?.fileName);

    if (previousPrivateSnapshot.exists) {
      const previousPrivate = previousPrivateSnapshot.data() as PrivatePhotoDocument;
      const previousPath = extractOwnedPrivatePhotoPathForId(
        ownerUid,
        photoId,
        previousPrivate.path ?? previousPrivate.url
      );

      if (previousPath !== storagePath) {
        await deleteStagingAssetBestEffort(storagePath, {
          ownerUid,
          photoId,
          reason: 'photo-id-collision',
        });
        throw new HttpsError(
          'already-exists',
          'Esta identificação de foto já está em uso.'
        );
      }
    } else {
      await privatePhotoRef.create({
        id: photoId,
        url: storagePath,
        path: storagePath,
        fileName,
        createdAt: now,
        updatedAt: now,
      });
      createdPrivateDocument = true;
    }

    try {
      const publication = await publishPhotoCore.run(request);
      await clearCleanupJobBestEffort(storagePath);

      return {
        ownerUid,
        photoId,
        storagePath,
        fileName,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        createdAt: now,
        moderationStatus: normalizeModerationStatus(
          publication.moderationStatus
        ),
      };
    } catch (error) {
      if (createdPrivateDocument) {
        try {
          await privatePhotoRef.delete();
        } catch (cleanupError) {
          logger.warn('[photoUpload] Metadado privado pendente de limpeza.', {
            ownerUid,
            photoId,
            error: normalizeErrorMessage(cleanupError),
          });
        }
      }

      await deleteStagingAssetBestEffort(storagePath, {
        ownerUid,
        photoId,
        reason: 'publication-failed',
      });
      throw error;
    }
  }
);

export const indexPrivatePhotoUploadForCleanup = onObjectFinalized(
  { region: FUNCTIONS_REGION },
  async (event) => {
    const storagePath = String(event.data.name ?? '').trim();
    const parsed = parseOwnedPrivatePhotoStagingPath(storagePath);

    if (!parsed) {
      return;
    }

    const now = Date.now();
    const job: PhotoUploadCleanupJob = {
      ownerUid: parsed.ownerUid,
      photoId: parsed.photoId,
      storagePath,
      createdAt: now,
      expiresAt: now + CLEANUP_DELAY_MS,
      updatedAt: now,
      attempts: 0,
      lastError: null,
    };

    await db
      .collection(CLEANUP_COLLECTION)
      .doc(cleanupJobId(storagePath))
      .set(job, { merge: true });
  }
);

export const cleanupPendingPrivatePhotoUploadAssets = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 6 hours',
    timeZone: 'UTC',
    retryCount: 1,
  },
  async () => {
    const now = Date.now();
    const snapshot = await db
      .collection(CLEANUP_COLLECTION)
      .where('expiresAt', '<=', now)
      .orderBy('expiresAt', 'asc')
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    for (const jobSnapshot of snapshot.docs) {
      const job = jobSnapshot.data() as Partial<PhotoUploadCleanupJob>;
      const ownerUid = cleanId(job.ownerUid);
      const photoId = cleanId(job.photoId);
      const storagePath = extractOwnedPrivatePhotoPathForId(
        ownerUid,
        photoId,
        job.storagePath
      );

      if (!ownerUid || !photoId || !storagePath) {
        await jobSnapshot.ref.delete();
        continue;
      }

      try {
        const [privateSnapshot, publicationSnapshot] = await Promise.all([
          db.doc(`users/${ownerUid}/photos/${photoId}`).get(),
          db.doc(`users/${ownerUid}/photo_publications/${photoId}`).get(),
        ]);
        const privatePhoto = privateSnapshot.exists
          ? privateSnapshot.data() as PrivatePhotoDocument
          : null;
        const publication = publicationSnapshot.exists
          ? publicationSnapshot.data() as PhotoPublicationDocument
          : null;
        const registeredPath = privatePhoto
          ? extractOwnedPrivatePhotoPathForId(
            ownerUid,
            photoId,
            privatePhoto.path ?? privatePhoto.url
          )
          : null;
        const isActivePublication =
          publication?.isPublished === true && registeredPath === storagePath;

        if (isActivePublication) {
          await jobSnapshot.ref.delete();
          continue;
        }

        await storage
          .bucket()
          .file(storagePath)
          .delete({ ignoreNotFound: true });

        const batch = db.batch();

        if (privateSnapshot.exists && registeredPath === storagePath) {
          batch.delete(privateSnapshot.ref);
        }

        if (
          publicationSnapshot.exists &&
          publication?.isPublished !== true
        ) {
          batch.delete(publicationSnapshot.ref);
        }

        batch.delete(jobSnapshot.ref);
        await batch.commit();
      } catch (error) {
        await jobSnapshot.ref.set(
          {
            attempts: Number(job.attempts ?? 0) + 1,
            updatedAt: now,
            lastError: normalizeErrorMessage(error),
            expiresAt: now + CLEANUP_DELAY_MS,
          },
          { merge: true }
        );

        logger.warn('[photoUpload] Falha na limpeza agendada.', {
          ownerUid,
          photoId,
          error: normalizeErrorMessage(error),
        });
      }
    }
  }
);
