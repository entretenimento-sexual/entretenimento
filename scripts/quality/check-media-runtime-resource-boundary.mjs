// scripts/quality/check-media-runtime-resource-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA RUNTIME / ACCESSIBILITY / RESPONSIVENESS BOUNDARY
// -----------------------------------------------------------------------------
// Protege a experiência única Foto/Vídeo:
// - memória/CPU em dispositivos fracos;
// - editor local com pixel budget e teardown;
// - render windows e preload limitado/cancelável;
// - players liberam decoder/source;
// - troca de sessão limpa recursos temporários;
// - keyboard/focus sem roubo de foco;
// - touch, orientation, reduced motion e alvos mínimos.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    throw new Error('[media-runtime-resource] arquivo ausente: ' + relativePath);
  }
  return fs.readFileSync(absolute, 'utf8');
}

function requireIncludes(source, fragments, label) {
  const values = Array.isArray(fragments) ? fragments : [fragments];
  for (const fragment of values) {
    if (!source.includes(fragment)) {
      throw new Error(
        '[media-runtime-resource] ' + label + ': ausente ' + fragment
      );
    }
  }
}

function forbid(source, pattern, label) {
  if (pattern.test(source)) {
    throw new Error('[media-runtime-resource] ' + label);
  }
}

const manifest = JSON.parse(read('config/media-formats.json'));
const maxInteractivePixels = Number(
  manifest?.image?.editorLimits?.maxInteractivePixels
);
if (
  !Number.isSafeInteger(maxInteractivePixels) ||
  maxInteractivePixels <= 0 ||
  maxInteractivePixels > 16_000_000
) {
  throw new Error(
    '[media-runtime-resource] image.editorLimits.maxInteractivePixels inválido.'
  );
}

const photoEditor = read(
  'src/app/photo-editor/photo-editor/photo-editor.component.ts'
);
requireIncludes(photoEditor, [
  'MEDIA_IMAGE_EDITOR_MAX_INTERACTIVE_PIXELS',
  'assertInteractivePixelBudget(image)',
  'this.revokeSourceObjectUrl()',
  'this.resizeObserver?.disconnect()',
  'this.cancelScheduledRender()',
  'focus({ preventScroll: true })',
], 'photo editor');

const photoEditorCss = read(
  'src/app/photo-editor/photo-editor/photo-editor.component.css'
);
requireIncludes(photoEditorCss, [
  '100dvh',
  '@media (prefers-reduced-motion: reduce)',
  '@media (pointer: coarse)',
  'var(--tap-target, 44px)',
  'touch-action: none',
], 'photo editor responsive');

const communityWindow = read(
  'src/app/community/feed/community-feed-render-window.facade.ts'
);
requireIncludes(
  communityWindow,
  'COMMUNITY_FEED_RENDER_WINDOW_PAGES = 6',
  'community feed render window'
);

for (const pathName of [
  'src/app/media/photos/latest-public-photos/latest-public-photos.component.ts',
  'src/app/media/photos/top-public-photos/top-public-photos.component.ts',
]) {
  const source = read(pathName);
  requireIncludes(source, [
    'PHOTO_RENDER_WINDOW_MAX_ITEMS = 72',
    'renderItems',
  ], pathName + ' bounded render');
}

const publicVideos = read(
  'src/app/media/videos/public-profile-videos/public-profile-videos.component.ts'
);
requireIncludes(publicVideos, [
  'PUBLIC_VIDEO_RENDER_WINDOW_MAX_ITEMS = 36',
  'renderItems',
  'galleryRenderStartSubject',
], 'public video bounded render');

const preload = read(
  'src/app/core/services/media/public-video-metadata-preload.service.ts'
);
requireIncludes(preload, [
  'MAX_ACTIVE_METADATA_PRELOADS = 2',
  'MAX_ATTEMPTED_METADATA_KEYS = 256',
  'LOW_MEMORY_BLOCK_THRESHOLD_GB = 2',
  'LOW_MEMORY_SINGLE_PRELOAD_THRESHOLD_GB = 4',
  'deviceMemoryGb',
  'resolveMaxActiveMetadataPreloads',
  'cancelMetadataPreload',
  "video.removeAttribute('src')",
  'video.load()',
  'this.activeCleanups',
], 'video metadata preload');

