import { createHash, randomUUID } from 'node:crypto';

import { logger } from 'firebase-functions';

import { db, storage } from '../../firebaseApp';
import type {
  VideoPlaybackMimeType,
  VideoPlaybackQuality,
  VideoProcessingVariant,
} from './video-processing-output';
import {
  buildPublishedVideoPosterPath,
  buildPublishedVideoVariantPath,
  normalizeOwnedProcessedVideoPath,
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

interface PrivateVideoProcessingDocument {
  status?: string;
  playbackPath?: string;
  processedStoragePath?: string;
  processedMimeType?: string;
  processedSizeBytes?: number;
  processedVariants?: unknown;
  processedDefaultQuality?: unknown;
}

export interface PublishedVideoVariantAsset {
  quality: VideoPlaybackQuality;
  storagePath: string;
  contentType: VideoPlaybackMimeType;
  sizeBytes: number;
}

export interface PublishedVideoAssetResult {
  /** Variante padrão mantida para compatibilidade com leitores antigos. */
  videoStoragePath: string;
  posterStoragePath: string | null;
  videoContentType: VideoPlaybackMimeType;
  sizeBytes: number;
  variants: PublishedVideoVariantAsset[];
  defaultQuality: VideoPlaybackQuality;
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
const ALLOWED_VIDEO_CONTENT_TYPES = new Set<VideoPlaybackMimeType>([
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

  return Math.trunc(sizeBytes);
}

function normalizeQuality(value: unknown): VideoPlaybackQuality | null {
  const quality = String(value ?? '').trim().toUpperCase();
  return quality === 'SD' || quality === 'HD' ? quality : null;
}

function normalizeVideoMimeType(value: unknown): VideoPlaybackMimeType | null {
  const mimeType = String(value ?? '').trim().toLowerCase() as
    VideoPlaybackMimeType;
  return ALLOWED_VIDEO_CONTENT_TYPES.has(mimeType) ? mimeType : null;
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

function normalizeProcessedVariants(
  ownerUid: string,
  videoId: string,
  privateVideo: PrivateVideoProcessingDocument
): {
  variants: VideoProcessingVariant[];
  defaultQuality: VideoPlaybackQuality;
} {
  const normalized = (Array.isArray(privateVideo.processedVariants)
    ? privateVideo.processedVariants
    : []
  ).flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) {
      return [];
    }

    const data = candidate as Partial<VideoProcessingVariant>;
    const quality = normalizeQuality(data.quality);
    const storagePath = normalizeOwnedProcessedVideoPath(
      ownerUid,
      videoId,
      data.storagePath
    );
    const mimeType = normalizeVideoMimeType(data.mimeType);
    const sizeBytes = Number(data.sizeBytes ?? 0);

    return quality && storagePath && mimeType &&
      Number.isFinite(sizeBytes) && sizeBytes > 0
      ? [{
          quality,
          storagePath,
          mimeType,
          sizeBytes: Math.trunc(sizeBytes),
        }]
      : [];
  });
  const byQuality = new Map<VideoPlaybackQuality, VideoProcessingVariant>();

  for (const variant of normalized) {
    byQuality.set(variant.quality, variant);
  }

  let variants = [...byQuality.values()].sort((left, right) =>
    left.quality === right.quality
      ? 0
      : left.quality === 'SD'
        ? -1
        : 1
  );

  if (!variants.length) {
    const legacyStoragePath =
      normalizeOwnedProcessedVideoPath(
        ownerUid,
        videoId,
        privateVideo.processedStoragePath
      ) ??
      normalizeOwnedProcessedVideoPath(
        ownerUid,
        videoId,
        privateVideo.playbackPath
      );
    const legacyMimeType = normalizeVideoMimeType(
      privateVideo.processedMimeType
    );
    const legacySizeBytes = Number(privateVideo.processedSizeBytes ?? 0);

    if (
      legacyStoragePath &&
      legacyMimeType &&
      Number.isFinite(legacySizeBytes) &&
      legacySizeBytes > 0
    ) {
      variants = [{
        quality: 'HD',
        storagePath: legacyStoragePath,
        mimeType: legacyMimeType,
        sizeBytes: Math.trunc(legacySizeBytes),
      }];
    }
  }

  if (!variants.length) {
    throw new Error(
      'O vídeo ainda não possui derivados processados para publicação.'
    );
  }

  const requestedDefault = normalizeQuality(
    privateVideo.processedDefaultQuality
  );
  const defaultQuality = requestedDefault && variants.some(
    (variant) => variant.quality === requestedDefault
  )
    ? requestedDefault
    : variants.some((variant) => variant.quality === 'HD')
      ? 'HD'
      : 'SD';

  return { variants, defaultQuality };
}

async function resolveProcessedVideoSources(
  command: CopyPublishedVideoAssetCommand
): Promise<{
  variants: VideoProcessingVariant[];
  defaultQuality: VideoPlaybackQuality;
}> {
  const privateVideoSnap = await db
    .doc(`users/${command.ownerUid}/videos/${command.videoId}`)
    .get();

  if (!privateVideoSnap.exists) {
    throw new Error('O vídeo privado não foi encontrado para publicação.');
  }

  const privateVideo =
    privateVideoSnap.data() as PrivateVideoProcessingDocument;
  const status = String(privateVideo.status ?? '').trim().toLowerCase();

  if (status !== 'ready') {
    throw new Error('O vídeo ainda não está pronto para publicação.');
  }

  return normalizeProcessedVariants(
    command.ownerUid,
    command.videoId,
    privateVideo
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

async function copyVariant(
  command: CopyPublishedVideoAssetCommand,
  variant: VideoProcessingVariant,
  assetVersion: string
): Promise<PublishedVideoVariantAsset> {
  const bucket = storage.bucket();
  const sourceVideo = bucket.file(variant.storagePath);
  const [videoExists] = await sourceVideo.exists();

  if (!videoExists) {
    throw new Error(
      `A variante ${variant.quality} processada não foi encontrada.`
    );
  }

  const [videoMetadata] = await sourceVideo.getMetadata();
  const metadataContentType = normalizeVideoMimeType(videoMetadata.contentType);

  if (!metadataContentType || metadataContentType !== variant.mimeType) {
    throw new Error(
      `A variante ${variant.quality} não possui MIME público compatível.`
    );
  }

  const sizeBytes = resolveValidatedSize(
    videoMetadata.size,
    MAX_PUBLISHED_VIDEO_BYTES
  );
  const destinationPath = buildPublishedVideoVariantPath(
    command.ownerUid,
    command.videoId,
    assetVersion,
    variant.quality,
    metadataContentType
  );
  const destinationVideo = bucket.file(destinationPath);

  await sourceVideo.copy(destinationVideo, {
    metadata: {
      contentType: metadataContentType,
      contentDisposition: 'inline',
      cacheControl: 'private, max-age=0, no-store, no-transform',
    },
  });

  return {
    quality: variant.quality,
    storagePath: destinationPath,
    contentType: metadataContentType,
    sizeBytes,
  };
}

export async function copyPrivateVideoToPublishedAsset(
  command: CopyPublishedVideoAssetCommand
): Promise<PublishedVideoAssetResult> {
  const processed = await resolveProcessedVideoSources(command);
  const assetVersion = `${Date.now()}-${randomUUID()}`;
  const copiedVariantPaths: string[] = [];
  let posterStoragePath: string | null = null;

  try {
    const variants: PublishedVideoVariantAsset[] = [];

    for (const variant of processed.variants) {
      const publishedVariant = await copyVariant(
        command,
        variant,
        assetVersion
      );
      variants.push(publishedVariant);
      copiedVariantPaths.push(publishedVariant.storagePath);
    }

    const poster = await copyPosterIfAvailable(command, assetVersion);
    posterStoragePath = poster?.storagePath ?? null;

    const defaultVariant = variants.find(
      (variant) => variant.quality === processed.defaultQuality
    ) ?? variants[0];

    if (!defaultVariant) {
      throw new Error('Nenhuma variante publicada foi criada.');
    }

    return {
      videoStoragePath: defaultVariant.storagePath,
      posterStoragePath,
      videoContentType: defaultVariant.contentType,
      sizeBytes: defaultVariant.sizeBytes,
      variants,
      defaultQuality: defaultVariant.quality,
    };
  } catch (error) {
    const cleanupPaths = [
      ...copiedVariantPaths,
      ...(posterStoragePath ? [posterStoragePath] : []),
    ];

    await Promise.all(
      cleanupPaths.map((storagePath) =>
        storage.bucket().file(storagePath)
          .delete({ ignoreNotFound: true })
          .catch(() => undefined)
      )
    );
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
