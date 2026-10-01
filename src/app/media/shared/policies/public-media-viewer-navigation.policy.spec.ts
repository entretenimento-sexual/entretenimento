import { describe, expect, it } from 'vitest';

import {
  PUBLIC_MEDIA_VIEWER_BLOCKED_TARGET_SELECTOR,
  canStartPublicMediaViewerSwipe,
  canUsePublicMediaViewerKeyboardNavigation,
  createPublicMediaViewerSwipeGesture,
  resolvePublicMediaViewerSwipeDirection,
  updatePublicMediaViewerSwipeGesture,
} from './public-media-viewer-navigation.policy';

function pointerEventLike(input: Partial<PointerEvent>): PointerEvent {
  return {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 0,
    clientY: 0,
    cancelable: true,
    target: document.createElement('div'),
    ...input,
  } as PointerEvent;
}

describe('public media viewer navigation policy', () => {
  it('inicia swipe apenas com ponteiro válido, navegação disponível e target livre', () => {
    expect(
      canStartPublicMediaViewerSwipe(pointerEventLike({}), {
        axis: 'horizontal',
        blockedTargetSelector: PUBLIC_MEDIA_VIEWER_BLOCKED_TARGET_SELECTOR,
        navigationAvailable: true,
      })
    ).toBe(true);

    expect(
      canStartPublicMediaViewerSwipe(
        pointerEventLike({ pointerType: 'mouse' }),
        {
          axis: 'horizontal',
          blockedTargetSelector: PUBLIC_MEDIA_VIEWER_BLOCKED_TARGET_SELECTOR,
          navigationAvailable: true,
        }
      )
    ).toBe(false);
  });

  it('detecta intenção dominante no eixo configurado', () => {
    const gesture = createPublicMediaViewerSwipeGesture(
      pointerEventLike({ clientX: 10, clientY: 10 })
    );

    expect(
      updatePublicMediaViewerSwipeGesture(
        gesture,
        pointerEventLike({ clientX: 42, clientY: 14 }),
        'horizontal'
      )
    ).toBe(true);

    expect(
      updatePublicMediaViewerSwipeGesture(
        gesture,
        pointerEventLike({ clientX: 44, clientY: 70 }),
        'horizontal'
      )
    ).toBe(false);
  });

  it('resolve direções horizontal e vertical sem duplicar thresholds', () => {
    const horizontal = {
      pointerId: 1,
      startX: 100,
      startY: 100,
      lastX: 100,
      lastY: 100,
      startedAt: 1000,
    };
    const vertical = { ...horizontal };

    expect(
      resolvePublicMediaViewerSwipeDirection(
        horizontal,
        pointerEventLike({ clientX: 20, clientY: 104 }),
        'horizontal',
        1200
      )
    ).toBe('next');

    expect(
      resolvePublicMediaViewerSwipeDirection(
        vertical,
        pointerEventLike({ clientX: 104, clientY: 20 }),
        'vertical',
        1200
      )
    ).toBe('next');
  });

  it('ignora gesto curto/lento e teclado com modificadores', () => {
    const gesture = {
      pointerId: 1,
      startX: 100,
      startY: 100,
      lastX: 100,
      lastY: 100,
      startedAt: 1000,
    };

    expect(
      resolvePublicMediaViewerSwipeDirection(
        gesture,
        pointerEventLike({ clientX: 70, clientY: 100 }),
        'horizontal',
        1200
      )
    ).toBeNull();

    expect(
      resolvePublicMediaViewerSwipeDirection(
        gesture,
        pointerEventLike({ clientX: 0, clientY: 100 }),
        'horizontal',
        1900
      )
    ).toBeNull();

    expect(
      canUsePublicMediaViewerKeyboardNavigation(
        {
          altKey: false,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          target: document.createElement('div'),
        } as KeyboardEvent,
        PUBLIC_MEDIA_VIEWER_BLOCKED_TARGET_SELECTOR
      )
    ).toBe(false);
  });
});
