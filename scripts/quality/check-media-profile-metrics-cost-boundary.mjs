// scripts/quality/check-media-profile-metrics-cost-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA PROFILE METRICS COST BOUNDARY
// -----------------------------------------------------------------------------
// Mantém duas camadas deliberadamente separadas:
// 1) hot path: agregação incremental em views/interações;
// 2) cold path: refreshPublicProfileMediaMetrics() como reconciliação completa.
//
// A reconciliação varre as mídias públicas aprovadas do perfil e portanto não
// pode migrar para discovery, playback, view, reaction, comment ou rating.
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
    throw new Error('[media-profile-metrics-cost] ' + label + ': ' + fragment);
  }
}

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

const metricsPath =
  'functions/src/media/application/public-profile-media-metrics.ts';
const metrics = read(metricsPath);

for (const fragment of [
  'export async function ensurePublicProfileViewerIndex',
  'export async function refreshPublicProfileMediaMetrics',
  'aggregateApprovedPublicMedia',
  "collection('public_photos')",
  "collection('public_videos')",
  'countProfileViewers(publicProfileRef)',
  'calculatePublicProfileEngagementScore',
]) {
  requireIncludes(metrics, fragment, 'canonical reconciliation drift');
}

const incrementalViewPaths = [
  'functions/src/media/application/record-photo-view.handler.ts',
  'functions/src/media/application/record-video-view.handler.ts',
];

for (const relativePath of incrementalViewPaths) {
  const source = read(relativePath);

  for (const fragment of [
    'ensurePublicProfileViewerIndex(ownerUid)',
    'profileViewsCount:',
    'profileUniqueViewersCount:',
    'mediaUniqueViewersCount:',
    'engagementScore',
    'mediaMetricsUpdatedAt:',
  ]) {
    requireIncludes(
      source,
      fragment,
      relativePath + ' must keep incremental profile aggregation'
    );
  }

  if (source.includes('refreshPublicProfileMediaMetrics')) {
    throw new Error(
      '[media-profile-metrics-cost] full reconciliation entered view hot path: ' +
        relativePath
    );
  }
}

const incrementalInteractionPaths = [
  'functions/src/media/application/toggle-photo-reaction.handler.ts',
  'functions/src/media/application/toggle-video-reaction.handler.ts',
  'functions/src/media/application/manage-photo-comment.handler.ts',
  'functions/src/media/application/manage-video-comment.handler.ts',
  'functions/src/media/application/rate-video.handler.ts',
];

for (const relativePath of incrementalInteractionPaths) {
  const source = read(relativePath);

  if (source.includes('refreshPublicProfileMediaMetrics')) {
    throw new Error(
      '[media-profile-metrics-cost] full reconciliation entered interaction hot path: ' +
        relativePath
    );
  }
}

const coldReconciliationCallers = new Set([
  metricsPath,
  'functions/src/media/application/manage-photo-publication.handler.ts',
  'functions/src/media/application/manage-video-publication.handler.ts',
  'functions/src/media/application/delete-profile-photo.handler.ts',
  'functions/src/media/application/delete-profile-video.handler.ts',
  'functions/src/media/application/sync-published-photo-on-private-update.handler.ts',
  'functions/src/media/application/normalize-legacy-video-moderation.handler.ts',
  'functions/src/media/application/normalize-legacy-photo-moderation.handler.ts',
  'functions/src/media/application/review-photo-content-report.handler.ts',
  'functions/src/media/application/review-video-content-report.handler.ts',
]);

const mediaApplicationRoot = path.join(
  root,
  'functions',
  'src',
  'media',
  'application'
);
const unexpectedCallers = runtimeFiles(mediaApplicationRoot)
  .filter((file) =>
    fs.readFileSync(file, 'utf8').includes('refreshPublicProfileMediaMetrics')
  )
  .map((file) => path.relative(root, file).replaceAll('\\', '/'))
  .filter((relative) => !coldReconciliationCallers.has(relative))
  .sort();

if (unexpectedCallers.length) {
  throw new Error(
    '[media-profile-metrics-cost] refreshPublicProfileMediaMetrics fora do cold path: ' +
      unexpectedCallers.join(', ')
  );
}

for (const relativePath of [...coldReconciliationCallers]) {
  const source = read(relativePath);
  requireIncludes(
    source,
    'refreshPublicProfileMediaMetrics',
    relativePath + ' reconciliation contract drift'
  );
}

const privatePhotoSync = read(
  'functions/src/media/application/sync-published-photo-on-private-update.use-case.ts'
);
for (const fragment of [
  'if (shouldCopyAsset) {',
  'await dependencies.refreshMetrics(input.ownerUid)',
  'Alterações somente de',
]) {
  requireIncludes(
    privatePhotoSync,
    fragment,
    'metadata-only update must not trigger full reconciliation'
  );
}

for (const relativePath of [
  'functions/src/media/application/get-public-media-discovery.handler.ts',
  'functions/src/media/application/get-public-photo-access-urls.handler.ts',
  'functions/src/media/application/get-public-video-access-urls.handler.ts',
  'functions/src/media/application/start-public-video-playback-session.handler.ts',
  'functions/src/media/application/record-video-retention-orchestrator.handler.ts',
]) {
  const source = read(relativePath);
  if (source.includes('refreshPublicProfileMediaMetrics')) {
    throw new Error(
      '[media-profile-metrics-cost] full reconciliation entered read/playback hot path: ' +
        relativePath
    );
  }
}

console.log(
  '[media-profile-metrics-cost] OK: hot paths remain incremental; full profile media refresh is restricted to lifecycle/moderation reconciliation.'
);
