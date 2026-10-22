import type { Firestore } from 'firebase-admin/firestore';
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
  sourceStoragePath: string | null;
  status: 'PENDING' | 'BLOCKED_SOURCE_PATH' | 'CLEANUP_PENDING';
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
    // Durable blocked job: never silently leave a PENDING report without a
    // corresponding record. A later valid request may replace/rearm this job.
    const now = Date.now();
    const batch = db.batch();
    batch.set(db.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId), {
      reportId,
      mediaType: input.mediaType,
      ownerUid,
      mediaId,
      reason: input.reason,
      sourceStoragePath: null,
      status: 'BLOCKED_SOURCE_PATH',
      updatedAt: now,
      createdAt: now,
      lastErrorCode: 'INVALID_SOURCE_PATH',
    }, { merge: true });
    batch.set(reportRef, {
      evidencePreservationStatus: 'PENDING',
      evidencePreservationUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();

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


/** Re-arm only from the canonical publication, never from operator-supplied paths. */
export async function rearmBlockedModerationEvidenceFromPublication(
  reportIdValue: unknown
): Promise<boolean> {
  return rearmBlockedModerationEvidenceInFirestore(db, reportIdValue);
}

export async function rearmBlockedModerationEvidenceInFirestore(
  firestore: Firestore, reportIdValue: unknown
): Promise<boolean> {
  const reportId = cleanId(reportIdValue);
  if (!reportId) return false;
  const jobRef = firestore.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId);
  const reportRef = firestore.collection('moderation_reports').doc(reportId);
  return firestore.runTransaction(async (tx) => {
    const [jobSnap, reportSnap] = await Promise.all([
      tx.get(jobRef), tx.get(reportRef),
    ]);
    if (!jobSnap.exists || jobSnap.get('status') !== 'BLOCKED_SOURCE_PATH' ||
        !reportSnap.exists || isReleasedReport(reportSnap.data()) ||
        reportSnap.get('moderationAction') !== 'REMOVE') return false;
    const job = jobSnap.data() as ModerationEvidenceJob;
    const ownerUid = cleanId(job.ownerUid);
    const mediaId = cleanId(job.mediaId);
    if (!ownerUid || !mediaId ||
        (job.mediaType !== 'PHOTO' && job.mediaType !== 'VIDEO')) return false;
    const kind = job.mediaType === 'VIDEO' ? 'video' : 'photo';
    const publicationRef = firestore.doc(
      `users/${ownerUid}/${kind}_publications/${mediaId}`
    );
    const publicationSnap = await tx.get(publicationRef);
    const sourceStoragePath = normalizeSourcePath(
      job.mediaType, ownerUid, mediaId,
      publicationSnap.get('publishedStoragePath')
    );
    if (!sourceStoragePath || publicationSnap.get('isPublished') !== true) {
      return false;
    }
    tx.update(jobRef, {
      status: 'PENDING',
      sourceStoragePath,
      lastErrorCode: null,
      updatedAt: Date.now(),
    });
    return true;
  });
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
  if (job.status === 'CLEANUP_PENDING') return;
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
  // Existing evidence must never be accepted merely because its object exists.
  // Otherwise a previous partial attempt or concurrent copy could bless
  // unrelated bytes and enable deletion of the reported publication.
  const sourceMd5 = safeMetadataString(sourceMetadata.md5Hash);
  const evidenceMd5 = safeMetadataString(evidenceMetadata.md5Hash);
  const sourceCrc32c = safeMetadataString(sourceMetadata.crc32c);
  const evidenceCrc32c = safeMetadataString(evidenceMetadata.crc32c);
  if (
    (sourceMd5 && evidenceMd5 && sourceMd5 !== evidenceMd5) ||
    (sourceCrc32c && evidenceCrc32c && sourceCrc32c !== evidenceCrc32c) ||
    Number(sourceMetadata.size) !== Number(evidenceMetadata.size)
  ) {
    throw new Error('Evidência preservada diverge do arquivo denunciado.');
  }

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
          if (String(report?.moderationAction ?? '').toUpperCase() === 'REMOVE') {
            transaction.update(jobRef, { status: 'CLEANUP_PENDING', updatedAt: Date.now() });
          } else {
            transaction.delete(jobRef);
          }
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
      if (String(report?.moderationAction ?? '').toUpperCase() === 'REMOVE') {
        transaction.update(jobRef, { status: 'CLEANUP_PENDING', updatedAt: Date.now() });
      } else {
        transaction.delete(jobRef);
      }
      return 'PRESERVED';
    }
  );

  if (finalizeResult === 'RELEASED') {
    await destinationFile.delete({ ignoreNotFound: true });
  }
}


/**
 * An already-preserved report may be resolved REMOVE long after preservation.
 * Stage its cleanup obligation before requesting any physical deletion.
 */
export async function ensurePreservedModerationCleanupJob(
  reportIdValue: unknown,
  mediaType: ModerationEvidenceMediaType,
  ownerUidValue: unknown,
  mediaIdValue: unknown
): Promise<boolean> {
  const reportId = cleanId(reportIdValue);
  const ownerUid = cleanId(ownerUidValue);
  const mediaId = cleanId(mediaIdValue);
  if (!reportId || !ownerUid || !mediaId) return false;

  const reportRef = db.collection('moderation_reports').doc(reportId);
  const evidenceRef = db.collection(MODERATION_EVIDENCE_COLLECTION).doc(reportId);
  const jobRef = db.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId);
  return db.runTransaction(async (tx) => {
    const [report, evidence, job] = await Promise.all([
      tx.get(reportRef), tx.get(evidenceRef), tx.get(jobRef),
    ]);
    if (!report.exists || !evidence.exists ||
        String(report.get('moderationAction') ?? '').toUpperCase() !== 'REMOVE' ||
        String(report.get('evidencePreservationStatus') ?? '').toUpperCase() !== 'PRESERVED' ||
        report.get('targetOwnerUid') !== ownerUid ||
        String(report.get('targetType') ?? '').toLowerCase() !== mediaType.toLowerCase() ||
        cleanId(mediaType === 'VIDEO'
          ? report.get('parentTargetId') ?? report.get('targetId')
          : report.get('targetId')) !== mediaId ||
        evidence.get('ownerUid') !== ownerUid ||
        evidence.get('mediaId') !== mediaId ||
        evidence.get('mediaType') !== mediaType) {
      return false;
    }
    if (job.exists) {
      return job.get('status') === 'CLEANUP_PENDING' &&
        job.get('ownerUid') === ownerUid &&
        job.get('mediaId') === mediaId &&
        job.get('mediaType') === mediaType;
    }
    const now = Date.now();
    tx.create(jobRef, {
      reportId, mediaType, ownerUid, mediaId,
      reason: evidence.get('reason') ?? null,
      sourceStoragePath: null,
      status: 'CLEANUP_PENDING',
      attempts: 0, createdAt: now, updatedAt: now, lastErrorCode: null,
    });
    return true;
  });
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

  // Do not claim the evidence was released if any protected object could
  // not be deleted. A failed release remains retryable with its Firestore
  // evidence reference and retention status intact.
  await Promise.all(
    [...pathsToDelete].map((path) =>
      bucket.file(path).delete({ ignoreNotFound: true })
    )
  );

  const batch = db.batch();
  batch.delete(evidenceRef);
  batch.delete(db.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId));
  batch.set(
    db.collection('moderation_reports').doc(reportId),
    {
      evidencePreservationStatus: 'RELEASED',
      evidenceReleaseReason: releaseReason,
      evidencePreservationUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();
}
