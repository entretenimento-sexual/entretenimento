// scripts/quality/check-photo-discovery-pagination-boundary.mjs
// -----------------------------------------------------------------------------
// PHOTO DISCOVERY PAGINATION BOUNDARY
// -----------------------------------------------------------------------------
// Impede regressão do discovery de fotos para:
// - polling integral periódico;
// - "load more" por aumento cumulativo de limit;
// - teto artificial de 60 itens na superfície;
// - bypass do cursor/hasMore canônico;
// - persistência fora do snapshot SWR por sessão.
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
    throw new Error(
      '[photo-discovery-pagination-boundary] ' + label + ': ' + fragment
    );
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error(
      '[photo-discovery-pagination-boundary] ' + label + ': ' + fragment
    );
  }
}

const feedPath =
  'src/app/core/services/media/public-photo-discovery-feed.service.ts';
const feed = read(feedPath);

for (const fragment of [
  'PublicPhotoDiscoveryFeedService',
  'PUBLIC_PHOTO_DISCOVERY_PAGE_SIZE = 24',
  'nextCursor',
  'hasMore',
  'loadMore$()',
  'this.ranking.loadPage$(',
  'this.snapshots.read$(',
  'this.snapshots.write(',
  'this.network.reconnected$',
  "connect$('",
]) {
  requireIncludes(
    feed,
    fragment,
    'cursor/SWR orchestrator drift'
  );
}

for (const forbidden of [
  'timer(0,',
  'setInterval(',
  'loadCountSubject',
  'MediaPublicQueryService',
]) {
  forbidIncludes(
    feed,
    forbidden,
    'discovery orchestrator must not return to polling/incremental-limit reads'
  );
}

const legacyQuery = read(
  'src/app/core/services/media/media-public-query.service.ts'
);

for (const forbidden of [
  'PUBLIC_MEDIA_SERVER_REFRESH_MS',
  'timer(0, PUBLIC_MEDIA_SERVER_REFRESH_MS)',
]) {
  forbidIncludes(
    legacyQuery,
    forbidden,
    'legacy compatibility reads must remain one-shot'
  );
}

const componentPaths = [
  'src/app/media/photos/latest-public-photos/latest-public-photos.component.ts',
  'src/app/media/photos/top-public-photos/top-public-photos.component.ts',
  'src/app/media/photos/boosted-public-photos/boosted-public-photos.component.ts',
];

for (const relativePath of componentPaths) {
  const source = read(relativePath);

  for (const fragment of [
    'PublicPhotoDiscoveryFeedService',
    'this.discovery.connect$(',
    'this.discovery.loadMore$()',
    'state.hasMore',
  ]) {
    requireIncludes(
      source,
      fragment,
      relativePath + ' must stay on canonical cursor discovery'
    );
  }

  for (const forbidden of [
    'loadCountSubject',
    'MediaPublicQueryService',
    'getLatestPublicPhotos$(',
    'getTopPublicPhotos$(',
    'getBoostedPublicPhotos$(',
  ]) {
    forbidIncludes(
      source,
      forbidden,
      relativePath + ' must not recreate false load-more'
    );
  }
}

const rankingContract = read(
  'src/app/core/interfaces/media/i-public-photo-ranking.ts'
);
requireIncludes(
  rankingContract,
  "'top' | 'latest' | 'boosted'",
  'ranking contract must include boosted cursor mode'
);
requireIncludes(
  rankingContract,
  'readonly boostedUntil?: number;',
  'boosted cursor must preserve boostedUntil'
);

const rankingGateway = read(
  'src/app/core/services/media/public-photo-ranking-firestore.gateway.ts'
);
for (const fragment of [
  "'BOOSTED'",
  'boostedUntil: request.cursor.boostedUntil',
  'response.nextCursor.boostedUntil',
]) {
  requireIncludes(
    rankingGateway,
    fragment,
    'boosted cursor gateway drift'
  );
}

const snapshots = read(
  'src/app/core/services/media/public-media-snapshot.service.ts'
);
for (const fragment of [
  "'latest-photos'",
  "'top-photos'",
  "'boosted-photos'",
  "delete projection['url'];",
  'PUBLIC_MEDIA_SNAPSHOT_TTL_MS',
]) {
  requireIncludes(
    snapshots,
    fragment,
    'SWR snapshot boundary drift'
  );
}

console.log(
  '[photo-discovery-pagination-boundary] OK: latest/top/boosted use cursor pagination + session-scoped SWR, without integral 60s polling or cumulative-limit load-more.'
);
