import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyVideoSourceProbeFailure,
  createVideoSourceProbeSnapshot,
  matchesVideoSourceProbeSnapshot,
  nextVideoSourceProbeRetryAt,
} from './video-source-probe.policy';

const job = {
  processingVersion: '123-uuid',
  sourceStoragePath: 'users/a/private/videos/b/original.mp4',
  sourceGeneration: '123456789',
  sourceSizeBytes: 800_000,
};
const inspected = {
  widthPixels: 1920,
  heightPixels: 1080,
  durationMs: 12_000,
  embeddedRotationDegrees: 0,
  displayAspectNumerator: 1920,
  displayAspectDenominator: 1080,
  sampleAspectRatio: { numerator: 1, denominator: 1 },
  videoCodec: 'h264',
  hasAudio: false,
  audioCodec: null,
  sourceGeneration: '123456789',
  sourceSizeBytes: 800_000,
};

describe('video source probe snapshot', () => {
  it('salva apenas medições válidas de uma origem fixada e aceita vídeo silencioso', () => {
    const snapshot = createVideoSourceProbeSnapshot(job, inspected, 1000);
    assert.equal(snapshot.hasAudio, false);
    assert.ok(matchesVideoSourceProbeSnapshot(job, snapshot));
  });
  it('rejeita mudança de geração, bytes ou versão', () => {
    const snapshot = createVideoSourceProbeSnapshot(job, inspected, 1000);
    assert.equal(matchesVideoSourceProbeSnapshot({ ...job, processingVersion: 'new' }, snapshot), false);
    assert.equal(matchesVideoSourceProbeSnapshot({ ...job, sourceGeneration: '99' }, snapshot), false);
    assert.equal(matchesVideoSourceProbeSnapshot({ ...job, sourceSizeBytes: 12 }, snapshot), false);
    assert.throws(() => createVideoSourceProbeSnapshot(job, {
      ...inspected, sourceGeneration: '99',
    }, 1000));
  });
  it('não aceita medidas inválidas vindas do worker', () => {
    assert.throws(() => createVideoSourceProbeSnapshot(job, {
      ...inspected, widthPixels: -1,
    }, 1000));
    assert.equal(matchesVideoSourceProbeSnapshot(job, {
      ...inspected, processingVersion: job.processingVersion,
      sourceStoragePath: job.sourceStoragePath, checkedAt: 'bad',
    }), false);
  });
  it('separa erros definitivos de indisponibilidade sem refletir mensagem técnica', () => {
    const permanent = classifyVideoSourceProbeFailure({code: 'VIDEO_PROBE_NO_VIDEO_STREAM'});
    assert.equal(permanent.retryable, false);
    assert.equal(permanent.code, 'VIDEO_PROBE_NO_VIDEO_STREAM');
    const temporary = classifyVideoSourceProbeFailure(new Error('file path PRIVATE'));
    assert.equal(temporary.retryable, true);
    assert.equal(temporary.code, 'VIDEO_PROBE_UNAVAILABLE');
  });
  it('limita backoff sem esgotar o vídeo por indisponibilidade de serviço', () => {
    assert.equal(nextVideoSourceProbeRetryAt(1000, 1), 61_000);
    assert.equal(nextVideoSourceProbeRetryAt(1000, 99), 3_601_000);
  });
});
