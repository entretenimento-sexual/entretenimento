// scripts/quality/check-media-trend-score-shadow-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA TREND SCORE — SHADOW BOUNDARY
// -----------------------------------------------------------------------------
// Garante que trendScore exista somente como observação shadow durante
// OBSERVE_ONLY e não influencie ranking, discovery, notificações, Promotion/
// Boost, preço ou limites comerciais.
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
    throw new Error('[media-trend-shadow] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[media-trend-shadow] ' + label + ': ' + fragment);
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

const stage = read(
  'functions/src/shared/calibration/product-calibration-stage.policy.ts'
);
requireIncludes(
  stage,
  "export const PRODUCT_CALIBRATION_STAGE = 'OBSERVE_ONLY' as const;",
  'product stage must remain OBSERVE_ONLY'
);

const trendPolicyPath =
  'functions/src/media/application/media-trend-score-shadow.policy.ts';
const trendPolicy = read(trendPolicyPath);

for (const fragment of [
  'MEDIA_TREND_SCORE_MODEL_VERSION = 1',
  'MEDIA_TREND_SCORE_FRESHNESS_WINDOW_HOURS = 24',
  "'media.trend_score_shadow'",
  'observationOnly: true',
  'eligibleForRanking: false',
  'eligibleForNotifications: false',
  'eligibleForCommercialUse: false',
  'reviewEligible && isProductCalibrationChangeAllowed()',
  'minimumProductionWindowDays',
  'minimumObservedDaysPerRuntimeMetric',
  'minimumRuntimeSamplesPerMetric',
  "input.source !== 'cloud_logging_runtime_events'",
]) {
  requireIncludes(trendPolicy, fragment, 'shadow policy drift');
}

for (const forbidden of [
  'db.',
  'FieldValue',
  'collection(',
  'transaction.',
]) {
  forbidIncludes(
    trendPolicy,
    forbidden,
    'shadow policy must not persist state'
  );
}

const observationPolicy = read(
  'functions/src/shared/observability/product-calibration-observation.policy.ts'
);
requireIncludes(
  observationPolicy,
  "'media.trend_score_shadow'",
  'runtime observation metric missing'
);

const observationServicePath =
  'functions/src/media/application/media-trend-score-shadow-observation.service.ts';
const observationService = read(observationServicePath);

for (const fragment of [
  'buildProductCalibrationRuntimeObservation',
  'buildMediaTrendScoreShadow',
  "logger.info('media_trend_score_shadow_observed'",
  'eligibleForRanking: shadow.eligibleForRanking',
  'eligibleForNotifications: shadow.eligibleForNotifications',
  'eligibleForCommercialUse: shadow.eligibleForCommercialUse',
]) {
  requireIncludes(
    observationService,
    fragment,
    'shadow observation wiring drift'
  );
}

for (const forbidden of [
  'db.',
  'FieldValue',
  'collection(',
  'transaction.',
]) {
  forbidIncludes(
    observationService,
    forbidden,
    'shadow observation must remain logging-only'
  );
}

const handlers = [
  [
    'functions/src/media/application/toggle-photo-reaction.handler.ts',
    "event: 'reaction'",
  ],
  [
    'functions/src/media/application/toggle-video-reaction.handler.ts',
    "event: 'reaction'",
  ],
  [
    'functions/src/media/application/manage-photo-comment.handler.ts',
    "event: 'comment'",
  ],
  [
    'functions/src/media/application/manage-video-comment.handler.ts',
    "event: 'comment'",
  ],
  [
    'functions/src/media/application/rate-video.handler.ts',
    "event: 'rating'",
  ],
];

for (const [relativePath, eventFragment] of handlers) {
  const source = read(relativePath);

  requireIncludes(
    source,
    'observeMediaTrendScoreShadow',
    relativePath + ' must emit shadow observation'
  );
  requireIncludes(
    source,
    eventFragment,
    relativePath + ' event semantics drift'
  );
  requireIncludes(
    source,
    'trendEngagementScore: nextScore.engagementScore',
    relativePath + ' must observe existing engagementScore'
  );
}

const engagement = read(
  'functions/src/media/application/media-engagement-score.ts'
);

// Snapshot dos pesos produtivos atuais. trendScore não pode alterá-los.
for (const fragment of [
  'reactionsCount * 2 + commentsCount * 4 + ratingWeight',
  'ratingsCount * (ratingAverage / 5) * 3',
  'scoreBreakdown.qualityScore * 0.20',
  'scoreBreakdown.engagementScore * 0.30',
  '(audienceScore ?? 0) * 0.10',
  '(retentionScore ?? 0) * 0.10',
  'scoreBreakdown.safetyScore * 0.30',
  'scoreBreakdown.qualityScore * 0.25',
  'scoreBreakdown.engagementScore * 0.45',
]) {
  requireIncludes(
    engagement,
    fragment,
    'current media score weights changed during OBSERVE_ONLY'
  );
}

const discovery = read(
  'functions/src/media/application/get-public-media-discovery.handler.ts'
);
for (const fragment of [
  ".orderBy('score', 'desc')",
  'score: nonNegativeNumber(data[\'score\'])',
]) {
  requireIncludes(discovery, fragment, 'discovery ordering drift');
}
forbidIncludes(
  discovery,
  'trendScore',
  'trendScore must not participate in public discovery'
);

// Runtime-wide: somente a policy e o logger shadow podem conhecer o conceito
// literal trendScore. Handlers apenas enviam o engagementScore atual ao logger.
const allowedTrendRuntimeFiles = new Set([
  trendPolicyPath,
  observationServicePath,
]);
const scanRoots = [
  path.join(root, 'functions', 'src', 'media'),
  path.join(root, 'functions', 'src', 'community'),
  path.join(root, 'functions', 'src', 'community-boost'),
  path.join(root, 'functions', 'src', 'promotion-boost'),
  path.join(root, 'functions', 'src', 'notifications'),
  path.join(root, 'functions', 'src', 'payments'),
  path.join(root, 'src', 'app'),
];

const violations = [];

for (const absolute of scanRoots.flatMap(runtimeFiles)) {
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  if (allowedTrendRuntimeFiles.has(relative)) continue;

  const source = fs.readFileSync(absolute, 'utf8');
  if (/\btrendScore\b/.test(source) || source.includes('MEDIA_TREND_SCORE_')) {
    violations.push(relative);
  }
}

if (violations.length) {
  throw new Error(
    '[media-trend-shadow] trendScore escaped shadow boundary:\n - '
      + violations.join('\n - ')
  );
}

const packageJson = read('package.json');
for (const fragment of [
  '"media:trend-score-shadow-boundary:check"',
  'npm run media:trend-score-shadow-boundary:check',
  'npm run community:calibration-freeze:check',
]) {
  requireIncludes(
    packageJson,
    fragment,
    'CI calibration protection drift'
  );
}

console.log(
  '[media-trend-shadow] OK: trendScore is logging-only shadow telemetry; current ranking weights and product calibration remain frozen under OBSERVE_ONLY.'
);
