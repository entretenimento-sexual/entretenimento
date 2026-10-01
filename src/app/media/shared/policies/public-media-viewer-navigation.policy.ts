export type PublicMediaViewerSwipeAxis = 'horizontal' | 'vertical';
export type PublicMediaViewerNavigationDirection = 'previous' | 'next';

export interface PublicMediaViewerSwipeGesture {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startedAt: number;
}

export interface PublicMediaViewerSwipeOptions {
  axis: PublicMediaViewerSwipeAxis;
  blockedTargetSelector: string;
  navigationAvailable: boolean;
  disabled?: boolean;
}

export const PUBLIC_MEDIA_VIEWER_SWIPE_MIN_DISTANCE_PX = 64;
export const PUBLIC_MEDIA_VIEWER_SWIPE_INTENT_DISTANCE_PX = 18;
export const PUBLIC_MEDIA_VIEWER_SWIPE_AXIS_DOMINANCE = 1.2;
export const PUBLIC_MEDIA_VIEWER_SWIPE_MAX_DURATION_MS = 800;

export const PUBLIC_MEDIA_VIEWER_BLOCKED_TARGET_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'option',
  'label',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="slider"]',
].join(',');

export function canStartPublicMediaViewerSwipe(
  event: PointerEvent,
  options: PublicMediaViewerSwipeOptions
): boolean {
  const pointerType = String(event.pointerType ?? '').trim().toLowerCase();

  if (
    pointerType === 'mouse' ||
    event.isPrimary === false ||
    event.button !== 0 ||
    options.disabled === true ||
    !options.navigationAvailable
  ) {
    return false;
  }

  return !isPublicMediaViewerNavigationTargetBlocked(
    event.target,
    options.blockedTargetSelector
  );
}

export function createPublicMediaViewerSwipeGesture(
  event: PointerEvent
): PublicMediaViewerSwipeGesture {
  return {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    startedAt: Date.now(),
  };
}

export function updatePublicMediaViewerSwipeGesture(
  gesture: PublicMediaViewerSwipeGesture,
  event: PointerEvent,
  axis: PublicMediaViewerSwipeAxis
): boolean {
  if (gesture.pointerId !== event.pointerId) {
    return false;
  }

  gesture.lastX = event.clientX;
  gesture.lastY = event.clientY;

  const deltaX = gesture.lastX - gesture.startX;
  const deltaY = gesture.lastY - gesture.startY;
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);

  const primaryDistance =
    axis === 'horizontal' ? horizontalDistance : verticalDistance;
  const crossDistance =
    axis === 'horizontal' ? verticalDistance : horizontalDistance;

  return (
    primaryDistance >= PUBLIC_MEDIA_VIEWER_SWIPE_INTENT_DISTANCE_PX &&
    primaryDistance > crossDistance * PUBLIC_MEDIA_VIEWER_SWIPE_AXIS_DOMINANCE
  );
}

export function resolvePublicMediaViewerSwipeDirection(
  gesture: PublicMediaViewerSwipeGesture,
  event: PointerEvent,
  axis: PublicMediaViewerSwipeAxis,
  now = Date.now()
): PublicMediaViewerNavigationDirection | null {
  if (gesture.pointerId !== event.pointerId) {
    return null;
  }

  const deltaX = event.clientX - gesture.startX;
  const deltaY = event.clientY - gesture.startY;
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  const primaryDistance =
    axis === 'horizontal' ? horizontalDistance : verticalDistance;
  const crossDistance =
    axis === 'horizontal' ? verticalDistance : horizontalDistance;
  const durationMs = now - gesture.startedAt;

  if (
    durationMs > PUBLIC_MEDIA_VIEWER_SWIPE_MAX_DURATION_MS ||
    primaryDistance < PUBLIC_MEDIA_VIEWER_SWIPE_MIN_DISTANCE_PX ||
    primaryDistance <=
      crossDistance * PUBLIC_MEDIA_VIEWER_SWIPE_AXIS_DOMINANCE
  ) {
    return null;
  }

  if (axis === 'horizontal') {
    return deltaX > 0 ? 'previous' : 'next';
  }

  return deltaY < 0 ? 'next' : 'previous';
}

export function canUsePublicMediaViewerKeyboardNavigation(
  event: KeyboardEvent,
  blockedTargetSelector: string,
  disabled = false
): boolean {
  if (
    disabled ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }

  return !isPublicMediaViewerNavigationTargetBlocked(
    event.target,
    blockedTargetSelector,
    false
  );
}

export function isPublicMediaViewerNavigationTargetBlocked(
  target: EventTarget | null,
  blockedTargetSelector: string,
  blockUnknownTarget = true
): boolean {
  if (!(target instanceof Element)) {
    return blockUnknownTarget;
  }

  return !!target.closest(blockedTargetSelector);
}
