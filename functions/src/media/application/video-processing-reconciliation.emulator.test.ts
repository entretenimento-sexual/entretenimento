import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import axios, { AxiosError, type AxiosResponse } from 'axios';

import { buildQueuedVideoProcessingJob, type VideoProcessingJob } from './video-processing-job';
import { saveLastVideoSchedulerCycle } from './video-scheduler-observability.firestore';
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
    terminalVideoWorkOutcomes('FAILED', 'REPLACED').forEach(observed.observe);
    assert.equal((await jobRef.get()).get('state'), 'PROCESSING');
    assert.equal((await videoRef.get()).get('status'), 'processing');
    assert.equal(await commit(second, 'SUCCEEDED'), 'APPLIED');
    terminalVideoWorkOutcomes('SUCCEEDED', 'APPLIED').forEach(observed.observe);
    assert.equal((await jobRef.get()).get('state'), 'SUCCEEDED');
    assert.equal((await videoRef.get()).get('status'), 'ready');
    assert.equal(await commit(first, 'FAILED'), 'REPLACED');
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
