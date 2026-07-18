// src/app/core/community/community-access-policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY ACCESS POLICY
// -----------------------------------------------------------------------------
// Resolve capacidades visuais e operacionais sem consultar Firebase.
// A autorização definitiva de leitura/escrita permanece nas Rules e Functions.
// -----------------------------------------------------------------------------

import type {
  CommunityMemberRole,
  ICommunity,
  ICommunityMembership,
} from './community.model';

export type CommunityViewerMode =
  | 'visitor'
  | 'pending'
  | 'member'
  | 'moderator'
  | 'manager'
  | 'blocked';

export interface CommunityViewerCapabilities {
  mode: CommunityViewerMode;
  canPreview: boolean;
  canInteract: boolean;
  canModerate: boolean;
  canManage: boolean;
  canRequestMembership: boolean;
}

function isActiveMembership(
  membership: Readonly<ICommunityMembership> | null | undefined
): membership is Readonly<ICommunityMembership> {
  return membership?.status === 'active';
}

function isModerationRole(role: CommunityMemberRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}

function isManagementRole(role: CommunityMemberRole): boolean {
  return role === 'owner' || role === 'admin';
}

function resolveViewerMode(
  membership: Readonly<ICommunityMembership> | null | undefined
): CommunityViewerMode {
  if (membership?.status === 'blocked') {
    return 'blocked';
  }

  if (membership?.status === 'pending') {
    return 'pending';
  }

  if (!isActiveMembership(membership)) {
    return 'visitor';
  }

  if (isManagementRole(membership.role)) {
    return 'manager';
  }

  if (membership.role === 'moderator') {
    return 'moderator';
  }

  return 'member';
}

/**
 * Resolve capacidades para a UI. Não substitui Rules, Functions ou entitlement.
 */
export function resolveCommunityViewerCapabilities(
  community: Readonly<ICommunity>,
  membership: Readonly<ICommunityMembership> | null | undefined,
  authenticated = true
): Readonly<CommunityViewerCapabilities> {
  const mode = resolveViewerMode(membership);
  const activeMembership = isActiveMembership(membership);
  const operational =
    community.status === 'active' && community.moderation.state === 'active';
  const publicPreview =
    operational && community.visibility === 'public_preview';
  const privilegedMembership =
    activeMembership && isModerationRole(membership.role);

  if (!authenticated || mode === 'blocked') {
    return Object.freeze({
      mode,
      canPreview: false,
      canInteract: false,
      canModerate: false,
      canManage: false,
      canRequestMembership: false,
    });
  }

  const canPreview = publicPreview || activeMembership;
  const canInteract = operational && activeMembership;
  const canModerate =
    privilegedMembership && community.status !== 'archived';
  const canManage =
    activeMembership &&
    isManagementRole(membership.role) &&
    community.status !== 'archived';
  const canRequestMembership =
    operational &&
    publicPreview &&
    !membership &&
    community.access.join !== 'invite_only';

  return Object.freeze({
    mode,
    canPreview,
    canInteract,
    canModerate,
    canManage,
    canRequestMembership,
  });
}
