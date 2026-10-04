// scripts/quality/check-media-single-source-authority.mjs
// -----------------------------------------------------------------------------
// MEDIA SINGLE-SOURCE AUTHORITY
// -----------------------------------------------------------------------------
// Projeções podem duplicar campos para leitura/ranking, mas nunca concedem:
// - visibility/publication/moderation;
// - lifecycle do proprietário;
// - segurança/moderação do conteúdo;
// - autoridade comercial/oficial.
// A elegibilidade etária pertence à conta e não é autoridade de Media.
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
    throw new Error('[media-single-source-authority] ' + label + ': ' + fragment);
  }
}

const exposure = read(
  'functions/src/media/application/public-media-exposure.policy.ts'
);
for (const fragment of [
  "input.publication['isPublished'] !== true",
  "input.publication['visibility']",
  "input.publication['moderationStatus']) === 'APPROVED'",
  'canonicalOwnerLifecycleAllowed',
]) {
  requireIncludes(exposure, fragment, 'asset exposure authority drift');
}

const ownerExposure = read(
  'functions/src/media/application/public-media-owner-exposure.service.ts'
);
for (const fragment of [
  'evaluateCanonicalOwnerLifecycle',
  'users/${ownerUid}',
  'public_profiles/${ownerUid}',
]) {
  requireIncludes(ownerExposure, fragment, 'owner authority drift');
}

for (const forbidden of [
  'evaluateCanonicalAgeEligibility',
  'age_eligibility_records/${ownerUid}',
]) {
  if (ownerExposure.includes(forbidden)) {
    throw new Error(
      '[media-single-source-authority] age authority leaked into Media: ' +
      forbidden
    );
  }
}

const discovery = read(
  'functions/src/media/application/get-public-media-discovery.handler.ts'
);
for (const fragment of [
  'isCurrentPublicMediaAssetExposure',
  "'photo_publications'",
  "'video_publications'",
  'publicationByDocumentPath',
]) {
  requireIncludes(discovery, fragment, 'discovery projection drift');
}

const officialMediaContext = read(
  'functions/src/media/application/sync-official-media-context.trigger.ts'
);
for (const fragment of [
  'community_official_associations',
  'profile_kyc_records',
  'users',
  'officialMediaContext',
  'deriveOfficialMediaContext',
]) {
  requireIncludes(
    officialMediaContext,
    fragment,
    'official media context projection drift'
  );
}

const authorityResolver = read(
  'functions/src/authority/canonical-resource-authority.resolver.ts'
);
for (const fragment of [
  'evaluateVerifiedCommercialAuthority',
  'evaluateOrganizationResourceAuthority',
  'evaluateEventAuthority',
  "input.targetType === 'profile'",
]) {
  requireIncludes(authorityResolver, fragment, 'commercial authority drift');
}

const promotionTarget = read(
  'functions/src/promotion-boost/photo-promotion-target.policy.ts'
);
for (const fragment of [
  'isPhotoPromotionPublicationEligible(publication)',
  'isPhotoPromotionPublicProjectionEligible(publicPhoto',
]) {
  requireIncludes(promotionTarget, fragment, 'promotion target authority drift');
}

const officialAssociation = read(
  'functions/src/community/community-official-association.model.ts'
);
requireIncludes(
  officialAssociation,
  "source['status'] !== 'verified'",
  'official association projection must fail closed'
);

console.log(
  '[media-single-source-authority] OK: projeções duplicam dados, mas decisões críticas revalidam as fontes canônicas.'
);