const preloadDirective = read(
  'src/app/media/videos/public-video-metadata-preload.directive.ts'
);
requireIncludes(preloadDirective, [
  'new IntersectionObserver',
  'this.cancelCurrentPreload()',
  'this.observer?.disconnect()',
  "rootMargin: '160px 0px'",
], 'video preload viewport');

const videoAccess = read(
  'src/app/core/services/media/public-video-access.service.ts'
);
requireIncludes(videoAccess, [
  'MAX_ACCESS_CACHE_ENTRIES = 128',
  'setAccessCache(',
  'touchAccessCache(',
  'this.accessCache.clear()',
  'this.inFlightRefreshes.clear()',
  'this.authSession.uid$',
], 'public video access session/LRU');

const viewerNavigationPolicy = read(
  'src/app/media/shared/policies/public-media-viewer-navigation.policy.ts'
);
requireIncludes(viewerNavigationPolicy, [
  'PUBLIC_MEDIA_VIEWER_SWIPE_MIN_DISTANCE_PX = 64',
  'PUBLIC_MEDIA_VIEWER_SWIPE_INTENT_DISTANCE_PX = 18',
  'PUBLIC_MEDIA_VIEWER_SWIPE_AXIS_DOMINANCE = 1.2',
  'PUBLIC_MEDIA_VIEWER_SWIPE_MAX_DURATION_MS = 800',
  'resolvePublicMediaViewerSwipeDirection',
  'canUsePublicMediaViewerKeyboardNavigation',
], 'shared public media viewer navigation policy');

