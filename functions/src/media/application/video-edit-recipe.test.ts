import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasEffectiveVideoEdit,
  normalizeVideoEditRecipe,
  resolveEditedVideoDurationMs,
  resolveVideoEditGeometry,
  VideoEditRecipeValidationError,
  withoutVideoRotation,
} from './video-edit-recipe';

describe('video-edit-recipe', () => {
  it('mantém edição neutra como padrão', () => {
    const recipe = normalizeVideoEditRecipe({}, 60_000);

    assert.deepEqual(recipe, {
      version: 1,
      trimStartMs: 0,
      trimEndMs: null,
      aspectRatio: 'ORIGINAL',
      rotationDegrees: 0,
      muteAudio: false,
      orientation: 'AUTO',
      sourceWidthPixels: null,
      sourceHeightPixels: null,
    });
    assert.equal(hasEffectiveVideoEdit(recipe, 60_000), false);
    assert.equal(resolveEditedVideoDurationMs(recipe, 60_000), 60_000);
  });

  it('normaliza corte, enquadramento, rotação e áudio', () => {
    const recipe = normalizeVideoEditRecipe({
      trimStartMs: 5_000,
      trimEndMs: 25_000,
      aspectRatio: 'vertical_9_16',
      rotationDegrees: 90,
      muteAudio: true,
      sourceWidthPixels: 1920,
      sourceHeightPixels: 1080,
    }, 30_000);

    assert.equal(hasEffectiveVideoEdit(recipe, 30_000), true);
    assert.equal(resolveEditedVideoDurationMs(recipe, 30_000), 20_000);
    assert.equal(recipe.aspectRatio, 'VERTICAL_9_16');
    assert.equal(recipe.rotationDegrees, 90);
    assert.equal(recipe.muteAudio, true);
  });

  it('troca as dimensões de origem após um quarto de volta', () => {
    const recipe = normalizeVideoEditRecipe({
      rotationDegrees: 90,
      sourceWidthPixels: 1920,
      sourceHeightPixels: 1080,
    }, 30_000);
    const geometry = resolveVideoEditGeometry(recipe);
    const rotated = withoutVideoRotation(recipe);

    assert.ok(geometry);
    assert.equal(geometry.outputWidthPixels, 720);
    assert.equal(geometry.outputHeightPixels, 1280);
    assert.equal(rotated.rotationDegrees, 0);
    assert.equal(rotated.sourceWidthPixels, 1080);
    assert.equal(rotated.sourceHeightPixels, 1920);
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

  it('rejeita rotação fora dos quatro ângulos permitidos', () => {
    assert.throws(
      () => normalizeVideoEditRecipe({
        rotationDegrees: 45,
        sourceWidthPixels: 1920,
        sourceHeightPixels: 1080,
      }, 30_000),
      VideoEditRecipeValidationError
    );
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

  it('rejeita enquadramento sem dimensões conhecidas', () => {
    assert.throws(
      () => normalizeVideoEditRecipe({
        aspectRatio: 'SQUARE_1_1',
      }, 10_000),
      VideoEditRecipeValidationError
    );
  });

  it('rejeita rotação sem dimensões conhecidas', () => {
    assert.throws(
      () => normalizeVideoEditRecipe({ rotationDegrees: 90 }, 10_000),
      VideoEditRecipeValidationError
    );
  });
});
