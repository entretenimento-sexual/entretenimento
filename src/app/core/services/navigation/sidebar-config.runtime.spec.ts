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

  it('adds one global Communities entry and resolves Local routes', () => {
    const sections = buildSidebarSections({
      isSubscriber: false,
      isVip: false,
      isAdmin: false,
    });
    const communities = sections.find(({ key }) => key === 'communities');

    expect(communities?.items.map(({ id }) => id)).toEqual(['communities']);
    expect(
      resolveSidebarSectionFromUrl('/dashboard/comunidades/locais/novo')
    ).toBe('communities');
  });
});
