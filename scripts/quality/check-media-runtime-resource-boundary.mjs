// scripts/quality/check-media-runtime-resource-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA RUNTIME RESOURCE BOUNDARY
// -----------------------------------------------------------------------------
// Protege memória/CPU em dispositivos fracos:
// - pixel budget canônico no editor;
// - render windows em feeds longos;
// - preload de vídeo limitado e cancelável;
// - players liberam decoder/source;
// - ObjectURL e observers possuem teardown;
// - subscriptions imperativas precisam de teardown explícito.
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
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[media-runtime-resource] ' + label + ': ' + fragment);
  }
}

const manifest = JSON.parse(read('config/media-formats.json'));
const maxInteractivePixels = Number(
  manifest?.image?.editorLimits?.maxInteractivePixels
);
if (
  !Number.isSafeInteger(maxInteractivePixels)
  || maxInteractivePixels <= 0
  || maxInteractivePixels > 16_000_000
) {
  throw new Error(
    '[media-runtime-resource] image.editorLimits.maxInteractivePixels inválido.'
  );
}

const editor = read(
  'src/app/photo-editor/photo-editor/photo-editor.component.ts'
);
for (const fragment of [
  'MEDIA_IMAGE_EDITOR_MAX_INTERACTIVE_PIXELS',
  'assertInteractivePixelBudget(image)',
  'this.revokeSourceObjectUrl()',
  'this.resizeObserver?.disconnect()',
  'this.cancelScheduledRender()',
]) {
  requireIncludes(editor, fragment, 'photo editor resource drift');
}

const communityWindow = read(
  'src/app/community/feed/community-feed-render-window.facade.ts'
);
requireIncludes(
  communityWindow,
  'COMMUNITY_FEED_RENDER_WINDOW_PAGES = 6',
  'community feed window drift'
);

for (const pathName of [
  'src/app/media/photos/latest-public-photos/latest-public-photos.component.ts',
  'src/app/media/photos/top-public-photos/top-public-photos.component.ts',
]) {
  const source = read(pathName);
  requireIncludes(
    source,
    'PHOTO_RENDER_WINDOW_MAX_ITEMS = 72',
    pathName + ' render window drift'
  );
  requireIncludes(
    source,
    'renderItems',
    pathName + ' must render bounded items'
  );
}

const publicVideos = read(
  'src/app/media/videos/public-profile-videos/public-profile-videos.component.ts'
);
for (const fragment of [
  'PUBLIC_VIDEO_RENDER_WINDOW_MAX_ITEMS = 36',
  'renderItems',
  'galleryRenderStartSubject',
]) {
  requireIncludes(publicVideos, fragment, 'public video render window drift');
}

const preload = read(
  'src/app/core/services/media/public-video-metadata-preload.service.ts'
);
for (const fragment of [
  'MAX_ACTIVE_METADATA_PRELOADS = 2',
  'MAX_ATTEMPTED_METADATA_KEYS = 256',
  'cancelMetadataPreload',
  "video.removeAttribute('src')",
  'video.load()',
  'this.activeCleanups',
]) {
  requireIncludes(preload, fragment, 'video metadata preload drift');
}

const preloadDirective = read(
  'src/app/media/videos/public-video-metadata-preload.directive.ts'
);
for (const fragment of [
  'new IntersectionObserver',
  'this.cancelCurrentPreload()',
  'this.observer?.disconnect()',
  "rootMargin: '160px 0px'",
]) {
  requireIncludes(preloadDirective, fragment, 'video preload viewport drift');
}

const videoAccess = read(
  'src/app/core/services/media/public-video-access.service.ts'
);
for (const fragment of [
  'MAX_ACCESS_CACHE_ENTRIES = 128',
  'setAccessCache(',
  'touchAccessCache(',
]) {
  requireIncludes(videoAccess, fragment, 'public video access LRU drift');
}

const viewer = read(
  'src/app/media/videos/public-video-viewer/public-video-viewer.component.ts'
);
for (const fragment of [
  'VIEWER_ITEM_WINDOW_MAX = 48',
  'VIEWER_ITEM_RETAIN_BEHIND = 12',
  'trimViewerItemWindow()',
  'releaseCurrentPlayerSource()',
  "player.removeAttribute('src')",
  'player.load()',
]) {
  requireIncludes(viewer, fragment, 'video decoder release drift');
}

const videoEditorLauncher = read(
  'src/app/core/services/media/video-editor-launcher.service.ts'
);
requireIncludes(
  videoEditorLauncher,
  'this.session.clearDraft(source);',
  'video editor must release File/Blob draft after completion'
);

function runtimeFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) return runtimeFiles(absolute);
    if (
      !entry.endsWith('.ts')
      || entry.endsWith('.spec.ts')
      || entry.endsWith('.test.ts')
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
    source.includes('URL.createObjectURL')
    && !source.includes('URL.revokeObjectURL')
  ) {
    violations.push(relative + ': createObjectURL sem revokeObjectURL');
  }

  if (
    source.includes('new IntersectionObserver')
    && !source.includes('.disconnect()')
  ) {
    violations.push(relative + ': IntersectionObserver sem disconnect');
  }

  if (
    source.includes('new ResizeObserver')
    && !source.includes('.disconnect()')
  ) {
    violations.push(relative + ': ResizeObserver sem disconnect');
  }

  if (
    source.includes('.subscribe(')
    && !source.includes('takeUntilDestroyed(')
    && !source.includes('take(1)')
    && !source.includes('.unsubscribe()')
    && !source.includes('Subscription')
  ) {
    violations.push(relative + ': subscribe imperativo sem teardown reconhecível');
  }
}

if (violations.length) {
  throw new Error(
    '[media-runtime-resource] Violações:\n - ' + violations.join('\n - ')
  );
}

console.log(
  '[media-runtime-resource] OK: editor, feeds, preload, player e recursos transitórios possuem limites/teardown defensivos.'
);
