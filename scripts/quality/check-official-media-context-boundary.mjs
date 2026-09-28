// scripts/quality/check-official-media-context-boundary.mjs
// -----------------------------------------------------------------------------
// OFFICIAL MEDIA CONTEXT BOUNDARY
// -----------------------------------------------------------------------------
// Official é contexto derivado, nunca estado editável da mídia.
// Promotion/Boost permanece independente e só usa disclosure patrocinado.
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
    throw new Error('[official-media-context-boundary] ' + label + ': ' + fragment);
  }
}

const policy = read(
  'functions/src/media/application/official-media-context.policy.ts'
);
for (const fragment of [
  'evaluateProfileKyc',
  'sanitizeCommunityOfficialAssociationPublicProjection',
  "association.target.type !== 'profile'",
  'activeRevalidationDueAt',
  'activeVerificationExpiresAt',
]) {
  requireIncludes(policy, fragment, 'derived context authority drift');
}

const sync = read(
  'functions/src/media/application/sync-official-media-context.trigger.ts'
);
for (const fragment of [
  'profile_kyc_records',
  'community_official_associations',
  'officialMediaContext',
  'syncOfficialMediaContextFromPhoto',
  'syncOfficialMediaContextFromVideo',
  'syncOfficialMediaContextFromProfileKyc',
  'syncOfficialMediaContextFromIdentity',
]) {
  requireIncludes(sync, fragment, 'projection reconciliation drift');
}

const photoContract = read(
  'src/app/core/interfaces/media/i-public-photo-item.ts'
);
const videoContract = read(
  'src/app/core/interfaces/media/i-public-video-item.ts'
);
requireIncludes(
  photoContract,
  'officialMediaContext?: IOfficialMediaContextProjection',
  'photo contract drift'
);
requireIncludes(
  videoContract,
  'officialMediaContext?: IOfficialMediaContextProjection',
  'video contract drift'
);

const photoCard = read(
  'src/app/media/shared/components/public-photo-card/public-photo-card.component.html'
);
requireIncludes(
  photoCard,
  'item.officialMediaContext?.association?.verified',
  'official badge drift'
);
requireIncludes(
  photoCard,
  'Patrocinado',
  'sponsored disclosure drift'
);

const promotionService = read(
  'src/app/core/services/media/photo-promotion-placement.service.ts'
);
requireIncludes(
  promotionService,
  "readonly disclosure: 'Patrocinado'",
  'promotion disclosure drift'
);

for (const promotionPath of [
  'src/app/core/services/media/photo-promotion-placement.service.ts',
  'functions/src/promotion-boost/photo-promotion-target.policy.ts',
  'functions/src/promotion-boost/manage-photo-promotion-campaign.handler.ts',
  'functions/src/promotion-boost/get-photo-promotion-placement.handler.ts',
]) {
  const source = read(promotionPath);
  if (source.includes('officialMediaContext') || source.includes('officialPhoto')) {
    throw new Error(
      '[official-media-context-boundary] Promotion/Boost não pode depender de contexto Official: ' +
      promotionPath
    );
  }
}

const legacyAllowedPath =
  'functions/src/media/application/sync-official-media-context.trigger.ts';

function runtimeFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) return runtimeFiles(absolute);

    if (
      !entry.endsWith('.ts') &&
      !entry.endsWith('.html')
    ) {
      return [];
    }

    if (
      entry.endsWith('.spec.ts') ||
      entry.endsWith('.test.ts')
    ) {
      return [];
    }

    return [absolute];
  });
}

const scanRoots = [
  path.join(root, 'src', 'app', 'core', 'interfaces', 'media'),
  path.join(root, 'src', 'app', 'core', 'services', 'media'),
  path.join(root, 'src', 'app', 'media'),
  path.join(root, 'functions', 'src', 'media'),
];

const legacyViolations = scanRoots
  .flatMap(runtimeFiles)
  .filter((file) => {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    return relative !== legacyAllowedPath
      && fs.readFileSync(file, 'utf8').includes('officialPhoto');
  })
  .map((file) => path.relative(root, file).replaceAll('\\', '/'))
  .sort();

if (legacyViolations.length) {
  throw new Error(
    '[official-media-context-boundary] officialPhoto legado fora do migrador: ' +
    legacyViolations.join(', ')
  );
}

console.log(
  '[official-media-context-boundary] OK: Official é projeção derivada; Patrocinado permanece independente.'
);
