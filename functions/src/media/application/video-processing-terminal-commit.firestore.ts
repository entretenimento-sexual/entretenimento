import { randomUUID } from 'node:crypto';

import { isOwnerDeletingForVideoMutationInTransaction }
  from '../../account_lifecycle/owner-video-lifecycle-fence.firestore';

import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import type { VideoProcessingJob } from './video-processing-job';
import { withAdminTriageProjection } from './admin-video-triage.firestore';
import { stageVideoTriageMutationInTransaction }
  from './admin-video-triage-mutation-outbox.firestore';
import { isCurrentVideoProcessingAttempt } from './video-processing-poll.policy';

/** An observed provider result is not necessarily a committed job transition. */
export type VideoCommitDisposition =
  | 'APPLIED' | 'REPLACED' | 'CANCEL_REQUESTED' | 'SKIPPED';

export interface TerminalVideoCommitCommand {
  state: 'SUCCEEDED' | 'FAILED';
  now: number;
  normalizeJob: (value: unknown) => VideoProcessingJob | null;
  /** Validates both the original path and its pinned source generation. */
  sourceMatches: (video: Record<string, unknown>) => boolean;
  jobPatch: Record<string, unknown>;
  videoPatch: Record<string, unknown> | ((video: Record<string, unknown>) => Record<string, unknown>);
}

/**
 * The production terminal writer and emulator tests share this exact transaction.
 * The result comes only after the Firestore transaction commits successfully.
 * No provider or Storage calls occur here.
 */
export async function commitTerminalVideoProcessingIfCurrent(
  firestore: Firestore,
  jobRef: DocumentReference,
  observed: VideoProcessingJob,
  command: TerminalVideoCommitCommand
): Promise<VideoCommitDisposition> {
  const videoRef = firestore.doc(`users/${observed.ownerUid}/videos/${observed.videoId}`);
  const eventId = randomUUID();
  return firestore.runTransaction(async transaction => {
    const [jobSnapshot, videoSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(videoRef),
    ]);
    const current = jobSnapshot.exists ? command.normalizeJob(jobSnapshot.data()) : null;
    if (!current || !isCurrentVideoProcessingAttempt(current, observed)) {
      return 'REPLACED' as const;
    }
    // A terminal result can arrive after deletion was requested, even while
    // its version/lease still matches. Do not update the private video.
    if (await isOwnerDeletingForVideoMutationInTransaction(
      firestore, transaction, observed.ownerUid
    )) {
      if (jobSnapshot.get('state') !== 'CANCEL_REQUESTED') {
        stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
          eventId, source: 'TERMINAL_COMMIT',
          kind: 'CANCEL_REQUESTED', before: jobSnapshot,
          afterState: 'CANCEL_REQUESTED',
        });
        transaction.update(jobRef, withAdminTriageProjection(jobRef.id, current, {
          state: 'CANCEL_REQUESTED',
          cancelRequestedAt: command.now,
          nextAttemptAt: command.now,
          leaseUntil: null,
          updatedAt: command.now,
          lastErrorCode: 'ACCOUNT_DELETION_REQUESTED',
          lastError: 'A conta proprietária entrou em exclusão definitiva.',
        }, command.now));
      }
      return 'CANCEL_REQUESTED' as const;
    }
    const video = videoSnapshot.exists
      ? videoSnapshot.data() as Record<string, unknown> : null;
    if (!video || !command.sourceMatches(video)) {
      const sourceChanged = !!video;
      if (jobSnapshot.get('state') !== 'CANCEL_REQUESTED') {
        stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
          eventId, source: 'TERMINAL_COMMIT',
          kind: 'CANCEL_REQUESTED', before: jobSnapshot,
          afterState: 'CANCEL_REQUESTED',
        });
      }
      transaction.update(jobRef, withAdminTriageProjection(jobRef.id, current, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: sourceChanged
          ? command.now : current.cancelRequestedAt ?? command.now,
        nextAttemptAt: command.now,
        leaseUntil: null,
        updatedAt: command.now,
        ...(sourceChanged && command.state === 'SUCCEEDED'
          ? {
            lastErrorCode: 'SOURCE_CHANGED',
            lastError: 'O arquivo privado associado ao vídeo foi alterado.',
          } : {}),
      }, command.now));
      return 'CANCEL_REQUESTED' as const;
    }
    if (jobSnapshot.get('state') !== command.state) {
      stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
        eventId, source: 'TERMINAL_COMMIT', kind: 'STATE_TRANSITION',
        before: jobSnapshot, afterState: command.state,
      });
    }
    transaction.update(jobRef, withAdminTriageProjection(jobRef.id, current, {
      state: command.state,
      ...command.jobPatch,
      updatedAt: command.now,
    }, command.now));
    transaction.set(videoRef, {
      ...(typeof command.videoPatch === 'function' ? command.videoPatch(video) : command.videoPatch),
      updatedAt: command.now,
    }, { merge: true });
    return 'APPLIED' as const;
  });
}
