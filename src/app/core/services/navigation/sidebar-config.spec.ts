import { describe, expect, it } from 'vitest';

import {
  buildSidebarSections,
  isSidebarGroupItem,
  resolveSidebarSectionFromUrl,
} from './sidebar-config';

describe('sidebar-config', () => {
  it('deve expor fotos e vídeos na seção de mídia', () => {
    const sections = buildSidebarSections({
      isSubscriber: false,
      isVip: false,
      isAdmin: false,
    });
    const mediaSection = sections.find((section) => section.key === 'media');

    expect(mediaSection?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'media-photos',
          route: '/media/photos',
        }),
        expect.objectContaining({
          id: 'media-videos',
          route: '/media/videos',
        }),
      ])
    );
  });

  it('deve reconhecer a biblioteca de vídeos como seção de mídia', () => {
    expect(resolveSidebarSectionFromUrl('/media/videos')).toBe('media');
    expect(resolveSidebarSectionFromUrl('/media/perfil/u1/videos')).toBe('media');
  });

  it('deve aglutinar os destinos pessoais no grupo Conta', () => {
    const sections = buildSidebarSections({
      isSubscriber: false,
      isVip: false,
      isAdmin: false,
    });
    const settings = sections.find((section) => section.key === 'settings');

    expect(settings).toBeDefined();
    expect(settings?.title).toBe('');
    expect(settings?.items).toHaveLength(1);

    const account = settings?.items[0];
    expect(account && isSidebarGroupItem(account)).toBe(true);

    if (!account || !isSidebarGroupItem(account)) {
      throw new Error('Grupo Conta não foi criado.');
    }

    expect(account.id).toBe('account');
    expect(account.label).toBe('Conta');
    expect(account.children.map((item) => item.id)).toEqual([
      'my-profile',
      'preferences',
      'my-account',
      'safety-center',
    ]);
    expect(account.children.map((item) => item.route)).toEqual([
      '/perfil',
      '/preferencias',
      '/conta',
      '/dashboard/seguranca',
    ]);
  });

  it('deve manter recursos condicionais fora da Conta', () => {
    const basicSections = buildSidebarSections({
      isSubscriber: false,
      isVip: false,
      isAdmin: false,
    });
    const privilegedSections = buildSidebarSections({
      isSubscriber: true,
      isVip: true,
      isAdmin: true,
    });

    const basicIds = basicSections.flatMap((section) =>
      section.items.map((item) => item.id)
    );
    const privilegedIds = privilegedSections.flatMap((section) =>
      section.items.map((item) => item.id)
    );

    expect(basicIds).not.toContain('vip-area');
    expect(basicIds).not.toContain('premium-area');
    expect(basicIds).not.toContain('admin-dashboard');
    expect(privilegedIds).toContain('vip-area');
    expect(privilegedIds).toContain('premium-area');
    expect(privilegedIds).toContain('admin-dashboard');
  });

  it.each([
    '/perfil',
    '/perfil/usuario-1',
    '/preferencias',
    '/preferencias/editar/usuario-1',
    '/conta',
    '/dashboard/seguranca',
  ])('deve reconhecer %s como seção de conta', (url) => {
    expect(resolveSidebarSectionFromUrl(url)).toBe('settings');
  });
});
