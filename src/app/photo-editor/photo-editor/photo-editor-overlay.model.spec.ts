// src/app/photo-editor/photo-editor/photo-editor-overlay.model.spec.ts
import { describe, expect, it } from 'vitest';

import {
  clonePhotoEditorOverlays,
  normalizePhotoEditorOverlays,
  privacyRegionFromDraft,
} from './photo-editor-overlay.model';

describe('photo editor overlay model', () => {
  it('normaliza seleção de privacidade arrastada no sentido inverso', () => {
    const overlay = privacyRegionFromDraft({
      kind: 'blur',
      startX: 0.8,
      startY: 0.7,
      endX: 0.2,
      endY: 0.1,
      strength: 0.03,
    });

    expect(overlay).toMatchObject({
      kind: 'blur',
      x: 0.2,
      y: 0.1,
      width: 0.6,
      height: 0.6,
      strength: 0.03,
    });
  });

  it('descarta seleção pequena demais para produzir proteção acidental', () => {
    const overlay = privacyRegionFromDraft({
      kind: 'pixelate',
      startX: 0.5,
      startY: 0.5,
      endX: 0.505,
      endY: 0.505,
      strength: 0.03,
    });

    expect(overlay).toBeNull();
  });

  it('normaliza elementos persistidos e limita valores inseguros', () => {
    const overlays = normalizePhotoEditorOverlays([
      {
        id: 'privacy-1',
        kind: 'pixelate',
        x: -1,
        y: 0.4,
        width: 4,
        height: 4,
        strength: 1,
      },
      {
        id: 'text-1',
        kind: 'text',
        x: 2,
        y: -2,
        size: 3,
        value: '  Texto de teste  ',
        style: 'invalid',
      },
    ]);

    expect(overlays[0]).toMatchObject({
      kind: 'pixelate',
      x: 0,
      y: 0.4,
      width: 1,
      height: 0.6,
      strength: 0.08,
    });
    expect(overlays[1]).toMatchObject({
      kind: 'text',
      x: 1,
      y: 0,
      size: 0.28,
      value: 'Texto de teste',
      style: 'classic',
    });
  });

  it('clona o histórico sem compartilhar os objetos das anotações', () => {
    const source = normalizePhotoEditorOverlays([
      {
        id: 'emoji-1',
        kind: 'emoji',
        x: 0.5,
        y: 0.5,
        size: 0.1,
        value: '🔒',
        style: 'classic',
      },
    ]);
    const cloned = clonePhotoEditorOverlays(source);

    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    expect(cloned[0]).not.toBe(source[0]);
  });
});
