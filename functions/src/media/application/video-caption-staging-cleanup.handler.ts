import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onObjectFinalized } from 'firebase-functions/v2/storage';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import { extractOwnedPrivateVideoCaptionPath } from './video-storage-path';

interface CaptionTrackDocument {
  storagePath?: unknown;
}

interface CaptionCleanupJob {
  ownerUid: string;
  videoId: string;
  storagePath: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  attempts: number;
  lastError: string | null;
}

const CLEANUP_COLLECTION = 'media_video_caption_staging_cleanup_jobs';
const LEGACY_UPLOAD_CLEANUP_COLLECTION =
  'media_private_video_upload_cleanup_jobs';
const CLEANUP_DELAY_MS = 6 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 100;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : String(error ?? 'unknown').slice(0, 500);
}

function cleanupJobId(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

function parseCaptionPath(value: unknown): {
  ownerUid: string;
  videoId: string;
  storagePath: string;
} | null {
  const storagePath = String(value ?? '').trim().replace(/^\/+/, '');
  const match = storagePath.match(
    /^users\/([^/]+)\/uploads\/video-captions\/([^/]+)\/[^/]+[.]vtt$/
  );

  if (!match) {
    return null;
  }

  const ownerUid = cleanId(match[1]);
  const videoId = cleanId(match[2]);
  const validatedPath = extractOwnedPrivateVideoCaptionPath(
    ownerUid,
    videoId,
    storagePath
  );

  return ownerUid && videoId && validatedPath
    ? { ownerUid, videoId, storagePath: validatedPath }
    : null;
}

function registeredCaptionPath(
  ownerUid: string,
  videoId: string,
  value: unknown
): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }

    const path = extractOwnedPrivateVideoCaptionPath(
      ownerUid,
      videoId,
      (candidate as CaptionTrackDocument).storagePath
    );

    if (path) {
      return path;
    }
  }

  return null;
}

async function isCaptionRegistered(
  ownerUid: string,
  videoId: string,
  storagePath: string
): Promise<boolean> {
  const snapshot = await db.doc(`users/${ownerUid}/videos/${videoId}`).get();

  if (!snapshot.exists) {
    return false;
  }

  return registeredCaptionPath(
    ownerUid,
    videoId,
    snapshot.data()?.['captionTracks']
  ) === storagePath;
}

async function enqueueCleanup(
  ownerUid: string,
  videoId: string,
  storagePath: string,
  delayMs = CLEANUP_DELAY_MS
): Promise<void> {
  const now = Date.now();
  const job: CaptionCleanupJob = {
    ownerUid,
    videoId,
    storagePath,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + Math.max(0, delayMs),
    attempts: 0,
    lastError: null,
  };

  await db
    .collection(CLEANUP_COLLECTION)
    .doc(cleanupJobId(storagePath))
    .set(job, { merge: true });
}

async function deleteCaptionBestEffort(
  ownerUid: string,
  videoId: string,
  storagePath: string
): Promise<void> {
  try {
    await storage.bucket().file(storagePath).delete({ ignoreNotFound: true });
  } catch (error) {
    await enqueueCleanup(ownerUid, videoId, storagePath, 0);
    logger.warn('[videoCaptionCleanup] Limpeza física pendente.', {
      ownerUid,
      videoId,
      error: normalizeErrorMessage(error),
    });
  }
}

export const indexPrivateVideoCaptionForCleanup = onObjectFinalized(
  { region: FUNCTIONS_REGION },
  async (event) => {
    const parsed = parseCaptionPath(event.data.name);

    if (!parsed) {
      return;
    }

    await enqueueCleanup(
      parsed.ownerUid,
      parsed.videoId,
      parsed.storagePath
    );
  }
);

