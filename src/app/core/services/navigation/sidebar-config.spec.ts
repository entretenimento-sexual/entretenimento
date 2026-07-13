import { describe, expect, it } from 'vitest';

import {
  buildSidebarSections,
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
});
