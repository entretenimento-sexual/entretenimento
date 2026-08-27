import * as logger from 'firebase-functions/logger';

import { db, FieldValue, storage } from '../../firebaseApp';
import { normalizeOwnedPublishedPhotoPath } from './photo-storage-path';
import { normalizeOwnedPublishedVideoPath } from './video-storage-path';
import {
  shouldPreserveMediaEvidence,
  type MediaReportSafetyReason,
} from './media-report-safety';

export type ModerationEvidenceMediaType = 'PHOTO' | 'VIDEO';

export interface ModerationEvidencePreservationInput {
  reportId: string;
  mediaType: ModerationEvidenceMediaType;
  ownerUid: string;
  mediaId: string;
  reason: MediaReportSafetyReason;
  sourceStoragePath: string | null | undefined;
}

interface ModerationEvidenceJob {
  reportId: string;
  mediaType: ModerationEvidenceMediaType;
  ownerUid: string;
  mediaId: string;
  reason: MediaReportSafetyReason;
  sourceStoragePath: string;
  status: 'PENDING';
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastErrorCode: string | null;
}

type PreservationFinalizeResult =
  | 'PRESERVED'
  | 'ALREADY_PRESERVED'
  | 'RELEASED';

export const MODERATION_EVIDENCE_JOBS_COLLECTION =
  'moderation_evidence_preservation_jobs';
export const MODERATION_EVIDENCE_COLLECTION = 'moderation_evidence';

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeSourcePath(
  mediaType: ModerationEvidenceMediaType,
  ownerUid: string,
  mediaId: string,
  value: unknown
): string | null {
  return mediaType === 'PHOTO'
    ? normalizeOwnedPublishedPhotoPath(ownerUid, mediaId, value)
    : normalizeOwnedPublishedVideoPath(ownerUid, mediaId, value);
}

function evidenceStoragePath(
  reportId: string,
  mediaType: ModerationEvidenceMediaType
): string {
  return `system/moderation-evidence/${reportId}/${mediaType.toLowerCase()}`;
}

function safeMetadataString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 300) : null;
}

function isReleasedReport(report: FirebaseFirestore.DocumentData | undefined): boolean {
  const status = String(report?.status ?? '').trim().toLowerCase();
  const evidenceStatus = String(report?.evidencePreservationStatus ?? '')
    .trim()
    .toUpperCase();

  return status === 'rejected' || evidenceStatus === 'RELEASED';
}

