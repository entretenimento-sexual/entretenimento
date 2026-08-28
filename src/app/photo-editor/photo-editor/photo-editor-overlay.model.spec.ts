// src/app/photo-editor/photo-editor/photo-editor-overlay.model.spec.ts
import { describe, expect, it } from 'vitest';

import {
  clonePhotoEditorOverlays,
  createPhotoEditorDateTimeMeta,
  formatPhotoEditorDateTime,
  hitTestPhotoEditorOverlay,
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

    expect(overlay).not.toBeNull();
    expect(overlay?.kind).toBe('blur');
    expect(overlay?.x).toBeCloseTo(0.2, 10);
    expect(overlay?.y).toBeCloseTo(0.1, 10);
    expect(overlay?.width).toBeCloseTo(0.6, 10);
    expect(overlay?.height).toBeCloseTo(0.6, 10);
    expect(overlay?.strength).toBeCloseTo(0.03, 10);
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
        fontFamily: 'invalid',
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
      fontFamily: 'system',
    });
  });

  it('formata data e hora conforme a escolha do usuário', () => {
    const referenceDate = new Date(2026, 6, 13, 18, 0, 0);

    expect(
      formatPhotoEditorDateTime(
        {
          date: '2026-07-13',
          time: '15:42',
          format: 'instagram',
          includeYear: false,
        },
        referenceDate
      )
    ).toBe('13 JUL • 15:42');

    expect(
      formatPhotoEditorDateTime(
        {
          date: '2026-07-13',
          time: '15:42',
          format: 'numeric',
          includeYear: true,
        },
        referenceDate
      )
    ).toBe('13/07/2026 • 15:42');

    expect(
      formatPhotoEditorDateTime(
        {
          date: '2026-07-13',
          time: '15:42',
          format: 'today',
          includeYear: false,
        },
        referenceDate
      )
    ).toBe('HOJE • 15:42');
  });

  it('cria metadados de data e hora manipuláveis', () => {
    expect(createPhotoEditorDateTimeMeta(new Date(2026, 6, 13, 9, 5))).toEqual({
      date: '2026-07-13',
      time: '09:05',
      format: 'instagram',
      includeYear: false,
    });
  });

  it('seleciona o elemento superior atingido pelo ponteiro', () => {
    const overlays = normalizePhotoEditorOverlays([
      {
        id: 'text-bottom',
        kind: 'text',
        x: 0.5,
        y: 0.5,
        size: 0.1,
        value: 'Fundo',
        style: 'classic',
        fontFamily: 'system',
      },
      {
        id: 'emoji-top',
        kind: 'emoji',
        x: 0.5,
        y: 0.5,
        size: 0.1,
        value: '🔒',
        style: 'classic',
        fontFamily: 'system',
      },
    ]);
    const context = {
      save: () => undefined,
      restore: () => undefined,
      measureText: (value: string) => ({ width: value.length * 12 }),
      font: '',
    } as unknown as CanvasRenderingContext2D;

    expect(
      hitTestPhotoEditorOverlay(
        overlays,
        { x: 0.5, y: 0.5 },
        800,
        600,
        context
      )?.id
    ).toBe('emoji-top');
  });

  it('clona metadados de data/hora sem compartilhar referências', () => {
    const source = normalizePhotoEditorOverlays([
      {
        id: 'datetime-1',
        kind: 'datetime',
        x: 0.5,
        y: 0.5,
        size: 0.1,
        value: 'ignorado',
        style: 'badge',
        fontFamily: 'condensed',
        dateTimeMeta: {
          date: '2026-07-13',
          time: '15:42',
          format: 'instagram',
          includeYear: false,
        },
      },
    ]);
    const cloned = clonePhotoEditorOverlays(source);

    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    expect(cloned[0]).not.toBe(source[0]);

    if (cloned[0]?.kind === 'datetime' && source[0]?.kind === 'datetime') {
      expect(cloned[0].dateTimeMeta).not.toBe(source[0].dateTimeMeta);
    }
  });
});
