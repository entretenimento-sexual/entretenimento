import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, test } from 'node:test';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { buildQueuedVideoProcessingJob } from './video-processing-job';
import { createVideoSourceProbeSnapshot } from './video-source-probe.policy';
import { ImmutableInputPreparationError, buildImmutableTranscoderInputPath,
  type ImmutableTranscoderInput } from './video-immutable-input.policy';
import {
  matchesPersistedImmutableInput,
  prepareImmutableInputBeforeSubmission,
  prepareImmutableInputPreflightWithPorts,
} from './video-immutable-input-preflight.service';

const PROJECT_ID = 'demo-entretenimento-video-reconciliation';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(process.env.GCLOUD_PROJECT, PROJECT_ID);
assert.match(String(host ?? ''), /^127\.0\.0\.1:\d{2,5}$/);
assert.equal(host, process.env.VIDEO_RECONCILE_EXPECTED_EMULATOR_HOST);
assert.notEqual(host, '127.0.0.1:8080');
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, '');

const app = initializeApp({ projectId: PROJECT_ID }, 'video-immutable-preflight-e2e');
const firestore = getFirestore(app);
after(async () => { await deleteApp(app); });

// Every emulator test creates distinct Firestore documents. Remove them after
// EACH case, including cancellation/terminal states, so later suites running
// against the same disposable demo database never see stale due jobs.
const createdPaths: Array<{ job: string; video: string }> = [];
afterEach(async () => {
  const finished = createdPaths.splice(0);
  await Promise.all(finished.flatMap(paths => [
    firestore.doc(paths.job).delete(),
    firestore.doc(paths.video).delete(),
  ]));
});

function fixture(hasGeneration = true) {
  const now = Date.now();
  const ownerUid = 'immutable-owner';
  const videoId = 'vid-' + randomUUID();
  const path = `users/${ownerUid}/uploads/videos/${videoId}-original.mp4`;
  const generation = '90071992547409991';
  const job = buildQueuedVideoProcessingJob({
    ownerUid, videoId, sourceStoragePath: path,
    ...(hasGeneration ? { sourceGeneration: generation } : {}),
    sourcePosterStoragePath: null, sourceMimeType: 'video/mp4',
    sourceSizeBytes: 100_000, sourceDurationMs: 15_000, now: now - 1000,
  });
  if (hasGeneration) {
    job.sourceProbe = createVideoSourceProbeSnapshot(job, {
      widthPixels: 1920, heightPixels: 1080, durationMs: 15_000,
      embeddedRotationDegrees: 0, displayAspectNumerator: 1920,
      displayAspectDenominator: 1080,
      sampleAspectRatio: { numerator: 1, denominator: 1 },
      videoCodec: 'h264', hasAudio: false, audioCodec: null,
      sourceGeneration: generation, sourceSizeBytes: 100_000,
    }, now);
  }
  const input: ImmutableTranscoderInput = {
    sourceStoragePath: path, sourceGeneration: generation,
    destinationStoragePath: buildImmutableTranscoderInputPath({
      ...job, sourceGeneration: generation,
    }),
    destinationGeneration: '90071992547409996',
    sizeBytes: 100_000, crc32c: 'AAAAAA==', reused: false,
  };
  const jobRef = firestore.doc(`media_video_processing_jobs/${ownerUid}_${videoId}`);
  const videoRef = firestore.doc(`users/${ownerUid}/videos/${videoId}`);
  createdPaths.push({ job: jobRef.path, video: videoRef.path });
  const video = {
    path, ...(hasGeneration ? { sourceGeneration: generation } : {}),
    status: 'queued', processingStage: 'queued',
  };
  return { now, job, jobRef, videoRef, video, input };
}
function barrier() {
  let signal!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { signal = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { started, wait, signal, release };
}
async function seed(f: ReturnType<typeof fixture>) {
  await Promise.all([f.jobRef.set(f.job), f.videoRef.set(f.video)]);
}
const copy = (input: ImmutableTranscoderInput) => async () => input;

test('scheduler entrypoint: opt-in OFF does not read or modify a job', async () => {
  const f = fixture();
  const previous = process.env.VIDEO_SOURCE_PROBE_CAPTURE_ENABLED;
  try {
    delete process.env.VIDEO_SOURCE_PROBE_CAPTURE_ENABLED;
    assert.equal(await prepareImmutableInputBeforeSubmission(f.jobRef, f.now), true);
    assert.equal((await f.jobRef.get()).exists, false);
  } finally {
    if (previous === undefined) delete process.env.VIDEO_SOURCE_PROBE_CAPTURE_ENABLED;
    else process.env.VIDEO_SOURCE_PROBE_CAPTURE_ENABLED = previous;
  }
});

test('preflight: copies once and persists exact version and generation', async () => {
  const f = fixture();
  await seed(f);
  let copies = 0;
  assert.equal(await prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => { copies++; return f.input; }
  ), true);
  const stored = (await f.jobRef.get()).data();
  if (!stored) throw new Error('Missing persisted job');
  assert.equal(stored['state'], 'QUEUED');
  assert.equal(stored['immutableInput'].destinationGeneration, f.input.destinationGeneration);
  assert.equal(stored['immutableInputClaimId'], null);
  assert.equal(matchesPersistedImmutableInput(f.job, stored['immutableInput']), true);
  assert.equal(await prepareImmutableInputPreflightWithPorts(
    f.jobRef, Date.now() + 1000, firestore, async () => { copies++; return f.input; }
  ), true);
  assert.equal(copies, 1);
});

