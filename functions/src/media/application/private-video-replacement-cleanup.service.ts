import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

export interface PrivateVideoReplacementCleanupInput {
  ownerUid: string;
  videoId: string;
  sourceStoragePath: string | null;
  posterStoragePath: string | null;
  processedOutputPrefix: string | null;
}

interface PrivateVideoReplacementCleanupJob
  extends PrivateVideoReplacementCleanupInput {
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

interface PrivateVideoDocument {
  path?: unknown;
  url?: unknown;
  thumbnailPath?: unknown;
  thumbnailUrl?: unknown;
  processedOutputPrefix?: unknown;
}

const CLEANUP_COLLECTION = 'media_private_video_replacement_cleanup_jobs';
const CLEANUP_BATCH_SIZE = 25;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeProcessedOutputPrefix(
  ownerUid: string,
  videoId: string,
  value: unknown
): string | null {
  const normalized = String(value ?? '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const escapedOwner = ownerUid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedVideo = videoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expected = new RegExp(
    `^users/${escapedOwner}/processed/videos/${escapedVideo}/[^/]+$`
  );

  return expected.test(normalized) ? `${normalized}/` : null;
}

function normalizeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? 'unknown'))
    .trim()
    .slice(0, 500);
}

function cleanupJobId(input: PrivateVideoReplacementCleanupInput): string {
  return createHash('sha256')
    .update([
      input.ownerUid,
      input.videoId,
      input.sourceStoragePath ?? '',
      input.posterStoragePath ?? '',
      input.processedOutputPrefix ?? '',
    ].join(':'))
    .digest('hex');
}

function logIdentity(ownerUid: string, videoId: string): string {
  return createHash('sha256')
    .update(`${ownerUid}:${videoId}`)
    .digest('hex')
    .slice(0, 16);
}

function normalizeInput(
  input: PrivateVideoReplacementCleanupInput
): PrivateVideoReplacementCleanupInput | null {
  const ownerUid = cleanId(input.ownerUid);
  const videoId = cleanId(input.videoId);

  if (!ownerUid || !videoId) return null;

  const sourceStoragePath = input.sourceStoragePath
    ? extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      input.sourceStoragePath
    )
    : null;
  const posterStoragePath = input.posterStoragePath
    ? extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      input.posterStoragePath
    )
    : null;
  const processedOutputPrefix = input.processedOutputPrefix
    ? normalizeProcessedOutputPrefix(
      ownerUid,
      videoId,
      input.processedOutputPrefix
    )
    : null;

  if (
    (input.sourceStoragePath && !sourceStoragePath) ||
    (input.posterStoragePath && !posterStoragePath) ||
    (input.processedOutputPrefix && !processedOutputPrefix)
  ) {
    return null;
  }

  return {
    ownerUid,
    videoId,
    sourceStoragePath,
    posterStoragePath,
    processedOutputPrefix,
  };
}

async function readCurrentReferences(
  ownerUid: string,
  videoId: string
): Promise<{
  sourceStoragePath: string | null;
  posterStoragePath: string | null;
  processedOutputPrefix: string | null;
}> {
  const snapshot = await db.doc(`users/${ownerUid}/videos/${videoId}`).get();

  if (!snapshot.exists) {
    return {
      sourceStoragePath: null,
      posterStoragePath: null,
      processedOutputPrefix: null,
    };
  }

  const video = snapshot.data() as PrivateVideoDocument;
  return {
    sourceStoragePath:
      extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
      extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url),
    posterStoragePath:
      extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        video.thumbnailPath
      ) ??
      extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        video.thumbnailUrl
      ),
    processedOutputPrefix: normalizeProcessedOutputPrefix(
      ownerUid,
      videoId,
      video.processedOutputPrefix
    ),
  };
}

async function deleteOutputPrefix(prefix: string): Promise<void> {
  const [files] = await storage.bucket().getFiles({ prefix });
  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
}

async function executeCleanup(
  input: PrivateVideoReplacementCleanupInput
): Promise<void> {
  const current = await readCurrentReferences(input.ownerUid, input.videoId);
  const tasks: Promise<unknown>[] = [];

  if (
    input.sourceStoragePath &&
    input.sourceStoragePath !== current.sourceStoragePath
  ) {
    tasks.push(
      storage
        .bucket()
        .file(input.sourceStoragePath)
        .delete({ ignoreNotFound: true })
    );
  }

  if (
    input.posterStoragePath &&
    input.posterStoragePath !== current.posterStoragePath
  ) {
    tasks.push(
      storage
        .bucket()
        .file(input.posterStoragePath)
        .delete({ ignoreNotFound: true })
    );
  }

  if (
    input.processedOutputPrefix &&
    input.processedOutputPrefix !== current.processedOutputPrefix
  ) {
    tasks.push(deleteOutputPrefix(input.processedOutputPrefix));
  }

  await Promise.all(tasks);
}

async function queueCleanup(
  input: PrivateVideoReplacementCleanupInput,
  error: unknown
): Promise<void> {
  const ref = db.collection(CLEANUP_COLLECTION).doc(cleanupJobId(input));
  const snapshot = await ref.get();
  const previous = snapshot.exists
    ? snapshot.data() as Partial<PrivateVideoReplacementCleanupJob>
    : null;
  const now = Date.now();

  await ref.set({
    ...input,
    createdAt: Number(previous?.createdAt ?? now),
    updatedAt: now,
    attempts: Math.max(0, Number(previous?.attempts ?? 0)) + 1,
    lastError: normalizeErrorMessage(error),
  } satisfies PrivateVideoReplacementCleanupJob);
}

export async function cleanupReplacedPrivateVideoAssetsOrQueue(
  input: PrivateVideoReplacementCleanupInput
): Promise<boolean> {
  const normalized = normalizeInput(input);

  if (!normalized) {
    logger.error('[privateVideoReplacementCleanup] Entrada inválida.');
    return false;
  }

  try {
    await executeCleanup(normalized);
    await db
      .collection(CLEANUP_COLLECTION)
      .doc(cleanupJobId(normalized))
      .delete()
      .catch(() => undefined);
    return true;
  } catch (error) {
    await queueCleanup(normalized, error);
    logger.warn('[privateVideoReplacementCleanup] Limpeza pendente.', {
      identity: logIdentity(normalized.ownerUid, normalized.videoId),
      error: normalizeErrorMessage(error),
    });
    return false;
  }
}

export const cleanupPendingPrivateVideoReplacementAssets = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 30 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const snapshot = await db
      .collection(CLEANUP_COLLECTION)
      .orderBy('updatedAt', 'asc')
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    for (const document of snapshot.docs) {
      const job = normalizeInput(
        document.data() as PrivateVideoReplacementCleanupJob
      );

      if (!job) {
        await document.ref.delete();
        continue;
      }

      try {
        await executeCleanup(job);
        await document.ref.delete();
      } catch (error) {
        const previous = document.data() as PrivateVideoReplacementCleanupJob;
        await document.ref.set({
          updatedAt: Date.now(),
          attempts: Math.max(0, Number(previous.attempts ?? 0)) + 1,
          lastError: normalizeErrorMessage(error),
        }, { merge: true });

        logger.warn('[privateVideoReplacementCleanup] Retry pendente.', {
          identity: logIdentity(job.ownerUid, job.videoId),
          attempts: Math.max(0, Number(previous.attempts ?? 0)) + 1,
          error: normalizeErrorMessage(error),
        });
      }
    }
  }
);
