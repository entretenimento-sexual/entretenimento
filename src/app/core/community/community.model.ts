// src/app/core/community/community.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY DOMAIN MODEL
// -----------------------------------------------------------------------------
// Contrato canônico compartilhado por comunidades originadas de locais e salas.
// A origem mantém sua autoridade própria; feed, mídia, membros e acesso usam este
// domínio social comum.
// -----------------------------------------------------------------------------

import type { ContentAccessPolicy } from '../access/content-access-policy.model';

export type CommunitySourceType = 'venue' | 'room';

export type CommunityStatus = 'active' | 'paused' | 'archived';

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
  joinedAt?: number | null;
  updatedAt?: number | null;
}
