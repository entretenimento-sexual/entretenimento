// functions/src/community/community-feed-access.policy.ts
import {
  CommunityFeedView,
  SanitizedCommunityFeedProjection,
} from './community-feed.model';

/**
 * Define o acesso de leitura ao conteúdo do Mural no nível da Comunidade.
 *
 * Comunidades com prévia autenticada usam o próprio Mural como superfície de
 * descoberta: o visitante autenticado pode ler o conteúdo, mas as capacidades
 * de escrita/interação continuam dependentes de membership ativo.
 *
 * O `activeMembership` preserva o acesso a Comunidades reservadas aos membros.
 */
export function resolveCommunityFeedContentAccess(
  activeMembership: boolean,
  authenticatedPreviewAccess: boolean | undefined
): boolean {
  return activeMembership || authenticatedPreviewAccess === true;
}

export function canViewerReadCommunityFeedAudience(
  projection: Readonly<SanitizedCommunityFeedProjection>,
  memberContentAccess: boolean
): boolean {
  return projection.audience === 'public_preview' || memberContentAccess;
}

export function canViewerReadCommunityFeedProjection(
  projection: Readonly<SanitizedCommunityFeedProjection>,
  view: CommunityFeedView,
  memberContentAccess: boolean
): boolean {
  if (!canViewerReadCommunityFeedAudience(projection, memberContentAccess)) {
    return false;
  }

  return view !== 'photos' || projection.item.kind === 'photo';
}