const videoViewer = read(
  'src/app/media/videos/public-video-viewer/public-video-viewer.component.ts'
);
requireIncludes(videoViewer, [
  'public-media-viewer-navigation.policy',
  'VIEWER_ITEM_WINDOW_MAX = 48',
  'VIEWER_ITEM_RETAIN_BEHIND = 12',
  'trimViewerItemWindow()',
  'releaseCurrentPlayerSource()',
  "player.removeAttribute('src')",
  'player.load()',
  'pairwise()',
  'handleViewerSessionChanged()',
  'this.publicVideoAccess.invalidatePublicVideoAccess(current)',
  'this.automaticRefreshKeys.clear()',
  'this.recordedViewKeys.clear()',
  "@HostListener('document:keydown.arrowleft'",
  "@HostListener('document:keydown.arrowright'",
  "@HostListener('document:keydown.arrowup'",
  "@HostListener('document:keydown.arrowdown'",
], 'video viewer runtime/a11y');
forbid(
  videoViewer,
  /player\.focus\s*\(/,
  'video viewer não pode roubar foco ao hidratar playback'
);

const videoViewerHtml = read(
  'src/app/media/videos/public-video-viewer/public-video-viewer.component.html'
);
requireIncludes(videoViewerHtml, [
  'cdkFocusInitial',
  'aria-live="polite"',
  'aria-keyshortcuts="Escape"',
  'aria-keyshortcuts="ArrowUp ArrowLeft"',
  'aria-keyshortcuts="ArrowDown ArrowRight"',
], 'video viewer template a11y');

const videoViewerCss = read(
  'src/app/media/videos/public-video-viewer/public-video-viewer.component.css'
);
requireIncludes(videoViewerCss, [
  '100dvh',
  'touch-action: pan-x pinch-zoom',
  '@media (pointer: coarse)',
  'var(--public-media-viewer-control-size)',
  '@media (max-height: 620px) and (orientation: landscape)',
  '@media (prefers-reduced-motion: reduce)',
], 'video viewer responsive');

const photoViewer = read(
  'src/app/media/photos/photo-viewer/photo-viewer.component.ts'
);
requireIncludes(photoViewer, [
  'public-media-viewer-navigation.policy',
  'onSwipePointerDown(',
  'onSwipePointerMove(',
  'onSwipePointerUp(',
  'cancelSwipeNavigation()',
  'navigationAnnouncement',
  "@HostListener('document:keydown.arrowleft'",
  "@HostListener('document:keydown.arrowright'",
  "@HostListener('document:keydown.arrowup'",
  "@HostListener('document:keydown.arrowdown'",
], 'photo viewer runtime/a11y');

const photoViewerHtml = read(
  'src/app/media/photos/photo-viewer/photo-viewer.component.html'
);
requireIncludes(photoViewerHtml, [
  'cdkFocusInitial',
  'navigationAnnouncement()',
  '(pointerdown)="onSwipePointerDown($event)"',
  'aria-keyshortcuts="ArrowLeft ArrowUp"',
  'aria-keyshortcuts="ArrowRight ArrowDown"',
], 'photo viewer template a11y');

const photoViewerCss = read(
  'src/app/media/photos/photo-viewer/photo-viewer.component.css'
);
requireIncludes(photoViewerCss, [
  '100dvh',
  'touch-action: pan-y pinch-zoom',
  '@media (pointer: coarse)',
  'var(--public-media-viewer-control-size)',
  '@media (max-height: 620px) and (orientation: landscape)',
  '@media (prefers-reduced-motion: reduce)',
], 'photo viewer responsive');

const photoCard = read(
  'src/app/media/shared/components/public-photo-card/public-photo-card.component.html'
);
const videoCard = read(
  'src/app/media/shared/components/public-video-card/public-video-card.component.html'
);
requireIncludes(photoCard, 'role="listitem"', 'photo card semantics');
requireIncludes(videoCard, 'role="listitem"', 'video card semantics');

const photoCardCss = read(
  'src/app/media/shared/components/public-photo-card/public-photo-card.component.css'
);
const videoCardCss = read(
  'src/app/media/shared/components/public-video-card/public-video-card.component.css'
);
for (const [source, label] of [
  [photoCardCss, 'photo card'],
  [videoCardCss, 'video card'],
]) {
  requireIncludes(source, [
    'focus-visible',
    '@media (prefers-reduced-motion: reduce)',
  ], label + ' focus/reduced-motion');
}
requireIncludes(photoCardCss, 'var(--tap-target, 44px)', 'photo card touch');
requireIncludes(videoCardCss, 'var(--tap-target, 44px)', 'video card touch');

const viewerTokens = read(
  'src/app/media/shared/styles/public-media-viewer.tokens.css'
);
requireIncludes(viewerTokens, [
  '--public-media-viewer-control-size: 44px',
  '--public-media-viewer-focus:',
], 'shared viewer tokens');

const videoEditorSession = read(
  'src/app/core/services/media/video-editor-session.service.ts'
);
requireIncludes(videoEditorSession, [
  'VIDEO_EDITOR_DRAFT_IDLE_TTL_MS = 15 * 60 * 1000',
  'readonly expiresAt: number',
  'this.scheduleExpiry(expiresAt)',
  "this.clearDraft(undefined, 'expired')",
  "this.clearDraft(undefined, 'auth-changed')",
  'this.draftSubject.next(null)',
  'takeResult(',
], 'video editor session teardown');

const videoEditorLauncher = read(
  'src/app/core/services/media/video-editor-launcher.service.ts'
);
requireIncludes(videoEditorLauncher, [
  'this.authSession.uid$.pipe(',
  'takeUntilDestroyed(this.destroyRef)',
  'this.session.clearIfOwnerMismatch(normalizedUid)',
  "this.session.clearDraft(undefined, 'destroyed')",
  'return this.session.takeResult(ownerUid, source);',
], 'video editor auth boundary');

const videoEditorControls = read(
  'src/app/media/videos/video-editor/video-simple-editor-controls.component.ts'
);
requireIncludes(videoEditorControls, [
  'this.fileSubject.next(null)',
  'this.metadataSubject.next(null)',
  'this.fileSubject.complete()',
  'this.metadataSubject.complete()',
], 'video editor refs teardown');

const videoEditorCss = read(
  'src/app/media/videos/video-editor/video-simple-editor-controls.component.css'
);
requireIncludes(videoEditorCss, [
  'var(--tap-target, 44px)',
  '@media (max-height: 620px) and (orientation: landscape)',
  '@media (prefers-reduced-motion: reduce)',
], 'local video editor responsive');

for (const launcherPath of [
  'src/app/media/photos/photo-viewer/public-photo-viewer-launcher.service.ts',
  'src/app/media/videos/public-video-viewer/public-video-viewer-launcher.service.ts',
]) {
  requireIncludes(read(launcherPath), [
    "autoFocus: 'first-tabbable'",
    'restoreFocus: true',
    "height: '100dvh'",
    "maxHeight: '100dvh'",
  ], launcherPath + ' focus/viewport contract');
}
requireIncludes(
  read('src/app/media/videos/public-video-viewer/public-video-viewer-launcher.service.ts'),
  "ariaLabel: 'Visualizador de vídeo'",
  'video launcher screen reader label'
);

const profileVideos = read(
  'src/app/media/videos/profile-videos/profile-videos.component.ts'
);
requireIncludes(profileVideos, [
  "reason === 'expired' || reason === 'auth-changed'",
  'this.releaseEditorSelection()',
  'this.revokePreviewUrl()',
  'this.selectedFileSubject.next(null)',
], 'profile video editor host teardown');

const videoUploadFlow = read(
  'src/app/core/services/media/video-upload-flow.service.ts'
);
requireIncludes(videoUploadFlow, [
  'private readonly authSession = inject(AuthSessionService)',
  'authBoundarySubscription = this.authSession.uid$.subscribe',
  'activeTask?.cancel()',
  'observer.complete()',
  'authBoundarySubscription?.unsubscribe()',
  'assertNotCancelled();',
], 'video upload auth boundary');

const videoMetadataPreparation = read(
  'src/app/core/services/media/video-metadata-preparation.service.ts'
);
requireIncludes(videoMetadataPreparation, [
  'URL.createObjectURL(file)',
  'URL.revokeObjectURL(objectUrl)',
  "video.removeAttribute('src')",
  'video.load()',
], 'video metadata ObjectURL teardown');

for (const testPath of [
  'src/app/core/services/media/video-editor-launcher.service.spec.ts',
  'src/app/core/services/media/video-upload-flow.lifecycle.spec.ts',
  'src/app/core/services/media/public-video-access.session.spec.ts',
  'src/app/core/services/media/public-video-metadata-preload.service.spec.ts',
  'src/app/media/videos/public-video-metadata-preload.directive.spec.ts',
  'src/app/media/videos/public-video-viewer/public-video-viewer-lazy-playback.spec.ts',
  'src/app/media/photos/photo-viewer/photo-viewer.component.spec.ts',
  'src/app/media/photos/photo-viewer/public-photo-viewer-launcher.service.spec.ts',
  'src/app/media/videos/public-video-viewer/public-video-viewer-launcher.service.spec.ts',
  'src/app/core/services/media/video-metadata-preparation.service.spec.ts',
]) {
  requireIncludes(read(testPath), 'it(', testPath + ' coverage');
}

function runtimeFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) return runtimeFiles(absolute);
    if (
      !entry.endsWith('.ts') ||
      entry.endsWith('.spec.ts') ||
      entry.endsWith('.test.ts')
    ) {
      return [];
    }

    return [absolute];
  });
}

