// scripts/quality/check-media-host-authority-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA HOST / PROFILE / EXPLORE AUTHORITY BOUNDARY
// -----------------------------------------------------------------------------
// Hosts podem:
// - apresentar projeções já autorizadas;
// - remover conteúdo quando uma projeção temporal expira;
// - bloquear UX de forma fail-closed.
//
// Hosts nunca podem usar projeções para CONCEDER:
// - visibility/publication/moderation;
// - maioridade;
// - lifecycle/bloqueio;
// - contexto Oficial;
// - autoridade comercial/patrocinada.
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
    throw new Error('[media-host-authority] arquivo obrigatório ausente: ' + relativePath);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length))
    .replace(/\/\/[^\n]*/g, (match) => ' '.repeat(match.length));
}

function requireIncludes(source, fragments, label) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      throw new Error(
        '[media-host-authority] ' + label + ': ausente ' + fragment
      );
    }
  }
}

function forbid(source, patterns, label) {
  const scanned = codeOnly(source);
  for (const [pattern, reason] of patterns) {
    if (pattern.test(scanned)) {
      throw new Error(
        '[media-host-authority] ' + label + ': ' + reason
      );
    }
  }
}

const authorityFieldPatterns = Object.freeze([
  [/\bageEligibilityVerifiedAdult\b/, 'host não pode conceder maioridade por projeção'],
  [/\bageEligibilityAdultAccessAllowed\b/, 'host não pode conceder maioridade por projeção'],
  [/\bmoderationStatus\b/, 'host não pode decidir moderação/publicação'],
  [/\bofficialMediaContext\b/, 'host não pode decidir contexto Oficial'],
  [/\baccountStatus\b/, 'host não pode decidir lifecycle'],
  [/\bsuspended\b/, 'host não pode decidir suspensão'],
  [/\bpublicVisibility\b/, 'host não pode decidir lifecycle público'],
  [/\binteractionBlocked\b/, 'host não pode decidir bloqueio de interação'],
  [/\bisBlocked\b/, 'host não pode decidir bloqueio bilateral'],
  [/\bcommercialAuthority\b/, 'host não pode decidir autoridade comercial'],
  [/\badvertiserAuthority\b/, 'host não pode decidir autoridade do anunciante'],
  [/\bcampaignCreationEnabled\b/, 'host não pode habilitar campanha'],
  [/\bplacementEnabled\b/, 'host não pode habilitar placement'],
]);

const hostFiles = Object.freeze([
  'src/app/layout/other-user-profile-view/other-user-profile-view.component.ts',
  'src/app/user-profile/user-profile-view/user-profile-view.component.ts',
  'src/app/explore/services/explore-personal-media.service.ts',
  'src/app/explore/services/explore-feed.service.ts',
  'src/app/explore/facades/explore-feed.facade.ts',
  'src/app/explore/pages/social-explore-page/social-explore-page.component.ts',
]);

for (const relativePath of hostFiles) {
  const source = read(relativePath);
  forbid(source, authorityFieldPatterns, relativePath);
}

const otherProfile = read(
  'src/app/layout/other-user-profile-view/other-user-profile-view.component.ts'
);
const otherProfileBootstrap = read(
  'src/app/layout/other-user-profile-view/application/visited-profile-bootstrap.orchestrator.ts'
);

requireIncludes(otherProfile, [
  'VisitedProfileBootstrapOrchestrator',
  'ProfileMediaShowcaseComponent',
], 'perfil alheio deve delegar bootstrap público');

requireIncludes(otherProfileBootstrap, [
  'getPublicUserById$(',
  'FirestoreUserQueryService',
], 'bootstrap do perfil alheio deve consumir somente projeção pública');

