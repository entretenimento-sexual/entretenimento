import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { buildQueuedVideoProcessingJob } from './video-processing-job';
import { VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION }
  from './admin-video-triage-mutation-outbox.firestore';
import { prepareVideoSourceProbeWithPorts } from './video-source-probe.service';
import { VideoSourceProbeFailure } from './video-source-probe.policy';
import type { AuthoritativeVideoProbeResult } from './video-rotation-worker.service';

const PROJECT_ID = 'demo-entretenimento-video-reconciliation';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(process.env.GCLOUD_PROJECT, PROJECT_ID);
assert.match(String(host ?? ''), /^127\.0\.0\.1:\d{2,5}$/);
assert.equal(host, process.env.VIDEO_RECONCILE_EXPECTED_EMULATOR_HOST);
assert.notEqual(host, '127.0.0.1:8080');
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, '');

const app = initializeApp({ projectId: PROJECT_ID }, 'video-source-probe-e2e');
const firestore = getFirestore(app);
const now = 1_800_000_000_000;

after(async () => { await deleteApp(app); });

function fixture(generation: string | null = '90071992547409935') {
  const ownerUid = 'probe-owner';
  const videoId = 'probe-' + randomUUID();
  const path = `users/${ownerUid}/uploads/videos/${videoId}-source.mp4`;
  const job = buildQueuedVideoProcessingJob({
    ownerUid, videoId, sourceStoragePath: path,
    ...(generation ? { sourceGeneration: generation } : {}),
    sourcePosterStoragePath: null, sourceMimeType: 'video/mp4',
    sourceSizeBytes: 120_000, sourceDurationMs: 12_000, now: now - 1_000,
  });
  const jobRef = firestore.collection('media_video_processing_jobs')
    .doc(`${ownerUid}_${videoId}`);
  const videoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  const video = {
    path,
    ...(generation ? { sourceGeneration: generation } : {}),
    status: 'queued', processingStage: 'queued',
  };
  const observed: AuthoritativeVideoProbeResult = {
    widthPixels: 1920, heightPixels: 1080, durationMs: 12_000,
    embeddedRotationDegrees: 0,
    displayAspectNumerator: 1920, displayAspectDenominator: 1080,
    sampleAspectRatio: { numerator: 1, denominator: 1 },
    videoCodec: 'h264', hasAudio: false, audioCodec: null,
    sourceGeneration: generation ?? '', sourceSizeBytes: 120_000,
  };
  return { job, jobRef, videoRef, video, observed };
}

async function mutationEvents(path: string) {
  const hash = createHash('sha256').update(path).digest('hex');
  return firestore.collection(VIDEO_TRIAGE_MUTATION_OUTBOX_COLLECTION)
    .where('jobKeySha256', '==', hash).get();
}

function barrier() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  return { entered, paused, enter, release };
}

test('real transaction: one probe reservation and a bound silent snapshot', async () => {
  const f = fixture();
  await Promise.all([f.jobRef.set(f.job), f.videoRef.set(f.video)]);
  const gate = barrier();
  let calls = 0;
  const first = prepareVideoSourceProbeWithPorts(
    f.jobRef, now, firestore, async () => {
      calls += 1;
      gate.enter();
      await gate.paused;
      return f.observed;
    }
  );
  await gate.entered;
  const pending = await f.jobRef.get();
  assert.equal(pending.get('state'), 'QUEUED');
  assert.equal((await f.videoRef.get()).get('processingStage'), 'verifying');
  assert.equal(await prepareVideoSourceProbeWithPorts(
    f.jobRef, now, firestore, async () => { calls += 1; return f.observed; }
  ), false);
  gate.release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  const current = await f.jobRef.get();
  assert.equal(current.get('sourceProbe.sourceGeneration'), f.job.sourceGeneration);
  assert.equal(current.get('sourceProbe.processingVersion'), f.job.processingVersion);
  assert.equal(current.get('sourceProbe.hasAudio'), false);
  assert.equal(current.get('sourceProbeClaimId'), null);
  assert.equal(current.get('state'), 'QUEUED');
  assert.equal((await mutationEvents(f.jobRef.path)).size, 0);
  assert.equal(await prepareVideoSourceProbeWithPorts(
    f.jobRef, now + 1000, firestore, async () => { calls += 1; return f.observed; }
  ), true);
  assert.equal(calls, 1);
});

test('real transaction: stale response after processing version replacement is ignored', async () => {
  const f = fixture();
  await Promise.all([f.jobRef.set(f.job), f.videoRef.set(f.video)]);
  const gate = barrier();
  const pending = prepareVideoSourceProbeWithPorts(
    f.jobRef, now, firestore, async () => {
      gate.enter();
      await gate.paused;
      return f.observed;
    }
  );
  await gate.entered;
  await f.jobRef.update({ processingVersion: 'replacement-' + randomUUID() });
  gate.release();
  assert.equal(await pending, false);
  assert.equal((await f.jobRef.get()).get('sourceProbe'), undefined);
  assert.equal((await mutationEvents(f.jobRef.path)).size, 0);
});