const scanRoots = [
  path.join(root, 'src', 'app', 'core', 'services', 'media'),
  path.join(root, 'src', 'app', 'core', 'services', 'image-handling'),
  path.join(root, 'src', 'app', 'media'),
  path.join(root, 'src', 'app', 'photo-editor'),
  path.join(root, 'src', 'app', 'community', 'feed'),
];

const violations = [];

for (const file of scanRoots.flatMap(runtimeFiles)) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file).replaceAll('\\', '/');

  if (
    source.includes('URL.createObjectURL') &&
    !source.includes('URL.revokeObjectURL')
  ) {
    violations.push(relative + ': createObjectURL sem revokeObjectURL');
  }

  if (
    source.includes('new IntersectionObserver') &&
    !source.includes('.disconnect()')
  ) {
    violations.push(relative + ': IntersectionObserver sem disconnect');
  }

  if (
    source.includes('new ResizeObserver') &&
    !source.includes('.disconnect()')
  ) {
    violations.push(relative + ': ResizeObserver sem disconnect');
  }

  if (
    source.includes('.subscribe(') &&
    !source.includes('takeUntilDestroyed(') &&
    !source.includes('take(1)') &&
    !source.includes('.unsubscribe()') &&
    !source.includes('Subscription')
  ) {
    violations.push(relative + ': subscribe imperativo sem teardown reconhecível');
  }

  if (
    source.includes('VideoEditorSessionService') &&
    !relative.endsWith(
      'src/app/core/services/media/video-editor-session.service.ts'
    ) &&
    !relative.endsWith(
      'src/app/core/services/media/video-editor-launcher.service.ts'
    )
  ) {
    violations.push(
      relative + ': VideoEditorSessionService fora do auth-boundary do launcher'
    );
  }
}

if (violations.length) {
  throw new Error(
    '[media-runtime-resource] Violações:\n - ' + violations.join('\n - ')
  );
}

console.log(
  '[media-runtime-resource] OK: Foto/Vídeo compartilham contratos de recursos, teclado/foco, touch, orientation, reduced-motion e degradação de memória.'
);
