import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasEffectiveVideoEdit,
  MAX_SOURCE_VIDEO_DURATION_MS,
  normalizeVideoEditRecipe,
  resolveEditedVideoDurationMs,
  resolveVideoEditGeometry,
  VideoEditRecipeValidationError,
} from './video-edit-recipe';

describe('video-edit-recipe', () => {
  it('mantém edição neutra como padrão', () => {
    const recipe = normalizeVideoEditRecipe({}, 60_000);

    assert.deepEqual(recipe, {
      version: 1,
      trimStartMs: 0,
      trimEndMs: null,
      aspectRatio: 'ORIGINAL',
      muteAudio: false,
      orientation: 'AUTO',
      sourceWidthPixels: null,
      sourceHeightPixels: null,
    });
    assert.equal(hasEffectiveVideoEdit(recipe, 60_000), false);
    assert.equal(resolveEditedVideoDurationMs(recipe, 60_000), 60_000);
  });

  it('normaliza corte, enquadramento e áudio', () => {
    const recipe = normalizeVideoEditRecipe({
      trimStartMs: 5_000,
      trimEndMs: 25_000,
      aspectRatio: 'vertical_9_16',
      muteAudio: true,
      sourceWidthPixels: 1920,
      sourceHeightPixels: 1080,
    }, 30_000);

    assert.equal(hasEffectiveVideoEdit(recipe, 30_000), true);
    assert.equal(resolveEditedVideoDurationMs(recipe, 30_000), 20_000);
    assert.equal(recipe.aspectRatio, 'VERTICAL_9_16');
    assert.equal(recipe.muteAudio, true);
  });

  it('gera corte central e saída vertical sem ampliar o vídeo', () => {
    const recipe = normalizeVideoEditRecipe({
      aspectRatio: 'VERTICAL_9_16',
      sourceWidthPixels: 1920,
      sourceHeightPixels: 1080,
    }, 30_000);
    const geometry = resolveVideoEditGeometry(recipe);

    assert.ok(geometry);
    assert.equal(geometry.outputWidthPixels, 606);
    assert.equal(geometry.outputHeightPixels, 1080);
    assert.equal(
      geometry.crop.leftPixels + geometry.crop.rightPixels,
      1314
    );
    assert.equal(geometry.crop.topPixels, 0);
  });

  it('limita saída horizontal a 720p', () => {
    const recipe = normalizeVideoEditRecipe({
      sourceWidthPixels: 3840,
      sourceHeightPixels: 2160,
    }, 30_000);
    const geometry = resolveVideoEditGeometry(recipe);

    assert.deepEqual(geometry, {
      crop: {
        topPixels: 0,
        bottomPixels: 0,
        leftPixels: 0,
        rightPixels: 0,
      },
      outputWidthPixels: 1280,
      outputHeightPixels: 720,
    });
  });

  it('rejeita resultado com menos de cinco segundos', () => {
    assert.throws(
      () => normalizeVideoEditRecipe({
        trimStartMs: 8_000,
        trimEndMs: 10_000,
      }, 10_000),
      VideoEditRecipeValidationError
    );
  });

  it('rejeita vídeo original acima de sessenta segundos', () => {
    assert.equal(MAX_SOURCE_VIDEO_DURATION_MS, 60_000);
    assert.throws(
      () => normalizeVideoEditRecipe({}, 60_001),
      (error: unknown) =>
        error instanceof VideoEditRecipeValidationError &&
        error.message.includes('no máximo 60 segundos')
    );
  });

  it('rejeita enquadramento sem dimensões conhecidas', () => {
    assert.throws(
      () => normalizeVideoEditRecipe({
        aspectRatio: 'SQUARE_1_1',
      }, 10_000),
      VideoEditRecipeValidationError
    );
  });
});
