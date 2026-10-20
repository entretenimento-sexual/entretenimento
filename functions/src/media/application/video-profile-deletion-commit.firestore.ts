/**
 * c18v: the deletion queue, RETIRED guard, publication removal and processing
 * cancellation are one Firestore commit. All decisions use transaction reads.
 * This does not assert complete outbox coverage or global ordering.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import {
  type DocumentReference, type DocumentSnapshot, type Firestore,
} from 'firebase-admin/firestore';

import { withAdminTriageProjection } from './admin-video-triage.firestore';
import { stageVideoTriageMutationInTransaction }
  from './admin-video-triage-mutation-outbox.firestore';
import { retireVideoIdentityInTransaction } from './video-identity-guard.firestore';
import {
  buildVideoProcessingJobId, type VideoProcessingJob,
} from './video-processing-job';

export interface ProfileVideoDeletionSnapshots {
  privateVideo: DocumentSnapshot;
  publication: DocumentSnapshot;
  processingJob: DocumentSnapshot;
}

export interface ProfileVideoDeletionCommand<T extends object> {
  ownerUid: string;
  videoId: string;
  now: number;
  eventId: string;
  allowQuarantined?: boolean;
  privateVideoRef: DocumentReference;
  publicationRef: DocumentReference;
  publicVideoRef: DocumentReference;
  processingJobRef: DocumentReference;
  identityRef: DocumentReference;
  deletionJobRef: DocumentReference;
  buildJob: (snapshots: ProfileVideoDeletionSnapshots,
    processingCleanupPending: boolean) => T;
}

export type ProfileVideoDeletionCommitResult =
  | { kind: 'EXISTING'; processingCleanupPending: true }
  | { kind: 'CREATED'; processingCleanupPending: boolean };

function checkPublicationHold(
  snapshot: DocumentSnapshot, allowQuarantined: boolean
): void {
  if (!snapshot.exists || allowQuarantined) return;
  const moderationStatus = String(snapshot.get('moderationStatus') ?? '')
    .trim().toUpperCase();
  const evidenceRetention = String(snapshot.get('reviewEvidenceRetention') ?? '')
    .trim().toUpperCase();
  const locked = moderationStatus === 'FLAGGED' ||
    (moderationStatus === 'PENDING_REVIEW' &&
      (snapshot.get('isPublished') === true ||
       evidenceRetention === 'PUBLISHED_ASSET_LOCKED'));
  if (locked) {
    throw new HttpsError(
      'failed-precondition',
      'Este vídeo está temporariamente preservado durante uma análise de segurança.'
    );
  }
}

/**
 * Repeated requests are read-only. Any stale scheduler/registration write on
 * a read document forces Firestore retry, never a second independent event.
 * No provider read, scheduler or unrelated collection scan is introduced.
 */
export async function commitProfileVideoDeletionRequest<T extends object>(
  firestore: Firestore, command: ProfileVideoDeletionCommand<T>
): Promise<ProfileVideoDeletionCommitResult> {
  const {
    ownerUid, videoId, now, eventId, privateVideoRef, publicationRef,
    publicVideoRef, processingJobRef, identityRef, deletionJobRef,
  } = command;
  if (!ownerUid || !videoId || !Number.isSafeInteger(now) || now <= 0 ||
      processingJobRef.path !==
        `media_video_processing_jobs/${buildVideoProcessingJobId(ownerUid, videoId)}` ||
      privateVideoRef.path !== `users/${ownerUid}/videos/${videoId}` ||
      publicationRef.path !== `users/${ownerUid}/video_publications/${videoId}` ||
      publicVideoRef.path !==
        `public_profiles/${ownerUid}/public_videos/${videoId}` ||
      identityRef.path !==
        `users/${ownerUid}/video_identity_guards/${videoId}` ||
      deletionJobRef.path !==
        `media_video_deletion_jobs/${ownerUid}_${videoId}` ||
      [privateVideoRef, publicationRef, publicVideoRef, processingJobRef,
        identityRef, deletionJobRef].some(ref => ref.firestore !== firestore)) {
    throw new Error('Invalid video profile deletion identity.');
  }

  return firestore.runTransaction(async transaction => {
    const [existingDeletion, privateVideo, publication, processingJob, identity] =
      await Promise.all([
        transaction.get(deletionJobRef),
        transaction.get(privateVideoRef),
        transaction.get(publicationRef),
        transaction.get(processingJobRef),
        transaction.get(identityRef),
      ]);

    if (existingDeletion.exists) {
      // Do not recreate a job, overwrite a lease, retire twice or append events.
      return { kind: 'EXISTING', processingCleanupPending: true } as const;
    }

    checkPublicationHold(publication, command.allowQuarantined === true);

    const processing = processingJob.exists
      ? processingJob.data() as Partial<VideoProcessingJob>
      : null;
    if (processing && (
      processing.ownerUid !== ownerUid || processing.videoId !== videoId
    )) {
      throw new Error('Processing job ownership mismatch during deletion.');
    }

    const state = String(processing?.state ?? '').trim().toUpperCase();
    const processingCleanupPending = !!processing;
    const deletionJob = command.buildJob(
      { privateVideo, publication, processingJob }, processingCleanupPending
    );

    retireVideoIdentityInTransaction(
      firestore, transaction, ownerUid, videoId, now, identity);
    transaction.create(deletionJobRef, {
      ...deletionJob,
      state: 'retryable',
      nextAttemptAt: now,
      deadLetterExpiresAt: null,
      leaseToken: null,
      leaseUntil: null,
    });

    if (processing && state !== 'CANCEL_REQUESTED' && state !== 'CANCELLED') {
      stageVideoTriageMutationInTransaction(firestore, transaction,
        processingJobRef, {
          eventId,
          source: 'PROFILE_VIDEO_DELETION',
          kind: 'CANCEL_REQUESTED',
          before: processingJob,
          afterState: 'CANCEL_REQUESTED',
        });
      transaction.set(processingJobRef, withAdminTriageProjection(
        processingJobRef.id, processing, {
          state: 'CANCEL_REQUESTED',
          cancelRequestedAt: now,
          leaseUntil: null,
          updatedAt: now,
          lastErrorCode: 'VIDEO_DELETED',
          lastError: 'O vídeo foi excluído da plataforma.',
        }, now), { merge: true });
    }

    if (publication.exists && publication.updateTime) {
      transaction.delete(publicationRef, {
        lastUpdateTime: publication.updateTime,
      });
    } else {
      transaction.delete(publicationRef);
    }
    transaction.delete(publicVideoRef);
    return { kind: 'CREATED', processingCleanupPending } as const;
  }, { maxAttempts: 3 });
}
