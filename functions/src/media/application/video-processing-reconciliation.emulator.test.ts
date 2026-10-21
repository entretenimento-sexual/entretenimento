import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import axios, { AxiosError, type AxiosResponse } from 'axios';

import { synchronizePublishedVideoSettingsInFirestore } from './sync-published-video-settings.handler';
import { buildQueuedVideoProcessingJob, type VideoProcessingJob } from './video-processing-job';
import { withAdminTriageProjection } from './admin-video-triage.firestore';
import {
  stageVideoTriageMutationInTransaction,
  stageVideoTriageCreatedJobInTransaction,
  VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION,
} from './admin-video-triage-mutation-outbox.firestore';
import { sampleVideoTriageReadinessPage } from './admin-video-triage-readiness.firestore';
import {
  auditVideoTriageConcurrentPage, type VideoTriagePageReadObservation,
} from './admin-video-triage-evidence-audit.firestore';
import { readAuthenticatedTriageIndexPage } from './admin-video-triage-evidence.firestore';
import { runOneVideoTriageAuditPage } from './admin-video-triage-audit-session.firestore';
import {
  registerSignedVideoTriageAuditJournal, readDurableVideoTriageAuditJournal,
  claimDurableVideoTriageAuditPage, settleDurableVideoTriageAuditPage,
  recoverDurableVideoTriageAuditAttempt, runOneDurableVideoTriageAuditPage,
  VIDEO_TRIAGE_AUDIT_LEASE_MS, VIDEO_TRIAGE_AUDIT_JOURNAL_COLLECTION,
} from './admin-video-triage-audit-journal.firestore';
import {
  createVideoTriageAuditSession,
} from './admin-video-triage-audit-session.policy';
import {
  validateVideoTriageAuditSession, type VideoTriageAuditSdkEvent,
} from './admin-video-triage-audit-journal.firestore';
import {
  reconcileVideoTriageFixture, reconcileVideoTriageClosedEpochFixture,
} from './admin-video-triage-audit-session.policy';
import { projectAdminTriageJob } from './admin-video-global-triage.policy';
import {
  auditVideoTriageIntegrityPage, reclassifyDueVideoTriagePage,
} from './admin-video-triage-consistency.firestore';
import {
  prepareVideoTriageBackfillPage, applyObservedVideoTriageBackfillJob,
} from './admin-video-triage-backfill.firestore';
import { saveLastVideoSchedulerCycle, bestEffortSaveVideoSchedulerCycle }
  from './video-scheduler-observability.firestore';
import {
  createVideoWorkOutcomeCounter, terminalVideoWorkOutcomes,
} from './video-processing-outcomes.policy';
import {
  commitTerminalVideoProcessingIfCurrent,
} from './video-processing-terminal-commit.firestore';
import {
  diagnoseVideoScheduler, videoSchedulerRecord, VIDEO_SCHEDULER_COLLECTION,
} from './video-scheduler-observability.policy';
import {
  clearProviderPollFailures,
  isProviderPollReviewRequired,
} from './video-provider-poll-failure.policy';
import {
  buildTerminalCleanupQueue,
  preserveTerminalCleanupBeforeRetry,
  terminalCleanupRef,
  claimDueTerminalTemporaryCleanup,
  isTerminalTemporaryClaimCurrent,
  terminalCleanupReviewBlocker,
  recheckReviewedTerminalTemporaryCleanup,
  TerminalCleanupReviewPreconditionError,
} from './video-terminal-temporary-cleanup.firestore';

import { decideMissingVideoSubmission } from './video-submission-confirmation.policy';
import { isCurrentVideoProcessingAttempt } from './video-processing-poll.policy';
import { commitCopiedVideoPublicationIfCurrent } from './video-publication-commit.firestore';
import {
  VIDEO_ORIGINAL_CLEANUP_COLLECTION,
  VIDEO_ORIGINAL_CLEANUP_GRACE_MS,
  videoOriginalCleanupJobId,
} from './video-original-cleanup.policy';
import { deleteUnreferencedPublishedVideoAsset } from './published-video-asset-cleanup.firestore';
import { migrateLegacyPublishedVideoCleanupJobs } from './published-video-cleanup-migration.firestore';
import {
  claimPublishedVideoCleanupJob,
  clearPublishedVideoCleanupJobIfUnleased,
  settlePublishedVideoCleanupJob,
} from './published-video-cleanup-queue.firestore';
import { VIDEO_CLEANUP_LEASE_MS } from './video-cleanup-claim.policy';
import {
  commitPrivateVideoRegistrationIfUnused,
  isVideoIdentityRetiring,
  retireVideoIdentityInBatch,
  retireVideoIdentityForActiveClaim,
  VideoIdentityUnavailableError,
} from './video-identity-guard.firestore';
import {
  claimVideoDeletionJob,
  createVideoDeletionJobIfAbsent,
  settleVideoDeletionJob,
} from './video-deletion-queue.firestore';
import {
  resolvePublicVideoSignedAccessItem,
  type PublicVideoSignedAccessRequest,
} from './public-video-access-resolution.firestore';
import { commitProfileVideoDeletionRequest }
  from './video-profile-deletion-commit.firestore';
import { retryFailedJob, mutateExistingJob }
  from './admin-video-processing-recovery.handler';
import {
  reconcileClosedVideoTriageOutbox,
  type ClosedOutboxEpochWitness,
  type ClosedOutboxObservedEvent,
  type ClosedOutboxObservedJob,
} from './admin-video-triage-closed-outbox.policy';
import { FirestoreAccountDataDeletionOrchestratorAdapter }
  from '../../account_lifecycle/account-owned-media-deletion.firestore';
import { isBilateralBlockActive } from '../../friendship/application/bilateral-block-access.policy';
import {
  executeVideoCancellation,
  type VideoCancellationPorts,
} from './video-cancellation-execution';
import {
  deleteVideoTranscoderJobWithTransport,
} from './video-transcoder-delete.transport';
import {
  backfillLegacyProcessingDueAt,
  claimProcessingJob,
  recordProviderPollErrorIfCurrent,
  queryDueCancelledJobs,
  claimDueCancellation,
  deleteCancelledJobIfCurrent,
  queryDueProcessingJobs,
  recordCancellationErrorIfCurrent,
  bindCancelledProviderJobIfCurrent,
  claimExpiredSubmissionLease,
  updateRecoveredSubmissionIfCurrent,
  confirmTranscoderPostIsCurrent,
} from './video-processing-reconciliation.firestore';

const PROJECT_ID = 'demo-entretenimento-video-reconciliation';
const expectedHost = process.env.VIDEO_RECONCILE_EXPECTED_EMULATOR_HOST;
const host = process.env.FIRESTORE_EMULATOR_HOST;

assert.equal(process.env.GCLOUD_PROJECT, PROJECT_ID);
assert.match(String(host ?? ''), /^127\.0\.0\.1:\d{2,5}$/);
assert.equal(host, expectedHost);
assert.notEqual(host, '127.0.0.1:8080');
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, '');

const app = initializeApp({ projectId: PROJECT_ID }, 'video-reconciliation-e2e');
const firestore = getFirestore(app);
const jobs = firestore.collection('media_video_processing_jobs');
const now = 1_800_000_000_000;

after(async () => {
  await deleteApp(app);
});

function fixture(suffix: string): VideoProcessingJob {
  const uid = 'demo-reconciler';
  const videoId = 'vid-' + randomUUID();
  return {
    ...buildQueuedVideoProcessingJob({
      ownerUid: uid,
      videoId,
      sourceStoragePath: `users/${uid}/uploads/videos/${videoId}-source.mp4`,
      sourcePosterStoragePath: null,
      sourceMimeType: 'video/mp4',
      sourceSizeBytes: 10_000,
      sourceDurationMs: 10_000,
      now: now - 3 * 60_000,
    }),
    state: 'PROCESSING',
    providerState: suffix,
    externalJobName: 'projects/demo/locations/us-central1/jobs/' + videoId,
    submittedAt: now - 3 * 60_000,
    nextAttemptAt: now - 1_000,
  };
}
function parseJob(data: unknown): VideoProcessingJob | null {
  return data && typeof data === 'object' ? data as VideoProcessingJob : null;
}


function readyPublicationFixture() {
  const ownerUid = 'demo-video-publisher';
  const videoId = 'vid-' + randomUUID();
  const path = `users/${ownerUid}/uploads/videos/${videoId}-original.mp4`;
  const processed = `users/${ownerUid}/processed/videos/${videoId}/version-one/output.mp4`;
  const ownerRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = firestore.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const publicRef = firestore.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  const video = {
    ownerUid, path, processedStoragePath: processed,
    status: 'ready', mimeType: 'video/mp4', durationMs: 12_000,
  };
  function command(version: string) {
    const copiedPath =
      `users/${ownerUid}/published/videos/${videoId}/assets/${version}`;
    return {
      ownerUid, videoId, sourceVideoStoragePath: path,
      sourceProcessedStoragePath: processed,
      publicationPatch: {
        ownerUid, videoId, isPublished: true,
        moderationStatus: 'APPROVED', publishedStoragePath: copiedPath,
      },
      publicVideoPatch: {
        id: videoId, ownerUid, mediaType: 'VIDEO',
        assetAccess: 'SIGNED_URL', assetVersion: version,
      },
    };
  }
  return { video, ownerRef, publicationRef, publicRef, command };
}

async function expectPublicationDenied(
  fixture: ReturnType<typeof readyPublicationFixture>
): Promise<void> {
  await assert.rejects(
    commitCopiedVideoPublicationIfCurrent(
      firestore, fixture.command('copy-' + randomUUID())
    ),
    (error: unknown) => !!error && typeof error === 'object' &&
      'code' in error && error.code === 'failed-precondition'
  );
  assert.notEqual((await fixture.publicationRef.get()).get('isPublished'), true);
  assert.equal((await fixture.publicRef.get()).exists, false);
}

test('real publication transaction fences source, derivative and status changes', async () => {
  for (const [field, replacement] of [
    ['status', 'processing'],
    ['path', 'users/demo-video-publisher/uploads/videos/replaced.mp4'],
    ['processedStoragePath',
      'users/demo-video-publisher/processed/videos/other/v2/output.mp4'],
  ] as const) {
    const fixture = readyPublicationFixture();
    await fixture.ownerRef.set({ ...fixture.video, [field]: replacement });
    await expectPublicationDenied(fixture);
  }
});

test('real publication transaction blocks moderation changes during copy', async () => {
  for (const reason of ['moderated', 'source-rejected'] as const) {
    const fixture = readyPublicationFixture();
    await fixture.ownerRef.set(fixture.video);
    await fixture.publicationRef.set(reason === 'moderated'
      ? { moderationStatus: 'REJECTED' }
      : { rejectedSourceStoragePath: fixture.video.path });
    await expectPublicationDenied(fixture);
  }
});

test('original cleanup job is atomically created with a successful publication', async () => {
  const fixture = readyPublicationFixture();
  const generation = '90071992547409933';
  await fixture.ownerRef.set({ ...fixture.video, sourceGeneration: generation });
  const command = fixture.command('cleanup-' + randomUUID());
  await commitCopiedVideoPublicationIfCurrent(firestore, command);
  const jobRef = firestore.collection(VIDEO_ORIGINAL_CLEANUP_COLLECTION)
    .doc(videoOriginalCleanupJobId(command.ownerUid, command.videoId));
  const [job, publication] = await Promise.all([
    jobRef.get(), fixture.publicationRef.get(),
  ]);
  assert.ok(job.exists);
  assert.equal(publication.get('publishedStoragePath'), command.publicationPatch['publishedStoragePath']);
  assert.equal(job.get('state'), 'retryable');
  assert.equal(job.get('sourceStoragePath'), fixture.video.path);
  assert.equal(job.get('sourceGeneration'), generation);
  assert.equal(job.get('processedStoragePath'), fixture.video.processedStoragePath);
  assert.equal(job.get('publishedStoragePath'), command.publicationPatch['publishedStoragePath']);
  assert.equal(job.get('nextAttemptAt') - job.get('createdAt'), VIDEO_ORIGINAL_CLEANUP_GRACE_MS);
});

test('legacy publication without stored GCS generation keeps its original', async () => {
  const fixture = readyPublicationFixture();
  await fixture.ownerRef.set(fixture.video);
  const command = fixture.command('legacy-' + randomUUID());
  await commitCopiedVideoPublicationIfCurrent(firestore, command);
  const job = await firestore.collection(VIDEO_ORIGINAL_CLEANUP_COLLECTION)
    .doc(videoOriginalCleanupJobId(command.ownerUid, command.videoId)).get();
  assert.equal((await fixture.publicationRef.get()).get('isPublished'), true);
  assert.equal(job.exists, false);
});

test('publication rejected during transaction never leaves an original-cleanup job', async () => {
  const fixture = readyPublicationFixture();
  await fixture.ownerRef.set({ ...fixture.video, sourceGeneration: '90071992547409933' });
  await fixture.publicationRef.set({ moderationStatus: 'REJECTED' });
  const command = fixture.command('rejected-' + randomUUID());
  await assert.rejects(commitCopiedVideoPublicationIfCurrent(firestore, command),
    (error: unknown) => !!error && typeof error === 'object' &&
      'code' in error && error.code === 'failed-precondition');
  const job = await firestore.collection(VIDEO_ORIGINAL_CLEANUP_COLLECTION)
    .doc(videoOriginalCleanupJobId(command.ownerUid, command.videoId)).get();
  assert.equal(job.exists, false);
  assert.equal((await fixture.publicRef.get()).exists, false);
});

test('two concurrent publication transactions cannot publish different copies', async () => {
  const fixture = readyPublicationFixture();
  await fixture.ownerRef.set(fixture.video);
  const a = fixture.command('copy-' + randomUUID());
  const b = fixture.command('copy-' + randomUUID());
  const attempts = await Promise.allSettled([
    commitCopiedVideoPublicationIfCurrent(firestore, a),
    commitCopiedVideoPublicationIfCurrent(firestore, b),
  ]);
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(x => x.status === 'rejected').length, 1);
  const persisted = await fixture.publicationRef.get();
  const projection = await fixture.publicRef.get();
  const winningPath = persisted.get('publishedStoragePath');
  assert.ok(
    winningPath === a.publicationPatch['publishedStoragePath'] ||
    winningPath === b.publicationPatch['publishedStoragePath']
  );
  const winningVersion = winningPath === a.publicationPatch['publishedStoragePath']
    ? a.publicVideoPatch['assetVersion']
    : b.publicVideoPatch['assetVersion'];
  assert.equal(projection.get('assetVersion'), winningVersion);
  // The losing copied path never becomes referenced by Firestore.
  assert.notEqual(winningPath, winningPath === a.publicationPatch['publishedStoragePath']
    ? b.publicationPatch['publishedStoragePath']
    : a.publicationPatch['publishedStoragePath']);
});


test('cleanup never deletes a video asset referenced by an active publication', async () => {
  const fixture = readyPublicationFixture();
  await fixture.ownerRef.set(fixture.video);
  const version = 'active-' + randomUUID();
  const published = fixture.command(version);
  await commitCopiedVideoPublicationIfCurrent(firestore, published);
  let deletes = 0;

  const result = await deleteUnreferencedPublishedVideoAsset(
    firestore, {
      ownerUid: published.ownerUid,
      videoId: published.videoId,
      storagePath: String(published.publicationPatch['publishedStoragePath']),
      assetKind: 'video',
    },
    async () => { deletes += 1; }
  );
  assert.equal(result, 'ACTIVE_REFERENCE');
  assert.equal(deletes, 0);
  assert.equal((await fixture.publicationRef.get()).get('isPublished'), true);
  assert.equal((await fixture.publicRef.get()).get('assetVersion'), version);
});

test('cleanup protects current poster but permits obsolete video versions', async () => {
  const fixture = readyPublicationFixture();
  const currentVideo = fixture.command('v-' + randomUUID());
  const posterPath = `users/${currentVideo.ownerUid}/published/videos/${currentVideo.videoId}/posters/current`;
  await fixture.publicationRef.set({
    ...currentVideo.publicationPatch,
    publishedPosterStoragePath: posterPath,
  });
  const deleted: string[] = [];

  async function attempt(storagePath: string, assetKind: 'video' | 'poster') {
    return deleteUnreferencedPublishedVideoAsset(
      firestore,
      { ownerUid: currentVideo.ownerUid, videoId: currentVideo.videoId,
        storagePath, assetKind },
      async () => { deleted.push(storagePath); }
    );
  }

  assert.equal(await attempt(posterPath, 'poster'), 'ACTIVE_REFERENCE');
  assert.equal(await attempt(String(
    currentVideo.publicationPatch['publishedStoragePath']
  ), 'video'), 'ACTIVE_REFERENCE');
  const oldPath =
    `users/${currentVideo.ownerUid}/published/videos/${currentVideo.videoId}/assets/old-version`;
  assert.equal(await attempt(oldPath, 'video'), 'DELETED');
  assert.deepEqual(deleted, [oldPath]);
});

test('unpublished asset cleanup succeeds and propagates storage failures', async () => {
  const fixture = readyPublicationFixture();
  const item = fixture.command('removed-' + randomUUID());
  const path = String(item.publicationPatch['publishedStoragePath']);
  await fixture.publicationRef.set({
    ...item.publicationPatch, isPublished: false,
  });
  let attempts = 0;
  const command = {
    ownerUid: item.ownerUid, videoId: item.videoId,
    storagePath: path, assetKind: 'video' as const,
  };
  assert.equal(await deleteUnreferencedPublishedVideoAsset(
    firestore, command, async () => { attempts += 1; }
  ), 'DELETED');
  assert.equal(attempts, 1);
  await assert.rejects(
    deleteUnreferencedPublishedVideoAsset(
      firestore, command,
      async () => { throw new Error('Storage unavailable'); }
    ),
    /Storage unavailable/
  );
});

