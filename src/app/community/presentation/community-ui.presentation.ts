// src/app/community/presentation/community-ui.presentation.ts
// -----------------------------------------------------------------------------
// COMMUNITY UI PRESENTATION
// -----------------------------------------------------------------------------
// Vocabulário visual compartilhado entre descoberta, perfil e página da
// Comunidade. Mantém o mesmo conceito com o mesmo ícone e evita que estados
// operacionais concorram com identidade ou associação oficial.
// -----------------------------------------------------------------------------

import type {
  CommunityPreviewSourceType,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';

export interface CommunityUiPresentation {
  readonly label: string;
  readonly icon: string;
}

export type CommunityAttentionGroupKey = 'priority' | 'unread' | 'quiet';

export interface CommunityAttentionPresentation
  extends CommunityUiPresentation {
  readonly key: CommunityAttentionGroupKey;
}

export const COMMUNITY_SECTION_ICONS = Object.freeze({
  feed: 'fa-message',
  photos: 'fa-images',
  members: 'fa-users',
  about: 'fa-circle-info',
  requests: 'fa-shield-halved',
  invites: 'fa-user-plus',
} as const);

const COMMUNITY_ROLE_PRESENTATIONS: Readonly<
  Record<CommunityPreviewViewerRole, CommunityUiPresentation>
> = Object.freeze({
  owner: { label: 'Proprietário', icon: 'fa-crown' },
  admin: { label: 'Administração', icon: 'fa-shield-halved' },
  moderator: { label: 'Moderação', icon: 'fa-shield' },
  member: { label: 'Membro', icon: 'fa-user-group' },
});

const COMMUNITY_ATTENTION_PRESENTATIONS: Readonly<
  Record<CommunityAttentionGroupKey, CommunityAttentionPresentation>
> = Object.freeze({
  priority: {
    key: 'priority',
    label: 'Requer atenção',
    icon: 'fa-bolt',
  },
  unread: {
    key: 'unread',
    label: 'Novidades',
    icon: 'fa-bell',
  },
  quiet: {
    key: 'quiet',
    label: 'Em dia',
    icon: 'fa-check',
  },
});

export function resolveCommunityMembershipRolePresentation(
  role: CommunityPreviewViewerRole | null | undefined,
  sourceType: CommunityPreviewSourceType = 'community'
): CommunityUiPresentation | null {
  if (!role) return null;

  if (role === 'owner' && sourceType === 'venue') {
    return { label: 'Responsável', icon: 'fa-crown' };
  }

  return COMMUNITY_ROLE_PRESENTATIONS[role];
}

export function resolveCommunityAttentionPresentation(
  unreadCount: number,
  hasPriorityUnread: boolean
): CommunityAttentionPresentation {
  if (unreadCount > 0 && hasPriorityUnread) {
    return COMMUNITY_ATTENTION_PRESENTATIONS.priority;
  }

  if (unreadCount > 0) {
    return COMMUNITY_ATTENTION_PRESENTATIONS.unread;
  }

  return COMMUNITY_ATTENTION_PRESENTATIONS.quiet;
}

export function resolveCommunityNotificationStatusPresentation(
  unreadCount: number,
  hasPriorityUnread: boolean,
  muted: boolean
): (CommunityUiPresentation & { readonly attention: CommunityAttentionGroupKey }) | null {
  const attention = resolveCommunityAttentionPresentation(
    unreadCount,
    hasPriorityUnread
  );

  if (unreadCount > 0) {
    return {
      attention: attention.key,
      icon: attention.icon,
      label: `${unreadCount > 99 ? '99+' : unreadCount} não lidas`,
    };
  }

  if (muted) {
    return {
      attention: attention.key,
      icon: 'fa-bell-slash',
      label: 'Silenciada',
    };
  }

  return null;
}
