import type { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { db, FieldValue, storage } from '../../firebaseApp';
import { normalizeOwnedPublishedPhotoPath } from './photo-storage-path';
import { normalizeOwnedPublishedVideoPath } from './video-storage-path';
import {
  shouldPreserveMediaEvidence,
  type MediaReportSafetyReason,
} from './media-report-safety';
import {
  deleteGenerationPinnedVideoFile,
  normalizeGcsGeneration,
} from './video-deletion-storage-pages';

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
  activePreservationOps?: number;
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

  return status === 'rejected' || evidenceStatus === 'RELEASED' || evidenceStatus === 'RELEASING';
}

/** Stage jobs and PENDING together, conditional on the live report state. */
export async function stageModerationEvidenceJobInFirestore(
  firestore: Firestore, reportId: string, job: ModerationEvidenceJob
): Promise<boolean> {
  const jobRef = firestore.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId);
  const reportRef = firestore.collection('moderation_reports').doc(reportId);
  return firestore.runTransaction(async (tx) => {
    const [report, previousJob] = await Promise.all([tx.get(reportRef), tx.get(jobRef)]);
    const status = String(report.get('evidencePreservationStatus') ?? '').trim().toUpperCase();
    if (!report.exists || isReleasedReport(report.data()) || status === 'PRESERVED' ||
        (previousJob.exists && (previousJob.get('status') === 'CLEANUP_PENDING' ||
          activeOps(previousJob) > 0))) return false;
    tx.set(jobRef, job, { merge: true });
    tx.set(reportRef, {
      evidencePreservationStatus: 'PENDING',
      evidencePreservationUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

/** A late failure cannot recreate jobs or revert preserved/released reports. */
export async function recordPreservationFailureInFirestore(
  firestore: Firestore, reportId: string
): Promise<boolean> {
  const jobRef = firestore.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId);
  const reportRef = firestore.collection('moderation_reports').doc(reportId);
  return firestore.runTransaction(async (tx) => {
    const [report, job] = await Promise.all([tx.get(reportRef), tx.get(jobRef)]);
    const status = String(report.get('evidencePreservationStatus') ?? '').trim().toUpperCase();
    if (!report.exists || isReleasedReport(report.data()) || status === 'PRESERVED' ||
        !job.exists || job.get('status') !== 'PENDING') return false;
    tx.set(jobRef, {
      attempts: FieldValue.increment(1), updatedAt: Date.now(),
      lastErrorCode: 'PRESERVATION_FAILED',
    }, { merge: true });
    tx.set(reportRef, {
      evidencePreservationStatus: 'PENDING',
      evidencePreservationUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

async function recordPreservationFailure(reportId: string, error: unknown): Promise<void> {
  if (!await recordPreservationFailureInFirestore(db, reportId)) return;
  logger.error('[moderationEvidence] Preservação pendente.', {
    reportId,
    error: error instanceof Error ? error.message.slice(0, 500)
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
    const now = Date.now();
    const staged = await stageModerationEvidenceJobInFirestore(db, reportId, {
      reportId, mediaType: input.mediaType, ownerUid, mediaId, reason: input.reason,
      sourceStoragePath: null, status: 'BLOCKED_SOURCE_PATH', attempts: 0,
      createdAt: now, updatedAt: now, lastErrorCode: 'INVALID_SOURCE_PATH',
    });
    if (staged) {
      logger.error('[moderationEvidence] Source path inválido para preservação.', {
        reportId, mediaType: input.mediaType, ownerUid, mediaId,
      });
    }
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

  const staged = await stageModerationEvidenceJobInFirestore(db, reportId, job);
  if (!staged) return { required: true, preserved: false };

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

type PreservationAttemptIdentity = Pick<ModerationEvidenceJob,
  'createdAt' | 'ownerUid' | 'mediaId' | 'mediaType' | 'sourceStoragePath'>;

function activeOps(snapshot: FirebaseFirestore.DocumentSnapshot): number {
  const raw = snapshot.get('activePreservationOps') ?? 0;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new Error('Contador de preservações ativo inválido; revisão manual necessária.');
  }
  return raw;
}

/** Claim is serialized against the RELEASING transition. No claim, no GCS copy. */
export async function beginModerationEvidencePreservationAttemptInFirestore(
  firestore: Firestore, reportId: string, identity: PreservationAttemptIdentity
): Promise<boolean> {
  const reportRef = firestore.collection('moderation_reports').doc(reportId);
  const jobRef = firestore.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId);
  return firestore.runTransaction(async tx => {
    const [report, job] = await Promise.all([tx.get(reportRef), tx.get(jobRef)]);
    if (!report.exists || isReleasedReport(report.data()) || !job.exists ||
        job.get('status') !== 'PENDING' ||
        String(report.get('evidencePreservationStatus') ?? '').toUpperCase() === 'PRESERVED' ||
        job.get('createdAt') !== identity.createdAt ||
        job.get('ownerUid') !== identity.ownerUid ||
        job.get('mediaId') !== identity.mediaId ||
        job.get('mediaType') !== identity.mediaType ||
        job.get('sourceStoragePath') !== identity.sourceStoragePath) return false;
    tx.update(jobRef, { activePreservationOps: activeOps(job) + 1 });
    return true;
  });
}

/** Release the claim only after all copy/cleanup operations have completed. */
export async function endModerationEvidencePreservationAttemptInFirestore(
  firestore: Firestore, reportId: string, identity: PreservationAttemptIdentity
): Promise<void> {
  const reportRef = firestore.collection('moderation_reports').doc(reportId);
  const jobRef = firestore.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId);
  await firestore.runTransaction(async tx => {
    const [report, job] = await Promise.all([tx.get(reportRef), tx.get(jobRef)]);
    if (!job.exists) {
      if (report.get('evidencePreservationStatus') === 'RELEASING') {
        throw new Error('Claim de preservação ausente durante liberação; revisão necessária.');
      }
      return;
    }
    if (job.get('createdAt') !== identity.createdAt ||
        job.get('ownerUid') !== identity.ownerUid ||
        job.get('mediaId') !== identity.mediaId) {
      throw new Error('Identidade de tentativa probatória substituída; revisão necessária.');
    }
    const active = activeOps(job);
    if (active === 0) throw new Error('Contador de preservações inconsistentes.');
    if (active > 1) {
      tx.update(jobRef, { activePreservationOps: active - 1 });
      return;
    }
    const reportStatus = String(report.get('evidencePreservationStatus') ?? '').toUpperCase();
    if (reportStatus === 'RELEASING' || reportStatus === 'RELEASED' ||
        (reportStatus === 'PRESERVED' && job.get('status') !== 'CLEANUP_PENDING')) {
      tx.delete(jobRef);
    } else {
      tx.update(jobRef, { activePreservationOps: 0 });
    }
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

  if (!await beginModerationEvidencePreservationAttemptInFirestore(db, reportId, job)) return;
  try {
    const bucket = storage.bucket();
    const sourceFile = bucket.file(sourceStoragePath);
    const destinationPath = evidenceStoragePath(reportId, job.mediaType);
    const destinationFile = bucket.file(destinationPath);
    const [sourceExists] = await sourceFile.exists();

    if (!sourceExists) {
      throw new Error('Ativo de origem não encontrado para preservação.');
    }

    const [sourceMetadata] = await sourceFile.getMetadata();
    const sourceGeneration = normalizeGcsGeneration(sourceMetadata.generation);
    if (!sourceGeneration) {
      throw new Error('Geração da origem probatória indisponível; revisão manual necessária.');
    }
    const [destinationExists] = await destinationFile.exists();
    let createdEvidenceGeneration: string | null = null;
    let copyCompletedInThisAttempt = false;

    if (!destinationExists) {
      try {
      // Atomic destination creation; pin exactly the observed source generation.
        const [copiedFile, copyApiResponse] = await bucket.file(sourceStoragePath, {
          generation: sourceGeneration,
        }).copy(destinationFile, {
          preconditionOpts: { ifGenerationMatch: 0 },
        });
        copyCompletedInThisAttempt = true;
        // Apenas a resposta da cópia pode provar a geração criada por este request.
        const apiObject = copyApiResponse as {
        generation?: unknown; resource?: { generation?: unknown };
      } | null | undefined;
        const apiGeneration = normalizeGcsGeneration(
          apiObject?.resource?.generation ?? apiObject?.generation
        );
        const fileGeneration = normalizeGcsGeneration(copiedFile.metadata?.generation);
        if (apiGeneration && fileGeneration && apiGeneration !== fileGeneration) {
          throw new Error('Gerações divergentes no retorno da cópia probatória; revisão necessária.');
        }
        createdEvidenceGeneration = apiGeneration ?? fileGeneration;
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
          ? Number(error.code) : null;
        // A parallel create-only copy won; verify its bytes rather than overwrite it.
        if (code !== 412) throw error;
      }
    }

    const [evidenceMetadata] = await destinationFile.getMetadata();
    const observedEvidenceGeneration =
    normalizeGcsGeneration(evidenceMetadata.generation);

    // getMetadata observa a versão atual; jamais prova a autoria da cópia.
    // Uma substituição física após File.copy() não pode habilitar exclusão.
    if (!observedEvidenceGeneration ||
      (createdEvidenceGeneration &&
       observedEvidenceGeneration !== createdEvidenceGeneration)) {
      throw new Error(
        'Geração da cópia probatória indisponível ou substituída; revisão necessária.'
      );
    }
    // Existing evidence must never be accepted merely because its object exists.
    // Otherwise a previous partial attempt or concurrent copy could bless
    // unrelated bytes and enable deletion of the reported publication.
    const sourceMd5 = safeMetadataString(sourceMetadata.md5Hash);
    const evidenceMd5 = safeMetadataString(evidenceMetadata.md5Hash);
    const sourceCrc32c = safeMetadataString(sourceMetadata.crc32c);
    const evidenceCrc32c = safeMetadataString(evidenceMetadata.crc32c);
    if (
      (sourceMd5 && evidenceMd5 && sourceMd5 !== evidenceMd5) ||
    !sourceCrc32c || !evidenceCrc32c ||
    sourceCrc32c !== evidenceCrc32c ||
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
        }
        return 'PRESERVED';
      }
    );

    if (finalizeResult === 'RELEASED' && copyCompletedInThisAttempt) {
      if (!createdEvidenceGeneration) {
      // Não excluir uma versão que não se pode atribuir à cópia deste request.
        throw new Error('Geração da cópia não comprovada; limpeza manual necessária.');
      }
      // Never clean up a generation created by another worker.
      await deleteGenerationPinnedVideoFile(createdEvidenceGeneration, (generation) =>
        destinationFile.delete({ ignoreNotFound: true, ifGenerationMatch: generation })
      );
    }
  } finally {
    await endModerationEvidencePreservationAttemptInFirestore(db, reportId, job);
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

export type ModerationEvidenceReleaseReason = 'REPORT_REJECTED' | 'LEGAL_RETENTION_RELEASED';

export async function releaseModerationEvidence(
  reportIdValue: unknown,
  releaseReason: ModerationEvidenceReleaseReason
): Promise<void> {
  const reportId = cleanId(reportIdValue);
  if (!reportId) return;

  const evidenceRef = db.collection(MODERATION_EVIDENCE_COLLECTION).doc(reportId);
  const jobRef = db.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(reportId);
  const reportRef = db.collection('moderation_reports').doc(reportId);
  const paths = [
    `system/moderation-evidence/${reportId}/photo`,
    `system/moderation-evidence/${reportId}/video`,
  ];

  // Phase 1: persist intent and stop all new copy claims atomically.
  const stage = await db.runTransaction(async tx => {
    const [report, job, evidence] = await Promise.all([
      tx.get(reportRef), tx.get(jobRef), tx.get(evidenceRef),
    ]);
    if (!report.exists) throw new Error('Relatório ausente durante liberação probatória.');
    const status = String(report.get('evidencePreservationStatus') ?? '').toUpperCase();
    if (status === 'RELEASED') {
      if (evidence.exists || job.exists) {
        throw new Error('Liberação marcada como concluída com obrigação remanescente.');
      }
      return 'DONE' as const;
    }
    if (status === 'RELEASING' && report.get('evidenceReleaseReason') !== releaseReason) {
      throw new Error('Motivo de liberação divergente; revisão manual necessária.');
    }
    if (status === 'PRESERVED' && !evidence.exists) {
      throw new Error('Registro de evidência preservada ausente; revisão necessária.');
    }
    const recordedPath = evidence.exists ? String(evidence.get('storagePath') ?? '').trim() : '';
    const recordedGeneration = evidence.exists
      ? normalizeGcsGeneration(evidence.get('evidenceGeneration')) : null;
    if (evidence.exists && (!paths.includes(recordedPath) || !recordedGeneration)) {
      throw new Error('Evidência sem geração canônica; revisão manual necessária.');
    }
    if (job.exists && (job.get('status') === 'PENDING' ||
        job.get('status') === 'BLOCKED_SOURCE_PATH')) {
      const count = activeOps(job);
      if (count === 0) tx.delete(jobRef);
    }
    if (status !== 'RELEASING') {
      tx.set(reportRef, {
        evidencePreservationStatus: 'RELEASING',
        evidenceReleaseReason: releaseReason,
        evidencePreservationUpdatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    return job.exists && activeOps(job) > 0 ? 'IN_FLIGHT' as const : 'READY' as const;
  });
  if (stage === 'DONE') return;
  if (stage === 'IN_FLIGHT') {
    throw new Error('Preservação ativa durante liberação; aguardando tentativa terminar.');
  }

  // Phase 2: check the exact version, never accept another path or generation.
  const [evidenceBefore, jobBefore] = await Promise.all([
    evidenceRef.get(), jobRef.get(),
  ]);
  if (jobBefore.exists && activeOps(jobBefore) > 0) {
    throw new Error('Preservação ativa durante liberação; reprocessamento necessário.');
  }
  const recordedPath = evidenceBefore.exists
    ? String(evidenceBefore.get('storagePath') ?? '').trim() : '';
  const recordedGeneration = evidenceBefore.exists
    ? normalizeGcsGeneration(evidenceBefore.get('evidenceGeneration')) : null;
  if (evidenceBefore.exists && (!paths.includes(recordedPath) || !recordedGeneration)) {
    throw new Error('Evidência sem geração canônica; revisão manual necessária.');
  }
  const bucket = storage.bucket();
  const observed = await Promise.all(paths.map(async path => {
    try {
      const [metadata] = await bucket.file(path).getMetadata();
      const generation = normalizeGcsGeneration(metadata.generation);
      if (!generation) {
        throw new Error('Geração física probatória indisponível; revisão manual necessária.');
      }
      return {path, generation};
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? Number(error.code) : null;
      if (code === 404) return null;
      throw error;
    }
  }));
  const existing = observed.filter((entry): entry is {path:string; generation:string} =>
    entry !== null);
  if (existing.some(entry =>
    entry.path !== recordedPath || entry.generation !== recordedGeneration)) {
    throw new Error('Objeto probatório inesperado ou substituído; revisão manual necessária.');
  }

  for (const entry of existing) {
    await deleteGenerationPinnedVideoFile(entry.generation, generation =>
      bucket.file(entry.path).delete({ignoreNotFound: true, ifGenerationMatch: generation})
    );
  }

  // Phase 3: finalize only the staged release. After a crash, a retry sees
  // the missing pinned object and can still safely complete this transaction.
  await db.runTransaction(async tx => {
    const [report, evidenceCurrent, jobCurrent] = await Promise.all([
      tx.get(reportRef), tx.get(evidenceRef), tx.get(jobRef),
    ]);
    const status = String(report.get('evidencePreservationStatus') ?? '').toUpperCase();
    if (status === 'RELEASED' && !evidenceCurrent.exists && !jobCurrent.exists) return;
    if (!report.exists || status !== 'RELEASING' ||
        report.get('evidenceReleaseReason') !== releaseReason) {
      throw new Error('Intenção de liberação alterada; revisão necessária.');
    }
    const unchanged = (before: FirebaseFirestore.DocumentSnapshot,
      current: FirebaseFirestore.DocumentSnapshot): boolean =>
      before.exists === current.exists &&
      (!before.exists || (!!before.updateTime && !!current.updateTime &&
        before.updateTime.isEqual(current.updateTime)));
    if (!unchanged(evidenceBefore, evidenceCurrent) ||
        !unchanged(jobBefore, jobCurrent) ||
        (jobCurrent.exists && activeOps(jobCurrent) > 0)) {
      throw new Error('Identidade probatória alterada durante liberação; revisão necessária.');
    }
    tx.delete(evidenceRef);
    tx.delete(jobRef);
    tx.set(reportRef, {
      evidencePreservationStatus: 'RELEASED',
      evidenceReleaseReason: releaseReason,
      evidencePreservationUpdatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  });
}