function publicPlaybackFixture() {
  const ownerUid = 'demo-playback-owner';
  const videoId = 'video-' + randomUUID();
  const viewerUid = 'demo-playback-viewer';
  const asset = `users/${ownerUid}/published/videos/${videoId}/assets/version-one`;
  const poster = `users/${ownerUid}/published/videos/${videoId}/posters/version-one`;
  const publicationRef = firestore.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const projectionRef = firestore.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`
  );
  const outboundBlockRef = firestore.doc(
    `users/${viewerUid}/blocks/${ownerUid}`
  );
  const inboundBlockRef = firestore.doc(
    `users/${ownerUid}/blocks/${viewerUid}`
  );
  const signed: string[] = [];
  const request: PublicVideoSignedAccessRequest = {
    ownerUid, videoId, nowMs: now,
    technicalExpiresAt: now + 5 * 60_000,
    requesterAccessExpiresAtMs: null,
    ownerAccessExpiresAtMs: null,
    ownerExposureAllowed: true,
    mode: 'PLAYBACK',
  };
  const ports = {
    fileExists: async (path: string) => path === asset || path === poster,
    createReadUrl: async (path: string, expiresAt: number) => {
      signed.push(path);
      return `signed:${path}:${expiresAt}`;
    },
  };
  async function setup() {
    await Promise.all([
      publicationRef.set({
        isPublished: true, visibility: 'PUBLIC',
        moderationStatus: 'APPROVED', publishedStoragePath: asset,
        publishedPosterStoragePath: poster,
      }),
      projectionRef.set({
        visibility: 'PUBLIC', moderationStatus: 'APPROVED',
      }),
    ]);
  }
  async function issue(
    overrides: Partial<PublicVideoSignedAccessRequest> = {}
  ) {
    return resolvePublicVideoSignedAccessItem(
      firestore, { ...request, ...overrides }, ports
    );
  }
  return {
    ownerUid, videoId, viewerUid, asset, poster, publicationRef,
    projectionRef, outboundBlockRef, inboundBlockRef, request, ports,
    signed, setup, issue,
  };
}

test('fresh playback URLs stop after unpublish, moderation or audience restriction', async () => {
  for (const [collection, patch] of [
    ['publication', { isPublished: false }],
    ['publication', { moderationStatus: 'HIDDEN' }],
    ['publication', { moderationStatus: 'REJECTED' }],
    ['publication', { moderationStatus: 'PENDING_REVIEW' }],
    ['publication', { visibility: 'FRIENDS' }],
    ['projection', { moderationStatus: 'FLAGGED' }],
    ['projection', { visibility: 'FRIENDS' }],
  ] as const) {
    const fixture = publicPlaybackFixture();
    await fixture.setup();
    assert.ok((await fixture.issue())?.url);
    const countBeforeRestriction = fixture.signed.length;
    const target = collection === 'publication'
      ? fixture.publicationRef
      : fixture.projectionRef;
    await target.set(patch, { merge: true });
    assert.equal(await fixture.issue(), null);
    assert.equal(fixture.signed.length, countBeforeRestriction);
  }
});

test('public playback never signs for blocked or suspended owners', async () => {
  for (const direction of ['outbound', 'inbound'] as const) {
    const fixture = publicPlaybackFixture();
    await fixture.setup();
    const blockRef = direction === 'outbound'
      ? fixture.outboundBlockRef
      : fixture.inboundBlockRef;
    await blockRef.set({ isBlocked: true });
    const [outbound, inbound] = await Promise.all([
      fixture.outboundBlockRef.get(), fixture.inboundBlockRef.get(),
    ]);
    const blocked = isBilateralBlockActive({
      actorBlock: outbound.exists ? outbound.data() : null,
      targetBlock: inbound.exists ? inbound.data() : null,
    });
    assert.equal(blocked, true);
    assert.equal(await fixture.issue({
      ownerExposureAllowed: !blocked,
    }), null);
    assert.equal(fixture.signed.length, 0);
  }
  const restricted = publicPlaybackFixture();
  await restricted.setup();
  assert.equal(await restricted.issue({ ownerExposureAllowed: false }), null);
  assert.equal(restricted.signed.length, 0);
});

test('public signed URLs cap expiry and PREVIEW omits playback', async () => {
  const fixture = publicPlaybackFixture();
  await fixture.setup();
  const capped = await fixture.issue({
    requesterAccessExpiresAtMs: now + 60_000,
    ownerAccessExpiresAtMs: now + 30_000,
  });
  assert.equal(capped?.expiresAt, now + 30_000);
  assert.equal(fixture.signed.length, 2);
  const preview = await fixture.issue({ mode: 'PREVIEW' });
  assert.equal(preview?.url, null);
  assert.ok(preview?.posterUrl);
  assert.equal(fixture.signed.length, 3);
  const expired = await fixture.issue({
    requesterAccessExpiresAtMs: now - 1,
  });
  assert.equal(expired, null);
  assert.equal(fixture.signed.length, 3);
});

test('due query selects earliest 20 and second batch after atomic claims', async () => {
  const prefix = 'due-' + randomUUID();
  const dueRefs = [];
  for (let i = 0; i < 25; i += 1) {
    const ref = jobs.doc(prefix + '-' + String(i).padStart(3, '0'));
    const job = fixture('RUNNING');
    await ref.set({ ...job, nextAttemptAt: now - 25_000 + i * 100 });
    dueRefs.push(ref);
  }
  const futureRef = jobs.doc(prefix + '-future');
  await futureRef.set({ ...fixture('PENDING'), nextAttemptAt: now + 60_000 });

  // The test collection is exclusively owned by this disposable emulator.
  const first = await queryDueProcessingJobs(firestore, now, 20).get();
  assert.equal(first.size, 20);
  assert.equal(first.docs[0].ref.id, dueRefs[0].id);

  const sameRef = first.docs[0].ref;
  const results = await Promise.all([
    claimProcessingJob(firestore, sameRef, now, parseJob),
    claimProcessingJob(firestore, sameRef, now, parseJob),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const claimed = (await sameRef.get()).data();
  assert.equal(claimed?.['updatedAt'], now - 3 * 60_000);
  assert.ok(Number(claimed?.['nextAttemptAt']) > now);

  for (const doc of first.docs.slice(1)) {
    assert.ok(await claimProcessingJob(firestore, doc.ref, now, parseJob));
  }
  const second = await queryDueProcessingJobs(firestore, now, 20).get();
  assert.equal(second.size, 5);
  assert.ok(second.docs.every(doc => doc.id !== futureRef.id));
});


test('terminal provider results are fenced to the newest PROCESSING poll claim', async () => {
  for (const [obsolete, latest] of [
    ['FAILED', 'SUCCEEDED'],
    ['SUCCEEDED', 'FAILED'],
  ] as const) {
    const jobRef = jobs.doc('processing-terminal-fence-' + randomUUID());
    const initial = fixture('RUNNING');
    const videoRef = firestore.doc(
      `users/${initial.ownerUid}/videos/${initial.videoId}`
    );
    await jobRef.set(initial);
    await videoRef.set({
      path: initial.sourceStoragePath,
      status: 'processing',
      processingStage: 'processing',
    });

    const first = await claimProcessingJob(firestore, jobRef, now, parseJob);
    assert.ok(first);
    const later = first.nextAttemptAt + 1_000;
    const second = await claimProcessingJob(firestore, jobRef, later, parseJob);
    assert.ok(second);
    assert.notEqual(first.nextAttemptAt, second.nextAttemptAt);

    // Same transactional predicate used by both production terminal writers.
    async function applyTerminalResult(
      observed: VideoProcessingJob,
      state: 'FAILED' | 'SUCCEEDED'
    ): Promise<boolean> {
      return firestore.runTransaction(async (transaction) => {
        const [jobSnapshot, videoSnapshot] = await Promise.all([
          transaction.get(jobRef),
          transaction.get(videoRef),
        ]);
        const current = jobSnapshot.exists
          ? parseJob(jobSnapshot.data())
          : null;
        if (!current || !videoSnapshot.exists ||
          !isCurrentVideoProcessingAttempt(current, observed)) {
          return false;
        }
        const status = state === 'SUCCEEDED' ? 'ready' : 'failed';
        transaction.update(jobRef, { state, providerState: state });
        transaction.update(videoRef, { status, processingStage: status });
        return true;
      });
    }

    assert.equal(await applyTerminalResult(first, obsolete), false);
    assert.equal((await jobRef.get()).get('state'), 'PROCESSING');
    assert.equal((await videoRef.get()).get('status'), 'processing');

    assert.equal(await applyTerminalResult(second, latest), true);
    assert.equal((await jobRef.get()).get('state'), latest);
    const finalStatus = latest === 'SUCCEEDED' ? 'ready' : 'failed';
    assert.equal((await videoRef.get()).get('status'), finalStatus);
    assert.equal((await videoRef.get()).get('processingStage'), finalStatus);
    assert.equal(await applyTerminalResult(first, obsolete), false);
    assert.equal((await videoRef.get()).get('status'), finalStatus);
  }
});

test('PROCESSING recovery rejects obsolete polling claims without a provider ID', async () => {
  const ref = jobs.doc('recover-processing-fence-' + randomUUID());
  const initial = {
    ...fixture('PENDING'),
    externalJobName: null,
    nextAttemptAt: now - 1_000,
  };
  await ref.set(initial);

  const first = await claimProcessingJob(firestore, ref, now, parseJob);
  assert.ok(first);
  assert.equal((await ref.get()).get('nextAttemptAt'), first.nextAttemptAt);
  assert.ok(first.nextAttemptAt > now);

  // A pre-claim or delayed lookup cannot write into the reserved slot.
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, { ...first, nextAttemptAt: initial.nextAttemptAt },
    parseJob, {
      now,
      jobPatch: { lastErrorCode: 'STALE_RECOVERY' },
    }
  ), false);
  assert.equal((await ref.get()).get('lastErrorCode'), null);

  // A later scheduler invocation takes the same version's polling slot.
  const later = first.nextAttemptAt + 1_000;
  const second = await claimProcessingJob(firestore, ref, later, parseJob);
  assert.ok(second);
  assert.notEqual(first.nextAttemptAt, second.nextAttemptAt);
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, first, parseJob, {
      now: later,
      jobPatch: { lastErrorCode: 'STALE_RECOVERY' },
    }
  ), false);
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, second, parseJob, {
      now: later,
      jobPatch: { lastErrorCode: 'CURRENT_RECOVERY' },
    }
  ), true);
  assert.equal((await ref.get()).get('lastErrorCode'), 'CURRENT_RECOVERY');
});

test('legacy PROCESSING job requires an explicit version-checked backfill', async () => {
  const ref = jobs.doc('legacy-' + randomUUID());
  const original = fixture('RUNNING');
  const { nextAttemptAt: _ignored, ...legacy } = original;
  void _ignored;
  await ref.set(legacy);

  const dueBefore = await queryDueProcessingJobs(firestore, now, 50).get();
  assert.ok(!dueBefore.docs.some(doc => doc.id === ref.id));
  assert.equal(await backfillLegacyProcessingDueAt(
    firestore, ref, 'invalid-version', now
  ), false);
  assert.equal(await backfillLegacyProcessingDueAt(
    firestore, ref, original.processingVersion, now
  ), true);
  assert.equal(await backfillLegacyProcessingDueAt(
    firestore, ref, original.processingVersion, now
  ), false);

  const migrated = await ref.get();
  assert.equal(migrated.get('nextAttemptAt'), now);
  assert.equal(migrated.get('updatedAt'), original.updatedAt);
  assert.ok(await claimProcessingJob(firestore, ref, now, parseJob));

  const cancelledRef = jobs.doc('legacy-cancelled-' + randomUUID());
  await cancelledRef.set({ ...legacy, state: 'CANCEL_REQUESTED' });
  assert.equal(await backfillLegacyProcessingDueAt(
    firestore, cancelledRef, original.processingVersion, now
  ), false);
  assert.equal((await cancelledRef.get()).get('nextAttemptAt'), undefined);
});

test('delayed cancellation cannot delete, alter or recreate a newer attempt', async () => {
  const ref = jobs.doc('cancel-' + randomUUID());
  const original = { ...fixture('PENDING'), state: 'CANCEL_REQUESTED' as const };
  await ref.set(original);
  const newer = {
    ...fixture('RUNNING'),
    state: 'PROCESSING' as const,
  };
  await ref.set(newer);

  assert.equal(await deleteCancelledJobIfCurrent(
    firestore, ref, original, parseJob
  ), false);
  assert.equal(await recordCancellationErrorIfCurrent(
    firestore, ref, original, parseJob,
    { code: 'TIMEOUT', message: 'Late provider response' }, now
  ), false);
  assert.equal((await ref.get()).get('processingVersion'), newer.processingVersion);
  assert.equal((await ref.get()).get('lastErrorCode'), null);

  await ref.set(original);
  assert.equal(await deleteCancelledJobIfCurrent(
    firestore, ref, original, parseJob
  ), true);
  assert.equal((await ref.get()).exists, false);
  const tombstoneKey = createHash('sha256').update(ref.path).digest('hex');
  const tombstones = await firestore
    .collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', tombstoneKey).get();
  assert.equal(tombstones.size, 1);
  assert.equal(tombstones.docs[0].get('source'), 'CANCELLATION_RECONCILIATION');
  assert.equal(tombstones.docs[0].get('kind'), 'DELETE');
  assert.equal(tombstones.docs[0].get('nextState'), null);
  assert.equal(tombstones.docs[0].get('globalCoverageVerified'), false);
  assert.equal(await recordCancellationErrorIfCurrent(
    firestore, ref, original, parseJob,
    { code: 'TIMEOUT', message: 'Late provider response' }, now
  ), false);
  assert.equal((await ref.get()).exists, false);
});

test('submission lease query excludes future leases before the batch limit', async () => {
  const expiredRef = jobs.doc('lease-expired-' + randomUUID());
  const futureRef = jobs.doc('lease-future-' + randomUUID());
  await expiredRef.set({
    ...fixture('PENDING'), state: 'SUBMITTING', leaseUntil: now - 1_000,
  });
  await futureRef.set({
    ...fixture('PENDING'), state: 'SUBMITTING', leaseUntil: now + 60_000,
  });
  const result = await jobs
    .where('state', '==', 'SUBMITTING')
    .where('leaseUntil', '<=', now)
    .orderBy('leaseUntil', 'asc')
    .limit(8)
    .get();
  assert.ok(result.docs.some(doc => doc.id === expiredRef.id));
  assert.ok(!result.docs.some(doc => doc.id === futureRef.id));
});

test('two competing submission recoveries claim only one expired lease', async () => {
  const ref = jobs.doc('recover-claim-' + randomUUID());
  const original = {
    ...fixture('PENDING'),
    state: 'SUBMITTING' as const,
    leaseUntil: now - 1_000,
  };
  await ref.set(original);
  const attempts = await Promise.all([
    claimExpiredSubmissionLease(firestore, ref, now, 300_000, parseJob),
    claimExpiredSubmissionLease(firestore, ref, now, 300_000, parseJob),
  ]);
  const claimed = attempts.filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal((await ref.get()).get('leaseUntil'), now + 300_000);

  const late = { ...claimed[0]!, leaseUntil: now - 1_000 };
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, late, parseJob, {
      now,
      jobPatch: { state: 'QUEUED', nextAttemptAt: now },
    }
  ), false);
  assert.equal((await ref.get()).get('state'), 'SUBMITTING');
});

test('recovery response cannot resurrect cancellation or overwrite new attempt', async () => {
  const ref = jobs.doc('recover-late-' + randomUUID());
  const old = {
    ...fixture('PENDING'),
    state: 'SUBMITTING' as const,
    leaseUntil: now + 300_000,
  };
  await ref.set(old);

  await ref.update({ state: 'CANCEL_REQUESTED', leaseUntil: null });
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, old, parseJob, {
      now,
      jobPatch: { state: 'QUEUED', nextAttemptAt: now },
    }
  ), false);
  assert.equal((await ref.get()).get('state'), 'CANCEL_REQUESTED');

  const newer = { ...fixture('RUNNING'), state: 'SUBMITTING' as const };
  await ref.set(newer);
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, old, parseJob, {
      now,
      jobPatch: { state: 'FAILED' },
    }
  ), false);
  assert.equal((await ref.get()).get('processingVersion'), newer.processingVersion);
});

test('a confirmed missing submission transitions job and video atomically', async () => {
  const jobRef = jobs.doc('recover-missing-' + randomUUID());
  const old = {
    ...fixture('PENDING'),
    state: 'SUBMITTING' as const,
    leaseUntil: now + 300_000,
  };
  const videoRef = firestore.doc(`users/${old.ownerUid}/videos/${old.videoId}`);
  await jobRef.set(old);
  await videoRef.set({ path: old.sourceStoragePath, status: 'processing' });

  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, jobRef, old, parseJob, {
      now,
      jobPatch: {
        state: 'QUEUED',
        leaseUntil: null,
        nextAttemptAt: now + 60_000,
      },
      videoPatch: { status: 'queued', processingStage: 'retry_wait' },
    }
  ), true);
  assert.equal((await jobRef.get()).get('state'), 'QUEUED');
  assert.equal((await videoRef.get()).get('processingStage'), 'retry_wait');
  const hash = createHash('sha256').update(jobRef.path).digest('hex');
  const events = () => firestore
    .collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  const firstTransition = await events();
  assert.equal(firstTransition.size, 1);
  assert.equal(firstTransition.docs[0].get('source'), 'SUBMISSION_RECOVERY');
  assert.equal(firstTransition.docs[0].get('previousState'), 'SUBMITTING');
  assert.equal(firstTransition.docs[0].get('nextState'), 'QUEUED');

  // If the source file changes while a lookup is in flight, fail closed.
  await jobRef.set(old);
  await videoRef.update({ path: 'users/other/private/videos/other/source.mp4' });
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, jobRef, old, parseJob, {
      now,
      jobPatch: { state: 'QUEUED' },
      videoPatch: { status: 'queued' },
    }
  ), false);
  assert.equal((await jobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await videoRef.get()).get('status'), 'queued');
  const secondTransition = await events();
  assert.equal(secondTransition.size, 2);
  assert.ok(secondTransition.docs.some(event =>
    event.get('nextState') === 'CANCEL_REQUESTED' &&
    event.get('source') === 'SUBMISSION_RECOVERY'));
});

test('late submit failure cannot override cancellation, retry or a new lease', async () => {
  const ref = jobs.doc('submit-error-' + randomUUID());
  const original = {
    ...fixture('PENDING'),
    state: 'SUBMITTING' as const,
    leaseUntil: now + 600_000,
  };
  const videoRef = firestore.doc(
    `users/${original.ownerUid}/videos/${original.videoId}`
  );
  await ref.set(original);
  await videoRef.set({
    path: original.sourceStoragePath,
    status: 'processing',
  });

  const update = {
    now,
    jobPatch: { state: 'FAILED', leaseUntil: null, lastErrorCode: 'HTTP_400' },
    videoPatch: { status: 'failed' },
  };

  // Cancelled during the original provider request.
  await ref.update({ state: 'CANCEL_REQUESTED' });
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, original, parseJob, update
  ), false);
  assert.equal((await ref.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await videoRef.get()).get('status'), 'processing');

  // A recovery worker takes over an expired submission before POST finishes.
  await ref.set({ ...original, leaseUntil: now + 900_000 });
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, original, parseJob, update
  ), false);
  assert.equal((await ref.get()).get('state'), 'SUBMITTING');

  // The last observed submit error belongs to an obsolete processing version.
  await ref.set({ ...original, processingVersion: 'new-attempt' });
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, original, parseJob, update
  ), false);
  assert.equal((await ref.get()).get('processingVersion'), 'new-attempt');

  // Only the live attempt may transition job and video in one transaction.
  await ref.set(original);
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, original, parseJob, update
  ), true);
  assert.equal((await ref.get()).get('state'), 'FAILED');
  assert.equal((await videoRef.get()).get('status'), 'failed');
});

test('negative provider lookup holds submission and never permits requeue', async () => {
  const ref = jobs.doc('confirm-negative-' + randomUUID());
  const current = {
    ...fixture('PENDING'),
    state: 'SUBMITTING' as const,
    leaseUntil: now + 300_000,
    submissionLookupMisses: 2,
  };
  const videoRef = firestore.doc(
    `users/${current.ownerUid}/videos/${current.videoId}`
  );
  await ref.set(current);
  await videoRef.set({ path: current.sourceStoragePath, status: 'processing' });
  const decision = decideMissingVideoSubmission(current, now);
  assert.equal(decision.leaseUntil, null);
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, current, parseJob, {
      now,
      jobPatch: { ...decision, updatedAt: now },
      videoPatch: {
        status: 'processing',
        processingStage: 'confirming_submission',
      },
    }
  ), true);
  assert.equal((await ref.get()).get('state'), 'SUBMITTING');
  assert.equal((await ref.get()).get('leaseUntil'), null);
  assert.equal((await ref.get()).get('lastErrorCode'), 'SUBMISSION_UNCONFIRMED');
  const due = await jobs.where('state', '==', 'SUBMITTING')
    .where('leaseUntil', '<=', now)
    .orderBy('leaseUntil', 'asc').get();
  assert.ok(!due.docs.some(doc => doc.id === ref.id));
});

test('unknown provider cancellation binds job name before permitting cleanup', async () => {
  const jobRef = jobs.doc('cancel-unknown-' + randomUUID());
  const old = {
    ...fixture('PENDING'),
    state: 'CANCEL_REQUESTED' as const,
    externalJobName: null,
    attempts: 1,
  };
  await jobRef.set(old);

  assert.equal(await bindCancelledProviderJobIfCurrent(
    firestore, jobRef, old, 'projects/demo/jobs/canonical',
    parseJob, now
  ), true);
  assert.equal((await jobRef.get()).get('externalJobName'), 'projects/demo/jobs/canonical');

  const replaced = { ...old, processingVersion: 'new-attempt' };
  await jobRef.set(replaced);
  assert.equal(await bindCancelledProviderJobIfCurrent(
    firestore, jobRef, old, 'projects/demo/jobs/late',
    parseJob, now
  ), false);
  assert.equal((await jobRef.get()).get('externalJobName'), null);
});

test('cancelled jobs are selected by due time, excluding deferred retries', async () => {
  const first = jobs.doc('cancel-due-a-' + randomUUID());
  const second = jobs.doc('cancel-due-b-' + randomUUID());
  const deferred = jobs.doc('cancel-later-' + randomUUID());

  await first.set({
    ...fixture('PENDING'),
    state: 'CANCEL_REQUESTED',
    nextAttemptAt: now - 120_000,
  });
  await second.set({
    ...fixture('PENDING'),
    state: 'CANCEL_REQUESTED',
    nextAttemptAt: now - 119_000,
  });
  await deferred.set({
    ...fixture('PENDING'),
    state: 'CANCEL_REQUESTED',
    nextAttemptAt: now + 60_000,
  });

  const due = await queryDueCancelledJobs(firestore, now, 20).get();
  assert.equal(due.docs[0].id, first.id);
  assert.equal(due.docs[1].id, second.id);
  assert.ok(!due.docs.some(doc => doc.id === deferred.id));
});

test('concurrent cancellation claims fence stale cleanup and back off failures', async () => {
  const ref = jobs.doc('cancel-claim-' + randomUUID());
  await ref.set({
    ...fixture('PENDING'),
    state: 'CANCEL_REQUESTED',
    nextAttemptAt: now - 1_000,
    cancellationCleanupAttempts: 0,
  });

  const [a, b] = await Promise.all([
    claimDueCancellation(firestore, ref, now, parseJob),
    claimDueCancellation(firestore, ref, now, parseJob),
  ]);
  const claimed = [a, b].filter((job): job is VideoProcessingJob => !!job);
  assert.equal(claimed.length, 1);

  const original = { ...claimed[0], nextAttemptAt: now - 1_000 };
  assert.equal(await recordCancellationErrorIfCurrent(
    firestore, ref, original, parseJob,
    { code: 'TRANSIENT', message: 'stale response' }, now
  ), false);

  assert.equal(await recordCancellationErrorIfCurrent(
    firestore, ref, claimed[0], parseJob,
    { code: 'TRANSIENT', message: 'first failure' }, now
  ), true);
  assert.equal((await ref.get()).get('cancellationCleanupAttempts'), 1);
  assert.equal((await ref.get()).get('nextAttemptAt'), now + 30 * 60_000);
  assert.equal((await ref.get()).get('cancellationReviewRequired'), false);

  const deferred = await queryDueCancelledJobs(firestore, now, 100).get();
  assert.ok(!deferred.docs.some(doc => doc.id === ref.id));

  const later = now + 30 * 60_000;
  const second = await claimDueCancellation(firestore, ref, later, parseJob);
  assert.ok(second);
  assert.equal(await recordCancellationErrorIfCurrent(
    firestore, ref, claimed[0], parseJob,
    { code: 'TRANSIENT', message: 'late callback' }, later
  ), false);
  assert.equal(await recordCancellationErrorIfCurrent(
    firestore, ref, second, parseJob,
    { code: 'CANCELLATION_UNCONFIRMED', message: 'provider not found' }, later
  ), true);
  assert.equal((await ref.get()).get('cancellationCleanupAttempts'), 2);
  assert.equal((await ref.get()).get('nextAttemptAt'), later + 2 * 60 * 60_000);
  assert.equal((await ref.get()).get('cancellationReviewRequired'), true);

  const thirdTime = later + 2 * 60 * 60_000;
  const third = await claimDueCancellation(firestore, ref, thirdTime, parseJob);
  assert.ok(third);
  assert.equal(await recordCancellationErrorIfCurrent(
    firestore, ref, third, parseJob,
    { code: 'TRANSIENT', message: 'third failure' }, thirdTime
  ), true);
  assert.equal((await ref.get()).get('cancellationCleanupAttempts'), 3);
  assert.equal((await ref.get()).get('nextAttemptAt'),
    thirdTime + 24 * 60 * 60_000);
  assert.equal((await ref.get()).get('cancellationReviewRequired'), true);
});

function fakeProviderError(status: number): AxiosError {
  return new AxiosError(
    'HTTP ' + status, 'ERR_BAD_RESPONSE', undefined, undefined,
    { status } as AxiosResponse
  );
}

/** All ports are local fakes or writes to this disposable demo emulator. */
function fakeCancellationPorts(
  ref: DocumentReference,
  events: string[],
  deleteRequest: (name: string) => Promise<unknown> = async () => undefined
): VideoCancellationPorts {
  return {
    findProviderJob: async () => {
      events.push('provider-lookup');
      return null;
    },
    bindProviderJob: (started, name) =>
      bindCancelledProviderJobIfCurrent(
        firestore, ref, started, name, parseJob, now
      ),
    deleteProviderJob: async (name) => {
      events.push('provider-delete');
      await deleteVideoTranscoderJobWithTransport(name, deleteRequest);
    },
    deleteOutputPrefix: async () => {
      events.push('storage-delete');
    },
    deleteCancelledJob: (started) => {
      events.push('firestore-delete');
      return deleteCancelledJobIfCurrent(
        firestore, ref, started, parseJob
      );
    },
    recordFailure: (started, error, clock) => {
      events.push('error:' + error.code);
      return recordCancellationErrorIfCurrent(
        firestore, ref, started, parseJob, error, clock
      );
    },
    normalizeError: (error) => ({
      code: axios.isAxiosError(error)
        ? 'HTTP_' + String(error.response?.status ?? 'UNKNOWN')
        : 'TRANSCODER_CLIENT_ERROR',
      message: error instanceof Error ? error.message : String(error),
    }),
    now: () => now,
  };
}

async function makeClaimedCancellation(
  externalJobName: string | null,
  attempts = 1
) {
  const ref = jobs.doc('cancel-end-to-end-' + randomUUID());
  const initial = {
    ...fixture('PENDING'),
    state: 'CANCEL_REQUESTED' as const,
    attempts,
    externalJobName,
    nextAttemptAt: now - 1_000,
    cancellationCleanupAttempts: 0,
  };
  await ref.set(initial);
  const claimed = await claimDueCancellation(firestore, ref, now, parseJob);
  assert.ok(claimed);
  return { ref, claimed };
}

test('mocked HTTP 200 completes cancellation and removes only its tracking job', async () => {
  const providerName = 'projects/demo/locations/us-central1/jobs/' + randomUUID();
  const { ref, claimed } = await makeClaimedCancellation(providerName);
  const events: string[] = [];

  const result = await executeVideoCancellation(
    claimed, fakeCancellationPorts(ref, events)
  );

  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(events, [
    'provider-delete', 'storage-delete', 'firestore-delete',
  ]);
  assert.equal((await ref.get()).exists, false);
});

test('mocked HTTP 404 is idempotent and completes the same cleanup transaction', async () => {
  const providerName = 'projects/demo/locations/us-central1/jobs/' + randomUUID();
  const { ref, claimed } = await makeClaimedCancellation(providerName);
  const events: string[] = [];
  const result = await executeVideoCancellation(
    claimed, fakeCancellationPorts(ref, events, async () => {
      throw fakeProviderError(404);
    })
  );

  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(events, [
    'provider-delete', 'storage-delete', 'firestore-delete',
  ]);
  assert.equal((await ref.get()).exists, false);
});

test('mocked HTTP 503 preserves cancellation and schedules retry without storage work', async () => {
  const providerName = 'projects/demo/locations/us-central1/jobs/' + randomUUID();
  const { ref, claimed } = await makeClaimedCancellation(providerName);
  const events: string[] = [];
  const result = await executeVideoCancellation(
    claimed, fakeCancellationPorts(ref, events, async () => {
      throw fakeProviderError(503);
    })
  );

  assert.equal(result.status, 'RETRY_SCHEDULED');
  assert.deepEqual(events, ['provider-delete', 'error:HTTP_503']);
  const snapshot = await ref.get();
  assert.equal(snapshot.exists, true);
  assert.equal(snapshot.get('state'), 'CANCEL_REQUESTED');
  assert.equal(snapshot.get('lastErrorCode'), 'HTTP_503');
  assert.equal(snapshot.get('cancellationCleanupAttempts'), 1);
  assert.equal(snapshot.get('nextAttemptAt'), now + 30 * 60_000);
});

test('malformed provider ID never reaches HTTP and cannot delete stored output', async () => {
  const { ref, claimed } = await makeClaimedCancellation('invalid-job-name');
  const events: string[] = [];
  let requests = 0;
  const result = await executeVideoCancellation(
    claimed, fakeCancellationPorts(ref, events, async () => {
      requests += 1;
    })
  );

  assert.equal(result.status, 'RETRY_SCHEDULED');
  assert.equal(requests, 0);
  assert.deepEqual(events, [
    'provider-delete', 'error:TRANSCODER_CLIENT_ERROR',
  ]);
  assert.equal((await ref.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await ref.get()).get('cancellationCleanupAttempts'), 1);
});

test('unknown remote submission remains tracked and does not delete output', async () => {
  const { ref, claimed } = await makeClaimedCancellation(null);
  const events: string[] = [];
  const result = await executeVideoCancellation(
    claimed, fakeCancellationPorts(ref, events)
  );

  assert.equal(result.status, 'UNCONFIRMED');
  assert.deepEqual(events, [
    'provider-lookup', 'error:CANCELLATION_UNCONFIRMED',
  ]);
  assert.equal((await ref.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await ref.get()).get('cancellationReviewRequired'), true);
  assert.equal((await ref.get()).get('externalJobName'), null);
});

test('a superseding job is never deleted by a late mocked provider response', async () => {
  const providerName = 'projects/demo/locations/us-central1/jobs/' + randomUUID();
  const { ref, claimed } = await makeClaimedCancellation(providerName);
  const replacement = { ...fixture('PENDING'), state: 'QUEUED' as const };
  const events: string[] = [];

  const result = await executeVideoCancellation(
    claimed, fakeCancellationPorts(ref, events, async () => {
      await ref.set(replacement);
    })
  );

  assert.equal(result.status, 'REPLACED');
  assert.deepEqual(events, [
    'provider-delete', 'storage-delete', 'firestore-delete',
  ]);
  assert.equal((await ref.get()).get('state'), 'QUEUED');
  assert.equal((await ref.get()).get('processingVersion'), replacement.processingVersion);
});

test('published cleanup: concurrent workers cannot claim the same job', async () => {
  const ref = firestore.collection('media_published_video_asset_cleanup_jobs')
    .doc('emulator-claim-' + randomUUID());
  await ref.set({ state: 'retryable', attempts: 0,
    nextAttemptAt: now - 1, leaseUntil: null, leaseToken: null });

  const [a, b] = await Promise.all([
    claimPublishedVideoCleanupJob<Record<string, unknown>>(firestore, ref, now, 'worker-a'),
    claimPublishedVideoCleanupJob<Record<string, unknown>>(firestore, ref, now, 'worker-b'),
  ]);
  assert.equal(Number(a !== null) + Number(b !== null), 1);
  const winner = a ? 'worker-a' : 'worker-b';
  const loser = a ? 'worker-b' : 'worker-a';
  const current = await ref.get();
  assert.equal(current.get('leaseToken'), winner);
  assert.equal(current.get('nextAttemptAt'), now + VIDEO_CLEANUP_LEASE_MS);
  assert.equal(await settlePublishedVideoCleanupJob(
    firestore, ref, loser, null, now + 1
  ), 'STALE');
  assert.equal((await ref.get()).get('leaseToken'), winner);
  assert.equal(await settlePublishedVideoCleanupJob(
    firestore, ref, winner, 'Storage temporarily unavailable', now + 2
  ), 'RETRYABLE');
  const retried = await ref.get();
  assert.equal(retried.get('attempts'), 1);
  assert.equal(retried.get('leaseToken'), null);
  assert.ok(Number(retried.get('nextAttemptAt')) > now + 2);
});

test('published cleanup: a direct delete never removes an active lease', async () => {
  const ref = firestore.collection('media_published_video_asset_cleanup_jobs')
    .doc('emulator-direct-' + randomUUID());
  await ref.set({ state: 'retryable', attempts: 2,
    nextAttemptAt: now + VIDEO_CLEANUP_LEASE_MS,
    leaseUntil: now + VIDEO_CLEANUP_LEASE_MS, leaseToken: 'reserved-worker' });
  assert.equal(await clearPublishedVideoCleanupJobIfUnleased(
    firestore, ref, now
  ), 'LEASED');
  assert.equal((await ref.get()).get('leaseToken'), 'reserved-worker');
  assert.equal(await settlePublishedVideoCleanupJob(
    firestore, ref, 'reserved-worker', null, now + 1
  ), 'REMOVED');
  assert.equal((await ref.get()).exists, false);
});

test('published cleanup: stale lease cannot overwrite new owner', async () => {
  const ref = firestore.collection('media_published_video_asset_cleanup_jobs')
    .doc('emulator-expired-' + randomUUID());
  await ref.set({ state: 'retryable', attempts: 1,
    nextAttemptAt: now - 1, leaseUntil: now - 1, leaseToken: 'old-owner' });
  assert.ok(await claimPublishedVideoCleanupJob<Record<string, unknown>>(
    firestore, ref, now, 'new-owner'
  ));
  assert.equal(await settlePublishedVideoCleanupJob(
    firestore, ref, 'old-owner', null, now
  ), 'STALE');
  assert.equal((await ref.get()).get('leaseToken'), 'new-owner');
  assert.equal(await settlePublishedVideoCleanupJob(
    firestore, ref, 'new-owner', null, now + 1
  ), 'REMOVED');
});

test('published cleanup: exhausted failure remains a durable dead letter', async () => {
  const ref = firestore.collection('media_published_video_asset_cleanup_jobs')
    .doc('emulator-dead-' + randomUUID());
  await ref.set({ state: 'retryable', attempts: 7,
    nextAttemptAt: now - 1, leaseUntil: null, leaseToken: null });
  assert.ok(await claimPublishedVideoCleanupJob<Record<string, unknown>>(
    firestore, ref, now, 'last-worker'
  ));
  assert.equal(await settlePublishedVideoCleanupJob(
    firestore, ref, 'last-worker', 'GCS failure', now + 1
  ), 'DEAD_LETTER');
  const snap = await ref.get();
  assert.equal(snap.get('state'), 'dead_letter');
  assert.equal(snap.get('attempts'), 8);
  assert.equal(snap.get('nextAttemptAt'), null);
  assert.equal(snap.get('deadLetterExpiresAt'), null);
  assert.equal(await claimPublishedVideoCleanupJob<Record<string, unknown>>(
    firestore, ref, now + 1000, 'future-worker'
  ), null);
});

test('published cleanup: direct completion resolves once without reviving a job', async () => {
  const ref = firestore.collection('media_published_video_asset_cleanup_jobs')
    .doc('emulator-ack-' + randomUUID());
  await ref.set({ state: 'retryable', attempts: 1,
    nextAttemptAt: now - 1, leaseUntil: null, leaseToken: null });
  const [a, b] = await Promise.all([
    clearPublishedVideoCleanupJobIfUnleased(firestore, ref, now),
    clearPublishedVideoCleanupJobIfUnleased(firestore, ref, now),
  ]);
  assert.deepEqual([a, b].sort(), ['MISSING', 'REMOVED']);
  assert.equal((await ref.get()).exists, false);
});

test('legacy published video cleanup migrates 205 records in bounded resumable pages', async () => {
  const suffix = randomUUID().replace(/-/g, '');
  const collection = `test_video_cleanup_migration_${suffix}`;
  const migrationId = `test-published-video-${suffix}`;
  const migrationNow = now + 1_000;
  const queue = firestore.collection(collection);
  const batch = firestore.batch();
  for (let i = 0; i < 205; i += 1) {
    const isDeadLetter = i === 140;
    batch.set(queue.doc(`job_${String(i).padStart(3, '0')}`), {
      state: isDeadLetter ? 'dead_letter' : 'retryable',
      attempts: isDeadLetter ? 8 : 1,
      createdAt: now - 10_000,
      // Simulate pre-scheduling documents and an old dead-letter deadline.
      ...(isDeadLetter ? { nextAttemptAt: migrationNow - 100 } : {}),
    });
  }
  await batch.commit();

  const options = { cleanupCollection: collection, migrationId, now: migrationNow };
  const first = await migrateLegacyPublishedVideoCleanupJobs(firestore, options);
  assert.equal(first.scanned, 100);
  assert.equal(first.checkpointAdvanced, true);
  assert.equal(first.complete, false);
  const progressRef = firestore.doc(`media_cleanup_migration_state/${migrationId}`);
  assert.equal((await progressRef.get()).get('lastDocumentId'), 'job_099');

  const second = await migrateLegacyPublishedVideoCleanupJobs(firestore, options);
  assert.equal(second.scanned, 100);
  assert.equal(second.complete, false);
  assert.equal((await progressRef.get()).get('lastDocumentId'), 'job_199');

  const third = await migrateLegacyPublishedVideoCleanupJobs(firestore, options);
  assert.equal(third.scanned, 5);
  assert.equal(third.complete, true);
  assert.equal((await progressRef.get()).get('lastDocumentId'), 'job_204');
  assert.equal((await progressRef.get()).get('complete'), true);

  const migrated = await queue.get();
  assert.equal(migrated.size, 205);
  for (const doc of migrated.docs) {
    const data = doc.data();
    if (doc.id === 'job_140') {
      assert.equal(data.state, 'dead_letter');
      assert.equal(data.nextAttemptAt, null);
    } else {
      assert.equal(data.state, 'retryable');
      assert.equal(data.nextAttemptAt, migrationNow);
    }
    assert.equal(data.deadLetterExpiresAt, null);
  }
});

test('concurrent legacy cleanup migrations cannot regress the persisted cursor', async () => {
  const suffix = randomUUID().replace(/-/g, '');
  const collection = `test_video_cleanup_race_${suffix}`;
  const migrationId = `test-published-race-${suffix}`;
  const queue = firestore.collection(collection);
  const batch = firestore.batch();
  for (let i = 0; i < 151; i += 1) {
    batch.set(queue.doc(`job_${String(i).padStart(3, '0')}`), {
      state: 'retryable', attempts: 0,
    });
  }
  await batch.commit();

  const options = { cleanupCollection: collection, migrationId, now: now + 2_000 };
  await Promise.all([
    migrateLegacyPublishedVideoCleanupJobs(firestore, options),
    migrateLegacyPublishedVideoCleanupJobs(firestore, options),
  ]);
  // A stale worker may have processed the same page; the next invocation
  // must still continue from the highest committed checkpoint.
  await migrateLegacyPublishedVideoCleanupJobs(firestore, options);
  await migrateLegacyPublishedVideoCleanupJobs(firestore, options);
  const progress = await firestore.doc(`media_cleanup_migration_state/${migrationId}`).get();
  assert.equal(progress.get('complete'), true);
  assert.equal(progress.get('lastDocumentId'), 'job_150');
  const all = await queue.get();
  assert.equal(all.size, 151);
  for (const doc of all.docs) assert.equal(doc.get('nextAttemptAt'), now + 2_000);
});

test('video deletion: concurrent claims grant exactly one lease', async () => {
  const ref = firestore.collection('media_video_deletion_jobs')
    .doc('deletion-claim-' + randomUUID());
  await ref.set({ state: 'retryable', attempts: 0,
    nextAttemptAt: now - 1, leaseUntil: null, leaseToken: null });

  const [first, second] = await Promise.all([
    claimVideoDeletionJob<Record<string, unknown>>(firestore, ref, now, 'first'),
    claimVideoDeletionJob<Record<string, unknown>>(firestore, ref, now, 'second'),
  ]);
  assert.equal(Number(first !== null) + Number(second !== null), 1);
  const token = first ? 'first' : 'second';
  const loser = first ? 'second' : 'first';
  assert.equal((await ref.get()).get('leaseToken'), token);
  assert.equal(await settleVideoDeletionJob(
    firestore, ref, loser, { kind: 'COMPLETED' }, now + 1
  ), 'STALE');
  assert.equal(await settleVideoDeletionJob(
    firestore, ref, token, { kind: 'COMPLETED' }, now + 1
  ), 'REMOVED');
  assert.equal((await ref.get()).exists, false);
});

test('video deletion: expired lease is recoverable and old ack is fenced', async () => {
  const ref = firestore.collection('media_video_deletion_jobs')
    .doc('deletion-expired-' + randomUUID());
  await ref.set({ state: 'retryable', attempts: 2,
    nextAttemptAt: now - 10, leaseUntil: now - 1, leaseToken: 'old' });
  assert.ok(await claimVideoDeletionJob<Record<string, unknown>>(
    firestore, ref, now, 'new'
  ));
  assert.equal(await settleVideoDeletionJob(
    firestore, ref, 'old', { kind: 'COMPLETED' }, now + 1
  ), 'STALE');
  assert.equal((await ref.get()).get('leaseToken'), 'new');
  assert.equal(await settleVideoDeletionJob(
    firestore, ref, 'new', { kind: 'RETRYABLE_FAILURE', error: 'Storage unavailable' }, now + 2
  ), 'RETRYABLE');
  const retry = await ref.get();
  assert.equal(retry.get('attempts'), 3);
  assert.equal(retry.get('leaseUntil'), null);
  assert.ok(Number(retry.get('nextAttemptAt')) > now + 2);
});

test('video deletion: blocked asset is retained for manual review', async () => {
  const ref = firestore.collection('media_video_deletion_jobs')
    .doc('deletion-blocked-' + randomUUID());
  await ref.set({ state: 'retryable', attempts: 0,
    nextAttemptAt: now - 1, leaseUntil: null, leaseToken: null });
  assert.ok(await claimVideoDeletionJob<Record<string, unknown>>(
    firestore, ref, now, 'review'
  ));
  assert.equal(await settleVideoDeletionJob(
    firestore, ref, 'review', { kind: 'BLOCKED', error: 'ACTIVE_REFERENCE' }, now + 1
  ), 'DEAD_LETTER');
  const held = await ref.get();
  assert.equal(held.get('state'), 'dead_letter');
  assert.equal(held.get('nextAttemptAt'), null);
  assert.equal(held.get('deadLetterExpiresAt'), null);
  assert.equal(await claimVideoDeletionJob<Record<string, unknown>>(
    firestore, ref, now + 50_000, 'other'
  ), null);
});

test('video deletion: eighth failure is a durable dead letter', async () => {
  const ref = firestore.collection('media_video_deletion_jobs')
    .doc('deletion-exhausted-' + randomUUID());
  await ref.set({ state: 'retryable', attempts: 7,
    nextAttemptAt: now - 1, leaseUntil: null, leaseToken: null });
  assert.ok(await claimVideoDeletionJob<Record<string, unknown>>(
    firestore, ref, now, 'last'
  ));
  assert.equal(await settleVideoDeletionJob(
    firestore, ref, 'last', { kind: 'RETRYABLE_FAILURE', error: 'GCS 503' }, now + 1
  ), 'DEAD_LETTER');
  assert.equal((await ref.get()).get('attempts'), 8);
  assert.equal((await ref.get()).get('deadLetterExpiresAt'), null);
});

test('video deletion: repeated request never overwrites an existing job', async () => {
  const ref = firestore.collection('media_video_deletion_jobs')
    .doc('deletion-repeated-' + randomUUID());
  await ref.set({ state: 'dead_letter', attempts: 8, createdAt: now - 4000,
    privateVideoStoragePath: 'original', nextAttemptAt: null,
    leaseToken: 'held-token', leaseUntil: now + 1000 });
  assert.equal(await createVideoDeletionJobIfAbsent(
    firestore, ref, { privateVideoStoragePath: 'replacement', attempts: 0 }, now
  ), 'EXISTING');
  const original = await ref.get();
  assert.equal(original.get('privateVideoStoragePath'), 'original');
  assert.equal(original.get('attempts'), 8);
  assert.equal(original.get('leaseToken'), 'held-token');
  assert.equal(original.get('createdAt'), now - 4000);
});

test('video deletion: legacy unscheduled job is never implicitly claimed', async () => {
  const ref = firestore.collection('media_video_deletion_jobs')
    .doc('deletion-legacy-' + randomUUID());
  await ref.set({ attempts: 0, ownerUid: 'legacy', videoId: 'old' });
  assert.equal(await claimVideoDeletionJob<Record<string, unknown>>(
    firestore, ref, now, 'unsafe'
  ), null);
});

test('video deletion: initial job carries due scheduling without resetting later', async () => {
  const ref = firestore.collection('media_video_deletion_jobs')
    .doc('deletion-create-' + randomUUID());
  assert.equal(await createVideoDeletionJobIfAbsent(
    firestore, ref, { ownerUid: 'owner', videoId: 'vid', attempts: 99 }, now
  ), 'CREATED');
  const snap = await ref.get();
  assert.equal(snap.get('state'), 'retryable');
  assert.equal(snap.get('attempts'), 0);
  assert.equal(snap.get('nextAttemptAt'), now);
  assert.equal(snap.get('leaseToken'), null);
  assert.equal(snap.get('deadLetterExpiresAt'), null);
});

test('video deletion: future scheduling and active lease are not claimable', async () => {
  const ref = firestore.collection('media_video_deletion_jobs')
    .doc('deletion-not-due-' + randomUUID());
  await ref.set({ state: 'retryable', attempts: 2,
    nextAttemptAt: now + 60_000, leaseToken: null, leaseUntil: null });
  assert.equal(await claimVideoDeletionJob<Record<string, unknown>>(
    firestore, ref, now, 'early'
  ), null);
  await ref.update({ nextAttemptAt: now - 1, leaseUntil: now + 60_000 });
  assert.equal(await claimVideoDeletionJob<Record<string, unknown>>(
    firestore, ref, now, 'overlap'
  ), null);
});
test('video identity: concurrent registrations grant the videoId to only one generation', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const videoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = firestore.doc(`users/${ownerUid}/video_publications/${videoId}`);
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  const command = (generation: string) => ({
    ownerUid, videoId, videoRef, publicationRef,
    videoDocument: { ownerUid, path: `generation-${generation}` },
    publicationDocument: { ownerUid, videoId, generation },
    now,
  });
  const outcomes = await Promise.allSettled([
    commitPrivateVideoRegistrationIfUnused(firestore, command('one')),
    commitPrivateVideoRegistrationIfUnused(firestore, command('two')),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((result) => result.status === 'rejected' &&
    result.reason instanceof VideoIdentityUnavailableError).length, 1);
  assert.equal((await guardRef.get()).get('state'), 'REGISTERED');
  const winner = (await videoRef.get()).get('path');
  assert.ok(winner === 'generation-one' || winner === 'generation-two');
  assert.equal((await publicationRef.get()).get('generation'),
    winner === 'generation-one' ? 'one' : 'two');
});

test('video identity: legacy pending deletion refuses a new registration', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const jobRef = firestore.collection('media_video_deletion_jobs').doc(`${ownerUid}_${videoId}`);
  const videoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = firestore.doc(`users/${ownerUid}/video_publications/${videoId}`);
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  await jobRef.create({ state: 'retryable' });
  assert.equal(await isVideoIdentityRetiring(firestore, ownerUid, videoId), true);
  await assert.rejects(
    commitPrivateVideoRegistrationIfUnused(firestore, {
      ownerUid, videoId, videoRef, publicationRef,
      videoDocument: { path: 'new' }, publicationDocument: { isPublished: false }, now,
    }), VideoIdentityUnavailableError
  );
  assert.equal((await guardRef.get()).exists, false);
  assert.equal((await videoRef.get()).exists, false);
});

test('video identity: retiring a legacy video blocks reuse after cleanup job removal', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const videoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = firestore.doc(`users/${ownerUid}/video_publications/${videoId}`);
  const jobRef = firestore.collection('media_video_deletion_jobs').doc(`${ownerUid}_${videoId}`);
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  await videoRef.create({ path: 'legacy-source' });
  const batch = firestore.batch();
  retireVideoIdentityInBatch(firestore, batch, ownerUid, videoId, now, await guardRef.get());
  batch.create(jobRef, { state: 'retryable' });
  batch.delete(publicationRef);
  await batch.commit();
  assert.equal((await guardRef.get()).get('state'), 'RETIRED');
  await videoRef.delete();
  await jobRef.delete();
  assert.equal(await isVideoIdentityRetiring(firestore, ownerUid, videoId), true);
  await assert.rejects(commitPrivateVideoRegistrationIfUnused(firestore, {
    ownerUid, videoId, videoRef, publicationRef,
    videoDocument: { path: 'replacement' }, publicationDocument: { isPublished: false }, now,
  }), VideoIdentityUnavailableError);
  assert.equal((await videoRef.get()).exists, false);
});

test('video identity: failed document create cannot commit a stray registration guard', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const videoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = firestore.doc(`users/${ownerUid}/video_publications/${videoId}`);
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  await videoRef.create({ path: 'existing-legacy' });
  await assert.rejects(commitPrivateVideoRegistrationIfUnused(firestore, {
    ownerUid, videoId, videoRef, publicationRef,
    videoDocument: { path: 'should-not-be-stored' },
    publicationDocument: { isPublished: false }, now,
  }));
  assert.equal((await guardRef.get()).exists, false);
  assert.equal((await videoRef.get()).get('path'), 'existing-legacy');
  assert.equal((await publicationRef.get()).exists, false);
});

test('video identity: duplicate retiring batch remains retired and blocks idempotent reply', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  await guardRef.create({ ownerUid, videoId, state: 'REGISTERED', createdAt: now - 1000 });
  for (const time of [now, now + 1000]) {
    const batch = firestore.batch();
    retireVideoIdentityInBatch(firestore, batch, ownerUid, videoId, time, await guardRef.get());
    await batch.commit();
  }
  assert.equal((await guardRef.get()).get('createdAt'), now - 1000);
  assert.equal((await guardRef.get()).get('state'), 'RETIRED');
  assert.equal(await isVideoIdentityRetiring(firestore, ownerUid, videoId), true);
});


test('video identity: legacy deletion claim backfills a tombstone before physical cleanup', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const jobRef = firestore.collection('media_video_deletion_jobs').doc(`${ownerUid}_${videoId}`);
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  await jobRef.create({ ownerUid, videoId, state: 'retryable',
    leaseToken: 'current', leaseUntil: now + 60_000 });
  assert.equal(await retireVideoIdentityForActiveClaim(
    firestore, jobRef, 'stale', ownerUid, videoId, now
  ), 'STALE');
  assert.equal((await guardRef.get()).exists, false);
  assert.equal(await retireVideoIdentityForActiveClaim(
    firestore, jobRef, 'current', ownerUid, videoId, now
  ), 'READY');
  assert.equal((await guardRef.get()).get('state'), 'RETIRED');
  await jobRef.delete();
  assert.equal(await isVideoIdentityRetiring(firestore, ownerUid, videoId), true);
});

test('video identity: expired legacy worker never backfills after losing authority', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const jobRef = firestore.collection('media_video_deletion_jobs').doc(`${ownerUid}_${videoId}`);
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  await jobRef.create({ ownerUid, videoId, leaseToken: 'expired', leaseUntil: now - 1 });
  assert.equal(await retireVideoIdentityForActiveClaim(
    firestore, jobRef, 'expired', ownerUid, videoId, now
  ), 'STALE');
  assert.equal((await guardRef.get()).exists, false);
});

test('video identity: stale deletion of a missing video cannot retire a concurrent registration', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const videoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = firestore.doc(`users/${ownerUid}/video_publications/${videoId}`);
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  const jobRef = firestore.collection('media_video_deletion_jobs').doc(`${ownerUid}_${videoId}`);
  const oldGuardSnapshot = await guardRef.get();
  const pendingDeletionBatch = firestore.batch();
  retireVideoIdentityInBatch(firestore, pendingDeletionBatch,
    ownerUid, videoId, now, oldGuardSnapshot);
  pendingDeletionBatch.create(jobRef, { ownerUid, videoId, state: 'retryable' });
  pendingDeletionBatch.delete(publicationRef);
  await commitPrivateVideoRegistrationIfUnused(firestore, {
    ownerUid, videoId, videoRef, publicationRef, now,
    videoDocument: { path: 'fresh' }, publicationDocument: { isPublished: false },
  });
  await assert.rejects(pendingDeletionBatch.commit());
  assert.equal((await videoRef.get()).get('path'), 'fresh');
  assert.equal((await guardRef.get()).get('state'), 'REGISTERED');
  assert.equal((await jobRef.get()).exists, false);
});

test('video identity: deletion succeeds first and blocks a late registration', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const videoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = firestore.doc(`users/${ownerUid}/video_publications/${videoId}`);
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  const jobRef = firestore.collection('media_video_deletion_jobs').doc(`${ownerUid}_${videoId}`);
  const batch = firestore.batch();
  retireVideoIdentityInBatch(firestore, batch, ownerUid, videoId, now, await guardRef.get());
  batch.create(jobRef, { ownerUid, videoId, state: 'retryable' });
  await batch.commit();
  await assert.rejects(commitPrivateVideoRegistrationIfUnused(firestore, {
    ownerUid, videoId, videoRef, publicationRef, now,
    videoDocument: { path: 'late' }, publicationDocument: { isPublished: false },
  }), VideoIdentityUnavailableError);
  assert.equal((await videoRef.get()).exists, false);
  assert.equal((await guardRef.get()).get('state'), 'RETIRED');
});

test('video identity: stale guard snapshot cannot overwrite an updated identity', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  await guardRef.create({ ownerUid, videoId, state: 'REGISTERED', createdAt: now });
  const stale = await guardRef.get();
  await guardRef.update({ updatedAt: now + 1 });
  const batch = firestore.batch();
  retireVideoIdentityInBatch(firestore, batch, ownerUid, videoId, now + 2, stale);
  await assert.rejects(batch.commit());
  assert.equal((await guardRef.get()).get('state'), 'REGISTERED');
});

test('video identity: legacy cleanup cannot retire an active registered identity', async () => {
  const ownerUid = 'identity-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const jobRef = firestore.collection('media_video_deletion_jobs').doc(`${ownerUid}_${videoId}`);
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  await guardRef.create({ ownerUid, videoId, state: 'REGISTERED', createdAt: now });
  await jobRef.create({ ownerUid, videoId, state: 'retryable',
    leaseToken: 'legacy', leaseUntil: now + 60_000 });
  assert.equal(await retireVideoIdentityForActiveClaim(
    firestore, jobRef, 'legacy', ownerUid, videoId, now
  ), 'CONFLICT');
  assert.equal((await guardRef.get()).get('state'), 'REGISTERED');
});

test('canonical processed publication records a generation-pinned original cleanup atomically', async () => {
  const f = readyPublicationFixture();
  await f.ownerRef.set({ ...f.video, sourceGeneration: '90071992547409933' });
  const old = f.command('unused');
  const command = {
    ...old,
    publicationPatch: {
      ...old.publicationPatch,
      assetStorageMode: 'PROCESSED_CANONICAL',
      publishedStoragePath: f.video.processedStoragePath,
    },
  };
  await commitCopiedVideoPublicationIfCurrent(firestore, command);
  const publication = await f.publicationRef.get();
  assert.equal(publication.get('publishedStoragePath'), f.video.processedStoragePath);
  assert.equal(publication.get('assetStorageMode'), 'PROCESSED_CANONICAL');

  const cleanup = await firestore.collection(VIDEO_ORIGINAL_CLEANUP_COLLECTION)
    .doc(videoOriginalCleanupJobId(command.ownerUid, command.videoId)).get();
  assert.equal(cleanup.exists, true);
  assert.equal(cleanup.get('sourceGeneration'), '90071992547409933');
  assert.equal(cleanup.get('assetStorageMode'), 'PROCESSED_CANONICAL');
});

test('canonical publication cannot reference a different processed object', async () => {
  const f = readyPublicationFixture();
  await f.ownerRef.set(f.video);
  const old = f.command('unused');
  await assert.rejects(commitCopiedVideoPublicationIfCurrent(firestore, {
    ...old,
    publicationPatch: {
      ...old.publicationPatch,
      assetStorageMode: 'PROCESSED_CANONICAL',
      publishedStoragePath: 'users/' + old.ownerUid + '/processed/videos/' + old.videoId + '/other/final.mp4',
    },
  }), /diverge da versão processada/);
  assert.equal((await f.publicationRef.get()).exists, false);
});


test('publication is fenced against a pending video deletion', async () => {
  const f = readyPublicationFixture();
  await f.ownerRef.set(f.video);
  await firestore.collection('media_video_deletion_jobs')
    .doc(`${f.video.ownerUid}_${f.publicationRef.id}`)
    .set({ ownerUid: f.video.ownerUid, videoId: f.publicationRef.id, state: 'retryable' });
  await expectPublicationDenied(f);
  assert.equal((await f.publicRef.get()).exists, false);
});

test('publication is fenced against a retired or inconsistent video identity', async () => {
  for (const state of ['RETIRED', 'CORRUPT'] as const) {
    const f = readyPublicationFixture();
    await f.ownerRef.set(f.video);
    await firestore.doc(`users/${f.video.ownerUid}/video_identity_guards/${f.publicationRef.id}`)
      .set({ ownerUid: f.video.ownerUid, videoId: f.publicationRef.id, state });
    await expectPublicationDenied(f);
    assert.equal((await f.publicRef.get()).exists, false);
  }
});

test('publication still accepts a valid registered video identity', async () => {
  const f = readyPublicationFixture();
  await f.ownerRef.set(f.video);
  await firestore.doc(`users/${f.video.ownerUid}/video_identity_guards/${f.publicationRef.id}`)
    .set({ ownerUid: f.video.ownerUid, videoId: f.publicationRef.id, state: 'REGISTERED' });
  await commitCopiedVideoPublicationIfCurrent(firestore, f.command('registered-' + randomUUID()));
  assert.equal((await f.publicationRef.get()).get('isPublished'), true);
});

test('final Transcoder POST guard denies cancellation, replacements and expired leases', async () => {
  const job = {
    ...fixture('post-fence'),
    state: 'SUBMITTING' as const,
    attempts: 1,
    sourceGeneration: '90071992547409930',
    externalJobName: null,
    cancelRequestedAt: null,
    leaseUntil: now + 60_000,
  };
  const ref = jobs.doc(job.ownerUid + '_' + job.videoId);
  const videoRef = firestore.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
  try {
    await Promise.all([
      ref.set(job),
      videoRef.set({ path: job.sourceStoragePath, sourceGeneration: job.sourceGeneration }),
    ]);
    const allows = () => confirmTranscoderPostIsCurrent(
      firestore, ref, job, parseJob, now, false
    );
    assert.equal(await allows(), true);
    await ref.update({ state: 'CANCEL_REQUESTED', cancelRequestedAt: now });
    assert.equal(await allows(), false);
    await ref.update({ state: 'SUBMITTING', cancelRequestedAt: null });
    await videoRef.update({ sourceGeneration: '90071992547409931' });
    assert.equal(await allows(), false);
    await videoRef.update({ sourceGeneration: job.sourceGeneration });
    await ref.update({ processingVersion: 'different-version' });
    assert.equal(await allows(), false);
    await ref.update({ processingVersion: job.processingVersion, leaseUntil: now });
    assert.equal(await allows(), false);
  } finally {
    await Promise.all([ref.delete(), videoRef.delete()]);
  }
});

test('terminal cleanup snapshot survives atomic retry and new processingVersion', async () => {
  const base = fixture('FAILED');
  const old = {
    ...base, state: 'FAILED' as const, providerState: 'FAILED',
    editRecipe: { ...base.editRecipe!, rotationDegrees: 90 as const },
    providerTerminalEvidence: {
      processingVersion: base.processingVersion,
      externalJobName: base.externalJobName!,
      state: 'FAILED' as const, observedAt: now,
    },
  };
  const jobId = old.ownerUid + '_' + old.videoId;
  const ref = jobs.doc(jobId);
  const cleanupRef = terminalCleanupRef(firestore, jobId, old.processingVersion);
  const replacement = {
    ...old, state: 'QUEUED' as const, providerState: null,
    externalJobName: null, processingVersion: old.processingVersion + '-new',
  };
  await ref.set(old);
  try {
    await firestore.runTransaction(async transaction => {
      const original = await transaction.get(ref);
      assert.equal(original.get('processingVersion'), old.processingVersion);
      assert.equal(await preserveTerminalCleanupBeforeRetry(
        firestore, transaction, jobId,
        original.data() as VideoProcessingJob, now
      ), true);
      transaction.set(ref, replacement);
    });
    const queued = await cleanupRef.get();
    assert.equal(queued.exists, true);
    assert.equal(queued.get('snapshot.processingVersion'), old.processingVersion);
    assert.equal(queued.get('snapshot.providerState'), 'FAILED');
    assert.equal((await ref.get()).get('processingVersion'), replacement.processingVersion);
    const claimed = await claimDueTerminalTemporaryCleanup(firestore, cleanupRef, now + 1);
    assert.ok(claimed);
    assert.equal(claimed.snapshot.processingVersion, old.processingVersion);
    assert.equal(await isTerminalTemporaryClaimCurrent(
      cleanupRef, claimed, now + 2
    ), true);
    await cleanupRef.update({ leaseToken: 'new-owner' });
    assert.equal(await isTerminalTemporaryClaimCurrent(
      cleanupRef, claimed, now + 2
    ), false);
  } finally {
    await Promise.all([ref.delete(), cleanupRef.delete()]);
  }
});

test('pre-upgrade cleanup queue is retained for review after replacement', async () => {
  const base = fixture('FAILED');
  const old = {
    ...base, state: 'FAILED' as const, providerState: 'FAILED',
    editRecipe: { ...base.editRecipe!, rotationDegrees: 90 as const },
    providerTerminalEvidence: {
      processingVersion: base.processingVersion,
      externalJobName: base.externalJobName!,
      state: 'FAILED' as const, observedAt: now,
    },
  };
  const jobId = old.ownerUid + '_' + old.videoId;
  const ref = jobs.doc(jobId);
  const cleanupRef = terminalCleanupRef(firestore, jobId, old.processingVersion);
  const oldQueue = buildTerminalCleanupQueue(jobId, old, now);
  assert.ok(oldQueue);
  const legacyQueue = { ...oldQueue };
  delete legacyQueue.snapshot;
  await Promise.all([
    cleanupRef.set(legacyQueue),
    ref.set({ ...old, processingVersion: old.processingVersion + '-new', state: 'QUEUED' }),
  ]);
  try {
    assert.equal(await claimDueTerminalTemporaryCleanup(
      firestore, cleanupRef, now + 1
    ), null);
    const blocked = await cleanupRef.get();
    assert.equal(blocked.get('state'), 'review');
    assert.equal(blocked.get('lastError'), 'VIDEO_TEMP_CLEANUP_SNAPSHOT_UNAVAILABLE');
  } finally {
    await Promise.all([ref.delete(), cleanupRef.delete()]);
  }
});

test('preserving terminal snapshot is idempotent across repeated administrative retries', async () => {
  const base = fixture('FAILED');
  const old = {
    ...base, state: 'FAILED' as const, providerState: 'FAILED',
    editRecipe: { ...base.editRecipe!, rotationDegrees: 90 as const },
    providerTerminalEvidence: {
      processingVersion: base.processingVersion,
      externalJobName: base.externalJobName!,
      state: 'FAILED' as const, observedAt: now,
    },
  };
  const jobId = old.ownerUid + '_' + old.videoId;
  const cleanupRef = terminalCleanupRef(firestore, jobId, old.processingVersion);
  try {
    await firestore.runTransaction(async t => {
      assert.equal(await preserveTerminalCleanupBeforeRetry(
        firestore, t, jobId, old, now
      ), true);
    });
    await firestore.runTransaction(async t => {
      assert.equal(await preserveTerminalCleanupBeforeRetry(
        firestore, t, jobId, old, now + 1
      ), true);
    });
    const snap = await cleanupRef.get();
    assert.equal(snap.get('snapshot.processingVersion'), old.processingVersion);
    assert.equal(snap.get('createdAt'), now);
    assert.equal(snap.get('state'), 'retryable');
  } finally {
    await cleanupRef.delete();
  }
});

test('concurrent terminal cleanup claims elect exactly one owner', async () => {
  const base = fixture('FAILED');
  const old = {
    ...base, state: 'FAILED' as const, providerState: 'FAILED',
    editRecipe: { ...base.editRecipe!, rotationDegrees: 90 as const },
    providerTerminalEvidence: {
      processingVersion: base.processingVersion,
      externalJobName: base.externalJobName!,
      state: 'FAILED' as const, observedAt: now,
    },
  };
  const jobId = old.ownerUid + '_' + old.videoId;
  const ref = terminalCleanupRef(firestore, jobId, old.processingVersion);
  const queue = buildTerminalCleanupQueue(jobId, old, now);
  assert.ok(queue);
  await ref.create(queue);
  try {
    const owners = await Promise.all([
      claimDueTerminalTemporaryCleanup(firestore, ref, now + 1),
      claimDueTerminalTemporaryCleanup(firestore, ref, now + 1),
    ]);
    assert.equal(owners.filter(Boolean).length, 1);
    assert.equal(await isTerminalTemporaryClaimCurrent(
      ref, owners.find(Boolean)!, now + 2
    ), true);
  } finally {
    await ref.delete();
  }
});

test('unconfirmed local FAILED cannot enqueue cleanup or survive a retry as terminal proof', async () => {
  const old = {
    ...fixture('RUNNING'),
    state: 'FAILED' as const,
    providerState: 'FAILED',
    editRecipe: { ...fixture('RUNNING').editRecipe!, rotationDegrees: 90 as const },
    providerTerminalEvidence: null,
  };
  const jobId = old.ownerUid + '_' + old.videoId;
  const ref = jobs.doc(jobId);
  const cleanupRef = terminalCleanupRef(firestore, jobId, old.processingVersion);
  assert.equal(buildTerminalCleanupQueue(jobId, old, now), null);
  await ref.set(old);
  try {
    await firestore.runTransaction(async transaction => {
      const data = await transaction.get(ref);
      assert.equal(await preserveTerminalCleanupBeforeRetry(
        firestore, transaction, jobId, data.data() as VideoProcessingJob, now
      ), false);
      transaction.update(ref, {
        processingVersion: old.processingVersion + '-requeued',
        state: 'QUEUED',
      });
    });
    assert.equal((await cleanupRef.get()).exists, false);
  } finally {
    await Promise.all([ref.delete(), cleanupRef.delete()]);
  }
});

test('persisted FAILED snapshot without matching provider evidence goes to review', async () => {
  const old = {
    ...fixture('FAILED'),
    state: 'FAILED' as const,
    providerState: 'FAILED',
    editRecipe: { ...fixture('FAILED').editRecipe!, rotationDegrees: 90 as const },
  };
  const jobId = old.ownerUid + '_' + old.videoId;
  const ref = terminalCleanupRef(firestore, jobId, old.processingVersion);
  const proof = {
    processingVersion: old.processingVersion,
    externalJobName: old.externalJobName!,
    state: 'FAILED' as const,
    observedAt: now,
  };
  const verified = { ...old, providerTerminalEvidence: proof };
  const queue = buildTerminalCleanupQueue(jobId, verified, now);
  assert.ok(queue);
  await ref.create({
    ...queue,
    snapshot: { ...queue.snapshot!, providerTerminalEvidence: {
      ...proof, externalJobName: 'projects/demo/locations/us-central1/jobs/foreign',
    } },
  });
  try {
    assert.equal(await claimDueTerminalTemporaryCleanup(
      firestore, ref, now + 1
    ), null);
    const pending = await ref.get();
    assert.equal(pending.get('state'), 'review');
    assert.equal(pending.get('leaseToken'), null);
  } finally {
    await ref.delete();
  }
});

test('failed provider GET retains PROCESSING with durable backoff and provenance', async () => {
  const current = fixture('RUNNING');
  const jobRef = jobs.doc(current.ownerUid + '_' + current.videoId);
  await jobRef.set(current);
  try {
    for (const [index, code] of [
      'PERMISSION_DENIED', 'NOT_FOUND', 'TRANSCODER_CLIENT_ERROR',
    ].entries()) {
      const snapshot = await jobRef.get();
      const observed = snapshot.data() as VideoProcessingJob;
      const applied = await recordProviderPollErrorIfCurrent(
        firestore, jobRef, observed, parseJob,
        { code, message: 'Provider lookup did not confirm terminal state', retryable: false },
        now + index * 1_000
      );
      assert.equal(applied, true);
      const stored = await jobRef.get();
      assert.equal(stored.get('state'), 'PROCESSING');
      assert.equal(stored.get('providerState'), 'RUNNING');
      assert.equal(stored.get('externalJobName'), current.externalJobName);
      assert.equal(stored.get('processingVersion'), current.processingVersion);
      assert.ok(stored.get('nextAttemptAt') > observed.nextAttemptAt);
      assert.equal(stored.get('providerPollFailureCount'), index + 1);
      assert.equal(stored.get('providerPollFailureVersion'), current.processingVersion);
      assert.equal(stored.get('providerPollReviewRequired'), index >= 2);
      assert.equal(stored.get('lastErrorCode'), code);
      assert.equal(stored.get('providerTerminalEvidence'), undefined);
    }
    const last = (await jobRef.get()).data() as VideoProcessingJob;
    await jobRef.update({ state: 'CANCEL_REQUESTED' });
    assert.equal(await recordProviderPollErrorIfCurrent(
      firestore, jobRef, last, parseJob,
      { code: 'NOT_FOUND', message: 'late GET' }, now + 20_000
    ), false);
    assert.equal((await jobRef.get()).get('state'), 'CANCEL_REQUESTED');
  } finally {
    await jobRef.delete();
  }
});

test('stale provider lookup error never alters another processing version or poll claim', async () => {
  const original = fixture('RUNNING');
  const ref = jobs.doc(original.ownerUid + '_' + original.videoId);
  await ref.set(original);
  try {
    await ref.update({ nextAttemptAt: original.nextAttemptAt + 1 });
    assert.equal(await recordProviderPollErrorIfCurrent(
      firestore, ref, original, parseJob,
      { code: 'NOT_FOUND', message: 'late 404' }, now
    ), false);
    assert.equal((await ref.get()).get('lastErrorCode'), original.lastErrorCode);
    await ref.update({
      nextAttemptAt: original.nextAttemptAt,
      processingVersion: original.processingVersion + '-new',
    });
    assert.equal(await recordProviderPollErrorIfCurrent(
      firestore, ref, original, parseJob,
      { code: 'PERMISSION_DENIED', message: 'late 403' }, now
    ), false);
    assert.equal((await ref.get()).get('lastErrorCode'), original.lastErrorCode);
  } finally {
    await ref.delete();
  }
});

test('eight failed GETs hold the job outside the due query until explicitly rearmed', async () => {
  const current = fixture('RUNNING');
  const ref = jobs.doc(current.ownerUid + '_' + current.videoId);
  await ref.set(current);
  try {
    for (let attempt = 1; attempt <= 8; attempt++) {
      const before = (await ref.get()).data() as VideoProcessingJob;
      assert.equal(await recordProviderPollErrorIfCurrent(
        firestore, ref, before, parseJob,
        { code: 'NOT_FOUND', message: 'Remote state unknown', retryable: false },
        now + attempt * 1_000
      ), true);
    }
    const held = (await ref.get()).data() as VideoProcessingJob;
    assert.equal(held.providerPollFailureCount, 8);
    assert.equal(held.providerPollReviewRequired, true);
    assert.equal(held.nextAttemptAt, Number.MAX_SAFE_INTEGER);
    assert.equal((await queryDueProcessingJobs(firestore, now + 24 * 60 * 60_000, 30).get())
      .docs.some(doc => doc.id === ref.id), false);
    // The manual path only advances the poll reservation. No provider POST.
    await firestore.runTransaction(async tx => {
      const latest = (await tx.get(ref)).data() as VideoProcessingJob;
      assert.equal(latest.processingVersion, current.processingVersion);
      assert.equal(latest.providerPollReviewRequired, true);
      tx.update(ref, { nextAttemptAt: now, providerPollReviewRequired: false });
    });
    const claimed = await claimProcessingJob(firestore, ref, now + 1, parseJob);
    assert.ok(claimed);
    assert.equal(claimed.processingVersion, current.processingVersion);
    assert.equal(claimed.externalJobName, current.externalJobName);
    assert.equal(claimed.providerPollFailureCount, 8);
    assert.equal(await recordProviderPollErrorIfCurrent(
      firestore, ref, held, parseJob,
      { code: 'PERMISSION_DENIED', message: 'stale worker' }, now + 5
    ), false);
    assert.equal(await recordProviderPollErrorIfCurrent(
      firestore, ref, claimed, parseJob,
      { code: 'PERMISSION_DENIED', message: 'recheck failed' }, now + 2
    ), true);
    assert.equal((await ref.get()).get('nextAttemptAt'), Number.MAX_SAFE_INTEGER);
  } finally {
    await ref.delete();
  }
});

test('manual provider recheck fences version and successful GET clears backoff', async () => {
  const original = fixture('RUNNING');
  const ref = jobs.doc(original.ownerUid + '_' + original.videoId);
  await ref.set({
    ...original,
    providerPollFailureVersion: original.processingVersion,
    providerPollFailureCount: 8,
    providerPollLastFailedAt: now - 30_000,
    providerPollReviewRequired: true,
    nextAttemptAt: Number.MAX_SAFE_INTEGER,
  });
  const rearm = (expectedVersion: string) => firestore.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const current = snap.data() as VideoProcessingJob;
    if (current.processingVersion !== expectedVersion ||
        !isProviderPollReviewRequired(current)) return false;
    tx.update(ref, { nextAttemptAt: now, providerPollReviewRequired: false });
    return true;
  });
  try {
    assert.equal(await rearm('obsolete'), false);
    assert.equal((await ref.get()).get('nextAttemptAt'), Number.MAX_SAFE_INTEGER);
    assert.equal(await rearm(original.processingVersion), true);
    const claimed = await claimProcessingJob(firestore, ref, now + 1, parseJob);
    assert.ok(claimed);
    await firestore.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const current = snap.data() as VideoProcessingJob;
      assert.equal(isCurrentVideoProcessingAttempt(current, claimed), true);
      tx.update(ref, {
        providerState: 'RUNNING',
        ...clearProviderPollFailures(),
        lastErrorCode: null,
        lastError: null,
      });
    });
    const snap = await ref.get();
    assert.equal(snap.get('state'), 'PROCESSING');
    assert.equal(snap.get('processingVersion'), original.processingVersion);
    assert.equal(snap.get('providerPollFailureCount'), 0);
    assert.equal(snap.get('providerPollFailureVersion'), null);
    assert.equal(snap.get('providerPollReviewRequired'), false);
    assert.equal(snap.get('providerPollLastFailedAt'), null);
  } finally {
    await ref.delete();
  }
});

test('review recheck reuses immutable terminal snapshot and never touches a new version', async () => {
  const old = fixture('SUCCEEDED');
  const terminal: VideoProcessingJob = {
    ...old, state: 'SUCCEEDED', attempts: 1,
    editRecipe: { ...old.editRecipe!, rotationDegrees: 90 },
    providerTerminalEvidence: {
      processingVersion: old.processingVersion,
      externalJobName: old.externalJobName!,
      state: 'SUCCEEDED',
      observedAt: now,
    },
  };
  const jobId = old.ownerUid + '_' + old.videoId;
  const ref = terminalCleanupRef(firestore, jobId, old.processingVersion);
  const liveRef = jobs.doc(jobId);
  const auditRef = firestore.collection('admin_logs').doc();
  const prepared = buildTerminalCleanupQueue(jobId, terminal, now);
  assert.ok(prepared);
  const held = { ...prepared, state: 'review' as const, attempts: 8,
    lastError: 'VIDEO_TEMP_CLEANUP_GCS_ERROR' };
  const command = {
    queueId: ref.id,
    processingVersion: old.processingVersion,
    expectedUpdatedAt: now,
    adminUid: 'admin-test',
    operationId: 'recheck-00001',
    reason: 'Proveniência verificada para nova checagem',
    now: now + 1,
  };
  await Promise.all([
    ref.set(held),
    liveRef.set({ ...terminal, state: 'PROCESSING',
      processingVersion: old.processingVersion + '-new',
      providerTerminalEvidence: null }),
  ]);
  try {
    assert.equal(terminalCleanupReviewBlocker(ref.id, held), null);
    assert.deepEqual(await recheckReviewedTerminalTemporaryCleanup(
      firestore, ref, auditRef, command
    ), { alreadyApplied: false });
    const actual = (await ref.get()).data()!;
    assert.equal(actual['state'], 'retryable');
    assert.equal(actual['attempts'], 8);
    assert.equal(actual['nextAttemptAt'], now + 1);
    assert.equal(actual['processingVersion'], old.processingVersion);
    assert.equal((await liveRef.get()).get('processingVersion'),
      old.processingVersion + '-new');
    assert.equal((await liveRef.get()).get('state'), 'PROCESSING');
    assert.deepEqual(actual['snapshot'], held.snapshot);
    assert.equal((await auditRef.get()).get('action'), 'videoTerminalCleanupRecheck');
    assert.deepEqual(await recheckReviewedTerminalTemporaryCleanup(
      firestore, ref, firestore.collection('admin_logs').doc(), command
    ), { alreadyApplied: true });
    const claimed = await claimDueTerminalTemporaryCleanup(firestore, ref, now + 2);
    assert.ok(claimed);
    assert.equal(claimed.snapshot.processingVersion, old.processingVersion);
    assert.equal(claimed.queue.attempts, 8);
    assert.equal(await isTerminalTemporaryClaimCurrent(ref, claimed, now + 3), true);
  } finally {
    await Promise.all([ref.delete(), auditRef.delete(), liveRef.delete()]);
  }
});

test('review recheck fails closed for stale, missing, foreign and lease-held snapshots', async () => {
  const old = fixture('FAILED');
  const terminal: VideoProcessingJob = {
    ...old, state: 'FAILED', attempts: 1,
    editRecipe: { ...old.editRecipe!, rotationDegrees: 90 },
    providerTerminalEvidence: {
      processingVersion: old.processingVersion,
      externalJobName: old.externalJobName!, state: 'FAILED', observedAt: now,
    },
  };
  const jobId = old.ownerUid + '_' + old.videoId;
  const ref = terminalCleanupRef(firestore, jobId, old.processingVersion);
  const prepared = buildTerminalCleanupQueue(jobId, terminal, now);
  assert.ok(prepared);
  const safe = { ...prepared, state: 'review' as const };
  const command = {
    queueId: ref.id, processingVersion: terminal.processingVersion,
    expectedUpdatedAt: now, adminUid: 'admin-test',
    operationId: 'recheck-00002', reason: 'Análise de recuperação controlada', now: now + 1,
  };
  try {
    for (const broken of [
      { ...safe, snapshot: undefined },
      { ...safe, leaseToken: 'other-worker' },
      { ...safe, snapshot: { ...safe.snapshot!,
        providerTerminalEvidence: null } },
      { ...safe, snapshot: { ...safe.snapshot!,
        processingVersion: 'different-version' } },
    ]) {
      // Firestore rejects undefined fields; omit the legacy snapshot entirely.
      await ref.set(JSON.parse(JSON.stringify(broken)));

      assert.ok(terminalCleanupReviewBlocker(ref.id, broken));
      const auditRef = firestore.collection('admin_logs').doc();
      await assert.rejects(recheckReviewedTerminalTemporaryCleanup(
        firestore, ref, auditRef, command
      ), (error: unknown) => error instanceof TerminalCleanupReviewPreconditionError);
      assert.equal((await ref.get()).get('state'), 'review');
      assert.equal((await auditRef.get()).exists, false);
    }
    await ref.set(safe);
    for (const invalid of [
      { ...command, expectedUpdatedAt: now - 1 },
      { ...command, processingVersion: 'replaced' },
    ]) {
      await assert.rejects(recheckReviewedTerminalTemporaryCleanup(
        firestore, ref, firestore.collection('admin_logs').doc(), invalid
      ), (error: unknown) => error instanceof TerminalCleanupReviewPreconditionError);
      assert.equal((await ref.get()).get('state'), 'review');
    }
    const results = await Promise.allSettled([
      recheckReviewedTerminalTemporaryCleanup(firestore, ref,
        firestore.collection('admin_logs').doc(), command),
      recheckReviewedTerminalTemporaryCleanup(firestore, ref,
        firestore.collection('admin_logs').doc(),
        { ...command, operationId: 'recheck-00003' }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal((await ref.get()).get('state'), 'retryable');
  } finally {
    await ref.delete();
  }
});

test('real Firestore scheduler evidence is monotonic under concurrent cycles', async () => {
  const key = 'submitQueuedVideoProcessing' as const;
  const ref = firestore.collection(VIDEO_SCHEDULER_COLLECTION).doc(key);
  const old = videoSchedulerRecord(
    key, 'older', now - 30_000, now - 20_000, 'FAILED', 'QUERY', {}
  );
  const latest = videoSchedulerRecord(
    key, 'latest', now - 15_000, now, 'OK', 'EXECUTE',
    { selected: 0, taskRejected: 0, batchLimitReached: false }
  );
  try {
    await ref.delete();
    const results = await Promise.all([
      saveLastVideoSchedulerCycle(firestore, latest),
      saveLastVideoSchedulerCycle(firestore, old),
    ]);
    assert.equal(results.filter(Boolean).length >= 1, true);
    const stored = (await ref.get()).data();
    assert.ok(stored);
    assert.equal(stored['cycleId'], latest.cycleId);
    assert.equal(stored['finishedAt'], now);
    assert.equal(await saveLastVideoSchedulerCycle(firestore, old), false);
    assert.equal(await saveLastVideoSchedulerCycle(firestore, latest), false);
    assert.equal(diagnoseVideoScheduler(key, stored, now + 1).health, 'OPERATIONAL');
    assert.equal(diagnoseVideoScheduler(key, stored, now + 26 * 60_000).health,
      'UNVERIFIED');
  } finally {
    await ref.delete();
  }
});

test('last recorded scheduler failure is separate from provider and job state', async () => {
  const key = 'reconcileVideoProcessing' as const;
  const ref = firestore.collection(VIDEO_SCHEDULER_COLLECTION).doc(key);
  const failure = videoSchedulerRecord(
    key, 'cycle-failed', now - 3000, now, 'FAILED', 'TERMINAL_CLEANUP', {}
  );
  try {
    await ref.delete();
    assert.equal(await saveLastVideoSchedulerCycle(firestore, failure), true);
    const stored = (await ref.get()).data();
    assert.ok(stored);
    assert.equal(diagnoseVideoScheduler(key, stored, now + 1).health, 'FAILED');
    const cancel = diagnoseVideoScheduler('cleanupCancelledVideoProcessing', null, now);
    assert.equal(cancel.health, 'UNVERIFIED');
    assert.equal((await jobs.where('providerState', '==', 'cycle-failed')
      .limit(1).get()).empty, true);
  } finally {
    await ref.delete();
  }
});

test('handled provider errors produce persistent ATTENTION without touching a job', async () => {
  const key = 'reconcileVideoProcessing' as const;
  const ref = firestore.collection(VIDEO_SCHEDULER_COLLECTION).doc(key);
  const jobRef = jobs.doc('scheduler-observation-' + randomUUID());
  const outcomes = createVideoWorkOutcomeCounter();
  try {
    await ref.delete();
    await jobRef.set({ state: 'PROCESSING', nextAttemptAt: now + 60_000 });
    outcomes.observe('PROVIDER_POLL_ERROR');
    outcomes.observe('PROVIDER_REVIEW');
    assert.equal(outcomes.needsAttention(), true);
    const evidence = videoSchedulerRecord(
      key, 'handled-transport-error', now - 5_000, now,
      outcomes.needsAttention() ? 'ATTENTION' : 'OK', 'EXECUTE', {
        ...outcomes.metrics(), selected: 1, claimed: 1,
      }
    );
    assert.equal(await saveLastVideoSchedulerCycle(firestore, evidence), true);
    const diagnostic = diagnoseVideoScheduler(key, (await ref.get()).data(), now + 1);
    assert.equal(diagnostic.executionHealth, 'EXECUTED');
    assert.equal(diagnostic.jobsHealth, 'ATTENTION');
    assert.equal(diagnostic.metrics.providerPollErrors, 1);
    assert.equal(diagnostic.metrics.providerReviewRequired, 1);
    const after = (await jobRef.get()).data();
    assert.equal(after?.['state'], 'PROCESSING');
    assert.equal(after?.['nextAttemptAt'], now + 60_000);
  } finally {
    await Promise.all([ref.delete(), jobRef.delete()]);
  }
});

test('terminal commit returns only the Firestore-applied result under racing poll claims', async () => {
  const initial = { ...fixture('RUNNING'), sourceGeneration: '9001' };
  const jobRef = jobs.doc('terminal-disposition-' + randomUUID());
  const videoRef = firestore.doc(`users/${initial.ownerUid}/videos/${initial.videoId}`);
  await jobRef.set(initial);
  await videoRef.set({
    path: initial.sourceStoragePath, sourceGeneration: '9001', status: 'processing',
  });
  const commit = (
    observed: VideoProcessingJob, state: 'SUCCEEDED' | 'FAILED'
  ) => commitTerminalVideoProcessingIfCurrent(firestore, jobRef, observed, {
    state, now: now + 10_000, normalizeJob: parseJob,
    sourceMatches: video => video['path'] === observed.sourceStoragePath &&
      video['sourceGeneration'] === observed.sourceGeneration,
    jobPatch: {
      providerState: state,
      providerTerminalEvidence: {
        processingVersion: observed.processingVersion,
        externalJobName: observed.externalJobName,
        state, observedAt: now,
      },
      completedAt: now + 10_000,
    },
    videoPatch: {
      status: state === 'SUCCEEDED' ? 'ready' : 'failed',
      processingStage: state === 'SUCCEEDED' ? 'ready' : 'failed',
    },
  });
  try {
    const first = await claimProcessingJob(firestore, jobRef, now, parseJob);
    assert.ok(first);
    const second = await claimProcessingJob(
      firestore, jobRef, first.nextAttemptAt + 1_000, parseJob
    );
    assert.ok(second);
    const observed = createVideoWorkOutcomeCounter();
    assert.equal(await commit(first, 'FAILED'), 'REPLACED');
    const hash = createHash('sha256').update(jobRef.path).digest('hex');
    const eventsForJob = () => firestore
      .collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
      .where('jobKeySha256', '==', hash).get();
    assert.equal((await eventsForJob()).size, 0);
    terminalVideoWorkOutcomes('FAILED', 'REPLACED').forEach(observed.observe);
    assert.equal((await jobRef.get()).get('state'), 'PROCESSING');
    assert.equal((await videoRef.get()).get('status'), 'processing');
    assert.equal(await commit(second, 'SUCCEEDED'), 'APPLIED');
    terminalVideoWorkOutcomes('SUCCEEDED', 'APPLIED').forEach(observed.observe);
    assert.equal((await jobRef.get()).get('state'), 'SUCCEEDED');
    assert.equal((await videoRef.get()).get('status'), 'ready');
    const appliedEvents = await eventsForJob();
    assert.equal(appliedEvents.size, 1);
    assert.equal(appliedEvents.docs[0].get('source'), 'TERMINAL_COMMIT');
    assert.equal(appliedEvents.docs[0].get('kind'), 'STATE_TRANSITION');
    assert.equal(appliedEvents.docs[0].get('nextState'), 'SUCCEEDED');
    assert.equal(appliedEvents.docs[0].get('globallySequenced'), false);
    assert.equal(await commit(first, 'FAILED'), 'REPLACED');
    assert.equal((await eventsForJob()).size, 1);
    assert.equal(observed.metrics()['providerFailedApplied'] ?? 0, 0);
    assert.equal(observed.metrics()['providerSucceededApplied'], 1);
    assert.equal(observed.needsAttention(), false);
    const evidence = videoSchedulerRecord('reconcileVideoProcessing',
      'committed-version', now - 1_000, now, 'OK', 'EXECUTE', observed.metrics());
    const diagnosis = diagnoseVideoScheduler('reconcileVideoProcessing', evidence, now + 1);
    assert.equal(diagnosis.metrics.providerSucceededApplied, 1);
    assert.equal(diagnosis.metrics.providerFailedApplied ?? 0, 0);
  } finally {
    await Promise.all([jobRef.delete(), videoRef.delete()]);
  }
});

test('terminal commit requests cancellation if original is missing or generation changed', async () => {
  for (const change of ['MISSING', 'GENERATION', 'PATH'] as const) {
    const initial = { ...fixture('RUNNING'), sourceGeneration: '701' };
    const jobRef = jobs.doc('terminal-source-changed-' + randomUUID());
    const videoRef = firestore.doc(`users/${initial.ownerUid}/videos/${initial.videoId}`);
    await jobRef.set(initial);
    await videoRef.set({
      path: change === 'PATH' ? initial.sourceStoragePath + '-new'
        : initial.sourceStoragePath,
      sourceGeneration: change === 'GENERATION' ? '702' : '701',
      status: 'processing',
      processedStoragePath: 'users/untouched/published/derivative.mp4',
    });
    if (change === 'MISSING') await videoRef.delete();
    try {
      const claimed = await claimProcessingJob(firestore, jobRef, now, parseJob);
      assert.ok(claimed);
      const disposition = await commitTerminalVideoProcessingIfCurrent(
        firestore, jobRef, claimed, {
          state: 'FAILED', now: now + 1, normalizeJob: parseJob,
          sourceMatches: video => video['path'] === claimed.sourceStoragePath &&
            video['sourceGeneration'] === claimed.sourceGeneration,
          jobPatch: { providerState: 'FAILED', completedAt: now + 1 },
          videoPatch: { status: 'failed', processedStoragePath: 'invalid-replacement' },
        }
      );
      assert.equal(disposition, 'CANCEL_REQUESTED', change);
      assert.equal((await jobRef.get()).get('state'), 'CANCEL_REQUESTED');
      const hash = createHash('sha256').update(jobRef.path).digest('hex');
      const events = await firestore
        .collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
        .where('jobKeySha256', '==', hash).get();
      assert.equal(events.size, 1);
      assert.equal(events.docs[0].get('source'), 'TERMINAL_COMMIT');
      assert.equal(events.docs[0].get('kind'), 'CANCEL_REQUESTED');
      assert.equal(events.docs[0].get('nextState'), 'CANCEL_REQUESTED');
      assert.notEqual((await jobRef.get()).get('providerState'), 'FAILED');
      const actual = await videoRef.get();
      if (change === 'MISSING') assert.equal(actual.exists, false);
      else {
        assert.equal(actual.get('status'), 'processing');
        assert.equal(actual.get('processedStoragePath'),
          'users/untouched/published/derivative.mp4');
      }
    } finally {
      await Promise.all([jobRef.delete(), videoRef.delete()]);
    }
  }
});


test('overlapping scheduler incidents survive a later OK, with one aggregate document', async () => {
  const name = 'reconcileVideoProcessing' as const;
  const ref = firestore.collection(VIDEO_SCHEDULER_COLLECTION).doc(name);
  const old = videoSchedulerRecord(name, 'older-incident', now - 2000,
    now - 1500, 'ATTENTION', 'EXECUTE', { providerReviewRequired: 1 });
  const latest = videoSchedulerRecord(name, 'newer-clean', now - 1000,
    now, 'OK', 'EXECUTE', { selected: 0 });
  try {
    await ref.delete();
    assert.equal(await saveLastVideoSchedulerCycle(firestore, latest), true);
    assert.equal(await saveLastVideoSchedulerCycle(firestore, old), true);
    assert.equal(await saveLastVideoSchedulerCycle(firestore, old), false);
    const stored = (await ref.get()).data();
    assert.equal(stored?.['cycleId'], latest.cycleId);
    assert.equal(stored?.['recentIncidents'].length, 1);
    const diagnostic = diagnoseVideoScheduler(name, stored, now + 1);
    assert.equal(diagnostic.jobsHealth, 'NO_ALERTS_OBSERVED');
    assert.equal(diagnostic.recentIncident?.outcome, 'ATTENTION');
  } finally {
    await ref.delete();
  }
});

test('real Firestore transaction resolves tied timestamps and preserves failure', async () => {
  const name = 'cleanupCancelledVideoProcessing' as const;
  const ref = firestore.collection(VIDEO_SCHEDULER_COLLECTION).doc(name);
  const a = videoSchedulerRecord(name, 'tie-a', now - 1000, now, 'FAILED', 'QUERY', {});
  const b = videoSchedulerRecord(name, 'tie-b', now - 1000, now, 'OK', 'EXECUTE', {});
  try {
    await ref.delete();
    await Promise.all([
      saveLastVideoSchedulerCycle(firestore, a),
      saveLastVideoSchedulerCycle(firestore, b),
    ]);
    const stored = (await ref.get()).data();
    assert.equal(stored?.['cycleId'], b.cycleId);
    assert.equal(stored?.['recentIncidents'][0].outcome, 'FAILED');
  } finally {
    await ref.delete();
  }
});

test('telemetry Firestore outage is best effort, not a clean processing result', async () => {
  const key = 'reconcileVideoProcessing';
  const record = videoSchedulerRecord(key, 'telemetry-down', now - 100,
    now, 'FAILED', 'QUERY', {});
  let calls = 0;
  const unavailable = {
    collection: () => { calls++; throw new Error('Firestore unavailable'); },
  } as unknown as typeof firestore;
  await assert.rejects(saveLastVideoSchedulerCycle(unavailable, record),
    /Firestore unavailable/);
  await assert.doesNotReject(bestEffortSaveVideoSchedulerCycle(unavailable, record));
  assert.equal(calls, 2);
  assert.equal(diagnoseVideoScheduler(key, null, now).health, 'UNVERIFIED');
});


test('telemetry stays within one logical read and at most one write per cycle', async () => {
  const name = 'submitQueuedVideoProcessing';
  const good = videoSchedulerRecord(name, 'budget-latest', now - 1000,
    now, 'OK', 'EXECUTE', { selected: 0 });
  const lateOK = videoSchedulerRecord(name, 'budget-old-ok', now - 3000,
    now - 2000, 'OK', 'EXECUTE', {});
  const lateFailure = videoSchedulerRecord(name, 'budget-old-failure',
    now - 4000, now - 3000, 'FAILED', 'QUERY', {});
  let snapshot: Record<string, unknown> | null = null;
  let reads = 0;
  let writes = 0;
  let attempts = 0;
  const fake = {
    collection: (collectionName: string) => {
      assert.equal(collectionName, VIDEO_SCHEDULER_COLLECTION);
      return { doc: (id: string) => {
        assert.equal(id, name);
        return { id };
      } };
    },
    runTransaction: async (fn: (tx: {
      get: (ref: unknown) => Promise<{ exists: boolean; data: () => unknown }>;
      set: (ref: unknown, data: Record<string, unknown>) => void;
    }) => Promise<boolean>) => {
      attempts++;
      let staged: Record<string, unknown> | null = null;
      const result = await fn({
        get: async () => {
          reads++;
          return { exists: snapshot !== null, data: () => snapshot };
        },
        set: (_ref, data) => { writes++; staged = data; },
      });
      if (staged) snapshot = staged;
      return result;
    },
  } as unknown as typeof firestore;
  assert.equal(await saveLastVideoSchedulerCycle(fake, good), true);
  assert.equal(await saveLastVideoSchedulerCycle(fake, good), false);
  assert.equal(await saveLastVideoSchedulerCycle(fake, lateOK), false);
  assert.equal(await saveLastVideoSchedulerCycle(fake, lateFailure), true);
  assert.equal(attempts, 4);
  assert.equal(reads, 4);
  assert.equal(writes, 2);
  assert.equal(snapshot?.['cycleId'], good.cycleId);
});

test('c17 admin state cursors traverse bounded legacy-safe pages under concurrent updates', async () => {
  // Disposable test collection in the isolated demo emulator; no production jobs.
  const cursorJobs = firestore.collection('c17_admin_video_queue_cursor_integration');
  const batch = firestore.batch();
  for (const state of ['QUEUED', 'SUBMITTING', 'PROCESSING',
    'FAILED', 'CANCEL_REQUESTED'] as const) {
    for (let n = 1; n <= 5; n++) {
      batch.set(cursorJobs.doc(state.toLowerCase() + '-' + n), {
        state,
        ...(n === 2 ? {} : { updatedAt: now - n * 60_000 }),
      });
    }
  }
  await batch.commit();
  async function page(state: string, after: string | null) {
    let query = cursorJobs.where('state', '==', state)
      .orderBy(FieldPath.documentId());
    if (after) query = query.startAfter(after);
    const docs = (await query.limit(3).get()).docs;
    const consumed = docs.slice(0, 2);
    return { ids: consumed.map(d => d.id), scanned: consumed.length,
      more: docs.length > 2, cursor: consumed.at(-1)?.id ?? null };
  }
  const queuedFirst = await page('QUEUED', null);
  assert.deepEqual(queuedFirst.ids, ['queued-1', 'queued-2']);
  assert.equal(queuedFirst.more, true);
  const queuedSecond = await page('QUEUED', queuedFirst.cursor);
  assert.deepEqual(queuedSecond.ids, ['queued-3', 'queued-4']);
  assert.equal(queuedSecond.scanned, 2);
  const queuedLast = await page('QUEUED', queuedSecond.cursor);
  assert.deepEqual(queuedLast.ids, ['queued-5']);
  assert.equal(queuedLast.more, false);
  const all = [...queuedFirst.ids, ...queuedSecond.ids, ...queuedLast.ids];
  assert.equal(new Set(all).size, 5);
  // A legacy record without updatedAt remains visible to ID-based traversal.
  assert.ok(all.includes('queued-2'));
  // State changes between pages are not an immutable snapshot.
  await cursorJobs.doc('processing-4').update({ state: 'QUEUED' });
  const refresh = await page('QUEUED', null);
  assert.deepEqual(refresh.ids, ['processing-4', 'queued-1']);
  // Emulate independent per-state windows: no forced global slice.
  const lanes = await Promise.all(['SUBMITTING', 'PROCESSING', 'FAILED',
    'CANCEL_REQUESTED'].map(state => page(state, null)));
  assert.equal(lanes.length, 4);
  assert.ok(lanes.every(lane => lane.scanned <= 2));
});

test('c17 terminal review cursor orders by ID and keeps legacy timestamps eligible', async () => {
  const collection = firestore.collection('c17_admin_terminal_cursor_integration');
  const ids = [
    'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64),
  ];
  const batch = firestore.batch();
  ids.forEach((id, i) => batch.set(collection.doc(id), {
    state: 'review', ...(i === 1 ? {} : { updatedAt: now - i * 60_000 }),
  }));
  await batch.commit();
  const query = collection.where('state', '==', 'review')
    .orderBy(FieldPath.documentId());
  const first = await query.limit(3).get();
  assert.equal(first.docs.length, 3);
  const consumed = first.docs.slice(0, 2);
  assert.deepEqual(consumed.map(d => d.id), ids.slice(0, 2));
  const after = await query.startAfter(consumed[1].id).limit(3).get();
  assert.deepEqual(after.docs.map(d => d.id), ids.slice(2));
  assert.equal((await collection.where('state', '==', 'review').count().get())
    .data().count, 4);
  assert.equal(new Set([...consumed, ...after.docs].map(d => d.id)).size, 4);
});

test('c18b bounded real Firestore audit observes legacy rows without a global claim', async () => {
  const collection = firestore.collection('c18b_media_admin_queue_audit_integration');
  const states = ['QUEUED', 'SUBMITTING', 'PROCESSING', 'FAILED',
    'CANCEL_REQUESTED'];
  const batch = firestore.batch();
  for (const state of states) {
    for (let index = 1; index <= 60; index++) {
      batch.set(collection.doc(state.toLowerCase() + '-' +
        String(index).padStart(3, '0')), {
        state,
        ...(index % 10 === 0 ? {} : { updatedAt: now - index * 60_000 }),
        ...(index === 60 ? { cancellationReviewRequired: true } : {}),
      });
    }
  }
  await batch.commit();

  let observed = 0;
  let legacyWithoutTimestamp = 0;
  let totalPages = 0;
  const readSizes: number[] = [];
  for (const state of states) {
    let after: string | null = null;
    while (true) {
      let query = collection.where('state', '==', state)
        .orderBy(FieldPath.documentId());
      if (after) query = query.startAfter(after);
      const docs = (await query.limit(11).get()).docs;
      const page = docs.slice(0, 10);
      totalPages++;
      readSizes.push(docs.length);
      observed += page.length;
      legacyWithoutTimestamp += page.filter(doc =>
        doc.get('updatedAt') === undefined).length;
      if (docs.length <= 10) break;
      after = page[page.length - 1].id;
    }
  }
  assert.equal(observed, 300);
  assert.equal(legacyWithoutTimestamp, 30);
  assert.equal(totalPages, 30);
  assert.ok(readSizes.every(n => n <= 11));
  // A state change between requests means later pages are not a snapshot.
  const first = (await collection.where('state', '==', 'QUEUED')
    .orderBy(FieldPath.documentId()).limit(11).get()).docs.slice(0, 10);
  const moved = collection.doc('failed-060');
  await moved.update({ state: 'QUEUED' });
  const after = (await collection.where('state', '==', 'QUEUED')
    .orderBy(FieldPath.documentId()).startAfter(first[9].id)
    .limit(11).get()).docs;
  assert.equal(after.some(doc => doc.id === moved.id), false);
  // A refresh can see a moved row; audit results never infer a global absence.
  const failedRefresh = await collection.where('state', '==', 'QUEUED')
    .orderBy(FieldPath.documentId()).limit(100).get();
  assert.ok(failedRefresh.docs.some(doc => doc.id === moved.id));
});


test('c18d real Firestore commit updates and clears triage with version-fenced transitions', async () => {
  const start = fixture('RUNNING');
  const ref = jobs.doc('c18d-' + randomUUID());
  await ref.create(withAdminTriageProjection(ref.id, null, start, now));
  assert.equal((await ref.get()).get('adminTriageProcessingVersion'),
    start.processingVersion);
  assert.equal((await ref.get()).get('adminTriageTier'), 5);

  const claims = await Promise.all([
    claimProcessingJob(firestore, ref, now, parseJob),
    claimProcessingJob(firestore, ref, now, parseJob),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const claimed = claims.find(Boolean)!;
  const reserved = await ref.get();
  assert.equal(reserved.get('adminTriageProcessingVersion'),
    claimed.processingVersion);
  assert.equal(reserved.get('adminTriageSince'), start.updatedAt);

  assert.equal(await recordProviderPollErrorIfCurrent(
    firestore, ref, claimed, parseJob,
    { code: 'PROVIDER_TIMEOUT', message: 'Provider temporarily unavailable',
      retryable: true }, now + 1000
  ), true);
  const afterError = await ref.get();
  assert.equal(afterError.get('adminTriageProcessingVersion'),
    claimed.processingVersion);
  assert.equal(afterError.get('adminTriageSince'), now + 1000);

  const videoRef = firestore.doc(
    `users/${start.ownerUid}/videos/${start.videoId}`);
  await videoRef.set({ path: start.sourceStoragePath });
  const commitCommand = {
    state: 'SUCCEEDED' as const, now: now + 2000, normalizeJob: parseJob,
    sourceMatches: (video: Record<string, unknown>) =>
      video['path'] === start.sourceStoragePath,
    jobPatch: { completedAt: now + 2000 },
    videoPatch: { status: 'ready' },
  };
  // A failed provider GET advances the polling reservation: older observations
  // must be rejected, even if they belong to the same processingVersion.
  assert.equal(await commitTerminalVideoProcessingIfCurrent(
    firestore, ref, claimed, commitCommand
  ), 'REPLACED');
  const currentAfterError = parseJob(afterError.data());
  assert.ok(currentAfterError);
  const terminal = await commitTerminalVideoProcessingIfCurrent(
    firestore, ref, currentAfterError, commitCommand
  );
  assert.equal(terminal, 'APPLIED');
  const done = await ref.get();
  assert.equal(done.get('state'), 'SUCCEEDED');
  for (const field of ['adminTriageTier', 'adminTriageSince',
    'adminTriageProjectionVersion', 'adminTriageProcessingVersion',
    'adminTriageReevaluateAt']) assert.equal(done.get(field), undefined);
  assert.equal((await videoRef.get()).get('status'), 'ready');
  assert.equal(await recordProviderPollErrorIfCurrent(
    firestore, ref, claimed, parseJob,
    { code: 'STALE', message: 'obsolete result' }, now + 3000
  ), false);
  assert.equal((await ref.get()).get('adminTriageTier'), undefined);
});

test('c18d versionless and timestamp-less legacy updates remain non-destructive', async () => {
  const ref = jobs.doc('c18d-legacy-' + randomUUID());
  await ref.create({ state: 'QUEUED', processingVersion: 'legacy',
    nextAttemptAt: now - 100 });
  await firestore.runTransaction(async tx => {
    const snap = await tx.get(ref);
    tx.update(ref, withAdminTriageProjection(
      ref.id, snap.data() as Partial<VideoProcessingJob>,
      { nextAttemptAt: now }, now));
  });
  const legacy = await ref.get();
  assert.equal(legacy.get('adminTriageTier'), 1);
  assert.equal(legacy.get('adminTriageSince'), 0);
  assert.equal(legacy.get('updatedAt'), undefined);
  assert.equal(legacy.get('processingVersion'), 'legacy');
});


test('c18e dry-run pages cost-limit and legacy timestamp classification', async () => {
  const prefix = 'c18e-preview-' + randomUUID();
  const refs = Array.from({ length: 5 }, (_, i) =>
    jobs.doc(prefix + '-' + String(i).padStart(2, '0')));
  const batch = firestore.batch();
  refs.forEach((ref, i) => batch.create(ref, {
    state: 'QUEUED', processingVersion: 'legacy-' + i,
    ...(i === 0 ? {} : { createdAt: now - 100_000 }),
    nextAttemptAt: now,
  }));
  await batch.commit();
  const first = await prepareVideoTriageBackfillPage(firestore, {
    state: 'QUEUED', afterId: prefix + '-00', limit: 2, now,
  });
  assert.equal(first.mode, 'DRY_RUN');
  assert.equal(first.scope, 'PAGE_ONLY');
  assert.equal(first.scanned, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.outcomes.WOULD_PROJECT, 2);
  assert.ok(first.maxQueryReads <= 3);
  assert.equal(first.maxTransactionReads, 0);
  assert.equal(first.maxWrites, 0);
  assert.equal((await refs[1].get()).get('adminTriageTier'), undefined);
  const second = await prepareVideoTriageBackfillPage(firestore, {
    state: 'QUEUED', afterId: first.nextCursor, limit: 2, now,
  });
  assert.equal(second.scanned, 2);
  assert.equal(second.outcomes.WOULD_PROJECT, 2);
  // Other jobs in this state can exist beyond the test fixture. A page
  // cursor never proves that the entire production lane is exhausted.
  assert.equal(second.hasMore, second.nextCursor !== null);
  if (second.hasMore) assert.equal(second.nextCursor, refs[4].id);

  // Explicit one-page APPLY changes only metadata, not timestamps or state.
  const applied = await prepareVideoTriageBackfillPage(firestore, {
    state: 'QUEUED', afterId: prefix + '-00', limit: 2, mode: 'APPLY', now,
  });
  assert.equal(applied.outcomes.PROJECTED, 2);
  assert.equal(applied.maxTransactionReads, 4);
  assert.equal(applied.maxWrites, 2);
  const job = await refs[1].get();
  assert.equal(job.get('processingVersion'), 'legacy-1');
  assert.equal(job.get('adminTriageProcessingVersion'), 'legacy-1');
  assert.equal(job.get('adminTriageTier'), 4);
  assert.equal(job.get('updatedAt'), undefined);
  const replay = await prepareVideoTriageBackfillPage(firestore, {
    state: 'QUEUED', afterId: prefix + '-00', limit: 2, mode: 'APPLY', now,
  });
  assert.equal(replay.outcomes.CURRENT, 2);
  assert.equal(replay.outcomes.PROJECTED, 0);
  assert.ok((await refs[1].get()).updateTime?.isEqual(job.updateTime!));
});

test('c18e transaction rejects stale version and same-version writer updates', async () => {
  const ref = jobs.doc('c18e-race-' + randomUUID());
  await ref.create({ state: 'FAILED', processingVersion: 'v1',
    updatedAt: now - 5_000, lastErrorCode: null });
  const observed = await ref.get();
  assert.ok(observed.exists);
  const race = await Promise.all([
    applyObservedVideoTriageBackfillJob(firestore, observed, now),
    applyObservedVideoTriageBackfillJob(firestore, observed, now),
  ]);
  assert.deepEqual(race.sort(), ['PROJECTED', 'REPLACED']);
  const projected = await ref.get();
  assert.equal(projected.get('adminTriageProcessingVersion'), 'v1');
  assert.equal(projected.get('adminTriageTier'), 2);

  // Even a same-version change, without state/version transition, blocks the
  // old observed snapshot and cannot be silently overwritten by the backfill.
  const sameVersionObserved = await ref.get();
  await ref.update(withAdminTriageProjection(ref.id,
    sameVersionObserved.data() as VideoProcessingJob, {
      updatedAt: now + 1, lastErrorCode: 'PROVIDER_UNCONFIRMED',
    }, now + 1));
  assert.equal(await applyObservedVideoTriageBackfillJob(
    firestore, sameVersionObserved, now + 2
  ), 'REPLACED');
  assert.equal((await ref.get()).get('updatedAt'), now + 1);

  const older = await ref.get();
  await ref.update(withAdminTriageProjection(ref.id,
    older.data() as VideoProcessingJob, {
      state: 'QUEUED', processingVersion: 'v2', updatedAt: now + 3,
    }, now + 3));
  assert.equal(await applyObservedVideoTriageBackfillJob(
    firestore, older, now + 4
  ), 'REPLACED');
  assert.equal((await ref.get()).get('adminTriageProcessingVersion'), 'v2');
});

test('c18e terminal scrubbing, absent version and no unbounded retry', async () => {
  const prefix = 'c18e-terminal-' + randomUUID();
  const terminalRef = jobs.doc(prefix + '-a');
  const cleanRef = jobs.doc(prefix + '-b');
  await terminalRef.create({ state: 'SUCCEEDED', processingVersion: 'v1',
    adminTriageProjectionVersion: 1, adminTriageProcessingVersion: 'v1',
    adminTriageTier: 0, adminTriageSince: 1,
    adminTriageReevaluateAt: null, outputStoragePath: 'preserved/output.mp4' });
  await cleanRef.create({ state: 'SUCCEEDED', processingVersion: 'v2',
    outputStoragePath: 'preserved/other.mp4' });
  const preview = await prepareVideoTriageBackfillPage(firestore, {
    state: 'SUCCEEDED', afterId: prefix, limit: 2, now,
  });
  assert.equal(preview.outcomes.WOULD_CLEAR_TERMINAL, 1);
  assert.equal(preview.outcomes.CURRENT, 1);
  assert.equal((await terminalRef.get()).get('adminTriageTier'), 0);
  const apply = await prepareVideoTriageBackfillPage(firestore, {
    state: 'SUCCEEDED', afterId: prefix, limit: 2, now, mode: 'APPLY',
  });
  assert.equal(apply.outcomes.CLEARED_TERMINAL, 1);
  assert.equal(apply.outcomes.CURRENT, 1);
  assert.equal((await terminalRef.get()).get('adminTriageTier'), undefined);
  assert.equal((await terminalRef.get()).get('outputStoragePath'),
    'preserved/output.mp4');

  const unversioned = jobs.doc('c18e-unversioned-' + randomUUID());
  await unversioned.create({ state: 'FAILED', createdAt: now - 50_000 });
  const observed = await unversioned.get();
  assert.equal(await applyObservedVideoTriageBackfillJob(
    firestore, observed, now
  ), 'UNVERSIONED');
  assert.equal((await unversioned.get()).get('processingVersion'), undefined);
  const vanished = jobs.doc('c18e-vanished-' + randomUUID());
  await vanished.create({ state: 'FAILED', processingVersion: 'v1' });
  const initial = await vanished.get();
  await vanished.delete();
  assert.equal(await applyObservedVideoTriageBackfillJob(
    firestore, initial, now
  ), 'MISSING');
});


test('c18f bounded due index reclassifies with time without altering job state', async () => {
  const ref = jobs.doc('c18f-due-' + randomUUID());
  const start = now - 19 * 60_000;
  const before = { state: 'QUEUED' as const, processingVersion: 'v1',
    updatedAt: start, outputStoragePath: 'original/safe.mp4' };
  const projection = projectAdminTriageJob(ref.id, before, now)!;
  await ref.create({ ...before, ...projection });
  assert.equal(projection.adminTriageTier, 5);
  const cutoff = now + 2 * 60_000;
  const page = await reclassifyDueVideoTriagePage(firestore, {
    now: cutoff, limit: 20, mode: 'DRY_RUN',
  });
  assert.equal(page.scope, 'PAGE_ONLY');
  assert.equal(page.provesGlobalCoverage, false);
  assert.ok(page.counts.WOULD_PROJECT >= 1);
  assert.ok(page.maxQueryReads <= 21);
  assert.equal(page.maxWrites, 0);
  assert.equal((await ref.get()).get('adminTriageTier'), 5);
  // Apply the precise observed document, independent of other test fixtures.
  const observed = await ref.get();
  assert.equal(await applyObservedVideoTriageBackfillJob(
    firestore, observed, cutoff
  ), 'PROJECTED');
  const updated = await ref.get();
  assert.equal(updated.get('adminTriageTier'), 3);
  assert.equal(updated.get('adminTriageReevaluateAt'), null);
  assert.equal(updated.get('updatedAt'), start);
  assert.equal(updated.get('state'), 'QUEUED');
  assert.equal(updated.get('processingVersion'), 'v1');
  assert.equal(updated.get('outputStoragePath'), 'original/safe.mp4');
  const repeat = await reclassifyDueVideoTriagePage(firestore, {
    now: cutoff, limit: 20,
  });
  assert.equal(repeat.provesGlobalCoverage, false);
  assert.equal(repeat.maxTransactionReads, 0);
});

test('c18f independent audit flags absence, version drift, overdue and terminal residue', async () => {
  const prefix = 'c18f-audit-' + randomUUID();
  const first = jobs.doc(prefix + '-01');
  const second = jobs.doc(prefix + '-02');
  const third = jobs.doc(prefix + '-03');
  const raw = { state: 'QUEUED' as const, processingVersion: 'v1',
    updatedAt: now - 3 * 60_000 };
  const clean = projectAdminTriageJob(first.id, raw, now)!;
  await first.create(raw);
  await second.create({ ...raw, ...clean,
    adminTriageProcessingVersion: 'v0' });
  const old = { ...raw, updatedAt: now - 19 * 60_000 };
  const projected = projectAdminTriageJob(third.id, old, now)!;
  await third.create({ ...old, ...projected });
  const inspected = await auditVideoTriageIntegrityPage(firestore, {
    state: 'QUEUED', afterId: prefix, limit: 3, now: now + 2 * 60_000,
  });
  assert.equal(inspected.scope, 'PAGE_ONLY');
  assert.equal(inspected.provesGlobalCoverage, false);
  assert.equal(inspected.counts.MISSING_PROJECTION, 1);
  assert.equal(inspected.counts.STALE_VERSION, 1);
  assert.equal(inspected.counts.TIME_DUE, 1);
  assert.ok(inspected.maxQueryReads <= 4);
});

test('c18f due cursor ties remain ordered and rejects invalid budgets', async () => {
  const prefix = 'c18f-tie-' + randomUUID();
  const refs = Array.from({ length: 3 }, (_, i) =>
    jobs.doc(prefix + '-' + String(i).padStart(2, '0')));
  const at = now - 500;
  const batch = firestore.batch();
  refs.forEach((ref, i) => batch.create(ref, {
    state: 'PROCESSING', processingVersion: 'v' + i, updatedAt: at,
    adminTriageProjectionVersion: 1,
    adminTriageProcessingVersion: 'v' + i,
    adminTriageTier: 5, adminTriageSince: at,
    adminTriageReevaluateAt: now - 100,
  }));
  await batch.commit();
  // Explicit tied deadline + ID cursor must be stable and deterministic.
  const first = await reclassifyDueVideoTriagePage(firestore, {
    now, limit: 1, after: { dueAt: now - 100,
      jobId: refs[0].id },
  });
  assert.equal(first.observed, 1);
  assert.ok(first.hasMore);
  assert.deepEqual(first.nextCursor, {
    dueAt: now - 100, jobId: refs[1].id,
  });
  const second = await reclassifyDueVideoTriagePage(firestore, {
    now, limit: 1, after: first.nextCursor,
  });
  assert.equal(second.observed, 1);
  assert.equal(second.provesGlobalCoverage, false);
  // Other due records can follow the fixture; only the cursor identity is
  // deterministic, never global exhaustion inferred from a sample.
  if (second.hasMore) assert.deepEqual(second.nextCursor, {
    dueAt: now - 100, jobId: refs[2].id,
  });
  else assert.equal(second.nextCursor, null);
  // A previously seen page is NOT a consistent collection snapshot.
  const current = await refs[1].get();
  await refs[1].update({ updatedAt: now, adminTriageReevaluateAt: null });
  assert.equal(await applyObservedVideoTriageBackfillJob(
    firestore, current, now
  ), 'REPLACED');
  for (const bad of [
    { limit: 21 }, { limit: 0 }, { mode: 'ON' },
    { after: { dueAt: now + 1, jobId: refs[0].id } },
    { after: { dueAt: now, jobId: 'bad/id' } },
  ]) {
    await assert.rejects(
      reclassifyDueVideoTriagePage(firestore, { now, ...bad } as
        Parameters<typeof reclassifyDueVideoTriagePage>[1]),
      RangeError
    );
  }
});


test('c18g one-page readiness probe is read-only, bounded and fails closed', async () => {
  const ref = jobs.doc('c18g-probe-' + randomUUID());
  await ref.create({ state: 'FAILED', processingVersion: 'v1',
    updatedAt: now - 30_000, outputStoragePath: 'keep/derived.mp4' });
  const before = await ref.get();
  const sample = await sampleVideoTriageReadinessPage(firestore, {
    state: 'FAILED', afterId: ref.id.slice(0, -1), now, limit: 2,
  });
  assert.equal(sample.scope, 'PAGE_ONLY');
  assert.equal(sample.provesGlobalCoverage, false);
  assert.equal(sample.maxQueryReads, 5);
  assert.equal(sample.maxTransactionReads, 0);
  assert.equal(sample.maxWrites, 0);
  assert.equal(sample.readiness.phase, 'BLOCKED');
  assert.equal(sample.readiness.blockedBy.length, 9);
  assert.equal(sample.readiness.activationAuthorized, false);
  assert.equal(sample.deadlineSample.mode, 'DRY_RUN');
  assert.ok(sample.stateAudit.observed >= 1);
  const afterRead = await ref.get();
  assert.ok(before.updateTime?.isEqual(afterRead.updateTime!));
  assert.equal(afterRead.get('outputStoragePath'), 'keep/derived.mp4');
  for (const bad of [
    { limit: 0 }, { limit: 21 }, { state: 'ARCHIVED' },
    { now: 0 }, { now: Number.POSITIVE_INFINITY },
    { afterId: 'not/a/document-id' },
  ]) {
    await assert.rejects(
      sampleVideoTriageReadinessPage(firestore, {
        state: 'FAILED', now, ...bad,
      } as Parameters<typeof sampleVideoTriageReadinessPage>[1]),
      RangeError
    );
  }
});


test('c18h two-stage offline evidence audit detects concurrent same-version mutation', async () => {
  const ref = jobs.doc('c18h-race-' + randomUUID());
  const initial = { state: 'FAILED', processingVersion: 'v1',
    updatedAt: now - 50_000, outputStoragePath: 'preserve/derived.mp4' };
  await ref.create(initial);
  let changed = false;
  const db = new Proxy(firestore, {
    get(target, prop) {
      if (prop === 'getAll') {
        return async (...refs: Parameters<typeof firestore.getAll>) => {
          if (!changed) {
            changed = true;
            await ref.update({ lastErrorCode: 'SAME_VERSION_UPDATE' });
          }
          return target.getAll(...refs);
        };
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? value.bind(target) as unknown : value;
    },
  });
  const page = await auditVideoTriageConcurrentPage(db, {
    state: 'FAILED', afterId: ref.id.slice(0, -1), limit: 1, now,
  });
  assert.equal(page.scope, 'PAGE_ONLY');
  assert.equal(page.consistency, 'BEST_EFFORT_NOT_SNAPSHOT');
  assert.equal(page.observed, 1);
  assert.equal(page.changedOnReread, 1);
  assert.equal(page.stableOnReread, 0);
  assert.equal(page.maxDocumentReads, 3);
  assert.equal(page.maxWrites, 0);
  assert.equal(page.concurrentCursorSafetyVerified, false);
  assert.equal(page.provesGlobalCoverage, false);
  assert.equal((await ref.get()).get('outputStoragePath'),
    'preserve/derived.mp4');
});

test('c18h metadata retrieval rejects emulator and missing authorization before HTTP', async () => {
  await assert.rejects(
    readAuthenticatedTriageIndexPage(app, {
      approved: true, purpose: 'READ_ONLY_TRIAGE_INDEX_PREFLIGHT',
      expectedProjectId: PROJECT_ID, expectedDatabaseId: '(default)',
    }, now),
    /not authorized/
  );
  const page = await auditVideoTriageConcurrentPage(firestore, {
    state: 'FAILED', afterId: 'zzzzzzzzzzzzzzzz', limit: 1, now,
  });
  assert.equal(page.observed, 0);
  assert.equal(page.maxWrites, 0);
  assert.equal(page.provesGlobalCoverage, false);
  for (const bad of [
    { limit: 0 }, { limit: 21 }, { state: 'ARCHIVED' },
    { afterId: 'invalid/document-id' }, { now: 0 },
  ]) await assert.rejects(
    auditVideoTriageConcurrentPage(firestore, {
      state: 'FAILED', now, ...bad,
    } as Parameters<typeof auditVideoTriageConcurrentPage>[1]), RangeError);
});


test('c18k c18i compatibility facade requires a registered durable journal', async () => {
  const key = randomBytes(32);
  const at = Date.now() - 1_000;
  const approval = {
    approved: true as const, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT' as const,
    expectedProjectId: PROJECT_ID, expectedDatabaseId: '(default)' as const,
  };
  const created = createVideoTriageAuditSession(approval, {
    pageSize: 1, maxPages: 2, maxDocuments: 2,
    maxDocumentReads: 6, maxDurationMs: 120_000, maxFailures: 1,
  }, key, at);
  const context = { ...approval, expectedSessionId: created.sessionId };
  let reads = 0;
  const reader: typeof auditVideoTriageConcurrentPage = async (db, request) => {
    reads++;
    return auditVideoTriageConcurrentPage(db, request);
  };
  await assert.rejects(runOneVideoTriageAuditPage(
    firestore, app, context, created.checkpoint, key, () => at + 1, reader),
  /not registered/);
  assert.equal(reads, 0);
  await registerSignedVideoTriageAuditJournal(
    firestore, app, context, created.checkpoint, key);
  const before = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  const applied = await runOneVideoTriageAuditPage(
    firestore, app, context, before.checkpoint, key,
    () => Date.now(), reader);
  assert.equal(reads, 1);
  assert.equal(applied.report.pagesAttempted, 1);
  assert.equal(applied.report.reservedDocumentReads, 3);
  assert.equal(applied.report.globalCoverageVerified, false);
  const after = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(after.report.pagesCompleted, 1);
  assert.equal(after.inFlight, false);
});

test('c18j concurrent claims reserve one page, commit only once and reject replay', async () => {
  const at = Date.now() - 1_000;
  const key = randomBytes(32);
  const approval = {
    approved: true as const, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT' as const,
    expectedProjectId: PROJECT_ID, expectedDatabaseId: '(default)' as const,
  };
  const created = createVideoTriageAuditSession(approval, {
    pageSize: 1, maxPages: 3, maxDocuments: 3,
    maxDocumentReads: 9, maxDurationMs: 180_000, maxFailures: 1,
  }, key, at);
  const context = { ...approval, expectedSessionId: created.sessionId };
  await registerSignedVideoTriageAuditJournal(
    firestore, app, context, created.checkpoint, key);
  await assert.rejects(
    registerSignedVideoTriageAuditJournal(
      firestore, app, context, created.checkpoint, key),
    /already registered/
  );
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const attempts = await Promise.all([
    claimDurableVideoTriageAuditPage(
      firestore, app, context, created.checkpoint, key, ownerA, at + 1),
    claimDurableVideoTriageAuditPage(
      firestore, app, context, created.checkpoint, key, ownerB, at + 1),
  ]);
  assert.deepEqual(attempts.map(a => a.kind).sort(),
    ['CLAIMED', 'STALE_CHECKPOINT']);
  const selected = attempts.find(a => a.kind === 'CLAIMED');
  assert.ok(selected && selected.kind === 'CLAIMED');
  const claimed = selected.claim;
  const pending = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(pending.inFlight, true);
  assert.equal(pending.generation, 1);
  assert.equal(pending.report.pagesAttempted, 1);
  assert.equal(pending.report.reservedDocumentReads, 3);
  assert.equal(pending.report.pagesCompleted, 0);
  const busy = await claimDurableVideoTriageAuditPage(
    firestore, app, context, pending.checkpoint, key, randomUUID(), at + 2);
  assert.equal(busy.kind, 'BUSY');
  const stale = await claimDurableVideoTriageAuditPage(
    firestore, app, context, created.checkpoint, key, randomUUID(), at + 2);
  assert.equal(stale.kind, 'STALE_CHECKPOINT');
  const sample = await auditVideoTriageConcurrentPage(firestore, {
    state: claimed.lane as 'QUEUED', limit: 1,
    afterId: claimed.afterId, now: claimed.evaluationAt,
  });
  const results = await Promise.all([
    settleDurableVideoTriageAuditPage(
      firestore, app, context, key, claimed, sample, at + 3),
    settleDurableVideoTriageAuditPage(
      firestore, app, context, key, claimed, sample, at + 3),
  ]);
  assert.deepEqual(results.map(a => a.kind).sort(), ['APPLIED', 'DUPLICATE']);
  const recovered = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(recovered.inFlight, false);
  assert.equal(recovered.report.pagesCompleted, 1);
  assert.equal(recovered.report.documentsObserved, sample.observed);
  assert.equal(recovered.report.reservedDocumentReads, 3);
  assert.equal(recovered.report.globalCoverageVerified, false);
  assert.equal(recovered.report.globalOrderingEnabled, false);
});

test('c18j expired lease recovery charges lost page and fences delayed completion', async () => {
  const at = Date.now() - 1_000;
  const key = randomBytes(32);
  const approval = {
    approved: true as const, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT' as const,
    expectedProjectId: PROJECT_ID, expectedDatabaseId: '(default)' as const,
  };
  const created = createVideoTriageAuditSession(approval, {
    pageSize: 1, maxPages: 4, maxDocuments: 4,
    maxDocumentReads: 12, maxDurationMs: 180_000, maxFailures: 1,
  }, key, at);
  const context = { ...approval, expectedSessionId: created.sessionId };
  await registerSignedVideoTriageAuditJournal(
    firestore, app, context, created.checkpoint, key);
  const first = await claimDurableVideoTriageAuditPage(
    firestore, app, context, created.checkpoint, key, randomUUID(), at + 1);
  assert.equal(first.kind, 'CLAIMED');
  if (first.kind !== 'CLAIMED') throw new Error('No claim');
  const recovered = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  // Emulator-only forced expiry: the server clock is never forged.
  await firestore.collection(VIDEO_TRIAGE_AUDIT_JOURNAL_COLLECTION)
    .doc(created.sessionId).update({ 'active.until': at - 1 });
  const second = await claimDurableVideoTriageAuditPage(
    firestore, app, context, recovered.checkpoint, key,
    randomUUID(), at + 2);
  assert.equal(second.kind, 'CLAIMED');
  if (second.kind !== 'CLAIMED') throw new Error('No recovered claim');
  assert.ok(second.claim.generation > first.claim.generation);
  const displaced = await settleDurableVideoTriageAuditPage(
    firestore, app, context, key, first.claim, null,
    at + VIDEO_TRIAGE_AUDIT_LEASE_MS + 3);
  assert.equal(displaced.kind, 'SUPERSEDED');
  const final = await settleDurableVideoTriageAuditPage(
    firestore, app, context, key, second.claim, null,
    at + VIDEO_TRIAGE_AUDIT_LEASE_MS + 3);
  assert.equal(final.kind, 'APPLIED');
  const evidence = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(evidence.report.pagesAttempted, 2);
  assert.equal(evidence.report.pagesCompleted, 0);
  assert.equal(evidence.report.reservedDocumentReads, 6);
  assert.equal(evidence.report.failedPages, 2);
  assert.equal(evidence.report.globalCoverageVerified, false);
  const repeated = await settleDurableVideoTriageAuditPage(
    firestore, app, context, key, first.claim, null,
    at + VIDEO_TRIAGE_AUDIT_LEASE_MS + 4);
  assert.equal(repeated.kind, 'SUPERSEDED');
});

test('c18j read errors consume reservation and no document content is mutated', async () => {
  const at = Date.now() - 1_000;
  const key = randomBytes(32);
  const approval = {
    approved: true as const, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT' as const,
    expectedProjectId: PROJECT_ID, expectedDatabaseId: '(default)' as const,
  };
  const created = createVideoTriageAuditSession(approval, {
    pageSize: 1, maxPages: 2, maxDocuments: 2,
    maxDocumentReads: 6, maxDurationMs: 120_000, maxFailures: 1,
  }, key, at);
  const context = { ...approval, expectedSessionId: created.sessionId };
  await registerSignedVideoTriageAuditJournal(
    firestore, app, context, created.checkpoint, key);
  const ref = jobs.doc('c18j-unchanged-' + randomUUID());
  await ref.create({ state: 'QUEUED', processingVersion: 'v1',
    updatedAt: at, outputStoragePath: 'untouched/original.mp4' });
  const before = await ref.get();
  const failingReader: typeof auditVideoTriageConcurrentPage = async () => {
    throw new Error('Simulated error after reservation');
  };
  const result = await runOneDurableVideoTriageAuditPage(
    firestore, app, context, created.checkpoint, key,
    () => at + 1, failingReader);
  assert.equal(result.kind, 'APPLIED');
  assert.equal(result.readFailed, true);
  assert.equal(result.page, null);
  assert.equal(result.report.failedPages, 1);
  assert.equal(result.report.pagesCompleted, 0);
  assert.equal(result.report.reservedDocumentReads, 3);
  const persisted = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(persisted.inFlight, false);
  assert.equal(persisted.report.pagesAttempted, 1);
  const after = await ref.get();
  assert.ok(before.updateTime?.isEqual(after.updateTime!));
  assert.equal(after.get('outputStoragePath'), 'untouched/original.mp4');
  const other = { ...context, expectedProjectId: 'demo-other-project' };
  await assert.rejects(readDurableVideoTriageAuditJournal(
    firestore, app, other, key), /local emulator/);
});

test('c18k expiry at exhausted budget never acknowledges an unapplied attempt', async () => {
  const at = Date.now() - 1_000;
  const key = randomBytes(32);
  const approval = {
    approved: true as const, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT' as const,
    expectedProjectId: PROJECT_ID, expectedDatabaseId: '(default)' as const,
  };
  const created = createVideoTriageAuditSession(approval, {
    pageSize: 1, maxPages: 1, maxDocuments: 1,
    maxDocumentReads: 3, maxDurationMs: 120_000, maxFailures: 0,
  }, key, at);
  const context = { ...approval, expectedSessionId: created.sessionId };
  await registerSignedVideoTriageAuditJournal(
    firestore, app, context, created.checkpoint, key);
  const first = await claimDurableVideoTriageAuditPage(
    firestore, app, context, created.checkpoint, key, randomUUID(), at + 1);
  assert.equal(first.kind, 'CLAIMED');
  if (first.kind !== 'CLAIMED') return;
  const canonical = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  const beforeRecovery = await recoverDurableVideoTriageAuditAttempt(
    firestore, app, context, key, first.claim);
  assert.equal(beforeRecovery.kind, 'INCONCLUSIVE');
  await firestore.collection(VIDEO_TRIAGE_AUDIT_JOURNAL_COLLECTION)
    .doc(created.sessionId).update({ 'active.until': at - 1 });
  const stopped = await claimDurableVideoTriageAuditPage(
    firestore, app, context, canonical.checkpoint, key,
    randomUUID(), at + 2);
  assert.equal(stopped.kind, 'STOPPED');
  const replay = await settleDurableVideoTriageAuditPage(
    firestore, app, context, key, first.claim, null, at + 3);
  assert.equal(replay.kind, 'SUPERSEDED');
  const recovery = await recoverDurableVideoTriageAuditAttempt(
    firestore, app, context, key, first.claim);
  assert.equal(recovery.kind, 'NOT_APPLIED');
  const after = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(after.report.pagesCompleted, 0);
  assert.equal(after.report.pagesAttempted, 1);
  assert.equal(after.report.failedPages, 1);
  assert.equal(after.report.reservedDocumentReads, 3);
  assert.equal(after.generation, 2);
});

test('c18k commit without observed response is recovered by exact attempt receipt', async () => {
  const at = Date.now() - 1_000;
  const key = randomBytes(32);
  const approval = {
    approved: true as const, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT' as const,
    expectedProjectId: PROJECT_ID, expectedDatabaseId: '(default)' as const,
  };
  const created = createVideoTriageAuditSession(approval, {
    pageSize: 1, maxPages: 2, maxDocuments: 2,
    maxDocumentReads: 6, maxDurationMs: 120_000, maxFailures: 1,
  }, key, at);
  const context = { ...approval, expectedSessionId: created.sessionId };
  await registerSignedVideoTriageAuditJournal(
    firestore, app, context, created.checkpoint, key);
  const first = await claimDurableVideoTriageAuditPage(
    firestore, app, context, created.checkpoint, key, randomUUID(), at + 1);
  assert.equal(first.kind, 'CLAIMED');
  if (first.kind !== 'CLAIMED') return;
  const page = await auditVideoTriageConcurrentPage(firestore, {
    state: first.claim.lane as 'QUEUED',
    afterId: first.claim.afterId, limit: 1, now: first.claim.evaluationAt,
  });
  // The transaction commits; its reply is intentionally disregarded.
  await settleDurableVideoTriageAuditPage(
    firestore, app, context, key, first.claim, page, at + 2);
  const recovered = await recoverDurableVideoTriageAuditAttempt(
    firestore, app, context, key, first.claim);
  assert.equal(recovered.kind, 'APPLIED');
  if (recovered.kind !== 'APPLIED') return;
  assert.match(recovered.resultId, /^[a-f0-9]{64}$/);
  const duplicate = await settleDurableVideoTriageAuditPage(
    firestore, app, context, key, first.claim, page, at + 3);
  assert.equal(duplicate.kind, 'DUPLICATE');
  const altered = await settleDurableVideoTriageAuditPage(
    firestore, app, context, key, first.claim,
    { ...page, checkedAt: page.checkedAt + 1 }, at + 4);
  assert.equal(altered.kind, 'SUPERSEDED');
  const durable = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(durable.report.pagesCompleted, 1);
  assert.equal(durable.report.pagesAttempted, 1);
  assert.equal(durable.report.reservedDocumentReads, 3);
  assert.equal(durable.journalReservedOperations, 9);
});

test('c18k skew and malformed page evidence cannot advance a reserved cursor', async () => {
  const at = Date.now() - 1_000;
  const key = randomBytes(32);
  const approval = {
    approved: true as const, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT' as const,
    expectedProjectId: PROJECT_ID, expectedDatabaseId: '(default)' as const,
  };
  const created = createVideoTriageAuditSession(approval, {
    pageSize: 1, maxPages: 2, maxDocuments: 2,
    maxDocumentReads: 6, maxDurationMs: 120_000, maxFailures: 1,
  }, key, at);
  const context = { ...approval, expectedSessionId: created.sessionId };
  await registerSignedVideoTriageAuditJournal(
    firestore, app, context, created.checkpoint, key);
  await assert.rejects(claimDurableVideoTriageAuditPage(
    firestore, app, context, created.checkpoint, key,
    randomUUID(), at + 500_000), /clock skew/);
  const first = await claimDurableVideoTriageAuditPage(
    firestore, app, context, created.checkpoint, key, randomUUID(), at + 1);
  assert.equal(first.kind, 'CLAIMED');
  if (first.kind !== 'CLAIMED') return;
  const page = await auditVideoTriageConcurrentPage(firestore, {
    state: first.claim.lane as 'QUEUED',
    afterId: first.claim.afterId, limit: 1, now: first.claim.evaluationAt,
  });
  const invalid = [
    { ...page, hasMore: true, nextCursor: null },
    { ...page, checkedAt: at + 50 },
    { ...page, maxPointReads: page.maxPointReads + 2 },
    { ...page, movedOnReread: page.observed + 1 },
    { ...page, counts: { ...page.counts, CURRENT: -1 } },
  ];
  for (const forged of invalid) {
    await assert.rejects(settleDurableVideoTriageAuditPage(
      firestore, app, context, key, first.claim, forged, at + 2),
    /Malformed audit page/);
  }
  const mid = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(mid.inFlight, true);
  assert.equal(mid.report.pagesCompleted, 0);
  await settleDurableVideoTriageAuditPage(
    firestore, app, context, key, first.claim, page, at + 3);
  const after = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(after.report.pagesCompleted, 1);
});


test('c18l competing journal claims reserve only one page and enforce a bounded stop', async () => {
  const at = Date.now() - 1_000;
  const key = randomBytes(32);
  const approval = {
    approved: true as const, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT' as const,
    expectedProjectId: PROJECT_ID, expectedDatabaseId: '(default)' as const,
  };
  const created = createVideoTriageAuditSession(approval, {
    pageSize: 1, maxPages: 1, maxDocuments: 1,
    maxDocumentReads: 3, maxDurationMs: 120_000, maxFailures: 0,
  }, key, at);
  const context = { ...approval, expectedSessionId: created.sessionId };
  await registerSignedVideoTriageAuditJournal(
    firestore, app, context, created.checkpoint, key);
  const claims = await Promise.allSettled(Array.from({ length: 4 }, () =>
    claimDurableVideoTriageAuditPage(
      firestore, app, context, created.checkpoint, key,
      randomUUID(), Date.now())
  ));
  const successes = claims.filter((item): item is PromiseFulfilledResult<
    Awaited<ReturnType<typeof claimDurableVideoTriageAuditPage>>> =>
    item.status === 'fulfilled').map(item => item.value);
  assert.equal(successes.filter(item => item.kind === 'CLAIMED').length, 1);
  const claimed = successes.find(item => item.kind === 'CLAIMED');
  assert.ok(claimed && claimed.kind === 'CLAIMED');
  if (claimed.kind !== 'CLAIMED') return;
  const current = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(current.report.pagesAttempted, 1);
  assert.equal(current.report.reservedDocumentReads, 3);
  assert.equal(current.journalReservedOperations, 9);
  const validation = validateVideoTriageAuditSession(
    current.checkpoint, key, context, current.journalReservedOperations);
  assert.equal(validation.consistency, 'CONSISTENT');
  assert.equal(validation.globalCoverageVerified, false);
  const page = await auditVideoTriageConcurrentPage(firestore, {
    state: claimed.claim.lane as 'QUEUED',
    afterId: claimed.claim.afterId, limit: 1,
    now: claimed.claim.evaluationAt,
  });
  const result = await settleDurableVideoTriageAuditPage(
    firestore, app, context, key, claimed.claim, page, Date.now());
  assert.equal(result.kind, 'APPLIED');
  const after = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  const stopped = await claimDurableVideoTriageAuditPage(
    firestore, app, context, after.checkpoint, key, randomUUID(), Date.now());
  assert.equal(stopped.kind, 'STOPPED');
  const end = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key);
  assert.equal(end.report.pagesAttempted, 1);
  assert.equal(end.report.pagesCompleted, 1);
  assert.equal(end.journalReservedOperations, 9);
});

test('c18l crossing state lanes can hide one skip and one duplicate', async () => {
  const at = Date.now() - 1_000;
  const prefix = 'c18l-' + randomUUID();
  // The missed ID falls strictly before the consumed cursor after it moves.
  const repeatedId = prefix + '-b';
  const missedId = prefix + '-a';
  await Promise.all([
    jobs.doc(repeatedId).create({ state: 'QUEUED', processingVersion: 'v1' }),
    jobs.doc(missedId).create({ state: 'PROCESSING', processingVersion: 'v1' }),
  ]);
  // Observed IDs never enter logs. Independent fixture before/after
  // snapshots are compared to the actual IDs returned by the SDK.
  const observations: VideoTriagePageReadObservation[] = [];
  const before = await firestore.getAll(
    jobs.doc(repeatedId), jobs.doc(missedId));
  const baseline = before.map(doc => ({
    id: doc.id,
    state: doc.get('state') as 'QUEUED' | 'PROCESSING',
    revision: doc.get('processingVersion') as string,
  }));
  const firstLane = await auditVideoTriageConcurrentPage(firestore, {
    state: 'QUEUED', afterId: prefix + '-', limit: 1, now: at,
  }, result => observations.push(result));
  assert.equal(firstLane.observed, 1);
  assert.equal(firstLane.provesGlobalCoverage, false);
  // Ordered fixture writers emulate a complete, local mutation witness.
  await jobs.doc(repeatedId).update({ state: 'PROCESSING' });
  await jobs.doc(missedId).update({ state: 'QUEUED' });
  const laterLane = await auditVideoTriageConcurrentPage(firestore, {
    state: 'PROCESSING', afterId: prefix + '-', limit: 1, now: at,
  }, result => observations.push(result));
  assert.equal(laterLane.observed, 1);
  assert.equal(laterLane.provesGlobalCoverage, false);
  assert.equal(firstLane.observed + laterLane.observed, 2);
  // The same repeatedId appeared in both lanes, and missedId was not read.
  // Matching observed counts are insufficient to certify any global coverage.
  const latest = await Promise.all([
    jobs.doc(repeatedId).get(), jobs.doc(missedId).get(),
  ]);
  assert.equal(latest[0].get('state'), 'PROCESSING');
  assert.equal(latest[1].get('state'), 'QUEUED');
  const after = latest.map(doc => ({
    id: doc.id,
    state: doc.get('state') as 'QUEUED' | 'PROCESSING',
    revision: doc.get('processingVersion') as string,
  }));
  assert.equal(observations.length, 2);
  assert.ok(observations.every(item =>
    item.scope === 'EMULATOR_SDK_PAGE' &&
    item.queryGetCalls === 1 &&
    item.pointDocumentsRequested === 1 &&
    item.queryDocumentsReturned >= 1));
  const reconciled = reconcileVideoTriageFixture(
    baseline, after, observations.map(item => ({
      state: item.state, afterId: item.afterId,
      ids: item.ids, hasMore: item.hasMore,
      nextCursor: item.nextCursor,
    })));
  assert.equal(reconciled.missingCount, 1);
  assert.equal(reconciled.duplicateCount, 1);
  assert.equal(reconciled.changedCount, 2);
  assert.equal(reconciled.status, 'GAPS_OR_DUPLICATES');
  assert.equal(reconciled.globalCoverageVerified, false);

  // A second post-close read is bounded to these two fixture IDs only.
  // It does not bypass the journal for any real operator audit.
  const repairSnapshots = await firestore.getAll(
    jobs.doc(repeatedId), jobs.doc(missedId));
  const repaired = repairSnapshots.map(doc => ({
    id: doc.id,
    state: doc.get('state') as 'QUEUED' | 'PROCESSING',
    revision: doc.get('processingVersion') as string,
  }));
  const mutations = [
    { sequence: 1, id: repeatedId, before: baseline[0], after: after[0] },
    { sequence: 2, id: missedId, before: baseline[1], after: after[1] },
  ];
  const pages = observations.map(item => ({
    state: item.state, afterId: item.afterId,
    ids: item.ids, hasMore: item.hasMore,
    nextCursor: item.nextCursor,
  }));
  // This test only exercises two of the seven states; supply explicit
  // empty, complete fixture lanes for the others, never production evidence.
  const allStates = [
    'QUEUED', 'SUBMITTING', 'PROCESSING', 'FAILED',
    'CANCEL_REQUESTED', 'SUCCEEDED', 'CANCELLED',
  ] as const;
  for (const state of allStates) {
    if (state !== 'QUEUED' && state !== 'PROCESSING') {
      pages.push({
        state, afterId: null, ids: [], hasMore: false, nextCursor: null,
      });
    }
  }
  // Real fixture page queries may have more documents outside this prefix.
  // Hence a bounded prefix alone must NOT be treated as a closed epoch proof.
  const verdict = reconcileVideoTriageClosedEpochFixture(
    baseline, after, pages, {
      source: 'EMULATOR_TEST_WRITER_FENCE',
      openedAt: at, closedAt: Date.now(),
      allFixtureWritersFenced: true, mutationCount: mutations.length,
    }, mutations, repaired);
  assert.equal(verdict.globalCoverageVerified, false);
  assert.equal(verdict.productionCostVerified, false);
  const incompleteLane = observations.some(item => item.hasMore);
  assert.equal(verdict.status, incompleteLane ?
    'INCONCLUSIVE' : 'FIXTURE_RECONCILED');
});

test('c18m records SDK call attempts and returned docs without claiming billing', async () => {
  const at = Date.now() - 1_000;
  const key = randomBytes(32);
  const approval = {
    approved: true as const, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT' as const,
    expectedProjectId: PROJECT_ID, expectedDatabaseId: '(default)' as const,
  };
  const created = createVideoTriageAuditSession(approval, {
    pageSize: 1, maxPages: 1, maxDocuments: 1,
    maxDocumentReads: 3, maxDurationMs: 120_000, maxFailures: 0,
  }, key, at);
  const context = { ...approval, expectedSessionId: created.sessionId };
  const events: VideoTriageAuditSdkEvent[] = [];
  const observe = (event: VideoTriageAuditSdkEvent) => events.push(event);
  const pages: VideoTriagePageReadObservation[] = [];
  await registerSignedVideoTriageAuditJournal(
    firestore, app, context, created.checkpoint, key, observe);
  const claim = await claimDurableVideoTriageAuditPage(
    firestore, app, context, created.checkpoint, key,
    randomUUID(), Date.now(), observe);
  assert.equal(claim.kind, 'CLAIMED');
  if (claim.kind !== 'CLAIMED') return;
  const page = await auditVideoTriageConcurrentPage(firestore, {
    state: claim.claim.lane as 'QUEUED',
    afterId: claim.claim.afterId, limit: 1,
    now: claim.claim.evaluationAt,
  }, observed => pages.push(observed));
  assert.equal(pages.length, 1);
  const confirmed = await settleDurableVideoTriageAuditPage(
    firestore, app, context, key, claim.claim, page, Date.now(), observe);
  assert.equal(confirmed.kind, 'APPLIED');
  const persisted = await readDurableVideoTriageAuditJournal(
    firestore, app, context, key, observe);
  const recovery = await recoverDurableVideoTriageAuditAttempt(
    firestore, app, context, key, claim.claim, observe);
  assert.equal(recovery.kind, 'APPLIED');
  const count = (event: VideoTriageAuditSdkEvent) =>
    events.filter(value => value === event).length;
  assert.ok(count('TX_ATTEMPT') >= 3);
  assert.equal(count('TX_GET'), count('TX_ATTEMPT'));
  assert.ok(count('TX_WRITE') >= 3);
  assert.equal(count('DIRECT_GET'), 2);
  const measured = validateVideoTriageAuditSession(
    persisted.checkpoint, key, context, persisted.journalReservedOperations, {
      source: 'EMULATOR_INSTRUMENTATION',
      jobQueryReads: pages[0].queryDocumentsReturned,
      jobPointReads: pages[0].pointDocumentsRequested,
      journalDocumentReads: count('TX_GET') + count('DIRECT_GET'),
      journalDocumentWrites: count('TX_WRITE'),
      transactionRetries: count('TX_ATTEMPT') - 3,
      recoveryReads: 1,
      statusReads: 1,
      registrationOperations: 2,
    });
  assert.equal(measured.consistency, 'CONSISTENT');
  assert.equal(measured.cost, 'MEASUREMENT_REVIEW');
  assert.equal(measured.productionCostVerified, false);
  assert.equal(measured.globalOrderingEnabled, false);
});


test('c18p outbox shares a transaction and rejects ambiguous duplicate event IDs', async () => {
  const ref = jobs.doc('c18p-' + randomUUID());
  await ref.create({ ...fixture('PENDING'), state: 'PROCESSING' });
  const eventId = randomUUID();
  const eventRef = firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(eventId);
  const stage = async (failAfterWrite: boolean): Promise<void> =>
    firestore.runTransaction(async transaction => {
      const before = await transaction.get(ref);
      assert.equal(before.exists, true);
      stageVideoTriageMutationInTransaction(firestore, transaction, ref, {
        eventId, source: 'ACCOUNT_DELETION_PAGE',
        kind: 'CANCEL_REQUESTED', before,
        afterState: 'CANCEL_REQUESTED',
      });
      transaction.update(ref, { state: 'CANCEL_REQUESTED' });
      if (failAfterWrite) throw new Error('SIMULATED_ABORT');
    }, { maxAttempts: 1 });

  await assert.rejects(stage(true), /SIMULATED_ABORT/);
  assert.equal((await ref.get()).get('state'), 'PROCESSING');
  assert.equal((await eventRef.get()).exists, false);

  await stage(false);
  const [job, event] = await Promise.all([ref.get(), eventRef.get()]);
  assert.equal(job.get('state'), 'CANCEL_REQUESTED');
  assert.equal(event.exists, true);
  assert.equal(event.get('kind'), 'CANCEL_REQUESTED');
  assert.equal(event.get('previousState'), 'PROCESSING');
  assert.equal(event.get('nextState'), 'CANCEL_REQUESTED');
  assert.equal(event.get('scope'), 'PARTIAL_WRITER_COVERAGE');
  assert.equal(event.get('globallySequenced'), false);
  const hashed = createHash('sha256').update(ref.path).digest('hex');
  assert.equal(event.get('jobKeySha256'), hashed);
  assert.ok(!JSON.stringify(event.data()).includes(ref.id));

  await assert.rejects(stage(false));
  assert.equal((await ref.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await eventRef.get()).get('jobKeySha256'), hashed);
  const same = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hashed).get();
  assert.equal(same.size, 1);
});

test('c18p deletion tombstones are not written for a missing job', async () => {
  const ref = jobs.doc('c18p-absent-' + randomUUID());
  const eventId = randomUUID();
  await firestore.runTransaction(async transaction => {
    const before = await transaction.get(ref);
    if (!before.exists) return;
    stageVideoTriageMutationInTransaction(firestore, transaction, ref, {
      eventId, source: 'ACCOUNT_DELETION_PAGE', kind: 'DELETE',
      before, afterState: null,
    });
    transaction.delete(ref);
  });
  const event = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(eventId).get();
  assert.equal(event.exists, false);
});


test('c18q queue creation event is atomic, idempotent and rejects existing jobs', async () => {
  const jobRef = jobs.doc('c18q-create-' + randomUUID());
  const job = buildQueuedVideoProcessingJob({
    ownerUid: 'c18q-emulator-owner', videoId: 'v-' + randomUUID(),
    sourceStoragePath: 'users/c18q-emulator-owner/uploads/videos/fixture.mp4',
    sourcePosterStoragePath: null, sourceMimeType: 'video/mp4',
    sourceSizeBytes: 20000, sourceDurationMs: 10000, now,
  });
  const eventId = randomUUID();
  const eventRef = firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(eventId);
  const create = async (abort = false) =>
    firestore.runTransaction(async tx => {
      const before = await tx.get(jobRef);
      if (before.exists) return false;
      stageVideoTriageCreatedJobInTransaction(
        firestore, tx, jobRef, before, eventId, job.processingVersion);
      tx.create(jobRef, withAdminTriageProjection(jobRef.id, null, job, now));
      if (abort) throw new Error('SIMULATED_QUEUE_ROLLBACK');
      return true;
    }, { maxAttempts: 1 });
  await assert.rejects(create(true), /SIMULATED_QUEUE_ROLLBACK/);
  assert.equal((await eventRef.get()).exists, false);
  assert.equal((await jobRef.get()).exists, false);
  assert.equal(await create(), true);
  assert.equal((await jobRef.get()).get('state'), 'QUEUED');
  const recorded = await eventRef.get();
  assert.equal(recorded.get('source'), 'QUEUE_CREATION');
  assert.equal(recorded.get('kind'), 'CREATE');
  assert.equal(recorded.get('previousState'), null);
  assert.equal(recorded.get('nextState'), 'QUEUED');
  assert.equal(recorded.get('processingVersion'), job.processingVersion);
  assert.equal(recorded.get('globalCoverageVerified'), false);
  assert.equal(await create(), false);
  const hash = createHash('sha256').update(jobRef.path).digest('hex');
  const events = await firestore
    .collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 1);
});

test('c18q state transition event rejects forged same-state and missing jobs', async () => {
  const jobRef = jobs.doc('c18q-transition-' + randomUUID());
  const before = { ...fixture('PENDING'), state: 'SUBMITTING' as const };
  await jobRef.create(before);
  const snapshot = await jobRef.get();
  await assert.rejects(firestore.runTransaction(async tx => {
    stageVideoTriageMutationInTransaction(firestore, tx, jobRef, {
      eventId: randomUUID(), source: 'SUBMISSION_CONFIRMATION',
      kind: 'STATE_TRANSITION', before: snapshot, afterState: 'SUBMITTING',
    });
  }), /Invalid video job mutation outbox intent/);
  const eventId = randomUUID();
  await firestore.runTransaction(async tx => {
    const current = await tx.get(jobRef);
    stageVideoTriageMutationInTransaction(firestore, tx, jobRef, {
      eventId, source: 'SUBMISSION_CONFIRMATION',
      kind: 'STATE_TRANSITION', before: current,
      afterState: 'PROCESSING',
    });
    tx.update(jobRef, { state: 'PROCESSING' });
  });
  const event = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(eventId).get();
  assert.equal(event.get('previousState'), 'SUBMITTING');
  assert.equal(event.get('nextState'), 'PROCESSING');
  assert.equal(event.get('source'), 'SUBMISSION_CONFIRMATION');
  assert.equal(event.get('scope'), 'PARTIAL_WRITER_COVERAGE');
  assert.equal((await jobRef.get()).get('state'), 'PROCESSING');
});


test('c18r administrative retry writes one version replacement with both versions', async () => {
  const jobRef = jobs.doc('c18r-retry-' + randomUUID());
  const original = { ...fixture('FAILED'), state: 'FAILED' as const };
  const nextVersion = randomUUID();
  await jobRef.create(original);
  const eventId = randomUUID();
  const eventRef = firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(eventId);
  const replace = async (abort: boolean) => firestore.runTransaction(
    async transaction => {
      const before = await transaction.get(jobRef);
      stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
        eventId, source: 'ADMIN_RECOVERY', kind: 'VERSION_REPLACED',
        before, afterState: 'QUEUED',
        nextProcessingVersion: nextVersion,
      });
      transaction.update(jobRef, { state: 'QUEUED',
        processingVersion: nextVersion });
      if (abort) throw new Error('SIMULATED_ADMIN_RETRY_ABORT');
    }, { maxAttempts: 1 });
  await assert.rejects(replace(true), /SIMULATED_ADMIN_RETRY_ABORT/);
  assert.equal((await jobRef.get()).get('state'), 'FAILED');
  assert.equal((await eventRef.get()).exists, false);
  await replace(false);
  const event = await eventRef.get();
  assert.equal((await jobRef.get()).get('processingVersion'), nextVersion);
  assert.equal(event.get('source'), 'ADMIN_RECOVERY');
  assert.equal(event.get('kind'), 'VERSION_REPLACED');
  assert.equal(event.get('processingVersion'), original.processingVersion);
  assert.equal(event.get('nextProcessingVersion'), nextVersion);
  assert.equal(event.get('globalCoverageVerified'), false);
  await assert.rejects(replace(false));
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==',
      createHash('sha256').update(jobRef.path).digest('hex')).get();
  assert.equal(events.size, 1);
});

test('c18r polling metadata updates do not create extra state-transition events', async () => {
  const jobRef = jobs.doc('c18r-poll-' + randomUUID());
  const original = fixture('RUNNING');
  await jobRef.create(original);
  const claimed = await claimProcessingJob(
    firestore, jobRef, now, parseJob);
  assert.ok(claimed);
  assert.equal(await recordProviderPollErrorIfCurrent(
    firestore, jobRef, claimed, parseJob, {
      code: 'POLL_TIMEOUT', message: 'Transient provider error',
      retryable: true,
    }, now + 1), true);
  const hash = createHash('sha256').update(jobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 0);
  assert.equal((await jobRef.get()).get('state'), 'PROCESSING');
});

test('c18r version replacement rejects unchanged, malformed or untrusted attempts', async () => {
  const jobRef = jobs.doc('c18r-fence-' + randomUUID());
  const original = fixture('FAILED');
  await jobRef.create({ ...original, state: 'FAILED' });
  const old = await jobRef.get();
  const wrongVersions = [
    original.processingVersion, '', 'bad space',
  ];
  for (const version of wrongVersions) {
    await assert.rejects(firestore.runTransaction(async tx => {
      stageVideoTriageMutationInTransaction(firestore, tx, jobRef, {
        eventId: randomUUID(), source: 'ADMIN_RECOVERY',
        kind: 'VERSION_REPLACED', before: old,
        afterState: 'QUEUED', nextProcessingVersion: version,
      });
    }), /Invalid video job mutation outbox intent/);
  }
  await assert.rejects(firestore.runTransaction(async tx => {
    stageVideoTriageMutationInTransaction(firestore, tx, jobRef, {
      eventId: randomUUID(), source: 'SUBMISSION_RECOVERY',
      kind: 'VERSION_REPLACED', before: old,
      afterState: 'QUEUED', nextProcessingVersion: randomUUID(),
    });
  }), /Invalid video job mutation outbox intent/);
  assert.equal((await jobRef.get()).get('state'), 'FAILED');
});

test('c18u selected emulator terminal events are atomic and omit stale attempts', async () => {
  for (const target of ['FAILED', 'SUCCEEDED'] as const) {
    const job: VideoProcessingJob = { ...fixture('c18u'), state: 'QUEUED' };
    const ref = jobs.doc(randomUUID());
    const id = randomUUID();
    await ref.create(job);
    await firestore.runTransaction(async tx => {
      const before = await tx.get(ref);
      if (!before.exists || before.get('state') !== 'QUEUED' ||
          before.get('processingVersion') !== job.processingVersion) return;
      stageVideoTriageMutationInTransaction(firestore, tx, ref, {
        eventId: id, source: 'EMULATOR_PROCESSING',
        kind: 'STATE_TRANSITION', before, afterState: target,
      });
      tx.update(ref, { state: target });
    });
    const [stored, event] = await Promise.all([
      ref.get(), firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
        .doc(id).get(),
    ]);
    assert.equal(stored.get('state'), target);
    assert.equal(event.get('nextState'), target);
    assert.equal(event.get('source'), 'EMULATOR_PROCESSING');

    const staleId = randomUUID();
    await firestore.runTransaction(async tx => {
      const before = await tx.get(ref);
      if (before.get('state') !== 'QUEUED' ||
          before.get('processingVersion') !== job.processingVersion) return;
      stageVideoTriageMutationInTransaction(firestore, tx, ref, {
        eventId: staleId, source: 'EMULATOR_PROCESSING',
        kind: 'STATE_TRANSITION', before, afterState: target,
      });
    });
    assert.equal((await firestore.collection(
      VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION).doc(staleId).get()).exists, false);

    const abortedId = randomUUID();
    await assert.rejects(firestore.runTransaction(async tx => {
      const before = await tx.get(ref);
      stageVideoTriageMutationInTransaction(firestore, tx, ref, {
        eventId: abortedId, source: 'EMULATOR_PROCESSING',
        kind: 'STATE_TRANSITION', before, afterState: 'QUEUED',
      });
      tx.update(ref, { state: 'QUEUED' });
      throw new Error('forced transaction abort');
    }), /forced transaction abort/);
    assert.equal((await firestore.collection(
      VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION).doc(abortedId).get()).exists, false);
    assert.equal((await ref.get()).get('state'), target);
  }
});

function c18vFixture() {
  const ownerUid = 'profile-del-' + randomUUID();
  const videoId = 'v-' + randomUUID();
  const privateVideoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = firestore.doc(
    `users/${ownerUid}/video_publications/${videoId}`);
  const publicVideoRef = firestore.doc(
    `public_profiles/${ownerUid}/public_videos/${videoId}`);
  const processingJobRef = jobs.doc(ownerUid + '_' + videoId);
  const identityRef = firestore.doc(
    `users/${ownerUid}/video_identity_guards/${videoId}`);
  const deletionJobRef = firestore.collection('media_video_deletion_jobs')
    .doc(ownerUid + '_' + videoId);
  return {
    ownerUid, videoId, privateVideoRef, publicationRef, publicVideoRef,
    processingJobRef, identityRef, deletionJobRef,
    command: (eventId = randomUUID()) => ({
      ownerUid, videoId, now, eventId, privateVideoRef, publicationRef,
      publicVideoRef, processingJobRef, identityRef, deletionJobRef,
      buildJob: (snapshots: {
        privateVideo: { get(field: string): unknown };
        publication: { get(field: string): unknown };
        processingJob: { get(field: string): unknown };
      }, pending: boolean) => ({
        ownerUid, videoId, processingCleanupPending: pending,
        privateVideoStoragePath: snapshots.privateVideo.get('path') ?? null,
        publishedVideoStoragePath:
          snapshots.publication.get('publishedStoragePath') ?? null,
        processedOutputPrefix:
          snapshots.processingJob.get('outputPrefix') ?? null,
        attempts: 0, lastError: null, createdAt: now, updatedAt: now,
      }),
    }),
  };
}

test('c18v deletion atomically records cancellation, tombstone, queue and unpublication', async () => {
  const f = c18vFixture();
  const job = { ...fixture('c18v'), ownerUid: f.ownerUid, videoId: f.videoId,
    state: 'PROCESSING' };
  await Promise.all([
    f.privateVideoRef.set({ path: 'source-one' }),
    f.publicationRef.set({ isPublished: true, publishedStoragePath: 'published-one' }),
    f.publicVideoRef.set({ state: 'VISIBLE' }),
    f.processingJobRef.set(job),
  ]);
  const eventId = randomUUID();
  assert.deepEqual(await commitProfileVideoDeletionRequest(
    firestore, f.command(eventId)), {
    kind: 'CREATED', processingCleanupPending: true,
  });
  const [queue, guard, currentJob, publication, publicVideo, event] =
    await Promise.all([
      f.deletionJobRef.get(), f.identityRef.get(), f.processingJobRef.get(),
      f.publicationRef.get(), f.publicVideoRef.get(),
      firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
        .doc(eventId).get(),
    ]);
  assert.equal(queue.get('state'), 'retryable');
  assert.equal(queue.get('privateVideoStoragePath'), 'source-one');
  assert.equal(queue.get('publishedVideoStoragePath'), 'published-one');
  assert.equal(queue.get('processingCleanupPending'), true);
  assert.equal(guard.get('state'), 'RETIRED');
  assert.equal(currentJob.get('state'), 'CANCEL_REQUESTED');
  assert.equal(publication.exists, false);
  assert.equal(publicVideo.exists, false);
  assert.equal(event.get('source'), 'PROFILE_VIDEO_DELETION');
  assert.equal(event.get('kind'), 'CANCEL_REQUESTED');
  assert.equal(event.get('processingVersion'), job.processingVersion);
  assert.equal(event.get('previousState'), 'PROCESSING');
  assert.equal(event.get('nextState'), 'CANCEL_REQUESTED');
});

test('c18v duplicate concurrent deletions preserve the first job and single event', async () => {
  const f = c18vFixture();
  const job = { ...fixture('c18v-dupe'), ownerUid: f.ownerUid,
    videoId: f.videoId, state: 'QUEUED' };
  await f.processingJobRef.create(job);
  const firstId = randomUUID();
  const secondId = randomUUID();
  const [first, second] = await Promise.all([
    commitProfileVideoDeletionRequest(firestore, f.command(firstId)),
    commitProfileVideoDeletionRequest(firestore, f.command(secondId)),
  ]);
  assert.deepEqual([first.kind, second.kind].sort(), ['CREATED', 'EXISTING']);
  const firstEvent = await firestore.collection(
    VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION).doc(firstId).get();
  const secondEvent = await firestore.collection(
    VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION).doc(secondId).get();
  assert.equal(Number(firstEvent.exists) + Number(secondEvent.exists), 1);
  assert.equal((await f.processingJobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await f.identityRef.get()).get('state'), 'RETIRED');
  assert.equal((await f.deletionJobRef.get()).get('leaseToken'), null);
  await assert.rejects(commitPrivateVideoRegistrationIfUnused(firestore, {
    ownerUid: f.ownerUid, videoId: f.videoId,
    videoRef: f.privateVideoRef, publicationRef: f.publicationRef,
    videoDocument: { path: 'resurrected' },
    publicationDocument: { isPublished: false }, now,
  }), VideoIdentityUnavailableError);
});

test('c18v terminal cancellation and missing job do not invent events', async () => {
  for (const state of ['CANCEL_REQUESTED', 'CANCELLED', 'MISSING'] as const) {
    const f = c18vFixture();
    if (state !== 'MISSING') {
      await f.processingJobRef.create({ ...fixture('c18v-existing'),
        ownerUid: f.ownerUid, videoId: f.videoId, state });
    }
    const eventId = randomUUID();
    const result = await commitProfileVideoDeletionRequest(
      firestore, f.command(eventId));
    assert.equal(result.kind, 'CREATED');
    assert.equal((await firestore.collection(
      VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION).doc(eventId).get()).exists, false);
    assert.equal((await f.identityRef.get()).get('state'), 'RETIRED');
    if (state !== 'MISSING') {
      assert.equal((await f.processingJobRef.get()).get('state'), state);
    }
  }
});

test('c18v blocked publication, identity conflict and aborted callback leave no writes', async () => {
  for (const invalid of ['FLAGGED', 'GUARD', 'ABORTED'] as const) {
    const f = c18vFixture();
    const eventId = randomUUID();
    await f.publicationRef.create({
      isPublished: true, moderationStatus: invalid === 'FLAGGED'
        ? 'FLAGGED' : 'APPROVED',
    });
    if (invalid === 'GUARD') {
      await f.identityRef.create({
        state: 'RETIRED', ownerUid: 'other', videoId: f.videoId,
      });
    }
    const command = f.command(eventId);
    if (invalid === 'ABORTED') {
      command.buildJob = () => { throw new Error('injected rollback'); };
    }
    await assert.rejects(commitProfileVideoDeletionRequest(
      firestore, command));
    assert.equal((await f.deletionJobRef.get()).exists, false);
    assert.equal((await f.publicationRef.get()).exists, true);
    assert.equal((await f.publicVideoRef.get()).exists, false);
    assert.equal((await firestore.collection(
      VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION).doc(eventId).get()).exists, false);
    if (invalid !== 'GUARD') assert.equal(
      (await f.identityRef.get()).exists, false);
  }
});

test('c18v fresh registration and deletion remain generation fenced', async () => {
  const f = c18vFixture();
  const create = commitPrivateVideoRegistrationIfUnused(firestore, {
    ownerUid: f.ownerUid, videoId: f.videoId,
    videoRef: f.privateVideoRef, publicationRef: f.publicationRef,
    videoDocument: { ownerUid: f.ownerUid, path: 'new-source' },
    publicationDocument: { isPublished: false }, now,
  });
  const deleting = commitProfileVideoDeletionRequest(
    firestore, f.command());
  await Promise.allSettled([create, deleting]);
  const guard = await f.identityRef.get();
  const queue = await f.deletionJobRef.get();
  if (queue.exists) {
    assert.equal(guard.get('state'), 'RETIRED');
    assert.equal((await f.publicationRef.get()).exists, false);
  } else {
    assert.equal(guard.get('state'), 'REGISTERED');
  }
});


test('c18x-A concurrent scheduler claims and profile deletion cannot resurrect a job', async () => {
  const f = c18vFixture();
  const initial = {
    ...fixture('c18x-scheduler'), ownerUid: f.ownerUid, videoId: f.videoId,
    state: 'PROCESSING' as const,
  };
  await Promise.all([
    f.processingJobRef.create(initial),
    f.privateVideoRef.create({ path: initial.sourceStoragePath }),
    f.publicationRef.create({ isPublished: true, moderationStatus: 'APPROVED' }),
  ]);
  const eventId = randomUUID();
  const [a, b, deletion] = await Promise.all([
    claimProcessingJob(firestore, f.processingJobRef, now, parseJob),
    claimProcessingJob(firestore, f.processingJobRef, now, parseJob),
    commitProfileVideoDeletionRequest(firestore, f.command(eventId)),
  ]);
  assert.equal(deletion.kind, 'CREATED');
  assert.ok(Number(!!a) + Number(!!b) <= 1);
  assert.equal((await f.processingJobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await f.identityRef.get()).get('state'), 'RETIRED');
  assert.equal((await f.deletionJobRef.get()).get('state'), 'retryable');
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].id, eventId);
  assert.equal(events.docs[0].get('kind'), 'CANCEL_REQUESTED');
  assert.equal(await claimProcessingJob(
    firestore, f.processingJobRef, now + 600_000, parseJob), null);
});

test('c18x-A racing terminal result and profile deletion end in cancellation', async () => {
  const f = c18vFixture();
  const original = {
    ...fixture('c18x-terminal'), ownerUid: f.ownerUid, videoId: f.videoId,
    sourceGeneration: '9001', state: 'PROCESSING' as const,
  };
  await Promise.all([
    f.processingJobRef.create(original),
    f.privateVideoRef.create({
      path: original.sourceStoragePath, sourceGeneration: '9001',
      status: 'processing',
    }),
    f.publicationRef.create({ isPublished: true, moderationStatus: 'APPROVED' }),
    f.publicVideoRef.create({ status: 'visible' }),
  ]);
  const terminalCommand = {
    state: 'SUCCEEDED' as const, now: now + 2_000, normalizeJob: parseJob,
    sourceMatches: (video: Record<string, unknown>) =>
      video['path'] === original.sourceStoragePath &&
      video['sourceGeneration'] === original.sourceGeneration,
    jobPatch: { providerState: 'SUCCEEDED', completedAt: now + 2_000 },
    videoPatch: { status: 'ready', processingStage: 'ready' },
  };
  const deletionId = randomUUID();
  const [terminal, deletion] = await Promise.all([
    commitTerminalVideoProcessingIfCurrent(
      firestore, f.processingJobRef, original, terminalCommand),
    commitProfileVideoDeletionRequest(firestore, f.command(deletionId)),
  ]);
  assert.equal(deletion.kind, 'CREATED');
  assert.ok(terminal === 'APPLIED' || terminal === 'REPLACED');
  assert.equal((await f.processingJobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await f.publicationRef.get()).exists, false);
  assert.equal((await f.publicVideoRef.get()).exists, false);
  assert.equal((await f.identityRef.get()).get('state'), 'RETIRED');
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.docs.filter(e => e.get('kind') === 'CANCEL_REQUESTED').length, 1);
  assert.equal(events.docs.filter(e => e.get('nextState') === 'SUCCEEDED').length,
    terminal === 'APPLIED' ? 1 : 0);
  assert.equal(events.size, terminal === 'APPLIED' ? 2 : 1);
  assert.equal(await commitTerminalVideoProcessingIfCurrent(
    firestore, f.processingJobRef, original, terminalCommand), 'REPLACED');
  assert.equal((await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get()).size, events.size);
});

test('c18x-A newer processingVersion fences concurrent obsolete terminal callbacks', async () => {
  const jobRef = jobs.doc('c18x-replaced-' + randomUUID());
  const old = { ...fixture('c18x-old'), sourceGeneration: '9001' };
  const videoRef = firestore.doc(
    'users/' + old.ownerUid + '/videos/' + old.videoId);
  await Promise.all([
    jobRef.create(old),
    videoRef.create({
      path: old.sourceStoragePath, sourceGeneration: '9001', status: 'processing',
    }),
  ]);
  const nextVersion = randomUUID();
  const replacementId = randomUUID();
  await firestore.runTransaction(async transaction => {
    const before = await transaction.get(jobRef);
    stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
      eventId: replacementId, source: 'ADMIN_RECOVERY',
      kind: 'VERSION_REPLACED', before, afterState: 'QUEUED',
      nextProcessingVersion: nextVersion,
    });
    transaction.set(jobRef, {
      ...old, state: 'QUEUED', processingVersion: nextVersion,
      nextAttemptAt: now + 90_000,
    });
  });
  const command = {
    state: 'FAILED' as const, now: now + 1_000, normalizeJob: parseJob,
    sourceMatches: (video: Record<string, unknown>) =>
      video['path'] === old.sourceStoragePath,
    jobPatch: { completedAt: now + 1_000 },
    videoPatch: { status: 'failed' },
  };
  const results = await Promise.all([
    commitTerminalVideoProcessingIfCurrent(firestore, jobRef, old, command),
    commitTerminalVideoProcessingIfCurrent(firestore, jobRef, old, command),
  ]);
  assert.deepEqual(results, ['REPLACED', 'REPLACED']);
  const after = await jobRef.get();
  assert.equal(after.get('state'), 'QUEUED');
  assert.equal(after.get('processingVersion'), nextVersion);
  assert.equal((await videoRef.get()).get('status'), 'processing');
  const hash = createHash('sha256').update(jobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].id, replacementId);
  assert.equal(events.docs[0].get('kind'), 'VERSION_REPLACED');
  assert.equal(events.docs[0].get('nextProcessingVersion'), nextVersion);
});

test('c18x-A rollback and three competing retries emit only one event', async () => {
  const jobRef = jobs.doc('c18x-rollback-' + randomUUID());
  await jobRef.create(fixture('c18x-rollback'));
  const abortedId = randomUUID();
  const abortedRef = firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(abortedId);
  await assert.rejects(firestore.runTransaction(async transaction => {
    const before = await transaction.get(jobRef);
    stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
      eventId: abortedId, source: 'SUBMISSION_RECOVERY',
      kind: 'CANCEL_REQUESTED', before, afterState: 'CANCEL_REQUESTED',
    });
    transaction.update(jobRef, { state: 'CANCEL_REQUESTED' });
    throw new Error('c18x-forced-abort');
  }, { maxAttempts: 1 }), /c18x-forced-abort/);
  assert.equal((await abortedRef.get()).exists, false);
  assert.equal((await jobRef.get()).get('state'), 'PROCESSING');
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const results = await Promise.all(ids.map(eventId =>
    firestore.runTransaction(async transaction => {
      const before = await transaction.get(jobRef);
      if (!before.exists || before.get('state') !== 'PROCESSING') return false;
      stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
        eventId, source: 'SUBMISSION_RECOVERY', kind: 'CANCEL_REQUESTED',
        before, afterState: 'CANCEL_REQUESTED',
      });
      transaction.update(jobRef, { state: 'CANCEL_REQUESTED' });
      return true;
    })
  ));
  assert.equal(results.filter(Boolean).length, 1);
  const hash = createHash('sha256').update(jobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 1);
  assert.ok(ids.some(id => id === events.docs[0].id));
  assert.equal((await abortedRef.get()).exists, false);
  assert.equal((await jobRef.get()).get('state'), 'CANCEL_REQUESTED');
});


function c18xB1Retry(f: ReturnType<typeof c18vFixture>) {
  return {
    command: {
      adminUid: 'c18xb1-admin',
      ownerUid: f.ownerUid,
      videoId: f.videoId,
      operationId: 'retry-' + randomUUID(),
      reason: 'Controlled emulator retry',
    },
    ports: {
      firestore,
      // No Cloud Storage, metadata request, provider call or Function export.
      prepareRetry: async (ownerUid: string, videoId: string) =>
        buildQueuedVideoProcessingJob({
          ownerUid, videoId,
          sourceStoragePath: 'users/' + ownerUid +
            '/uploads/videos/' + videoId + '-source.mp4',
          sourcePosterStoragePath: null,
          sourceMimeType: 'video/mp4',
          sourceSizeBytes: 10_000,
          sourceDurationMs: 10_000,
          now,
        }),
    },
  };
}

async function c18xB1SeedFailed(f: ReturnType<typeof c18vFixture>): Promise<void> {
  const original = {
    ...fixture('c18xb1-failed'), ownerUid: f.ownerUid, videoId: f.videoId,
    state: 'FAILED' as const,
    sourceStoragePath: 'users/' + f.ownerUid +
      '/uploads/videos/' + f.videoId + '-source.mp4',
  };
  await Promise.all([
    f.processingJobRef.create(original),
    f.privateVideoRef.create({ ownerUid: f.ownerUid, path: original.sourceStoragePath,
      status: 'failed' }),
    f.publicationRef.create({ isPublished: true, moderationStatus: 'APPROVED' }),
  ]);
}

test('c18x-B1 retry-first then deletion leaves no active processing version', async () => {
  const f = c18vFixture();
  await c18xB1SeedFailed(f);
  const input = c18xB1Retry(f);
  const retry = await retryFailedJob(input.command, input.ports);
  assert.equal(retry.alreadyApplied, false);
  assert.equal(retry.nextState, 'QUEUED');
  const replacedVersion = (await f.processingJobRef.get()).get('processingVersion');
  const deletionId = randomUUID();
  assert.equal((await commitProfileVideoDeletionRequest(
    firestore, f.command(deletionId))).kind, 'CREATED');
  const actual = await f.processingJobRef.get();
  assert.equal(actual.get('state'), 'CANCEL_REQUESTED');
  assert.equal(actual.get('processingVersion'), replacedVersion);
  assert.equal((await f.identityRef.get()).get('state'), 'RETIRED');
  assert.equal((await f.publicationRef.get()).exists, false);
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 2);
  assert.equal(events.docs.filter(d => d.get('kind') === 'VERSION_REPLACED').length, 1);
  assert.equal(events.docs.filter(d => d.get('kind') === 'CANCEL_REQUESTED').length, 1);
  const again = await assert.rejects(retryFailedJob(input.command, input.ports));
  assert.equal(again, undefined);
  assert.equal((await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get()).size, 2);
});

test('c18x-B1 actual retry racing profile deletion cannot revive retired video', async () => {
  const f = c18vFixture();
  await c18xB1SeedFailed(f);
  const input = c18xB1Retry(f);
  const deletionId = randomUUID();
  const results = await Promise.allSettled([
    retryFailedJob(input.command, input.ports),
    commitProfileVideoDeletionRequest(firestore, f.command(deletionId)),
  ]);
  assert.equal(results[1].status, 'fulfilled');
  const retryWon = results[0].status === 'fulfilled';
  if (results[0].status === 'fulfilled') {
    assert.equal(results[0].value.nextState, 'QUEUED');
  } else {
    assert.equal(results[0].status, 'rejected');
  }
  assert.equal((await f.processingJobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await f.identityRef.get()).get('state'), 'RETIRED');
  assert.equal((await f.deletionJobRef.get()).get('state'), 'retryable');
  assert.equal((await f.publicationRef.get()).exists, false);
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.docs.filter(d => d.get('kind') === 'CANCEL_REQUESTED').length, 1);
  assert.equal(events.docs.filter(d => d.get('kind') === 'VERSION_REPLACED').length,
    retryWon ? 1 : 0);
  assert.equal(events.size, retryWon ? 2 : 1);
});

test('c18x-B1 legacy FAILED with pending deletion or retired guard cannot retry', async () => {
  for (const kind of ['DELETION_ONLY', 'RETIRED_ONLY'] as const) {
    const f = c18vFixture();
    await c18xB1SeedFailed(f);
    if (kind === 'DELETION_ONLY') {
      await f.deletionJobRef.create({
        ownerUid: f.ownerUid, videoId: f.videoId,
        state: 'retryable', nextAttemptAt: now,
      });
    } else {
      await f.identityRef.create({
        ownerUid: f.ownerUid, videoId: f.videoId, state: 'RETIRED',
      });
    }
    const before = await f.processingJobRef.get();
    const input = c18xB1Retry(f);
    await assert.rejects(retryFailedJob(input.command, input.ports),
      (error: unknown) => !!error && typeof error === 'object' &&
        'code' in error && error.code === 'failed-precondition');
    assert.equal((await f.processingJobRef.get()).get('processingVersion'),
      before.get('processingVersion'));
    assert.equal((await f.processingJobRef.get()).get('state'), 'FAILED');
    const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
    assert.equal((await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
      .where('jobKeySha256', '==', hash).get()).size, 0);
    assert.equal((await f.privateVideoRef.get()).get('status'), 'failed');
  }
});


test('c18x-B2 cancellation wins against stale, unconfirmed and provider rechecks', async () => {
  for (const action of [
    'RECHECK_STALE', 'RECHECK_UNCONFIRMED', 'RECHECK_PROVIDER',
  ] as const) {
    const f = c18vFixture();
    const initial = fixture('c18xb2-' + action);
    const state = action === 'RECHECK_STALE' ? 'QUEUED'
      : action === 'RECHECK_UNCONFIRMED' ? 'SUBMITTING' : 'PROCESSING';
    const job = {
      ...initial, ownerUid: f.ownerUid, videoId: f.videoId, state,
      updatedAt: Date.now() - 3 * 24 * 60 * 60_000,
      ...(action === 'RECHECK_UNCONFIRMED'
        ? { lastErrorCode: 'SUBMISSION_UNCONFIRMED', leaseUntil: null,
          externalJobName: null } : {}),
      ...(action === 'RECHECK_PROVIDER'
        ? { providerPollFailureVersion: initial.processingVersion,
          providerPollFailureCount: 4, providerPollReviewRequired: true } : {}),
    };
    await Promise.all([
      f.processingJobRef.create(job),
      f.privateVideoRef.create({ path: job.sourceStoragePath, status: 'processing' }),
    ]);
    const baseCommand = {
      adminUid: 'c18xb2-admin', ownerUid: f.ownerUid,
      videoId: f.videoId, expectedProcessingVersion: job.processingVersion,
      reason: 'Adversarial administrative cancellation',
    };
    const [cancel, recheck] = await Promise.allSettled([
      mutateExistingJob({
        ...baseCommand, action: 'CANCEL_ACTIVE', operationId: randomUUID(),
      }, { firestore }),
      mutateExistingJob({
        ...baseCommand, action, operationId: randomUUID(),
      }, { firestore }),
    ]);
    assert.equal(cancel.status, 'fulfilled', action);
    if (cancel.status === 'fulfilled') {
      assert.equal(cancel.value.nextState, 'CANCEL_REQUESTED', action);
    }
    assert.ok(recheck.status === 'fulfilled' || recheck.status === 'rejected');
    assert.equal((await f.processingJobRef.get()).get('state'),
      'CANCEL_REQUESTED', action);
    assert.equal((await f.privateVideoRef.get()).get('status'), 'failed', action);
    const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
    const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
      .where('jobKeySha256', '==', hash).get();
    assert.equal(events.size, 1, action);
    assert.equal(events.docs[0].get('source'), 'ADMIN_RECOVERY');
    assert.equal(events.docs[0].get('nextState'), 'CANCEL_REQUESTED');
    assert.equal(events.docs[0].get('previousState'), state);
  }
});

test('c18x-B2 stale admin version and operation collision never touch new retry', async () => {
  const f = c18vFixture();
  await c18xB1SeedFailed(f);
  const original = (await f.processingJobRef.get()).get('processingVersion') as string;
  const retry = c18xB1Retry(f);
  const applied = await retryFailedJob(retry.command, retry.ports);
  assert.equal(applied.nextState, 'QUEUED');
  const newVersion = (await f.processingJobRef.get()).get('processingVersion') as string;
  assert.notEqual(newVersion, original);
  const command = {
    adminUid: 'c18xb2-admin', ownerUid: f.ownerUid, videoId: f.videoId,
    reason: 'Adversarial old version cancellation',
    action: 'CANCEL_ACTIVE' as const, operationId: randomUUID(),
  };
  await assert.rejects(mutateExistingJob({
    ...command, expectedProcessingVersion: original,
  }, { firestore }), (e: unknown) =>
    !!e && typeof e === 'object' && 'code' in e &&
    e.code === 'failed-precondition');
  await assert.rejects(mutateExistingJob({
    ...command, expectedProcessingVersion: '',
  }, { firestore }));
  assert.equal((await f.processingJobRef.get()).get('state'), 'QUEUED');
  const cancel = await mutateExistingJob({
    ...command, expectedProcessingVersion: newVersion,
  }, { firestore });
  assert.equal(cancel.nextState, 'CANCEL_REQUESTED');
  const replay = await mutateExistingJob({
    ...command, expectedProcessingVersion: newVersion,
  }, { firestore });
  assert.equal(replay.alreadyApplied, true);
  await assert.rejects(mutateExistingJob({
    ...command, action: 'RECHECK_STALE',
    expectedProcessingVersion: newVersion,
  }, { firestore }));
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 2);
  assert.equal(events.docs.filter(e => e.get('kind') === 'VERSION_REPLACED').length, 1);
  assert.equal(events.docs.filter(e => e.get('nextState') === 'CANCEL_REQUESTED').length, 1);
});

test('c18x-B2 deletion and unconfirmed recheck cannot revive video or event', async () => {
  const f = c18vFixture();
  const base = fixture('c18xb2-deletion');
  const job = { ...base, ownerUid: f.ownerUid, videoId: f.videoId,
    state: 'SUBMITTING' as const, leaseUntil: null,
    lastErrorCode: 'SUBMISSION_UNCONFIRMED', externalJobName: null };
  await Promise.all([
    f.processingJobRef.create(job),
    f.privateVideoRef.create({ path: job.sourceStoragePath, status: 'processing' }),
    f.publicationRef.create({ isPublished: true, moderationStatus: 'APPROVED' }),
  ]);
  const admin = {
    adminUid: 'c18xb2-admin', ownerUid: f.ownerUid, videoId: f.videoId,
    action: 'RECHECK_UNCONFIRMED' as const,
    expectedProcessingVersion: job.processingVersion,
    operationId: randomUUID(), reason: 'Adversarial deletion check',
  };
  const eventId = randomUUID();
  const outcomes = await Promise.allSettled([
    mutateExistingJob(admin, { firestore }),
    commitProfileVideoDeletionRequest(firestore, f.command(eventId)),
  ]);
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal((await f.processingJobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await f.identityRef.get()).get('state'), 'RETIRED');
  assert.equal((await f.deletionJobRef.get()).get('state'), 'retryable');
  assert.equal((await f.publicationRef.get()).exists, false);
  await assert.rejects(mutateExistingJob({
    ...admin, operationId: randomUUID(),
  }, { firestore }));
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].id, eventId);
  assert.equal(events.docs[0].get('kind'), 'CANCEL_REQUESTED');
});


test('c18x-B3 pending account deletion prevents terminal publication and restores no state', async () => {
  const f = c18vFixture();
  const original = {
    ...fixture('c18xb3-terminal'), ownerUid: f.ownerUid,
    videoId: f.videoId, sourceGeneration: '9001',
  };
  const ownerRef = firestore.doc('users/' + f.ownerUid);
  await Promise.all([
    ownerRef.create({ accountStatus: 'pending_deletion' }),
    f.processingJobRef.create(original),
    f.privateVideoRef.create({
      path: original.sourceStoragePath, sourceGeneration: '9001',
      status: 'processing',
    }),
    f.publicationRef.create({ isPublished: false }),
  ]);
  const terminal = await commitTerminalVideoProcessingIfCurrent(
    firestore, f.processingJobRef, original, {
      state: 'SUCCEEDED', now: now + 1_000, normalizeJob: parseJob,
      sourceMatches: video =>
        video['path'] === original.sourceStoragePath &&
        video['sourceGeneration'] === '9001',
      jobPatch: { providerState: 'SUCCEEDED', completedAt: now + 1_000 },
      videoPatch: { status: 'ready', processedStoragePath: 'resurrected' },
    }
  );
  assert.equal(terminal, 'CANCEL_REQUESTED');
  assert.equal((await f.processingJobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await f.privateVideoRef.get()).get('status'), 'processing');
  assert.equal((await f.privateVideoRef.get()).get('processedStoragePath'), undefined);
  assert.equal((await f.publicationRef.get()).get('isPublished'), false);
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].get('kind'), 'CANCEL_REQUESTED');
  assert.equal(events.docs[0].get('source'), 'TERMINAL_COMMIT');
  assert.equal(events.docs[0].get('globalCoverageVerified'), false);
  assert.equal(await commitTerminalVideoProcessingIfCurrent(
    firestore, f.processingJobRef, original, {
      state: 'SUCCEEDED', now: now + 2_000, normalizeJob: parseJob,
      sourceMatches: () => true, jobPatch: {}, videoPatch: { status: 'ready' },
    }
  ), 'REPLACED');
  assert.equal((await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get()).size, 1);
});

test('c18x-B3 account deletion cancellation races terminal commit without orphan events', async () => {
  const f = c18vFixture();
  const job = { ...fixture('c18xb3-race'), ownerUid: f.ownerUid,
    videoId: f.videoId, sourceGeneration: '9001' };
  await Promise.all([
    firestore.doc('users/' + f.ownerUid).create({ accountStatus: 'pending_deletion' }),
    f.processingJobRef.create(job),
    f.privateVideoRef.create({
      path: job.sourceStoragePath, sourceGeneration: '9001', status: 'processing',
    }),
    f.publicationRef.create({ isPublished: false }),
  ]);
  const adapter = new FirestoreAccountDataDeletionOrchestratorAdapter();
  const [terminal, page] = await Promise.all([
    commitTerminalVideoProcessingIfCurrent(firestore, f.processingJobRef, job, {
      state: 'SUCCEEDED', now: now + 5_000, normalizeJob: parseJob,
      sourceMatches: video => video['path'] === job.sourceStoragePath,
      jobPatch: { providerState: 'SUCCEEDED' },
      videoPatch: { status: 'ready' },
    }),
    adapter.resolveOwnedVideoProcessingJobsPage(f.ownerUid, 10),
  ]);
  assert.ok(terminal === 'REPLACED' || terminal === 'CANCEL_REQUESTED');
  assert.equal(page.blocking, 1);
  assert.equal((await f.processingJobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await f.privateVideoRef.get()).get('status'), 'processing');
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].get('kind'), 'CANCEL_REQUESTED');
  assert.ok(['ACCOUNT_DELETION_PAGE', 'TERMINAL_COMMIT'].includes(
    events.docs[0].get('source') as string));
});

test('c18x-B3 administrative retry and rechecks reject an owner pending deletion', async () => {
  const failed = c18vFixture();
  await c18xB1SeedFailed(failed);
  await firestore.doc('users/' + failed.ownerUid)
    .create({ accountStatus: 'pending_deletion' });
  const input = c18xB1Retry(failed);
  await assert.rejects(retryFailedJob(input.command, input.ports),
    (err: unknown) => !!err && typeof err === 'object' &&
      'code' in err && err.code === 'failed-precondition');
  assert.equal((await failed.processingJobRef.get()).get('state'), 'FAILED');
  const hashFailed = createHash('sha256')
    .update(failed.processingJobRef.path).digest('hex');
  assert.equal((await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hashFailed).get()).size, 0);

  const active = c18vFixture();
  const job = { ...fixture('c18xb3-admin'), ownerUid: active.ownerUid,
    videoId: active.videoId, state: 'QUEUED' as const };
  await Promise.all([
    firestore.doc('users/' + active.ownerUid).create({ accountStatus: 'deleted' }),
    active.processingJobRef.create(job),
    active.privateVideoRef.create({ path: job.sourceStoragePath }),
  ]);
  for (const action of ['RECHECK_STALE', 'CANCEL_ACTIVE'] as const) {
    await assert.rejects(mutateExistingJob({
      adminUid: 'c18xb3-admin', ownerUid: active.ownerUid,
      videoId: active.videoId, action, operationId: randomUUID(),
      expectedProcessingVersion: job.processingVersion,
      reason: 'Account deletion adversarial test',
    }, { firestore }), (err: unknown) => !!err && typeof err === 'object' &&
      'code' in err && err.code === 'failed-precondition');
  }
  assert.equal((await active.processingJobRef.get()).get('state'), 'QUEUED');
  const hash = createHash('sha256').update(active.processingJobRef.path).digest('hex');
  assert.equal((await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get()).size, 0);
});

test('c18x-B3 post-purge tombstone prevents delayed terminal commit', async () => {
  const f = c18vFixture();
  const old = { ...fixture('c18xb3-tombstone'), ownerUid: f.ownerUid,
    videoId: f.videoId, sourceGeneration: '1' };
  await Promise.all([
    firestore.collection('deleted_accounts_audit').doc(f.ownerUid)
      .create({ status: 'deleted', purgePhase: 'completed' }),
    f.processingJobRef.create(old),
    f.privateVideoRef.create({ path: old.sourceStoragePath, status: 'processing' }),
  ]);
  const result = await commitTerminalVideoProcessingIfCurrent(
    firestore, f.processingJobRef, old, {
      state: 'SUCCEEDED', now: now + 2_000, normalizeJob: parseJob,
      sourceMatches: () => true,
      jobPatch: { providerState: 'SUCCEEDED' },
      videoPatch: { status: 'ready' },
    });
  assert.equal(result, 'CANCEL_REQUESTED');
  assert.equal((await f.processingJobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await f.privateVideoRef.get()).get('status'), 'processing');
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].get('kind'), 'CANCEL_REQUESTED');
});

test('c18x-B3 account deletion begins while terminal result commits', async () => {
  const f = c18vFixture();
  const initial = { ...fixture('c18xb3-timing'), ownerUid: f.ownerUid,
    videoId: f.videoId, sourceGeneration: '99' };
  const ownerRef = firestore.doc('users/' + f.ownerUid);
  await Promise.all([
    ownerRef.create({ accountStatus: 'active' }),
    f.processingJobRef.create(initial),
    f.privateVideoRef.create({
      path: initial.sourceStoragePath, sourceGeneration: '99',
      status: 'processing',
    }),
  ]);
  const [terminal, lifecycle] = await Promise.all([
    commitTerminalVideoProcessingIfCurrent(firestore, f.processingJobRef,
      initial, {
        state: 'SUCCEEDED', now: now + 4_000, normalizeJob: parseJob,
        sourceMatches: video => video['path'] === initial.sourceStoragePath,
        jobPatch: { providerState: 'SUCCEEDED' },
        videoPatch: { status: 'ready' },
      }),
    firestore.runTransaction(async tx => {
      const owner = await tx.get(ownerRef);
      assert.equal(owner.get('accountStatus'), 'active');
      tx.update(ownerRef, { accountStatus: 'pending_deletion' });
      return true;
    }),
  ]);
  assert.equal(lifecycle, true);
  assert.ok(terminal === 'APPLIED' || terminal === 'CANCEL_REQUESTED');
  assert.equal((await ownerRef.get()).get('accountStatus'), 'pending_deletion');
  const finalState = (await f.processingJobRef.get()).get('state');
  if (terminal === 'APPLIED') {
    assert.equal(finalState, 'SUCCEEDED');
  } else {
    assert.equal(finalState, 'CANCEL_REQUESTED');
  }
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  const events = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].get('nextState'),
    terminal === 'APPLIED' ? 'SUCCEEDED' : 'CANCEL_REQUESTED');
});


async function c18xB4Epoch() {
  const f = c18vFixture();
  const job = buildQueuedVideoProcessingJob({
    ownerUid: f.ownerUid, videoId: f.videoId,
    sourceStoragePath: 'users/' + f.ownerUid +
      '/uploads/videos/' + f.videoId + '-original.mp4',
    sourcePosterStoragePath: null, sourceMimeType: 'video/mp4',
    sourceSizeBytes: 10_000, sourceDurationMs: 10_000, now,
  });
  const createId = randomUUID();
  const deleteId = randomUUID();
  await firestore.runTransaction(async tx => {
    const absent = await tx.get(f.processingJobRef);
    assert.equal(absent.exists, false);
    stageVideoTriageCreatedJobInTransaction(
      firestore, tx, f.processingJobRef, absent, createId,
      job.processingVersion);
    tx.create(f.processingJobRef, withAdminTriageProjection(
      f.processingJobRef.id, null, job, now));
  });
  await Promise.all([
    f.privateVideoRef.create({ path: job.sourceStoragePath }),
    f.publicationRef.create({
      isPublished: true, moderationStatus: 'APPROVED',
    }),
  ]);
  assert.equal((await commitProfileVideoDeletionRequest(
    firestore, f.command(deleteId))).kind, 'CREATED');
  const hash = createHash('sha256').update(f.processingJobRef.path).digest('hex');
  // The manifest is constructed from the harness's confirmed commands, not
  // from the outbox, enabling independent detection of a missing event.
  const epoch: ClosedOutboxEpochWitness = {
    scope: 'FENCED_EMULATOR_EPOCH',
    openedAt: now - 1_000, closedAt: now + 1_000,
    allWritersStopped: true, allScopedEventsRead: true,
    allScopedJobsRead: true,
    jobs: [{ jobKeySha256: hash, initialState: null, initialVersion: null }],
    committed: [
      {
        id: createId, jobKeySha256: hash, source: 'QUEUE_CREATION',
        kind: 'CREATE', previousState: null, nextState: 'QUEUED',
        processingVersion: job.processingVersion,
      },
      {
        id: deleteId, jobKeySha256: hash, source: 'PROFILE_VIDEO_DELETION',
        kind: 'CANCEL_REQUESTED', previousState: 'QUEUED',
        nextState: 'CANCEL_REQUESTED', processingVersion: job.processingVersion,
      },
    ],
  };
  const read = async (): Promise<{
    events: ClosedOutboxObservedEvent[];
    jobs: ClosedOutboxObservedJob[];
  }> => {
    const [events, current] = await Promise.all([
      firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
        .where('jobKeySha256', '==', hash).get(),
      f.processingJobRef.get(),
    ]);
    return {
      events: events.docs.map(doc => ({
        id: doc.id, fields: doc.data(),
      })),
      jobs: [{
        jobKeySha256: hash,
        state: current.exists
          ? current.get('state') as ClosedOutboxObservedJob['state'] : null,
        processingVersion: current.exists
          ? current.get('processingVersion') as string : null,
      }],
    };
  };
  return { f, epoch, read, createId, deleteId };
}

test('c18x-B4 closed epoch reconciles independent creation and deletion witnesses', async () => {
  const e = await c18xB4Epoch();
  const { events, jobs } = await e.read();
  const report = reconcileClosedVideoTriageOutbox(e.epoch, events, jobs);
  assert.equal(report.scope, 'EMULATOR_CLOSED_OUTBOX_ONLY');
  assert.equal(report.status, 'RECONCILED');
  assert.deepEqual(report.issues, []);
  assert.equal(report.expectedEvents, 2);
  assert.equal(report.observedEvents, 2);
  assert.equal(report.globalCoverageVerified, false);
  assert.equal(report.globallySequenced, false);
  assert.equal(report.productionCostVerified, false);
  assert.equal(report.cleanupAuthorized, false);
  const reversed = reconcileClosedVideoTriageOutbox(
    e.epoch, [...events].reverse(), jobs);
  assert.deepEqual(reversed, report);
});

test('c18x-B4 missing and tampered outbox events are detected independently', async () => {
  const e = await c18xB4Epoch();
  const eventRef = firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(e.createId);
  await eventRef.delete();
  const missing = e.read();
  const a = await missing;
  const report = reconcileClosedVideoTriageOutbox(e.epoch, a.events, a.jobs);
  assert.equal(report.status, 'DIVERGENT');
  assert.equal(report.missingEvents, 1);
  assert.ok(report.issues.includes('MISSING_EVENT'));
  await eventRef.create({
    schemaVersion: 1, scope: 'PARTIAL_WRITER_COVERAGE',
    globalCoverageVerified: false, globallySequenced: false,
    jobKeySha256: e.epoch.jobs[0].jobKeySha256,
    source: 'QUEUE_CREATION', kind: 'CREATE', previousState: null,
    nextState: 'FAILED', processingVersion: e.epoch.committed[0].processingVersion,
  });
  const b = await e.read();
  const tampered = reconcileClosedVideoTriageOutbox(e.epoch, b.events, b.jobs);
  assert.equal(tampered.status, 'DIVERGENT');
  assert.equal(tampered.payloadMismatches, 1);
  assert.ok(tampered.issues.includes('EVENT_PAYLOAD_MISMATCH'));
});

test('c18x-B4 duplicate, extra event and unjournaled job write fail closed', async () => {
  const e = await c18xB4Epoch();
  const copied = await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(e.createId).get();
  const extraId = randomUUID();
  await firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .doc(extraId).create(copied.data()!);
  await e.f.processingJobRef.update({ state: 'PROCESSING' });
  const { events, jobs } = await e.read();
  const report = reconcileClosedVideoTriageOutbox(e.epoch, events, jobs);
  assert.equal(report.status, 'DIVERGENT');
  assert.equal(report.unexpectedEvents, 1);
  assert.equal(report.finalJobMismatches, 1);
  assert.ok(report.issues.includes('DUPLICATE_LOGICAL_EVENT'));
  assert.ok(report.issues.includes('UNEXPECTED_EVENT'));
  assert.ok(report.issues.includes('FINAL_JOB_MISMATCH'));
  assert.equal(report.globalCoverageVerified, false);
});

test('c18x-B4 unsealed or inconsistent witness is never global evidence', async () => {
  const e = await c18xB4Epoch();
  const { events, jobs } = await e.read();
  const unsealed = reconcileClosedVideoTriageOutbox({
    ...e.epoch, allWritersStopped: false,
  }, events, jobs);
  assert.equal(unsealed.status, 'INCONCLUSIVE');
  assert.ok(unsealed.issues.includes('EPOCH_NOT_CLOSED'));
  const inconsistent = reconcileClosedVideoTriageOutbox({
    ...e.epoch, committed: [
      e.epoch.committed[1], e.epoch.committed[0],
    ],
  }, events, jobs);
  assert.equal(inconsistent.status, 'INCONCLUSIVE');
  assert.ok(inconsistent.issues.includes('INVALID_COMMIT_CHAIN'));
  const incomplete = reconcileClosedVideoTriageOutbox({
    ...e.epoch, allScopedEventsRead: false,
  }, events, jobs);
  assert.equal(incomplete.status, 'INCONCLUSIVE');
  const unbounded = reconcileClosedVideoTriageOutbox({
    ...e.epoch, committed: Array(65).fill(e.epoch.committed[0]),
  }, events, jobs);
  assert.equal(unbounded.status, 'INCONCLUSIVE');
  assert.ok(unbounded.issues.includes('UNBOUNDED_OR_INVALID_INPUT'));
});


test('c18x-B4 unknown jobs and duplicated event IDs fail the closed scope', async () => {
  const e = await c18xB4Epoch();
  const { events, jobs } = await e.read();
  const otherHash = createHash('sha256').update(randomUUID()).digest('hex');
  const outside = reconcileClosedVideoTriageOutbox(e.epoch, events, [
    ...jobs, { jobKeySha256: otherHash, state: 'QUEUED',
      processingVersion: randomUUID() },
  ]);
  assert.equal(outside.status, 'DIVERGENT');
  assert.ok(outside.issues.includes('UNEXPECTED_JOB'));
  const repeatedId = reconcileClosedVideoTriageOutbox(
    e.epoch, [...events, events[0]], jobs);
  assert.equal(repeatedId.status, 'INCONCLUSIVE');
  assert.ok(repeatedId.issues.includes('INVALID_OBSERVED_EVENT_SET'));
  assert.equal(repeatedId.cleanupAuthorized, false);
  assert.equal(repeatedId.globalCoverageVerified, false);
});

test('VF1-A pending video publication atomically creates one preventive review', async () => {
  const f = readyPublicationFixture();
  await f.ownerRef.set(f.video);
  const base = f.command('vf1-' + randomUUID());
  const assetVersion = 1700000000000;
  const command = {
    ...base,
    publicationPatch: {
      ...base.publicationPatch,
      moderationStatus: 'PENDING_REVIEW',
      assetVersion,
    },
    publicVideoPatch: {
      ...base.publicVideoPatch,
      moderationStatus: 'PENDING_REVIEW',
      assetVersion,
    },
  };
  await commitCopiedVideoPublicationIfCurrent(firestore, command);
  const [publication, projection] = await Promise.all([
    f.publicationRef.get(), f.publicRef.get(),
  ]);
  const reportId = publication.get('preventiveReviewReportId');
  assert.equal(typeof reportId, 'string');
  assert.ok(reportId);
  assert.equal(publication.get('moderationStatus'), 'PENDING_REVIEW');
  assert.equal(projection.get('moderationStatus'), 'PENDING_REVIEW');
  assert.equal(projection.get('preventiveReviewReportId'), reportId);
  const report = await firestore.collection('moderation_reports')
    .doc(reportId).get();
  assert.equal(report.get('reason'), 'preventive_media_review');
  assert.equal(report.get('status'), 'open');
  assert.equal(report.get('contentQuarantined'), true);
  assert.equal(report.get('quarantinedAssetVersion'), assetVersion);
  assert.equal(report.get('targetOwnerUid'), command.ownerUid);
  assert.equal(report.get('targetId'), command.videoId);
  await assert.rejects(
    commitCopiedVideoPublicationIfCurrent(firestore, command),
    (error: unknown) => !!error && typeof error === 'object' &&
      'code' in error && error.code === 'failed-precondition'
  );
  assert.equal((await firestore.collection('moderation_reports')
    .where('targetId', '==', command.videoId).get()).size, 1);
});

test('VF1-B1 preventive review rejects inconsistent asset versions', async () => {
  const f = readyPublicationFixture();
  await f.ownerRef.set(f.video);
  const base = f.command('vf1-version-mismatch-' + randomUUID());
  await assert.rejects(
    commitCopiedVideoPublicationIfCurrent(firestore, {
      ...base,
      publicationPatch: {
        ...base.publicationPatch,
        moderationStatus: 'PENDING_REVIEW',
        assetVersion: 1700000000000,
      },
      publicVideoPatch: {
        ...base.publicVideoPatch,
        moderationStatus: 'PENDING_REVIEW',
        assetVersion: 1700000000001,
      },
    }),
    (error: unknown) => !!error && typeof error === 'object' &&
      'code' in error && error.code === 'failed-precondition'
  );
  assert.equal((await f.publicationRef.get()).exists, false);
  assert.equal((await f.publicRef.get()).exists, false);
});

test('VF1-A status mismatch cannot create publication or review', async () => {
  const f = readyPublicationFixture();
  await f.ownerRef.set(f.video);
  const base = f.command('vf1-mismatch-' + randomUUID());
  await assert.rejects(
    commitCopiedVideoPublicationIfCurrent(firestore, {
      ...base,
      publicationPatch: {
        ...base.publicationPatch, moderationStatus: 'PENDING_REVIEW',
      },
    }),
    (error: unknown) => !!error && typeof error === 'object' &&
      'code' in error && error.code === 'failed-precondition'
  );
  assert.equal((await f.publicationRef.get()).exists, false);
  assert.equal((await f.publicRef.get()).exists, false);
});


test('VF1-B3.4.6 delayed settings event cannot resurrect a retired video projection', async () => {
  const ownerUid = 'vf1-sync-' + randomUUID();
  const videoId = 'video-' + randomUUID();
  const publicationRef = firestore.doc(`users/${ownerUid}/video_publications/${videoId}`);
  const publicRef = firestore.doc(`public_profiles/${ownerUid}/public_videos/${videoId}`);
  const guardRef = firestore.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
  await Promise.all([
    publicationRef.set({ ownerUid, videoId, isPublished: true, moderationStatus: 'APPROVED' }),
    publicRef.set({ id: videoId, ownerUid, moderationStatus: 'APPROVED', title: 'before' }),
    guardRef.set({ ownerUid, videoId, state: 'REGISTERED' }),
  ]);
  assert.equal(await synchronizePublishedVideoSettingsInFirestore(firestore, ownerUid, videoId), 'UPDATED');
  await firestore.runTransaction(async tx => {
    const snap = await tx.get(guardRef);
    assert.equal(snap.get('state'), 'REGISTERED');
    tx.update(guardRef, { state: 'RETIRED' });
    tx.delete(publicationRef);
    tx.delete(publicRef);
  });
  for (let i = 0; i < 2; i += 1) {
    assert.equal(
      await synchronizePublishedVideoSettingsInFirestore(firestore, ownerUid, videoId),
      'IGNORED_UNPUBLISHED'
    );
    assert.equal((await publicRef.get()).exists, false);
  }
});