export const cleanupVideoCaptionsOnDelete = onDocumentDeleted(
  {
    region: FUNCTIONS_REGION,
    document: 'users/{ownerUid}/videos/{videoId}',
  },
  async (event) => {
    const ownerUid = cleanId(event.params.ownerUid);
    const videoId = cleanId(event.params.videoId);
    const captionTracks = event.data?.data()?.['captionTracks'];

    if (!ownerUid || !videoId || !Array.isArray(captionTracks)) {
      return;
    }

    const paths = new Set<string>();

    for (const candidate of captionTracks) {
      if (typeof candidate !== 'object' || candidate === null) {
        continue;
      }

      const storagePath = extractOwnedPrivateVideoCaptionPath(
        ownerUid,
        videoId,
        (candidate as CaptionTrackDocument).storagePath
      );

      if (storagePath) {
        paths.add(storagePath);
      }
    }

    await Promise.all(
      [...paths].map((storagePath) =>
        deleteCaptionBestEffort(ownerUid, videoId, storagePath)
      )
    );
  }
);

async function processCaptionCleanupJob(
  jobRef: FirebaseFirestore.DocumentReference,
  job: Partial<CaptionCleanupJob>,
  now: number
): Promise<void> {
  const ownerUid = cleanId(job.ownerUid);
  const videoId = cleanId(job.videoId);
  const storagePath = extractOwnedPrivateVideoCaptionPath(
    ownerUid,
    videoId,
    job.storagePath
  );

  if (!ownerUid || !videoId || !storagePath) {
    await jobRef.delete();
    return;
  }

  try {
    if (await isCaptionRegistered(ownerUid, videoId, storagePath)) {
      await jobRef.delete();
      await db
        .collection(LEGACY_UPLOAD_CLEANUP_COLLECTION)
        .doc(cleanupJobId(storagePath))
        .delete()
        .catch(() => undefined);
      return;
    }

    await storage.bucket().file(storagePath).delete({ ignoreNotFound: true });
    await jobRef.delete();
    await db
      .collection(LEGACY_UPLOAD_CLEANUP_COLLECTION)
      .doc(cleanupJobId(storagePath))
      .delete()
      .catch(() => undefined);
  } catch (error) {
    await jobRef.set(
      {
        attempts: Number(job.attempts ?? 0) + 1,
        updatedAt: now,
        expiresAt: now + CLEANUP_DELAY_MS,
        lastError: normalizeErrorMessage(error),
      },
      { merge: true }
    );

    logger.warn('[videoCaptionCleanup] Falha no retry.', {
      ownerUid,
      videoId,
      error: normalizeErrorMessage(error),
    });
  }
}

export const cleanupPendingPrivateVideoCaptions = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 2,
  },
  async () => {
    const now = Date.now();
    const [stagingSnapshot, legacySnapshot] = await Promise.all([
      db
        .collection(CLEANUP_COLLECTION)
        .where('expiresAt', '<=', now)
        .orderBy('expiresAt', 'asc')
        .limit(CLEANUP_BATCH_SIZE)
        .get(),
      db
        .collection(LEGACY_UPLOAD_CLEANUP_COLLECTION)
        .where('assetKind', '==', 'caption')
        .limit(CLEANUP_BATCH_SIZE)
        .get(),
    ]);

    for (const snapshot of stagingSnapshot.docs) {
      await processCaptionCleanupJob(snapshot.ref, snapshot.data(), now);
    }

    for (const legacySnapshotDoc of legacySnapshot.docs) {
      const data = legacySnapshotDoc.data() as Partial<CaptionCleanupJob>;
      const parsed = parseCaptionPath(data.storagePath);

      if (!parsed) {
        await legacySnapshotDoc.ref.delete();
        continue;
      }

      const stagingRef = db
        .collection(CLEANUP_COLLECTION)
        .doc(cleanupJobId(parsed.storagePath));
      await stagingRef.set(
        {
          ownerUid: parsed.ownerUid,
          videoId: parsed.videoId,
          storagePath: parsed.storagePath,
          createdAt: Number(data.createdAt ?? now),
          updatedAt: now,
          expiresAt: now,
          attempts: Number(data.attempts ?? 0),
          lastError: data.lastError ?? null,
        },
        { merge: true }
      );
      await processCaptionCleanupJob(
        stagingRef,
        {
          ...data,
          ownerUid: parsed.ownerUid,
          videoId: parsed.videoId,
          storagePath: parsed.storagePath,
        },
        now
      );
      await legacySnapshotDoc.ref.delete().catch(() => undefined);
    }
  }
);