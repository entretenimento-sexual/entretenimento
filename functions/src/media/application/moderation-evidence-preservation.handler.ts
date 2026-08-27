import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { deleteProfilePhotoResources } from './delete-profile-photo.handler';
import { deleteProfileVideoResources } from './delete-profile-video.handler';
import {
  MODERATION_EVIDENCE_JOBS_COLLECTION,
  preserveModerationEvidence,
} from './moderation-evidence-preservation.service';

const RETRY_BATCH_SIZE = 20;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

async function cleanupResolvedRemovedMedia(reportId: string): Promise<void> {
  const reportSnap = await db.collection('moderation_reports').doc(reportId).get();

  if (!reportSnap.exists) {
    return;
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
    return;
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
    return;
  }

  if (targetType === 'photo') {
    await deleteProfilePhotoResources(ownerUid, mediaId, {
      allowQuarantined: true,
    });
    return;
  }

  await deleteProfileVideoResources(ownerUid, mediaId, {
    allowQuarantined: true,
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
      .orderBy('updatedAt', 'asc')
      .limit(RETRY_BATCH_SIZE)
      .get();

    for (const jobDoc of jobsSnapshot.docs) {
      try {
        await preserveModerationEvidence(jobDoc.id);
        await cleanupResolvedRemovedMedia(jobDoc.id);
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
