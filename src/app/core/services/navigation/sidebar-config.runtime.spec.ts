import { describe, expect, it } from 'vitest';

import {
  buildSidebarSections,
  isSidebarGroupItem,
  resolveSidebarSectionFromUrl,
} from './sidebar-config.runtime';

describe('sidebar runtime composition', () => {
  it('keeps the subscription route only inside account', () => {
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
      'subscription-plan',
      'safety-center',
    ]);
    expect(
      sections.filter(({ key }) => key === 'subscriptions')
    ).toHaveLength(0);
  });

  it('preserves conditional premium links and account route context', () => {
    const sections = buildSidebarSections({
      isSubscriber: true,
      isVip: true,
      isAdmin: false,
    });
    const premium = sections.find(({ key }) => key === 'subscriptions');

    expect(premium?.title).toBe('Premium');
    expect(premium?.items.map(({ id }) => id)).toEqual([
      'vip-area',
      'premium-area',
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
    expect(resolveSidebarSectionFromUrl('/dashboard/locais/novo')).toBe('explore');
    expect(resolveSidebarSectionFromUrl('/dashboard/comunidades/grupo-1')).toBe(
      'explore'
    );
  });

  it('separa Mensagens e Salas dentro de Conversas', () => {
    const sections = buildSidebarSections({
      isSubscriber: false,
      isVip: false,
      isAdmin: false,
    });
    const chat = sections.find(({ key }) => key === 'chat');

    expect(chat?.items.map(({ id }) => id)).toEqual([
      'chat-list',
      'chat-rooms',
    ]);
    expect(
      chat?.items.map((item) =>
        isSidebarGroupItem(item) ? null : item.route
      )
    ).toEqual([
      '/chat',
      '/chat/rooms',
    ]);
  });

  it('mantém Feed e Pessoas quando Locais e Comunidades estão desativados', () => {
    const sections = buildSidebarSections(
      {
        isSubscriber: false,
        isVip: false,
        isAdmin: false,
      },
      { communityPreviewEnabled: false }
    );
    const explore = sections.find(({ key }) => key === 'explore');

    expect(explore?.items.map(({ id }) => id)).toEqual([
      'social-feed',
      'discover-people',
    ]);
  });
});
