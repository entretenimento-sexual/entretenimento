import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { deleteProfilePhotoResources } from './delete-profile-photo.handler';
import { deleteProfileVideoResources } from './delete-profile-video.handler';
import {
  MODERATION_EVIDENCE_JOBS_COLLECTION,
  preserveModerationEvidence,
  rearmBlockedModerationEvidenceFromPublication,
} from './moderation-evidence-preservation.service';

const RETRY_BATCH_SIZE = 20;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

async function cleanupResolvedRemovedMedia(reportId: string): Promise<boolean> {
  const reportSnap = await db.collection('moderation_reports').doc(reportId).get();

  if (!reportSnap.exists) {
    return false;
  }

  const report = reportSnap.data() ?? {};
  const targetType = String(report.targetType ?? '').trim().toLowerCase();
  const moderationAction = String(report.moderationAction ?? '')
    .trim()
    .toUpperCase();
  const evidenceStatus = String(report.evidencePreservationStatus ?? '')
    .trim()
    .toUpperCase();

  if (
    (targetType !== 'photo' && targetType !== 'video') ||
    moderationAction !== 'REMOVE' ||
    evidenceStatus !== 'PRESERVED'
  ) {
    return false;
  }

  const ownerUid = cleanId(report.targetOwnerUid);
  const mediaId = cleanId(
    targetType === 'video'
      ? report.parentTargetId ?? report.targetId
      : report.targetId
  );

  if (!ownerUid || !mediaId) {
    logger.error(
      '[retryPendingModerationEvidencePreservation] Referência inválida para limpeza.',
      { reportId, targetType }
    );
    return false;
  }

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
  if (!await cleanupResolvedRemovedMedia(reportId)) return;
  // Only acknowledge the job if it remains the preserved cleanup obligation.
  await db.runTransaction(async (tx) => {
    const job = await tx.get(jobRef);
    if (job.get('status') === 'CLEANUP_PENDING') {
      tx.delete(jobRef);
    }
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
