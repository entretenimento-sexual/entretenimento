import { describe, expect, it } from 'vitest';

import {
  buildSidebarSections,
  isSidebarGroupItem,
  resolveSidebarItemIdFromUrl,
  resolveSidebarSectionFromUrl,
} from './sidebar-config.runtime';

describe('sidebar runtime composition', () => {
  it('keeps subscription, legal documents and compliance routes only inside account', () => {
    const sections = buildSidebarSections({
      isSubscriber: false,
      isVip: false,
      isAdmin: false,
    });
    const settings = sections.find(({ key }) => key === 'settings');
    const account = settings?.items.find(({ id }) => id === 'account');

    expect(account && isSidebarGroupItem(account)).toBe(true);
    if (!account || !isSidebarGroupItem(account)) return;

    expect(account.children.map(({ id }) => id)).toEqual([
      'my-profile',
      'preferences',
      'my-account',
      'legal-documents',
      'compliance-cases',
      'subscription-plan',
      'safety-center',
    ]);
    expect(
      sections.filter(({ key }) => key === 'subscriptions')
    ).toHaveLength(0);
    expect(resolveSidebarSectionFromUrl('/conta/documentos-legais')).toBe(
      'settings'
    );
    expect(resolveSidebarSectionFromUrl('/conta/conformidade')).toBe(
      'settings'
    );
  });

  it('preserves only premium links backed by a real route', () => {
    const sections = buildSidebarSections({
      isSubscriber: true,
      isVip: true,
      isAdmin: false,
    });
    const premium = sections.find(({ key }) => key === 'subscriptions');

    expect(premium?.title).toBe('Premium');
    expect(premium?.items.map(({ id }) => id)).toEqual([
      'vip-area',
    ]);
    expect(resolveSidebarSectionFromUrl('/subscription-plan')).toBe(
      'settings'
    );
  });

  it('apresenta Feed antes de Pessoas, Locais e Comunidades', () => {
    const sections = buildSidebarSections({
      isSubscriber: false,
      isVip: false,
      isAdmin: false,
    });
    const explore = sections.find(({ key }) => key === 'explore');

    expect(explore?.items.map(({ id }) => id)).toEqual([
      'social-feed',
      'discover-people',
      'discover-venues',
      'discover-communities',
    ]);
    expect(explore?.items[0]).toMatchObject({
      label: 'Feed',
      route: '/descobrir',
      exact: true,
    });
    expect(sections.some(({ key }) => key === 'communities')).toBe(false);
    expect(resolveSidebarSectionFromUrl('/descobrir')).toBe('explore');
    expect(resolveSidebarSectionFromUrl('/dashboard/perfis-sugeridos')).toBe(
      'explore'
    );
    expect(resolveSidebarSectionFromUrl('/dashboard/locais/novo')).toBe('explore');
    expect(resolveSidebarSectionFromUrl('/dashboard/comunidades/grupo-1')).toBe(
      'explore'
    );
  });

  it('mantém perfil alheio no contexto de descoberta sem confundir edição da conta', () => {
    expect(resolveSidebarSectionFromUrl('/perfil/usuario-1')).toBe('explore');
    expect(
      resolveSidebarSectionFromUrl('/perfil/usuario-1?from=discovery#bio')
    ).toBe('explore');
    expect(resolveSidebarSectionFromUrl('/perfil')).toBe('settings');
    expect(
      resolveSidebarSectionFromUrl('/perfil/usuario-1/editar-dados-pessoais')
    ).toBe('settings');
  });

  it('resolve um único item ativo para páginas contextuais de descoberta', () => {
    expect(resolveSidebarItemIdFromUrl('/descobrir')).toBe('social-feed');
    expect(resolveSidebarItemIdFromUrl('/dashboard/explorar')).toBe(
      'discover-people'
    );
    expect(resolveSidebarItemIdFromUrl('/dashboard/perfis-sugeridos')).toBe(
      'discover-people'
    );
    expect(resolveSidebarItemIdFromUrl('/dashboard/online')).toBe(
      'discover-people'
    );
    expect(resolveSidebarItemIdFromUrl('/perfil/usuario-1')).toBe(
      'discover-people'
    );
    expect(resolveSidebarItemIdFromUrl('/outro-perfil/usuario-1')).toBe(
      'discover-people'
    );
  });

  it('resolve destinos específicos da conta antes do pai /conta', () => {
    expect(resolveSidebarItemIdFromUrl('/conta')).toBe('my-account');
    expect(resolveSidebarItemIdFromUrl('/conta/documentos-legais')).toBe(
      'legal-documents'
    );
    expect(resolveSidebarItemIdFromUrl('/conta/conformidade')).toBe(
      'compliance-cases'
    );
    expect(resolveSidebarItemIdFromUrl('/subscription-plan')).toBe(
      'subscription-plan'
    );
    expect(resolveSidebarItemIdFromUrl('/dashboard/seguranca')).toBe(
      'safety-center'
    );
  });

  it('resolve mídia contextual sem acender fotos e vídeos ao mesmo tempo', () => {
    expect(resolveSidebarItemIdFromUrl('/media/photos')).toBe('media-photos');
    expect(resolveSidebarItemIdFromUrl('/media/ultimas-fotos')).toBe(
      'media-photos'
    );
    expect(resolveSidebarItemIdFromUrl('/media/perfil/u1/fotos-publicas')).toBe(
      'media-photos'
    );
    expect(resolveSidebarItemIdFromUrl('/media/videos')).toBe('media-videos');
    expect(resolveSidebarItemIdFromUrl('/media/video/u1/v1')).toBe(
      'media-videos'
    );
    expect(resolveSidebarItemIdFromUrl('/media/perfil/u1/videos-publicos')).toBe(
      'media-videos'
    );
  });

  it('separa conexões de mensagens sem promover salas antigas no menu global', () => {
    const sections = buildSidebarSections({
      isSubscriber: false,
      isVip: false,
      isAdmin: false,
    });
    const connections = sections.find(({ key }) => key === 'profiles');
    const chat = sections.find(({ key }) => key === 'chat');

    expect(connections?.title).toBe('Conexões');
    expect(connections?.items.map(({ id }) => id)).toEqual([
      'friends-list',
      'friend-requests',
    ]);
    expect(
      connections?.items.map((item) =>
        isSidebarGroupItem(item) ? null : item.route
      )
    ).toEqual([
      '/friends/list',
      '/friends/requests',
    ]);

    expect(chat?.items.map(({ id }) => id)).toEqual([
      'chat-list',
    ]);
    expect(
      chat?.items.map((item) =>
        isSidebarGroupItem(item) ? null : item.route
      )
    ).toEqual([
      '/chat',
    ]);
    expect(chat?.items.some(({ id }) => id === 'chat-rooms')).toBe(false);
    expect(chat?.items.some(({ id }) => id === 'room-invites')).toBe(false);

    expect(resolveSidebarSectionFromUrl('/chat/rooms')).toBe('chat');
    expect(resolveSidebarSectionFromUrl('/chat/room-invites')).toBe('chat');
    expect(resolveSidebarSectionFromUrl('/chat/invite-list')).toBe('chat');
    expect(resolveSidebarSectionFromUrl('/friends/requests')).toBe('profiles');
    expect(resolveSidebarSectionFromUrl('/dashboard/friends/list')).toBe(
      'profiles'
    );
    expect(resolveSidebarItemIdFromUrl('/friends/requests')).toBe(
      'friend-requests'
    );
    expect(resolveSidebarItemIdFromUrl('/friends/blocked')).toBe(
      'friends-list'
    );
    expect(resolveSidebarItemIdFromUrl('/chat/rooms')).toBe('chat-list');
  });

  it('mantém Comunidades visível quando somente o preview de Locais está desativado', () => {
    const sections = buildSidebarSections(
      {
        isSubscriber: false,
        isVip: false,
        isAdmin: false,
      },
      {
        communitiesEnabled: true,
        communityPreviewEnabled: false,
      }
    );
    const explore = sections.find(({ key }) => key === 'explore');

    expect(explore?.items.map(({ id }) => id)).toEqual([
      'social-feed',
      'discover-people',
      'discover-communities',
    ]);
  });

  it('mantém Feed e Pessoas quando Locais e Comunidades estão desativados', () => {
    const sections = buildSidebarSections(
      {
        isSubscriber: false,
        isVip: false,
        isAdmin: false,
      },
      {
        communitiesEnabled: false,
        communityPreviewEnabled: false,
      }
    );
    const explore = sections.find(({ key }) => key === 'explore');

    expect(explore?.items.map(({ id }) => id)).toEqual([
      'social-feed',
      'discover-people',
    ]);
  });
});