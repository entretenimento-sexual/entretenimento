import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AxiosError, AxiosHeaders } from 'axios';

import { normalizeGoogleTranscoderError } from './google-video-transcoder.service';
import { buildQueuedVideoProcessingJob } from './video-processing-job';
import {
  buildProviderTerminalEvidence,
  matchesProviderTerminalEvidence,
} from './video-provider-terminal-evidence.policy';

function job() {
  return {
    ...buildQueuedVideoProcessingJob({
      ownerUid: 'owner', videoId: 'sample',
      sourceStoragePath: 'users/owner/uploads/videos/sample.mp4',
      sourcePosterStoragePath: null, sourceMimeType: 'video/mp4',
      sourceSizeBytes: 100_000, sourceDurationMs: 12_000, now: 1_800_000_000_000,
    }),
    state: 'PROCESSING' as const,
    attempts: 1,
    externalJobName: 'projects/demo/locations/us-central1/jobs/sample',
    providerState: 'RUNNING',
  };
}

test('only matching successful terminal GET produces version-bound proof', () => {
  const current = job();
  for (const state of ['SUCCEEDED', 'FAILED'] as const) {
    const evidence = buildProviderTerminalEvidence(current, {
      name: current.externalJobName, state,
    }, 1_800_000_000_010);
    assert.equal(matchesProviderTerminalEvidence({
      ...current, state, providerState: state, providerTerminalEvidence: evidence,
    }), true);
    assert.equal(matchesProviderTerminalEvidence({
      ...current, state, providerState: state, providerTerminalEvidence: {
        ...evidence, processingVersion: 'replacement',
      },
    }), false);
    assert.equal(matchesProviderTerminalEvidence({
      ...current, state, providerState: state, providerTerminalEvidence: {
        ...evidence, externalJobName: 'projects/demo/locations/us-central1/jobs/other',
      },
    }), false);
    assert.equal(matchesProviderTerminalEvidence({
      ...current, state, providerState: state, providerTerminalEvidence: {
        ...evidence, observedAt: 0,
      },
    }), false);
  }
});

test('nonterminal observations, replaced jobs and invalid timestamps cannot prove completion', () => {
  const current = job();
  for (const observed of [
    { name: current.externalJobName, state: 'RUNNING' },
    { name: 'projects/demo/locations/us-central1/jobs/foreign', state: 'FAILED' },
    { name: current.externalJobName, state: 'PROCESSING_STATE_UNSPECIFIED' },
  ]) {
    assert.throws(() => buildProviderTerminalEvidence(current, observed, 1_800_000_000_010),
      /VIDEO_PROVIDER_TERMINAL_EVIDENCE_MISMATCH/);
  }
  assert.throws(() => buildProviderTerminalEvidence(current, {
    name: current.externalJobName, state: 'FAILED',
  }, 0), /VIDEO_PROVIDER_TERMINAL_EVIDENCE_MISMATCH/);
});

test('HTTP 403, HTTP 404 and local exceptions are errors, not terminal provider evidence', () => {
  const current = job();
  for (const status of [403, 404]) {
    const error = new AxiosError('provider lookup failed', undefined, undefined, undefined, {
      status,
      data: { error: { status: status === 403 ? 'PERMISSION_DENIED' : 'NOT_FOUND' } },
      statusText: String(status),
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
    const normalized = normalizeGoogleTranscoderError(error);
    assert.equal(normalized.retryable, false);
    assert.notEqual(normalized.code, 'FAILED');
    assert.equal(matchesProviderTerminalEvidence({
      ...current, state: 'FAILED', providerState: 'FAILED', providerTerminalEvidence: null,
    }), false);
  }
  const local = normalizeGoogleTranscoderError(new Error('client exception'));
  assert.equal(local.code, 'TRANSCODER_CLIENT_ERROR');
  assert.equal(local.retryable, false);
});