forbid(otherProfile + '\n' + otherProfileBootstrap, [
  [/\.getUser(?:Once|ById)?\s*\(/, 'perfil alheio não pode cair em users/{uid} privado'],
  [/UserRepositoryService/, 'perfil alheio não pode importar repositório privado'],
  [/UsersReadRepository/, 'perfil alheio não pode importar leitura privada'],
], 'perfil alheio');

const userDiscovery = read(
  'src/app/core/services/data-handling/queries/user-discovery.query.service.ts'
);
requireIncludes(userDiscovery, [
  'PublicProfileReadBoundaryService',
  'this.publicProfileRead.readByUids$(',
  'this.publicProfileRead.read$(',
], 'hidratação pública de perfil deve atravessar backend-time');

const explorePersonal = read(
  'src/app/explore/services/explore-personal-media.service.ts'
);
requireIncludes(explorePersonal, [
  'PublicMediaOwnerPageQueryService',
  'this.ownerPageQuery.loadPhotoPage$(',
  'this.ownerPageQuery.loadVideoPage$(',
], 'Explore pessoal deve consumir paginação autorizada de Media');

const ownerPage = read(
  'src/app/core/services/media/public-media-owner-page-query.service.ts'
);
requireIncludes(ownerPage, [
  'PublicMediaReadBoundaryService',
  "'getAuthorizedPhotoOwnerPage'",
  "mediaType: 'VIDEO'",
  "mode: 'RECENT_BY_OWNERS'",
  'PublicPhotoAccessService',
  'PublicVideoAccessService',
], 'owner-page de Media deve permanecer atrás de backend/access boundary');

const discoveryRepo = read(
  'src/app/dashboard/discovery/data-access/discovery-public-profiles.repository.ts'
);
requireIncludes(discoveryRepo, [
  'PublicProfileReadBoundaryService',
  'this.publicProfileRead.read$(',
  'filterCurrentAdultCards',
], 'Discovery deve consumir backend e usar projeção etária apenas para fail-close');

const discoveryMapper = read(
  'src/app/dashboard/discovery/data-access/public-profile-card.mapper.ts'
);
requireIncludes(discoveryMapper, [
  "source['ageEligibilityVerifiedAdult'] !== true",
  'ageEligibilityValidUntil === null',
  'ageEligibilityValidUntil <= Date.now()',
  'return null;',
], 'mapper etário só pode descartar projeção inválida');

forbid(discoveryMapper, [
  [/ageEligibilityVerifiedAdult[^\n]{0,120}===\s*true[^\n]{0,160}return\s+\{/, 'mapper não pode conceder autoridade com projeção etária'],
], 'mapper de perfil público');

const discoveryFacade = read(
  'src/app/dashboard/discovery/application/discovery-public-profiles.facade.ts'
);
requireIncludes(discoveryFacade, [
  'watchCurrentAdultSlice$(',
  'item?.ageEligibilityValidUntil',
  'validUntilMs !== null && validUntilMs > nowMs',
], 'facade só pode usar validade projetada para retirar cache expirado');

forbid(discoveryFacade, [
  [/ageEligibilityVerifiedAdult/, 'facade não deve decidir maioridade por boolean projetado'],
  [/ageEligibilityValidUntil[\s\S]{0,220}(?:ALLOW|canAccess|canView|authorized)\s*=\s*true/i, 'facade não pode transformar validade projetada em autorização'],
], 'facade Discovery');

const officialProjection = read(
  'src/app/core/services/media/official-media-context.projection.ts'
);
requireIncludes(officialProjection, [
  "identity['verified'] !== true",
  "association['verified'] !== true",
  'identityType !== targetType',
  'return null;',
], 'Official projection deve falhar fechado');

const mediaPresentation = read(
  'src/app/media/shared/presentation/public-media-presentation.policy.ts'
);
requireIncludes(mediaPresentation, [
  'normalizeOfficialMediaContextProjection',
  'value?.officialMediaContext',
  ") !== null;",
], 'badge Oficial deve normalizar projeção antes de apresentar');

const promotionPlacement = read(
  'src/app/core/services/media/photo-promotion-placement.service.ts'
);
requireIncludes(promotionPlacement, [
  "'getPhotoPromotionPlacement'",
  'placementId',
  'campaignId',
  "disclosure: 'Patrocinado'",
  'PublicPhotoAccessService',
], 'Patrocinado deve nascer de placement backend');

for (const relativePath of [
  'src/app/layout/other-user-profile-view/other-user-profile-view.component.ts',
  'src/app/user-profile/user-profile-view/user-profile-view.component.ts',
  'src/app/explore/services/explore-personal-media.service.ts',
  'src/app/explore/services/explore-feed.service.ts',
  'src/app/explore/facades/explore-feed.facade.ts',
]) {
  const source = read(relativePath);
  forbid(source, [
    [/\bplacementId\b/, 'host não pode fabricar placement patrocinado'],
    [/\bcampaignId\b/, 'host não pode fabricar campanha patrocinada'],
    [/\bdisclosure\s*:\s*['"]Patrocinado['"]/, 'host não pode autoatribuir disclosure comercial'],
  ], relativePath);
}

console.log(
  '[media-host-authority] OK: host/profile/explore apenas apresentam ou falham fechado; autoridade permanece em backend/Rules.'
);
