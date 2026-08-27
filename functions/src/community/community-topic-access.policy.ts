// functions/src/community/community-topic-access.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPIC ACCESS POLICY
// -----------------------------------------------------------------------------
// Política pura para leitura e interação em Tópicos.
// O handler é responsável por obter CommunityViewerContext e nunca confia em
// flags vindas do cliente para conceder acesso.
// -----------------------------------------------------------------------------

import type {
  CommunityTopicAudience,
  CommunityTopicStatus,
  SanitizedCommunityTopicProjection,
} from './community-topic.model';
import type { CommunityViewerRole } from './community-preview.model';

export type CommunityTopicModeratorRole = Exclude<CommunityViewerRole, 'member'>;

/**
 * Resolve a capacidade de leitura dos Tópicos no nível da Comunidade.
 *
 * Em Comunidades com prévia autenticada, Tópicos e respostas também funcionam
 * como superfície de descoberta. A escrita continua separada e depende de
 * `canInteract`, portanto esta permissão nunca concede membership.
 */
export function resolveCommunityTopicContentAccess(
  memberContentAccess: boolean,
  authenticatedPreviewAccess: boolean | undefined
): boolean {
  return memberContentAccess || authenticatedPreviewAccess === true;
}

export function canViewerReadCommunityTopicAudience(
  audience: CommunityTopicAudience,
  topicContentAccess: boolean
): boolean {
  return audience === 'public_preview' || topicContentAccess;
}

export function canViewerReadCommunityTopicProjection(
  projection: Readonly<SanitizedCommunityTopicProjection>,
  topicContentAccess: boolean
): boolean {
  return canViewerReadCommunityTopicAudience(
    projection.audience,
    topicContentAccess
  );
}

export function canViewerCreateCommunityTopic(canInteract: boolean): boolean {
  return canInteract;
}

export function canViewerReplyToCommunityTopic(
  status: CommunityTopicStatus,
  canInteract: boolean
): boolean {
  return canInteract && status === 'active';
}

export function canViewerModerateCommunityTopic(
  role: CommunityViewerRole | null
): role is CommunityTopicModeratorRole {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}
