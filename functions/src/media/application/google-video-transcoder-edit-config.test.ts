import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildEditedTranscoderJobConfig,
  buildNeutralSingleMp4Config,
} from './google-video-transcoder-edit-config';
import { normalizeVideoEditRecipe } from './video-edit-recipe';

describe('google-video-transcoder-edit-config', () => {
  it('não substitui o preset quando não existe edição efetiva', () => {
    const recipe = normalizeVideoEditRecipe({}, 20_000);

    assert.equal(buildEditedTranscoderJobConfig({
      inputUri: 'gs://bucket/input.mp4',
      outputUri: 'gs://bucket/output/',
      recipe,
      sourceDurationMs: 20_000,
    }), null);
  });

  it('gera um único MP4 com corte e áudio', () => {
    const recipe = normalizeVideoEditRecipe({
      trimStartMs: 2_000,
      trimEndMs: 18_000,
      sourceWidthPixels: 1920,
      sourceHeightPixels: 1080,
    }, 20_000);
    const config = buildEditedTranscoderJobConfig({
      inputUri: 'gs://bucket/input.mp4',
      outputUri: 'gs://bucket/output/',
      recipe,
      sourceDurationMs: 20_000,
    });

    assert.ok(config);
    assert.equal(config.editList[0]?.startTimeOffset, '2s');
    assert.equal(config.editList[0]?.endTimeOffset, '18s');
    assert.deepEqual(
      config.muxStreams[0]?.elementaryStreams,
      ['video-stream0', 'audio-stream0']
    );
    assert.equal(config.muxStreams[0]?.fileName, 'playback.mp4');
  });

  it('remove a faixa de áudio e aplica crop central', () => {
    const recipe = normalizeVideoEditRecipe({
      aspectRatio: 'SQUARE_1_1',
      muteAudio: true,
      sourceWidthPixels: 1920,
      sourceHeightPixels: 1080,
    }, 20_000);
    const config = buildEditedTranscoderJobConfig({
      inputUri: 'gs://bucket/input.mp4',
      outputUri: 'gs://bucket/output/',
      recipe,
      sourceDurationMs: 20_000,
    });

    assert.ok(config);
    assert.equal(config.elementaryStreams.length, 1);
    assert.deepEqual(
      config.muxStreams[0]?.elementaryStreams,
      ['video-stream0']
    );
    assert.ok(config.inputs[0]?.preprocessingConfig?.crop.leftPixels);
    assert.equal(
      config.elementaryStreams[0]?.videoStream?.h264.widthPixels,
      720
    );
    assert.equal(
      config.elementaryStreams[0]?.videoStream?.h264.heightPixels,
      720
    );
  });

  it('neutral landscape produces one 720p MP4 and no adaptive manifests', () => {
    const recipe = normalizeVideoEditRecipe({
      sourceWidthPixels: 1920, sourceHeightPixels: 1080,
    }, 20_000);
    const config = buildNeutralSingleMp4Config({
      inputUri: 'gs://bucket/input.mp4',
      outputUri: 'gs://bucket/output/',
      recipe,
      sourceDurationMs: 20_000,
    });
    assert.ok(config);
    assert.equal(config.inputs.length, 1);
    assert.equal(config.muxStreams.length, 1);
    assert.equal(config.muxStreams[0]?.fileName, 'playback.mp4');
    assert.equal(config.elementaryStreams[0]?.videoStream?.h264.widthPixels, undefined);
    assert.equal(config.elementaryStreams[0]?.videoStream?.h264.heightPixels, 720);
    assert.deepEqual(config.muxStreams[0]?.elementaryStreams,
      ['video-stream0', 'audio-stream0']);
    assert.equal(config.editList[0]?.startTimeOffset, '0s');
    assert.equal(config.editList[0]?.endTimeOffset, undefined);
  });

  it('neutral portrait delegates actual aspect ratio to Transcoder', () => {
    const recipe = normalizeVideoEditRecipe({
      sourceWidthPixels: 1080, sourceHeightPixels: 1920,
    }, 20_000);
    const config = buildNeutralSingleMp4Config({
      inputUri: 'gs://bucket/input.mp4',
      outputUri: 'gs://bucket/output/',
      recipe,
      sourceDurationMs: 20_000,
    });
    assert.ok(config);
    assert.equal(config.elementaryStreams[0]?.videoStream?.h264.widthPixels, 720);
    assert.equal(config.elementaryStreams[0]?.videoStream?.h264.heightPixels, undefined);
    const small = normalizeVideoEditRecipe({
      sourceWidthPixels: 480, sourceHeightPixels: 270,
    }, 20_000);
    const smaller = buildNeutralSingleMp4Config({
      inputUri: 'gs://bucket/input.mp4',
      outputUri: 'gs://bucket/output/',
      recipe: small,
      sourceDurationMs: 20_000,
    });
    assert.ok(smaller);
    assert.equal(smaller.elementaryStreams[0]?.videoStream?.h264.widthPixels, undefined);
    assert.equal(smaller.elementaryStreams[0]?.videoStream?.h264.heightPixels, 270);
  });

  it('missing dimensions retain the existing safe template fallback', () => {
    const input = {
      inputUri: 'gs://bucket/input.mp4',
      outputUri: 'gs://bucket/output/',
      recipe: normalizeVideoEditRecipe({}, 20_000),
      sourceDurationMs: 20_000,
    };
    assert.equal(buildNeutralSingleMp4Config(input), null);
    assert.equal(buildEditedTranscoderJobConfig(input), null);
    const edited = normalizeVideoEditRecipe({
      trimStartMs: 1000, sourceWidthPixels: 1920, sourceHeightPixels: 1080,
    }, 20_000);
    assert.equal(buildNeutralSingleMp4Config({ ...input, recipe: edited }), null);
    assert.ok(buildEditedTranscoderJobConfig({ ...input, recipe: edited }));
  });
});
