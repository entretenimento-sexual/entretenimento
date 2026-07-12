import { createHash, randomUUID } from 'node:crypto';

import { logger } from 'firebase-functions';

import { db, storage } from '../../firebaseApp';
import {
  buildPublishedVideoPath,
  buildPublishedVideoPosterPath,
  normalizeOwnedPublishedVideoPath,
  normalizeOwnedPublishedVideoPosterPath,
} from './video-storage-path';

interface PublishedVideoAssetCleanupJob {
  ownerUid: string;
  videoId: string;
  storagePath: string;
  assetKind: 'video' | 'poster';
  reason: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

interface CopyPublishedVideoAssetCommand {
  ownerUid: string;
  videoId: string;
  sourceVideoStoragePath: string;
  sourcePosterStoragePath?: string | null;
}

interface PublishedVideoAssetResult {
  videoStoragePath: string;
  posterStoragePath: string | null;
  videoContentType: string;
  sizeBytes: number;
}

interface DeletePublishedVideoAssetCommand {
  ownerUid: string;
  videoId: string;
  storagePath: string | null | undefined;
  assetKind: 'video' | 'poster';
  reason: string;
}

const CLEANUP_COLLECTION = 'media_published_video_asset_cleanup_jobs';
const MAX_PUBLISHED_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_PUBLISHED_POSTER_BYTES = 10 * 1024 * 1024;
const ALLOWED_VIDEO_CONTENT_TYPES = new Set([
  'video/mp4',
  'video/webm',
]);
const ALLOWED_POSTER_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function buildCleanupJobId(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

function resolveValidatedSize(value: unknown, maxBytes: number): number {
  const sizeBytes = Number(value ?? 0);

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error('Não foi possível validar o tamanho do arquivo.');
  }

  if (sizeBytes > maxBytes) {
    throw new Error('O arquivo excede o limite permitido para publicação.');
  }

  return sizeBytes;
}

function normalizePublishedAssetPath(
  ownerUid: string,
  videoId: string,
  storagePath: unknown,
  assetKind: 'video' | 'poster'
): string | null {
  if (assetKind === 'video') {
    return normalizeOwnedPublishedVideoPath(
      ownerUid,
      videoId,
      storagePath
    );
  }

  return normalizeOwnedPublishedVideoPosterPath(
    ownerUid,
    videoId,
    storagePath
  );
}

async function enqueuePublishedVideoAssetCleanup(
  command: DeletePublishedVideoAssetCommand,
  storagePath: string,
  error: unknown
): Promise<void> {
  const now = Date.now();
  const job: PublishedVideoAssetCleanupJob = {
    ownerUid: command.ownerUid,
    videoId: command.videoId,
    storagePath,
    assetKind: command.assetKind,
    reason: command.reason,
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    lastError: normalizeErrorMessage(error),
  };

  await db
    .collection(CLEANUP_COLLECTION)
    .doc(buildCleanupJobId(storagePath))
    .set(job, { merge: true });
}

async function copyPosterIfAvailable(
  command: CopyPublishedVideoAssetCommand,
  assetVersion: string
): Promise<{
  storagePath: string;
  contentType: string;
} | null> {
  if (!command.sourcePosterStoragePath) {
    return null;
  }

  const bucket = storage.bucket();
  const sourcePoster = bucket.file(command.sourcePosterStoragePath);
  const [posterExists] = await sourcePoster.exists();

  if (!posterExists) {
    return null;
  }

  const [posterMetadata] = await sourcePoster.getMetadata();
  const posterContentType = String(
    posterMetadata.contentType ?? ''
  ).toLowerCase();

  if (!ALLOWED_POSTER_CONTENT_TYPES.has(posterContentType)) {
    throw new Error('O poster privado não é uma imagem suportada.');
  }

  resolveValidatedSize(posterMetadata.size, MAX_PUBLISHED_POSTER_BYTES);

  const destinationPath = buildPublishedVideoPosterPath(
    command.ownerUid,
    command.videoId,
    assetVersion
  );
  const destinationPoster = bucket.file(destinationPath);

  try {
    await sourcePoster.copy(destinationPoster, {
      metadata: {
        contentType: posterContentType,
        contentDisposition: 'inline',
        cacheControl: 'private, max-age=0, no-store, no-transform',
      },
    });
  } catch (error) {
    await destinationPoster
      .delete({ ignoreNotFound: true })
      .catch(() => undefined);
    throw error;
  }

  return {
    storagePath: destinationPath,
    contentType: posterContentType,
  };
}

export async function copyPrivateVideoToPublishedAsset(
  command: CopyPublishedVideoAssetCommand
): Promise<PublishedVideoAssetResult> {
  const bucket = storage.bucket();
  const sourceVideo = bucket.file(command.sourceVideoStoragePath);
  const [videoExists] = await sourceVideo.exists();

  if (!videoExists) {
    throw new Error('O arquivo privado do vídeo não foi encontrado.');
  }

  const [videoMetadata] = await sourceVideo.getMetadata();
  const videoContentType = String(videoMetadata.contentType ?? '').toLowerCase();

  if (!ALLOWED_VIDEO_CONTENT_TYPES.has(videoContentType)) {
    throw new Error(
      'A publicação pública aceita somente vídeos MP4 ou WebM.'
    );
  }

  const sizeBytes = resolveValidatedSize(
    videoMetadata.size,
    MAX_PUBLISHED_VIDEO_BYTES
  );
  const assetVersion = `${Date.now()}-${randomUUID()}`;
  const videoStoragePath = buildPublishedVideoPath(
    command.ownerUid,
    command.videoId,
    assetVersion
  );
  const destinationVideo = bucket.file(videoStoragePath);
  let posterStoragePath: string | null = null;

  try {
    await sourceVideo.copy(destinationVideo, {
      metadata: {
        contentType: videoContentType,
        contentDisposition: 'inline',
        cacheControl: 'private, max-age=0, no-store, no-transform',
      },
    });

    const poster = await copyPosterIfAvailable(command, assetVersion);
    posterStoragePath = poster?.storagePath ?? null;

    return {
      videoStoragePath,
      posterStoragePath,
      videoContentType,
      sizeBytes,
    };
  } catch (error) {
    const cleanupTasks: Promise<unknown>[] = [
      destinationVideo.delete({ ignoreNotFound: true }).catch(() => undefined),
    ];

    if (posterStoragePath) {
      cleanupTasks.push(
        bucket
          .file(posterStoragePath)
          .delete({ ignoreNotFound: true })
          .catch(() => undefined)
      );
    }

    await Promise.all(cleanupTasks);
    throw error;
  }
}

export async function deletePublishedVideoAssetOrQueue(
  command: DeletePublishedVideoAssetCommand
): Promise<boolean> {
  const storagePath = normalizePublishedAssetPath(
    command.ownerUid,
    command.videoId,
    command.storagePath,
    command.assetKind
  );

  if (!storagePath) {
    return true;
  }

  try {
    await storage
      .bucket()
      .file(storagePath)
      .delete({ ignoreNotFound: true });

    await db
      .collection(CLEANUP_COLLECTION)
      .doc(buildCleanupJobId(storagePath))
      .delete()
      .catch(() => undefined);

    return true;
  } catch (error) {
    await enqueuePublishedVideoAssetCleanup(command, storagePath, error);

    logger.error('[publishedVideoAsset] Limpeza física pendente.', {
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      assetKind: command.assetKind,
      reason: command.reason,
      storagePath,
      error: normalizeErrorMessage(error),
    });

    return false;
  }
}

export async function processPendingPublishedVideoAssetCleanupJobs(
  batchSize = 50
): Promise<void> {
  const jobsSnapshot = await db
    .collection(CLEANUP_COLLECTION)
    .limit(batchSize)
    .get();

  for (const jobDoc of jobsSnapshot.docs) {
    const job = jobDoc.data() as PublishedVideoAssetCleanupJob;
    const storagePath = normalizePublishedAssetPath(
      job.ownerUid,
      job.videoId,
      job.storagePath,
      job.assetKind
    );

    if (!storagePath) {
      logger.error('[publishedVideoAsset] Job de limpeza inválido.', {
        jobId: jobDoc.id,
      });
      continue;
    }

    try {
      await storage
        .bucket()
        .file(storagePath)
        .delete({ ignoreNotFound: true });
      await jobDoc.ref.delete();
    } catch (error) {
      await jobDoc.ref.set(
        {
          attempts: Number(job.attempts ?? 0) + 1,
          updatedAt: Date.now(),
          lastError: normalizeErrorMessage(error),
        },
        { merge: true }
      );

      logger.error('[publishedVideoAsset] Falha no retry de limpeza.', {
        jobId: jobDoc.id,
        ownerUid: job.ownerUid,
        videoId: job.videoId,
        assetKind: job.assetKind,
        error: normalizeErrorMessage(error),
      });
    }
  }
}