async function recordPreservationFailure(
  reportId: string,
  error: unknown
): Promise<void> {
  const jobRef = db.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId);
  const reportRef = db.collection('moderation_reports').doc(reportId);
  const reportSnap = await reportRef.get();

  if (!reportSnap.exists || isReleasedReport(reportSnap.data())) {
    await jobRef.delete().catch(() => undefined);
    return;
  }

  await Promise.allSettled([
    jobRef.set(
      {
        attempts: FieldValue.increment(1),
        updatedAt: Date.now(),
        lastErrorCode: 'PRESERVATION_FAILED',
      },
      { merge: true }
    ),
    reportRef.set(
      {
        evidencePreservationStatus: 'PENDING',
        evidencePreservationUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
  ]);

  logger.error('[moderationEvidence] Preservação pendente.', {
    reportId,
    error: error instanceof Error
      ? error.message.slice(0, 500)
      : String(error ?? '').slice(0, 500),
  });
}

export async function queueModerationEvidencePreservation(
  input: ModerationEvidencePreservationInput
): Promise<{ required: boolean; preserved: boolean }> {
  const reportId = cleanId(input.reportId);
  const ownerUid = cleanId(input.ownerUid);
  const mediaId = cleanId(input.mediaId);

  if (
    !reportId ||
    !ownerUid ||
    !mediaId ||
    !shouldPreserveMediaEvidence(input.reason)
  ) {
    return { required: false, preserved: false };
  }

  const reportRef = db.collection('moderation_reports').doc(reportId);
  const reportSnap = await reportRef.get();

  if (!reportSnap.exists || isReleasedReport(reportSnap.data())) {
    return { required: true, preserved: false };
  }

  const sourceStoragePath = normalizeSourcePath(
    input.mediaType,
    ownerUid,
    mediaId,
    input.sourceStoragePath
  );

  if (!sourceStoragePath) {
    await reportRef.set(
      {
        evidencePreservationStatus: 'PENDING',
        evidencePreservationUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.error('[moderationEvidence] Source path inválido para preservação.', {
      reportId,
      mediaType: input.mediaType,
      ownerUid,
      mediaId,
    });

    return { required: true, preserved: false };
  }

  const now = Date.now();
  const job: ModerationEvidenceJob = {
    reportId,
    mediaType: input.mediaType,
    ownerUid,
    mediaId,
    reason: input.reason,
    sourceStoragePath,
    status: 'PENDING',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastErrorCode: null,
  };

  await db.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId).set(
    job,
    { merge: true }
  );
  await reportRef.set(
    {
      evidencePreservationStatus: 'PENDING',
      evidencePreservationUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await preserveModerationEvidence(reportId);
    const refreshedReport = await reportRef.get();
    return {
      required: true,
      preserved:
        String(refreshedReport.data()?.evidencePreservationStatus ?? '')
          .trim()
          .toUpperCase() === 'PRESERVED',
    };
  } catch (error) {
    await recordPreservationFailure(reportId, error);
    return { required: true, preserved: false };
  }
}

export async function preserveModerationEvidence(
  reportIdValue: unknown
): Promise<void> {
  const reportId = cleanId(reportIdValue);

  if (!reportId) {
    throw new Error('Report ID inválido para preservação.');
  }

  const jobRef = db.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId);
  const jobSnap = await jobRef.get();

  if (!jobSnap.exists) {
    return;
  }

  const job = jobSnap.data() as ModerationEvidenceJob;
  const ownerUid = cleanId(job.ownerUid);
  const mediaId = cleanId(job.mediaId);
  const sourceStoragePath = normalizeSourcePath(
    job.mediaType,
    ownerUid,
    mediaId,
    job.sourceStoragePath
  );

  if (!ownerUid || !mediaId || !sourceStoragePath) {
    throw new Error('Job de preservação contém referências inválidas.');
  }

  const bucket = storage.bucket();
  const sourceFile = bucket.file(sourceStoragePath);
  const destinationPath = evidenceStoragePath(reportId, job.mediaType);
  const destinationFile = bucket.file(destinationPath);
  const [sourceExists] = await sourceFile.exists();

  if (!sourceExists) {
    throw new Error('Ativo de origem não encontrado para preservação.');
  }

  const [sourceMetadata] = await sourceFile.getMetadata();
  const [destinationExists] = await destinationFile.exists();

  if (!destinationExists) {
    await sourceFile.copy(destinationFile);
  }

  const [evidenceMetadata] = await destinationFile.getMetadata();
  const evidenceRef = db.collection(MODERATION_EVIDENCE_COLLECTION).doc(reportId);
  const reportRef = db.collection('moderation_reports').doc(reportId);
  const timestamp = FieldValue.serverTimestamp();

  const finalizeResult = await db.runTransaction<PreservationFinalizeResult>(
    async (transaction) => {
      const [currentJobSnap, reportSnap, evidenceSnap] = await Promise.all([
        transaction.get(jobRef),
        transaction.get(reportRef),
        transaction.get(evidenceRef),
      ]);
      const report = reportSnap.exists ? reportSnap.data() : undefined;
      const evidenceStatus = String(report?.evidencePreservationStatus ?? '')
        .trim()
        .toUpperCase();

      if (evidenceStatus === 'PRESERVED' && evidenceSnap.exists) {
        if (currentJobSnap.exists) {
          transaction.delete(jobRef);
        }
        return 'ALREADY_PRESERVED';
      }

      if (!currentJobSnap.exists || !reportSnap.exists || isReleasedReport(report)) {
        return 'RELEASED';
      }

      transaction.set(
        evidenceRef,
        {
          reportId,
          mediaType: job.mediaType,
          ownerUid,
          mediaId,
          reason: job.reason,
          storagePath: destinationPath,
          sourceGeneration: safeMetadataString(sourceMetadata.generation),
          sourceMd5Hash: safeMetadataString(sourceMetadata.md5Hash),
          sourceCrc32c: safeMetadataString(sourceMetadata.crc32c),
          evidenceGeneration: safeMetadataString(evidenceMetadata.generation),
          evidenceMd5Hash: safeMetadataString(evidenceMetadata.md5Hash),
          evidenceCrc32c: safeMetadataString(evidenceMetadata.crc32c),
          contentType: safeMetadataString(evidenceMetadata.contentType),
          sizeBytes: Number(evidenceMetadata.size ?? 0) || 0,
          retentionStatus: 'LEGAL_REVIEW_REQUIRED',
          accessPolicy: 'BACKEND_ONLY',
          preservedAt: timestamp,
          updatedAt: timestamp,
        },
        { merge: false }
      );
      transaction.set(
        reportRef,
        {
          evidencePreservationStatus: 'PRESERVED',
          evidenceId: reportId,
          evidencePreservationUpdatedAt: timestamp,
        },
        { merge: true }
      );
      transaction.delete(jobRef);
      return 'PRESERVED';
    }
  );

  if (finalizeResult === 'RELEASED') {
    await destinationFile.delete({ ignoreNotFound: true });
  }
}

export async function releaseModerationEvidence(
  reportIdValue: unknown,
  releaseReason: 'REPORT_REJECTED' | 'LEGAL_RETENTION_RELEASED'
): Promise<void> {
  const reportId = cleanId(reportIdValue);

  if (!reportId) {
    return;
  }

  const evidenceRef = db.collection(MODERATION_EVIDENCE_COLLECTION).doc(reportId);
  const evidenceSnap = await evidenceRef.get();
  const storagePath = evidenceSnap.exists
    ? String(evidenceSnap.data()?.storagePath ?? '').trim()
    : '';
  const bucket = storage.bucket();
  const deterministicPaths = [
    `system/moderation-evidence/${reportId}/photo`,
    `system/moderation-evidence/${reportId}/video`,
  ];
  const pathsToDelete = new Set(
    [storagePath, ...deterministicPaths].filter((path) =>
      path.startsWith(`system/moderation-evidence/${reportId}/`)
    )
  );

  await Promise.allSettled(
    [...pathsToDelete].map((path) =>
      bucket.file(path).delete({ ignoreNotFound: true })
    )
  );

  await Promise.all([
    evidenceRef.delete(),
    db.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId).delete(),
    db.collection('moderation_reports').doc(reportId).set(
      {
        evidencePreservationStatus: 'RELEASED',
        evidenceReleaseReason: releaseReason,
        evidencePreservationUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
  ]);
}
