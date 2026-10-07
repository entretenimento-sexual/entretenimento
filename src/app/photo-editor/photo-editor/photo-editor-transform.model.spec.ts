import { describe, expect, it } from 'vitest';

import {
  PHOTO_EDITOR_FULL_CROP_RECT,
  createPhotoEditorCropRect,
  isFullPhotoEditorCropRect,
  normalizePhotoEditorCropRect,
  resolvePhotoEditorCropOutputGeometry,
} from './photo-editor-transform.model';

describe('photo editor transform model', () => {
  it('normaliza recorte e mantém a área dentro do canvas', () => {
    expect(
      normalizePhotoEditorCropRect({
        x: 0.9,
        y: -1,
        width: 0.8,
        height: 3,
      })
    ).toEqual({
      x: 0.9,
      y: 0,
      width: 0.1,
      height: 1,
    });
  });

  it('cria recorte no sentido inverso sem depender da direção do arraste', () => {
    const crop = createPhotoEditorCropRect(
      { x: 0.8, y: 0.7 },
      { x: 0.2, y: 0.1 }
    );

    expect(crop.x).toBeCloseTo(0.2, 10);
    expect(crop.y).toBeCloseTo(0.1, 10);
    expect(crop.width).toBeCloseTo(0.6, 10);
    expect(crop.height).toBeCloseTo(0.6, 10);
  });

  it('reconhece somente o recorte integral como estado neutro', () => {
    expect(isFullPhotoEditorCropRect(PHOTO_EDITOR_FULL_CROP_RECT)).toBe(true);
    expect(
      isFullPhotoEditorCropRect({ x: 0.01, y: 0, width: 0.99, height: 1 })
    ).toBe(false);
  });

  it('resolve geometria de exportação sem ultrapassar canvas ou edge canônico', () => {
    const geometry = resolvePhotoEditorCropOutputGeometry(
      1000,
      800,
      { x: 0.1, y: 0.2, width: 0.5, height: 0.25 },
      2048
    );

    expect(geometry).toEqual({
      sourceX: 100,
      sourceY: 160,
      sourceWidth: 500,
      sourceHeight: 200,
      outputWidth: 2048,
      outputHeight: 819,
    });
  });

  it('mantém o recorte extremo dentro dos limites físicos da imagem', () => {
    const geometry = resolvePhotoEditorCropOutputGeometry(
      640,
      480,
      { x: 0.95, y: 0.94, width: 0.5, height: 0.5 },
      1024
    );

    expect(geometry.sourceX + geometry.sourceWidth).toBeLessThanOrEqual(640);
    expect(geometry.sourceY + geometry.sourceHeight).toBeLessThanOrEqual(480);
    expect(Math.max(geometry.outputWidth, geometry.outputHeight)).toBeLessThanOrEqual(
      1024
    );
  });
});
