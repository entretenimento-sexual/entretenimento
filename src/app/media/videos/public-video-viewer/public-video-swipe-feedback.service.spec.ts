import { describe, expect, it } from 'vitest';

import { resolvePublicVideoSwipeFeedback } from './public-video-swipe-feedback.service';

describe('public video swipe feedback', () => {
  it('permanece oculto antes de existir intenção vertical suficiente', () => {
    expect(resolvePublicVideoSwipeFeedback({
      deltaX: 2,
      deltaY: -12,
      canNavigateNext: true,
      canNavigatePrevious: false,
    }).direction).toBeNull();
  });

  it('permanece oculto em movimento predominantemente horizontal', () => {
    expect(resolvePublicVideoSwipeFeedback({
      deltaX: 90,
      deltaY: -28,
      canNavigateNext: true,
      canNavigatePrevious: false,
    }).direction).toBeNull();
  });

  it('mostra progresso para o próximo vídeo antes do limiar', () => {
    const state = resolvePublicVideoSwipeFeedback({
      deltaX: 3,
      deltaY: -32,
      canNavigateNext: true,
      canNavigatePrevious: false,
    });

    expect(state.direction).toBe('next');
    expect(state.progress).toBeCloseTo(0.5);
    expect(state.ready).toBe(false);
    expect(state.label).toContain('Continue deslizando');
  });

  it('orienta soltar quando o gesto para o próximo vídeo atinge o limiar', () => {
    const state = resolvePublicVideoSwipeFeedback({
      deltaX: 4,
      deltaY: -80,
      canNavigateNext: true,
      canNavigatePrevious: true,
    });

    expect(state.direction).toBe('next');
    expect(state.progress).toBe(1);
    expect(state.ready).toBe(true);
    expect(state.label).toBe('Solte para abrir o próximo vídeo');
  });

  it('indica o início da galeria sem sugerir navegação impossível', () => {
    const state = resolvePublicVideoSwipeFeedback({
      deltaX: 1,
      deltaY: 90,
      canNavigateNext: true,
      canNavigatePrevious: false,
    });

    expect(state.direction).toBe('previous');
    expect(state.available).toBe(false);
    expect(state.ready).toBe(false);
    expect(state.label).toBe('Início da galeria');
  });
});