test('real transaction: replacement of original source cancels old claim', async () => {
  const f = fixture();
  await Promise.all([f.jobRef.set(f.job), f.videoRef.set(f.video)]);
  const gate = barrier();
  const pending = prepareVideoSourceProbeWithPorts(
    f.jobRef, now, firestore, async () => {
      gate.enter();
      await gate.paused;
      return f.observed;
    }
  );
  await gate.entered;
  await f.videoRef.update({ sourceGeneration: '999' });
  gate.release();
  assert.equal(await pending, false);
  const current = await f.jobRef.get();
  assert.equal(current.get('state'), 'CANCEL_REQUESTED');
  assert.equal(current.get('lastErrorCode'), 'SOURCE_CHANGED');
  assert.equal(current.get('sourceProbe'), undefined);
  const events = await mutationEvents(f.jobRef.path);
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].get('source'), 'SOURCE_PROBE');
  assert.equal(events.docs[0].get('kind'), 'CANCEL_REQUESTED');
  assert.equal(events.docs[0].get('previousState'), 'QUEUED');
  assert.equal(events.docs[0].get('nextState'), 'CANCEL_REQUESTED');
});

test('real transaction: late response from expired lease cannot overwrite newer claim', async () => {
  const f = fixture();
  await Promise.all([f.jobRef.set(f.job), f.videoRef.set(f.video)]);
  const gate = barrier();
  const old = prepareVideoSourceProbeWithPorts(
    f.jobRef, now, firestore, async () => {
      gate.enter();
      await gate.paused;
      return { ...f.observed, widthPixels: 800, displayAspectNumerator: 800 };
    }
  );
  await gate.entered;
  const updated = await prepareVideoSourceProbeWithPorts(
    f.jobRef, now + 4 * 60_000, firestore, async () => f.observed
  );
  assert.equal(updated, true);
  gate.release();
  assert.equal(await old, false);
  assert.equal((await f.jobRef.get()).get('sourceProbe.widthPixels'), 1920);
});

test('real transaction: permanent metadata error fails without Transcoder submission', async () => {
  const f = fixture();
  await Promise.all([f.jobRef.set(f.job), f.videoRef.set(f.video)]);
  assert.equal(await prepareVideoSourceProbeWithPorts(
    f.jobRef, now, firestore, async () => {
      throw new VideoSourceProbeFailure('VIDEO_PROBE_NO_VIDEO_STREAM', false);
    }
  ), false);
  assert.equal((await f.jobRef.get()).get('state'), 'FAILED');
  assert.equal((await f.videoRef.get()).get('processingErrorCode'), 'VIDEO_PROBE_NO_VIDEO_STREAM');
  const events = await mutationEvents(f.jobRef.path);
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].get('kind'), 'STATE_TRANSITION');
  assert.equal(events.docs[0].get('nextState'), 'FAILED');
  assert.equal(events.docs[0].get('globalCoverageVerified'), false);
});

test('real transaction: service outage queues retry without marking video failed', async () => {
  const f = fixture();
  await Promise.all([f.jobRef.set(f.job), f.videoRef.set(f.video)]);
  assert.equal(await prepareVideoSourceProbeWithPorts(
    f.jobRef, now, firestore, async () => {
      throw new VideoSourceProbeFailure('VIDEO_PROBE_UNAVAILABLE', true);
    }
  ), false);
  const state = await f.jobRef.get();
  assert.equal(state.get('state'), 'QUEUED');
  assert.equal(state.get('lastErrorCode'), 'VIDEO_PROBE_UNAVAILABLE');
  assert.ok(state.get('nextAttemptAt') > Date.now());
  assert.equal((await f.videoRef.get()).get('status'), 'queued');
  assert.equal((await mutationEvents(f.jobRef.path)).size, 0);
});

test('real transaction: source bytes mismatch cannot be persisted', async () => {
  const f = fixture();
  await Promise.all([f.jobRef.set(f.job), f.videoRef.set(f.video)]);
  assert.equal(await prepareVideoSourceProbeWithPorts(
    f.jobRef, now, firestore, async () => ({ ...f.observed, sourceSizeBytes: 11 })
  ), false);
  assert.equal((await f.jobRef.get()).get('state'), 'FAILED');
  assert.equal((await f.jobRef.get()).get('lastErrorCode'), 'VIDEO_PROBE_SOURCE_CHANGED');
});

test('real transaction: legacy jobs with no generation never call worker', async () => {
  const f = fixture(null);
  await Promise.all([f.jobRef.set(f.job), f.videoRef.set(f.video)]);
  let calls = 0;
  assert.equal(await prepareVideoSourceProbeWithPorts(
    f.jobRef, now, firestore, async () => { calls += 1; return f.observed; }
  ), true);
  assert.equal(calls, 0);
  assert.equal((await f.jobRef.get()).get('state'), 'QUEUED');
});
