import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_SECTION_ICONS,
  resolveCommunityAttentionPresentation,
  resolveCommunityMembershipRolePresentation,
  resolveCommunityNotificationStatusPresentation,
} from './community-ui.presentation';

describe('community UI presentation contract', () => {
  it('mantém iconografia única para navegação de conteúdo e administração', () => {
    expect(COMMUNITY_SECTION_ICONS).toEqual({
      feed: 'fa-message',
      photos: 'fa-images',
      members: 'fa-users',
      about: 'fa-circle-info',
      requests: 'fa-shield-halved',
      invites: 'fa-user-plus',
    });
  });

  it('distingue papéis sem reutilizar um badge genérico de membro', () => {
    expect(
      resolveCommunityMembershipRolePresentation('owner', 'community')
    ).toEqual({ label: 'Proprietário', icon: 'fa-crown' });
    expect(
      resolveCommunityMembershipRolePresentation('owner', 'venue')
    ).toEqual({ label: 'Responsável', icon: 'fa-crown' });
    expect(
      resolveCommunityMembershipRolePresentation('admin', 'community')
    ).toEqual({ label: 'Administração', icon: 'fa-shield-halved' });
    expect(
      resolveCommunityMembershipRolePresentation('moderator', 'community')
    ).toEqual({ label: 'Moderação', icon: 'fa-shield' });
    expect(
      resolveCommunityMembershipRolePresentation('member', 'community')
    ).toEqual({ label: 'Membro', icon: 'fa-user-group' });
  });

  it('usa um único estado de atenção com prioridade sobre unread comum', () => {
    expect(resolveCommunityAttentionPresentation(2, true)).toEqual({
      key: 'priority',
      label: 'Precisa de atenção',
      icon: 'fa-bolt',
    });
    expect(resolveCommunityAttentionPresentation(7, false)).toEqual({
      key: 'unread',
      label: 'Novas atividades',
      icon: 'fa-bell',
    });
    expect(resolveCommunityAttentionPresentation(0, false)).toEqual({
      key: 'quiet',
      label: 'Demais',
      icon: 'fa-check',
    });
  });

  it('não empilha mute sobre unread no status operacional do card', () => {
    expect(
      resolveCommunityNotificationStatusPresentation(7, true, true)
    ).toEqual({
      attention: 'priority',
      icon: 'fa-bolt',
      label: '7 não lidas',
    });
    expect(
      resolveCommunityNotificationStatusPresentation(0, false, true)
    ).toEqual({
      attention: 'quiet',
      icon: 'fa-bell-slash',
      label: 'Silenciada',
    });
    expect(
      resolveCommunityNotificationStatusPresentation(0, false, false)
    ).toBeNull();
  });
});