test('preflight: two schedulers cannot copy concurrently on same live claim', async () => {
  const f = fixture();
  await seed(f);
  const gate = barrier();
  let copies = 0;
  const pending = prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => {
      copies++;
      gate.signal();
      await gate.wait;
      return f.input;
    }
  );
  await gate.started;
  assert.equal((await f.videoRef.get()).get('processingStage'), 'preparing');
  assert.equal(await prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => { copies++; return f.input; }
  ), false);
  gate.release();
  assert.equal(await pending, true);
  assert.equal(copies, 1);
});

test('preflight: response from replaced version never attaches an old input', async () => {
  const f = fixture();
  await seed(f);
  const gate = barrier();
  const pending = prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => {
      gate.signal(); await gate.wait; return f.input;
    }
  );
  await gate.started;
  await f.jobRef.update({ processingVersion: 'new-' + randomUUID() });
  gate.release();
  assert.equal(await pending, false);
  assert.equal((await f.jobRef.get()).get('immutableInput'), undefined);
});

test('preflight: cancelled claim cannot resurrect or persist immutable input', async () => {
  const f = fixture();
  await seed(f);
  const gate = barrier();
  const pending = prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => {
      gate.signal(); await gate.wait; return f.input;
    }
  );
  await gate.started;
  await f.jobRef.update({ state: 'CANCEL_REQUESTED', cancelRequestedAt: f.now });
  gate.release();
  assert.equal(await pending, false);
  assert.equal((await f.jobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await f.jobRef.get()).get('immutableInput'), undefined);
});

test('preflight: expired claim cannot overwrite newer successful claim', async () => {
  const f = fixture();
  await seed(f);
  const gate = barrier();
  const old = prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => {
      gate.signal(); await gate.wait;
      return { ...f.input, destinationGeneration: '123' };
    }
  );
  await gate.started;
  assert.equal(await prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now + 11 * 60_000, firestore, copy(f.input)
  ), true);
  gate.release();
  assert.equal(await old, false);
  assert.equal((await f.jobRef.get()).get('immutableInput.destinationGeneration'),
    f.input.destinationGeneration);
});

test('preflight: changed private generation cancels and never copies', async () => {
  const f = fixture();
  await seed(f);
  await f.videoRef.update({ sourceGeneration: '55' });
  let copies = 0;
  assert.equal(await prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => { copies++; return f.input; }
  ), false);
  assert.equal(copies, 0);
  assert.equal((await f.jobRef.get()).get('state'), 'CANCEL_REQUESTED');
});

test('preflight: transient copy outage stays queued with a future retry', async () => {
  const f = fixture();
  await seed(f);
  assert.equal(await prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => {
      throw new ImmutableInputPreparationError('IMMUTABLE_INPUT_TEMPORARY_UNAVAILABLE', true);
    }
  ), false);
  const stored = await f.jobRef.get();
  assert.equal(stored.get('state'), 'QUEUED');
  assert.ok(stored.get('nextAttemptAt') > Date.now());
  assert.equal(stored.get('immutableInput'), undefined);
});

test('preflight: identity conflict is terminal and never permits POST', async () => {
  const f = fixture();
  await seed(f);
  assert.equal(await prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => {
      throw new ImmutableInputPreparationError('IMMUTABLE_INPUT_DESTINATION_CONFLICT', false);
    }
  ), false);
  const stored = await f.jobRef.get();
  assert.equal(stored.get('state'), 'FAILED');
  assert.equal((await f.videoRef.get()).get('status'), 'failed');
  assert.equal(stored.get('immutableInput'), undefined);
});

test('preflight: invalid copy identity cannot be recorded', async () => {
  const f = fixture();
  await seed(f);
  assert.equal(await prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => ({ ...f.input, sourceGeneration: '666' })
  ), false);
  assert.equal((await f.jobRef.get()).get('state'), 'FAILED');
  assert.equal((await f.jobRef.get()).get('lastErrorCode'), 'IMMUTABLE_INPUT_RESULT_INVALID');
});

test('preflight: legacy job without sourceGeneration never copies', async () => {
  const f = fixture(false);
  await seed(f);
  let copies = 0;
  assert.equal(await prepareImmutableInputPreflightWithPorts(
    f.jobRef, f.now, firestore, async () => { copies++; return f.input; }
  ), true);
  assert.equal(copies, 0);
  assert.equal((await f.jobRef.get()).get('state'), 'QUEUED');
});
