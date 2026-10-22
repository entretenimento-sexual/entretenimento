import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { deleteProfilePhotoResources } from './delete-profile-photo.handler';
import { deleteProfileVideoResources } from './delete-profile-video.handler';
import {
  MODERATION_EVIDENCE_COLLECTION,
  MODERATION_EVIDENCE_JOBS_COLLECTION,
  preserveModerationEvidence,
  rearmBlockedModerationEvidenceFromPublication,
} from './moderation-evidence-preservation.service';

const RETRY_BATCH_SIZE = 20;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

type CleanupIdentity = {
  ownerUid: string;
  mediaId: string;
  mediaType: 'PHOTO' | 'VIDEO';
  createdAt: number;
};

function matchingCleanupIdentity(
  job: FirebaseFirestore.DocumentSnapshot,
  identity: CleanupIdentity
): boolean {
  return job.exists &&
    job.get('status') === 'CLEANUP_PENDING' &&
    job.get('ownerUid') === identity.ownerUid &&
    job.get('mediaId') === identity.mediaId &&
    job.get('mediaType') === identity.mediaType &&
    job.get('createdAt') === identity.createdAt;
}

async function cleanupResolvedRemovedMedia(
  reportId: string,
  identity: CleanupIdentity
): Promise<boolean> {
  const reportSnap = await db.collection('moderation_reports').doc(reportId).get();
  if (!reportSnap.exists) return false;

  const report = reportSnap.data() ?? {};
  const targetType = String(report.targetType ?? '').trim().toLowerCase();
  const moderationAction = String(report.moderationAction ?? '').trim().toUpperCase();
  const evidenceStatus = String(report.evidencePreservationStatus ?? '').trim().toUpperCase();
  const ownerUid = cleanId(report.targetOwnerUid);
  const mediaId = cleanId(
    targetType === 'video'
      ? report.parentTargetId ?? report.targetId
      : report.targetId
  );

  if (
    (targetType !== 'photo' && targetType !== 'video') ||
    moderationAction !== 'REMOVE' ||
    evidenceStatus !== 'PRESERVED' ||
    ownerUid !== identity.ownerUid ||
    mediaId !== identity.mediaId ||
    identity.mediaType !== (targetType === 'photo' ? 'PHOTO' : 'VIDEO')
  ) return false;

  const evidenceSnap = await db.collection(MODERATION_EVIDENCE_COLLECTION).doc(reportId).get();
  if (!evidenceSnap.exists ||
      evidenceSnap.get('ownerUid') !== identity.ownerUid ||
      evidenceSnap.get('mediaId') !== identity.mediaId ||
      evidenceSnap.get('mediaType') !== identity.mediaType) return false;

  if (targetType === 'photo') {
    const result = await deleteProfilePhotoResources(ownerUid, mediaId, {
      allowQuarantined: true,
    });
    return result.cleanupPending === false;
  }

  const result = await deleteProfileVideoResources(ownerUid, mediaId, {
    allowQuarantined: true,
  });
  return result.cleanupPending === false;
}

async function finishPreservedCleanup(reportId: string): Promise<void> {
  const jobRef = db.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId);
  const jobBefore = await jobRef.get();
  const identity: CleanupIdentity = {
    ownerUid: cleanId(jobBefore.get('ownerUid')),
    mediaId: cleanId(jobBefore.get('mediaId')),
    mediaType: jobBefore.get('mediaType'),
    createdAt: jobBefore.get('createdAt'),
  };
  if (
    !identity.ownerUid || !identity.mediaId ||
    (identity.mediaType !== 'PHOTO' && identity.mediaType !== 'VIDEO') ||
    typeof identity.createdAt !== 'number' ||
    !matchingCleanupIdentity(jobBefore, identity)
  ) return;

  if (!await cleanupResolvedRemovedMedia(reportId, identity)) return;

  // Prevent acknowledging a replaced job or changed report/evidence after physical deletion.
  await db.runTransaction(async (tx) => {
    const reportRef = db.collection('moderation_reports').doc(reportId);
    const evidenceRef = db.collection(MODERATION_EVIDENCE_COLLECTION).doc(reportId);
    const [job, report, evidence] = await Promise.all([
      tx.get(jobRef), tx.get(reportRef), tx.get(evidenceRef),
    ]);
    const targetType = identity.mediaType === 'PHOTO' ? 'photo' : 'video';
    const reportMediaId = targetType === 'video'
      ? report.get('parentTargetId') ?? report.get('targetId')
      : report.get('targetId');
    if (
      matchingCleanupIdentity(job, identity) &&
      report.exists &&
      report.get('moderationAction') === 'REMOVE' &&
      report.get('evidencePreservationStatus') === 'PRESERVED' &&
      report.get('targetOwnerUid') === identity.ownerUid &&
      String(report.get('targetType') ?? '').toLowerCase() === targetType &&
      reportMediaId === identity.mediaId &&
      evidence.exists &&
      evidence.get('ownerUid') === identity.ownerUid &&
      evidence.get('mediaId') === identity.mediaId &&
      evidence.get('mediaType') === identity.mediaType
    ) tx.delete(jobRef);
  });
}

export const retryPendingModerationEvidencePreservation = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 15 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const jobsSnapshot = await db
      .collection(MODERATION_EVIDENCE_JOBS_COLLECTION)
      .where('status', '==', 'PENDING')
      .limit(RETRY_BATCH_SIZE)
      .get();

    const blockedSnapshot = await db
      .collection(MODERATION_EVIDENCE_JOBS_COLLECTION)
      .where('status', '==', 'BLOCKED_SOURCE_PATH')
      .limit(RETRY_BATCH_SIZE)
      .get();
    for (const blocked of blockedSnapshot.docs) {
      try {
        if (await rearmBlockedModerationEvidenceFromPublication(blocked.id)) {
          await preserveModerationEvidence(blocked.id);
          await finishPreservedCleanup(blocked.id);
        }
      } catch (error) {
        logger.error('[retryPendingModerationEvidencePreservation] Rearme falhou.', {
          reportId: blocked.id,
          error: error instanceof Error ? error.message.slice(0, 500) : String(error),
        });
      }
    }

    const cleanupSnapshot = await db
      .collection(MODERATION_EVIDENCE_JOBS_COLLECTION)
      .where('status', '==', 'CLEANUP_PENDING')
      .limit(RETRY_BATCH_SIZE)
      .get();
    for (const cleanup of cleanupSnapshot.docs) {
      try {
        await finishPreservedCleanup(cleanup.id);
      } catch (error) {
        logger.error('[retryPendingModerationEvidencePreservation] Limpeza pendente.', {
          reportId: cleanup.id,
          error: error instanceof Error ? error.message.slice(0, 500) : String(error),
        });
      }
    }

    for (const jobDoc of jobsSnapshot.docs) {
      try {
        await preserveModerationEvidence(jobDoc.id);
        await finishPreservedCleanup(jobDoc.id);
      } catch (error) {
        logger.error(
          '[retryPendingModerationEvidencePreservation] Falha no retry.',
          {
            reportId: jobDoc.id,
            error: error instanceof Error
              ? error.message.slice(0, 500)
              : String(error ?? '').slice(0, 500),
          }
        );
      }
    }
  }
);
