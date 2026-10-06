// scripts/quality/check-media-exposure-matrix-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA EXPOSURE MATRIX
// -----------------------------------------------------------------------------
// Foto e Vídeo devem falhar fechado de forma uniforme em:
// próprio perfil publicado, perfil alheio, discovery, deep link, viewer e share.
// O acervo de origem do dono é gestão; nunca é atalho para exposição pública.
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
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error('[media-exposure-matrix] arquivo obrigatório ausente: ' + relativePath);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireIncludes(source, fragments, label) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      throw new Error(
        '[media-exposure-matrix] ' + label + ': ausente ' + fragment
      );
    }
  }
}

const helpers = read('firestore-rules/_helpers.rules');
requireIncludes(helpers, [
  'canonicalOwnerLifecycleAllowsPublicMediaExposure',
  'accountStatus == null || accountStatus == "active"',
  'suspended != true',
  'publicVisibility == null || publicVisibility == "visible"',
  'loginAllowed != false',
  'canConsumeAdultPublicMedia',
  'bilateralExposureAllows',
], 'helpers canônicos');

for (const rulePath of [
  'firestore-rules/public_profiles_photos.rules',
  'firestore-rules/public_profiles_videos.rules',
]) {
  const source = read(rulePath);
  requireIncludes(source, [
    'canonicalOwnerLifecycleAllowsPublicMediaExposure(userId)',
    'bilateralExposureAllows(userId)',
    'moderationStatus == "APPROVED"',
    'allow list: if false;',
  ], rulePath + ' deve proteger deep link e enumeração');
}

const privatePhotos = read('firestore-rules/users_photos.rules');
requireIncludes(privatePhotos, [
  'match /users/{userId}/photos/{photoId}',
  'allow get, list: if isSelf(userId);',
], 'acervo de origem de fotos do proprietário');

const privateVideos = read('firestore-rules/users_videos.rules');
requireIncludes(privateVideos, [
  'match /users/{userId}/videos/{videoId}',
  'allow get, list: if isSelf(userId);',
], 'acervo de origem de vídeos do proprietário');

const exposurePolicy = read(
  'functions/src/media/application/public-media-exposure.policy.ts'
);
requireIncludes(exposurePolicy, [
  'evaluatePublicMediaOwnerExposure',
  'evaluatePublicMediaSignedOwnerExposure',
  'isCurrentPublicMediaProjectionExposure',
  'isCurrentPublicMediaAssetExposure',
  'isCurrentPublicPhotoAssetExposure',
  'BILATERAL_BLOCK',
  "input.publication['isPublished'] !== true",
  "input.publication['moderationStatus']) === 'APPROVED'",
], 'policy de exposição');

const ownerExposure = read(
  'functions/src/media/application/public-media-owner-exposure.service.ts'
);
requireIncludes(ownerExposure, [
  'evaluateCanonicalOwnerLifecycle',
  'resolvePublicMediaOwnerExposure',
  'resolvePublicMediaSignedOwnerExposure',
], 'owner exposure backend');

const consumption = read(
  'functions/src/media/application/public-media-consumption-access.policy.ts'
);
requireIncludes(consumption, [
  'assertPlatformAccountAccessData',
], 'viewer consumption authority');

const discovery = read(
  'functions/src/media/application/get-public-media-discovery.handler.ts'
);
requireIncludes(discovery, [
  'assertPublicMediaConsumptionAccess',
  'resolvePublicMediaOwnerExposure',
  'isCurrentPublicMediaAssetExposure',
  "'photo_publications'",
  "'video_publications'",
], 'discovery deve revalidar viewer, owner e publicação');

for (const accessPath of [
  'functions/src/media/application/get-public-photo-access-urls.handler.ts',
  'functions/src/media/application/get-public-video-access-urls.handler.ts',
]) {
  const source = read(accessPath);
  requireIncludes(source, [
    'assertPublicMediaConsumptionAccess',
    'resolvePublicMediaSignedOwnerExposure',
    'isCurrentPublic',
    'resolvePublicMediaSignedUrlExpiresAt',
  ], accessPath + ' deve revalidar viewer/owner/ativo antes de URL');
}

const videoShare = read(
  'src/app/core/services/media/public-video-share.service.ts'
);
requireIncludes(videoShare, [
  'buildPublicVideoCanonicalPath',
  '/media/video/',
  "Pick<IPublicVideoItem, 'id' | 'ownerUid'>",
], 'share de vídeo deve compartilhar referência, não URL assinada');

if (
  /sharePublicVideo[\s\S]{0,1500}\bvideo\.url\b/.test(videoShare) ||
  /ShareData[\s\S]{0,400}\burl\s*:\s*video\.url/.test(videoShare)
) {
  throw new Error(
    '[media-exposure-matrix] share de vídeo não pode compartilhar URL assinada do ativo'
  );
}


const ownProfile = read(
  'src/app/user-profile/user-profile-view/user-profile-view.component.html'
);
requireIncludes(ownProfile, [
  "currentUid, 'fotos'",
  "currentUid, 'fotos', 'upload'",
], 'perfil próprio deve apontar somente para gestão do proprietário');

const otherProfileShowcase = read(
  'src/app/media/shared/components/profile-media-showcase/profile-media-showcase.component.ts'
);
requireIncludes(otherProfileShowcase, [
  'MediaPublicPreviewQueryService',
  "'fotos-publicas'",
  'ProfileMediaShowcaseViewerFacade',
], 'perfil alheio deve usar preview e galeria públicos');

