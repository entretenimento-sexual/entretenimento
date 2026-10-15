import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import axios, { AxiosError, type AxiosResponse } from 'axios';

import { buildQueuedVideoProcessingJob, type VideoProcessingJob } from './video-processing-job';
import { decideMissingVideoSubmission } from './video-submission-confirmation.policy';
import { isCurrentVideoProcessingAttempt } from './video-processing-poll.policy';
import { commitCopiedVideoPublicationIfCurrent } from './video-publication-commit.firestore';
import { deleteUnreferencedPublishedVideoAsset } from './published-video-asset-cleanup.firestore';
import { migrateLegacyPublishedVideoCleanupJobs } from './published-video-cleanup-migration.firestore';
import {
  claimPublishedVideoCleanupJob,
  clearPublishedVideoCleanupJobIfUnleased,
  settlePublishedVideoCleanupJob,
} from './published-video-cleanup-queue.firestore';
import { VIDEO_CLEANUP_LEASE_MS } from './video-cleanup-claim.policy';
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
  queryDueCancelledJobs,
  claimDueCancellation,
  deleteCancelledJobIfCurrent,
  queryDueProcessingJobs,
  recordCancellationErrorIfCurrent,
  bindCancelledProviderJobIfCurrent,
  claimExpiredSubmissionLease,
  updateRecoveredSubmissionIfCurrent,
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
