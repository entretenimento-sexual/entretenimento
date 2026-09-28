// scripts/quality/check-official-media-context-boundary.mjs
// -----------------------------------------------------------------------------
// OFFICIAL MEDIA CONTEXT BOUNDARY
// -----------------------------------------------------------------------------
// Official é projeção derivada de autoridades canônicas e associação vigente.
// Promotion/Boost é um eixo comercial independente.
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

const contract = read(
  'src/app/core/interfaces/media/i-official-media-context.ts'
);
for (const fragment of [
  "'profile'",
  "'organization'",
  "'venue'",
  "'event'",
  'readonly contexts:',
]) {
  requireIncludes(contract, fragment, 'target contract drift');
}

const policy = read(
  'functions/src/media/application/official-media-context.policy.ts'
);
for (const fragment of [
  'resolveCanonicalResourceAuthority',
  'evaluateProfileKyc',
  'evaluateOfficialSpaceCreationGrant',
  'sanitizeCommunityOfficialAssociationPublicProjection',
  "target.type === 'profile'",
  "target.type === 'organization'",
  "target.type === 'venue'",
  "targetType: 'event'",
  'activeRevalidationDueAt',
  'activeVerificationExpiresAt',
  'buildOfficialMediaContextProjection',
]) {
  requireIncludes(policy, fragment, 'derived context authority drift');
}

const sync = read(
  'functions/src/media/application/sync-official-media-context.trigger.ts'
);
for (const fragment of [
  'profile_kyc_records',
  'official_space_creation_grants',
  'venues',
  'organizations',
  'organization_kyb_records',
  'organization_representations',
  'event_authority_records',
  'community_official_associations',
  'officialMediaContext',
  'syncOfficialMediaContextFromPhoto',
  'syncOfficialMediaContextFromVideo',
  'syncOfficialMediaContextFromAssociation',
  'syncOfficialMediaContextFromProfileKyc',
  'syncOfficialMediaContextFromIdentity',
  'syncOfficialMediaContextFromCommercialAuthority',
  'syncOfficialMediaContextFromVenue',
  'syncOfficialMediaContextFromOrganization',
  'syncOfficialMediaContextFromOrganizationKyb',
  'syncOfficialMediaContextFromOrganizationRepresentation',
  'syncOfficialMediaContextFromEventAuthority',
  'targetCounts',
  "profile: 0",
  "organization: 0",
  "venue: 0",
  "event: 0",
]) {
  requireIncludes(sync, fragment, 'projection reconciliation drift');
}

for (const officialPath of [
  'functions/src/media/application/official-media-context.policy.ts',
  'functions/src/media/application/sync-official-media-context.trigger.ts',
]) {
  const source = read(officialPath);
  for (const forbidden of [
    "from '../../promotion-boost",
    'photoPromotion',
    'promotionCampaign',
    'boostCampaign',
    'sponsoredPlacement',
  ]) {
    if (source.includes(forbidden)) {
      throw new Error(
        '[official-media-context-boundary] Official não pode depender de Promotion/Boost: ' +
        officialPath + ' -> ' + forbidden
      );
    }
  }
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
  'item.officialMediaContext?.contexts?.length',
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

const legacyAllowedPaths = new Set([
  'functions/src/media/application/sync-official-media-context.trigger.ts',
  'src/app/core/services/media/public-media-snapshot.service.ts',
]);

const snapshotSanitizer = read(
  'src/app/core/services/media/public-media-snapshot.service.ts'
);
requireIncludes(
  snapshotSanitizer,
  "delete sanitized['officialPhoto'];",
  'snapshot must strip legacy officialPhoto state'
);

function runtimeFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) return runtimeFiles(absolute);

    if (!entry.endsWith('.ts') && !entry.endsWith('.html')) return [];
    if (entry.endsWith('.spec.ts') || entry.endsWith('.test.ts')) return [];

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
    return !legacyAllowedPaths.has(relative)
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
  '[official-media-context-boundary] OK: Profile/Venue/Organization/Event usam autoridades canônicas; backfill é tipado por target; Official e Patrocinado permanecem ortogonais em todo o runtime Promotion/Boost.'
);