for (const forbidden of [
  'MediaQueryService',
  'PhotoFirestoreService',
]) {
  if (otherProfileShowcase.includes(forbidden)) {
    throw new Error(
      '[media-exposure-matrix] perfil alheio não pode atravessar gestão/origem: ' + forbidden
    );
  }
}

const publicProfilePhotos = read(
  'src/app/media/photos/public-profile-photos/public-profile-photos.component.ts'
);
requireIncludes(publicProfilePhotos, [
  'MediaPublicQueryService',
  'getProfilePublicPhotos$',
  'PublicPhotoViewerLauncherService',
], 'galeria pública de perfil deve usar query e viewer públicos');

for (const forbidden of ['MediaQueryService', 'PhotoFirestoreService']) {
  if (publicProfilePhotos.includes(forbidden)) {
    throw new Error(
      '[media-exposure-matrix] galeria pública não pode ler acervo de origem: ' + forbidden
    );
  }
}

for (const surfacePath of [
  'src/app/media/photos/latest-public-photos/latest-public-photos.component.ts',
  'src/app/media/photos/top-public-photos/top-public-photos.component.ts',
]) {
  const source = read(surfacePath);
  requireIncludes(source, [
    'PublicPhotoDiscoveryFeedService',
    'PublicPhotoViewerLauncherService',
    'PhotoPromotionPlacementService',
  ], surfacePath + ' deve usar discovery/viewer/promoção canônicos');

  for (const forbidden of ['MediaQueryService', 'PhotoFirestoreService']) {
    if (source.includes(forbidden)) {
      throw new Error(
        '[media-exposure-matrix] latest/top não pode ler acervo de origem: ' + surfacePath
      );
    }
  }
}

const explorePersonalMedia = read(
  'src/app/explore/services/explore-personal-media.service.ts'
);
requireIncludes(explorePersonalMedia, [
  'PublicMediaOwnerPageQueryService',
  'IPublicPhotoItem',
  'loadPhotoPage$',
], 'Explore pessoal deve usar paginação pública autorizada');

for (const forbidden of ['MediaQueryService', 'PhotoFirestoreService']) {
  if (explorePersonalMedia.includes(forbidden)) {
    throw new Error(
      '[media-exposure-matrix] Explore não pode ler acervo de origem: ' + forbidden
    );
  }
}

const promotionPlacement = read(
  'src/app/core/services/media/photo-promotion-placement.service.ts'
);
requireIncludes(promotionPlacement, [
  'getPhotoPromotionPlacement',
  'PublicPhotoAccessService',
  'hydratePublicPhotoUrls$',
  "disclosure: 'Patrocinado'",
], 'foto patrocinada deve reusar autoridade pública de acesso');

for (const forbidden of ['PhotoFirestoreService', 'MediaQueryService']) {
  if (promotionPlacement.includes(forbidden)) {
    throw new Error(
      '[media-exposure-matrix] patrocinado não pode contornar acesso público: ' + forbidden
    );
  }
}

const officialProjection = read(
  'src/app/core/services/media/official-media-context.projection.ts'
);
requireIncludes(officialProjection, [
  'Normaliza apenas a projeção destinada à apresentação.',
  'Não concede nem revalida autoridade no cliente.',
  'normalizeOfficialMediaContextProjection',
], 'contexto oficial deve ser somente projeção de apresentação');

const communityExplore = read(
  'src/app/community/data-access/community-explore-content.repository.ts'
);
requireIncludes(communityExplore, [
  'getCommunityExploreContent',
  'httpsCallable',
], 'conteúdo de Comunidades no Explore deve vir de autoridade backend');

for (const forbidden of [
  'PhotoFirestoreService',
  'MediaQueryService',
  'PublicPhotoAccessService',
]) {
  if (communityExplore.includes(forbidden)) {
    throw new Error(
      '[media-exposure-matrix] Comunidades não pode reconstruir exposição de foto no cliente: ' + forbidden
    );
  }
}

const matrixTest = read(
  'functions/src/media/application/public-media-exposure-matrix.contract.test.ts'
);
for (const required of [
  'SELF_PROFILE_PUBLISHED',
  'OTHER_PROFILE',
  'DISCOVERY',
  'DEEP_LINK',
  'VIEWER',
  'SHARE',
  "'PHOTO'",
  "'VIDEO'",
  "'PENDING_REVIEW'",
  "'FLAGGED'",
  "'HIDDEN'",
  "'REJECTED'",
  'BILATERAL_BLOCK',
  'OWNER_LIFECYCLE_NOT_CANONICAL',
  'assertPublicMediaConsumptionAccessData',
  'ageReverification',
]) {
  if (!matrixTest.includes(required)) {
    throw new Error(
      '[media-exposure-matrix] contrato de teste incompleto: ' + required
    );
  }
}

const rulesTest = read(
  'firestore-rules/tests/public-media-age-visibility.rules.spec.ts'
);
requireIncludes(rulesTest, [
  'revoga deep link de foto e vídeo imediatamente quando o proprietário é suspenso',
  'mantém mídia em quarentena fora de deep link para foto e vídeo',
  "setMediaModerationStatus('APPROVED')",
], 'Rules precisam cobrir suspensão e quarentena');

console.log(
  '[media-exposure-matrix] OK: Foto/Vídeo compartilham autoridade fail-closed em perfil próprio/alheio, latest/top, Explore, Comunidades, oficial, patrocinado, deep link, viewer e share.'
);
