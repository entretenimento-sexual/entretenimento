// scripts/quality/check-media-snapshot-boundary.mjs
// -----------------------------------------------------------------------------
// PUBLIC MEDIA SNAPSHOT BOUNDARY
// -----------------------------------------------------------------------------
// Garante paridade de snapshot/SWR entre Fotos e Vídeos sem persistir
// credenciais efêmeras, signed URLs, poster assinado, playback ou tokens.
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
    throw new Error('[media-snapshot-boundary] ' + label + ': ' + fragment);
  }
}

const snapshot = read(
  'src/app/core/services/media/public-media-snapshot.service.ts'
);

for (const fragment of [
  "'latest-photos'",
  "'top-photos'",
  "'latest-videos'",
  "'top-videos'",
  'hydratePublicPhotoUrls$',
  'hydratePublicVideoPreviews$',
  "'url'",
  "'posterUrl'",
  "'accessExpiresAt'",
  "'playbackToken'",
  "'retentionToken'",
]) {
  requireIncludes(snapshot, fragment, 'snapshot contract drift');
}

const videoRanking = read(
  'src/app/core/services/media/public-video-ranking-query.service.ts'
);
for (const fragment of [
  'PublicMediaSnapshotService',
  "'latest-videos'",
  "'top-videos'",
  'if (!cursor)',
  'this.snapshots.write(',
]) {
  requireIncludes(videoRanking, fragment, 'video snapshot write drift');
}

const videoContinuation = read(
  'src/app/core/services/media/public-video-continuation.service.ts'
);
for (const fragment of [
  'PublicMediaSnapshotService',
  'this.snapshots.read$(kind)',
  "kind = mode === 'latest' ? 'latest-videos' : 'top-videos'",
  'return cached.length',
  'failed: true',
]) {
  requireIncludes(videoContinuation, fragment, 'video SWR read drift');
}

console.log(
  '[media-snapshot-boundary] OK: photo/video snapshots persist projections only and video ranking uses stale-while-revalidate.'
);
