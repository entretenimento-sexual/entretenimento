import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeVideoProbeJson, VideoProbeError } from './video-probe.mjs';

const video = (overrides = {}, audio = true) => ({
  format: { duration: '20.5' },
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
      sample_aspect_ratio: '1:1', ...overrides },
    ...(audio ? [{ codec_type: 'audio', codec_name: 'aac' }] : []),
  ],
});

describe('video probe metadata normalization', () => {
  it('handles landscape and actual codec and audio', () => {
    assert.deepEqual(normalizeVideoProbeJson(video()), {
      widthPixels: 1920, heightPixels: 1080,
      displayAspectNumerator: 1920, displayAspectDenominator: 1080,
      sampleAspectRatio: { numerator: 1, denominator: 1 },
      embeddedRotationDegrees: 0, durationMs: 20500,
      videoCodec: 'h264', hasAudio: true, audioCodec: 'aac',
    });
  });
  it('handles portrait videos without an audio stream', () => {
    const result = normalizeVideoProbeJson(video({ width: 720, height: 1280 }, false));
    assert.equal(result.hasAudio, false);
    assert.equal(result.audioCodec, null);
    assert.equal(result.heightPixels, 1280);
  });
  it('preserves non-square pixel sample aspect ratio for future geometry', () => {
    const result = normalizeVideoProbeJson(video({ sample_aspect_ratio: '4:3' }));
    assert.equal(result.displayAspectNumerator, 7680);
    assert.equal(result.displayAspectDenominator, 3240);
  });
  it('interprets rotation stored in display-matrix metadata', () => {
    const result = normalizeVideoProbeJson(video({ side_data_list: [{ rotation: -90 }] }));
    assert.equal(result.embeddedRotationDegrees, 270);
  });
  it('rejects spoofed or incomplete video metadata', () => {
    assert.throws(() => normalizeVideoProbeJson({ streams: [] }), VideoProbeError);
    assert.throws(() => normalizeVideoProbeJson(video({ width: 0 })),
      { code: 'VIDEO_PROBE_INVALID_DIMENSIONS' });
    assert.throws(() => normalizeVideoProbeJson({ ...video(), format: { duration: 'NaN' } }),
      { code: 'VIDEO_PROBE_INVALID_DURATION' });
  });
  it('rejects fractional or unsupported rotations', () => {
    assert.throws(() => normalizeVideoProbeJson(video({ tags: { rotate: '45' } })),
      { code: 'VIDEO_PROBE_UNSUPPORTED_ROTATION' });
  });
});
