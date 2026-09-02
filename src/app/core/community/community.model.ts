// src/app/core/community/community.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY DOMAIN MODEL
// -----------------------------------------------------------------------------
// Contrato canônico do frontend para o domínio social de Comunidades.
//
// - `community`: Comunidade criada por usuário elegível, com membros, regras,
//   mural, moderação e lifecycle próprios;
// - `venue`: superfície social vinculada a um Local físico, reutilizando a
//   infraestrutura comunitária sem transformar o Local em uma Comunidade;
// - associação oficial identifica qual entidade canônica o espaço representa;
// - participação comum permanece privada por padrão e possui policy própria;
// - Sala não é origem comunitária. Salas pertencem ao domínio de Conversas.
// -----------------------------------------------------------------------------

import type { ContentAccessPolicy } from '../access/content-access-policy.model';
import type {
  CommunityOfficialAssociationPublic,
} from './community-official-association.model';
import type {
  CommunityMemberProfileVisibility,
  CommunityMembershipDisclosurePolicy,
} from './community-membership-visibility.model';

export const COMMUNITY_SOURCE_TYPES = ['community', 'venue'] as const;

export type CommunitySourceType = (typeof COMMUNITY_SOURCE_TYPES)[number];

export function isCommunitySourceType(
  value: unknown
): value is CommunitySourceType {
  return value === 'community' || value === 'venue';
}

export const COMMUNITY_STATUSES = [
  'active',
  'paused',
  'dormant',
  'archived',
  'scheduled_for_deletion',
] as const;

export type CommunityStatus = (typeof COMMUNITY_STATUSES)[number];

export function isCommunityStatus(value: unknown): value is CommunityStatus {
  return value === 'active'
    || value === 'paused'
    || value === 'dormant'
    || value === 'archived'
    || value === 'scheduled_for_deletion';
}

export type CommunityVisibility =
  | 'public_preview'
  | 'members_only'
  | 'hidden';

export type CommunityModerationState =
  | 'active'
  | 'pending_review'
  | 'hidden'
  | 'rejected';

export type CommunityJoinPolicy = 'open' | 'approval' | 'invite_only';

export type CommunityMemberRole = 'owner' | 'admin' | 'moderator' | 'member';

export type CommunityMemberStatus =
  | 'active'
  | 'pending'
  | 'blocked'
  | 'left';

export interface ICommunitySource {
  type: CommunitySourceType;
  id: string;
}

/**
 * Política social da comunidade.
 *
 * `contentAccess` descreve requisitos de perfil ou assinatura, mas não concede
 * acesso. Entitlements continuam autoritativos no backend.
 */
export interface ICommunityAccessPolicy {
  preview: 'authenticated' | 'members_only';
  interaction: 'members_only';
  join: CommunityJoinPolicy;
  contentAccess?: Readonly<ContentAccessPolicy> | null;
}

export interface ICommunityModeration {
  state: CommunityModerationState;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  reason?: string | null;
}

export interface ICommunityMetrics {
  memberCount: number;
  postCount: number;
  mediaCount: number;
}

export interface ICommunity {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  source: ICommunitySource;
  status: CommunityStatus;
  visibility: CommunityVisibility;
  access: ICommunityAccessPolicy;
  moderation: ICommunityModeration;
  metrics: ICommunityMetrics;
  /**
   * Controla se membros podem optar por exibir a participação no próprio perfil.
   * Ausência equivale a `disabled`; nunca significa consentimento implícito.
   */
  membershipDisclosure?: Readonly<CommunityMembershipDisclosurePolicy> | null;
  /** Projeção pública; dados de verificação permanecem backend-only. */
  officialAssociation?: Readonly<CommunityOfficialAssociationPublic> | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

/**
 * Membership individual. Não existe array crescente de membros no documento da
 * comunidade; o vínculo é armazenado em subcoleção/projeção própria.
 */
export interface ICommunityMembership {
  communityId: string;
  uid: string;
  role: CommunityMemberRole;
  status: CommunityMemberStatus;
  /**
   * Consentimento granular do próprio membro para aquela Comunidade.
   * Ausência equivale a `hidden` e nunca deve ser promovida automaticamente.
   */
  profileVisibility?: CommunityMemberProfileVisibility | null;
  /**
   * Versão da policy de disclosure aceita quando o membro escolheu `visible`.
   * Versão divergente invalida a exposição até novo consentimento explícito.
   */
  profileVisibilityPolicyVersion?: number | null;
  joinedAt?: number | null;
  updatedAt?: number | null;
}
