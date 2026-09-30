import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SocialExploreMediaViewerFacade } from './social-explore-media-viewer.facade';

const VIDEO = {
  id: 'video-1',
  ownerUid: 'owner-1',
  mediaType: 'VIDEO',
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  posterUrl: 'https://example.test/poster.webp',
} as any;

const PHOTO = {
  id: 'photo-1',
  ownerUid: 'owner-1',
  mediaType: 'PHOTO',
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  url: 'https://example.test/photo.webp',
} as any;

describe('SocialExploreMediaViewerFacade', () => {
  function setup(openResult = of(void 0)) {
    const open$ = vi.fn(() => openResult as any);
    const showWarning = vi.fn();
    const report = vi.fn();

    const facade = new SocialExploreMediaViewerFacade(
      { open$ } as any,
      { showWarning } as any,
      { report } as any
    );

    return { facade, open$, showWarning, report };
  }

  it('abre a mídia selecionada pelo launcher misto canônico', async () => {
    const { facade, open$ } = setup();

    await firstValueFrom(facade.open$(VIDEO, [PHOTO, VIDEO]));

    expect(open$).toHaveBeenCalledWith({
      items: [PHOTO, VIDEO],
      selected: VIDEO,
      source: 'discover',
    });
    expect(facade.openingMediaKey()).toBeNull();
  });

  it('avisa quando a mídia não pertence mais à sequência', () => {
    const { facade, open$, showWarning } = setup();

    const values: unknown[] = [];
    facade.open$(VIDEO, [PHOTO]).subscribe((value) => values.push(value));

    expect(open$).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      'Esta publicação não está mais disponível para visitantes.'
    );
    expect(values).toEqual([]);
  });

  it('não inicia segunda abertura enquanto outra mídia está abrindo', () => {
    const { facade, open$ } = setup();

    facade.openingMediaKey.set(facade.mediaKey(PHOTO));

    const values: unknown[] = [];
    facade.open$(VIDEO, [VIDEO]).subscribe((value) => values.push(value));

    expect(open$).not.toHaveBeenCalled();
    expect(values).toEqual([]);
  });

  it('mantém erro do launcher sob autoridade do launcher e limpa opening state', async () => {
    const error = new Error('viewer failed');
    const { facade } = setup(throwError(() => error));

    const values: unknown[] = [];
    facade.open$(VIDEO, [VIDEO]).subscribe((value) => values.push(value));

    expect(values).toEqual([]);
    expect(facade.openingMediaKey()).toBeNull();
  });

  it('marca falha de poster uma única vez e diagnostica silenciosamente', () => {
    const { facade, report } = setup();

    facade.markVideoPosterFailed(VIDEO);
    facade.markVideoPosterFailed(VIDEO);

    expect(facade.hasUsableVideoPoster(VIDEO)).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      {
        feature: 'explore-media',
        operation: 'loadExploreVideoPoster',
        fallbackMessage: 'Não foi possível carregar a capa deste vídeo.',
        notification: 'none',
        metadata: {
          scope: 'SocialExploreMediaViewerFacade',
          hasOwnerUid: true,
          hasVideoId: true,
        },
      }
    );

    facade.resetVideoPosterFailures();
    expect(facade.hasUsableVideoPoster(VIDEO)).toBe(true);
  });
});
