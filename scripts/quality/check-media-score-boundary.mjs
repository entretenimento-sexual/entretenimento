// scripts/quality/check-media-score-boundary.mjs
// -----------------------------------------------------------------------------
// CANONICAL MEDIA SCORE BOUNDARY
// -----------------------------------------------------------------------------
// Garante que Fotos e Vídeos usem media-engagement-score.ts como autoridade
// única para engagement/ranking derivados de reações, comentários e ratings.
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
    throw new Error('[media-score-boundary] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[media-score-boundary] ' + label + ': ' + fragment);
  }
}

const canonicalPath =
  'functions/src/media/application/media-engagement-score.ts';
const canonical = read(canonicalPath);

for (const fragment of [
  'export function buildMediaEngagementScore',
  'export function normalizeMediaCount',
  'scoreBreakdown.rankingScore',
]) {
  requireIncludes(canonical, fragment, 'canonical score contract drift');
}

const photoMutationPaths = [
  'functions/src/media/application/toggle-photo-reaction.handler.ts',
  'functions/src/media/application/manage-photo-comment.handler.ts',
];

for (const relativePath of photoMutationPaths) {
  const source = read(relativePath);

  requireIncludes(
    source,
    'buildMediaEngagementScore',
    relativePath + ' must consume canonical score'
  );
  requireIncludes(
    source,
    'normalizeMediaCount',
    relativePath + ' must consume canonical count normalization'
  );

  for (const forbidden of [
    'function calculateEngagementScore',
    'function calculateRankingScore',
    'Math.log1p(weightedEngagement)',
    'quality * 0.25',
    'engagement * 0.45',
    'safety * 0.30',
  ]) {
    forbidIncludes(
      source,
      forbidden,
      relativePath + ' must not reimplement media scoring'
    );
  }
}

const videoMutationPaths = [
  'functions/src/media/application/toggle-video-reaction.handler.ts',
  'functions/src/media/application/manage-video-comment.handler.ts',
  'functions/src/media/application/rate-video.handler.ts',
];

for (const relativePath of videoMutationPaths) {
  const source = read(relativePath);
  requireIncludes(
    source,
    'buildMediaEngagementScore',
    relativePath + ' must consume canonical score'
  );
}

console.log(
  '[media-score-boundary] OK: photo and video engagement/ranking mutations use the canonical media score.'
);
