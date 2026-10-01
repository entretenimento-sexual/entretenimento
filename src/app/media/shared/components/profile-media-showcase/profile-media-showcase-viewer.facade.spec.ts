import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileMediaShowcaseViewerFacade } from './profile-media-showcase-viewer.facade';

const photo = {
  id: 'photo-1',
  ownerUid: 'owner-1',
  mediaType: 'PHOTO',
} as any;

const video = {
  id: 'video-1',
  ownerUid: 'owner-1',
  mediaType: 'VIDEO',
} as any;

describe('ProfileMediaShowcaseViewerFacade', () => {
  function setup(input?: {
    previewItems?: any[];
    previewError?: unknown;
    viewerError?: unknown;
  }) {
    const getProfilePublicMediaPreview$ = vi.fn(() =>
      input?.previewError
        ? throwError(() => input.previewError)
        : of({
            items: input?.previewItems ?? [photo, video],
            photosCount: 1,
            videosCount: 1,
            totalCount: 2,
          })
    );
    const open$ = vi.fn(() =>
      input?.viewerError
        ? throwError(() => input.viewerError)
        : of(void 0)
    );
    const showWarning = vi.fn();
    const report = vi.fn();

    const facade = new ProfileMediaShowcaseViewerFacade(
      { getProfilePublicMediaPreview$ } as any,
      { open$ } as any,
      { showWarning } as any,
      { report } as any
    );

    return {
      facade,
      getProfilePublicMediaPreview$,
      open$,
      showWarning,
      report,
    };
  }

  it('usa identidade pública canônica com owner e tipo', () => {
    const { facade } = setup();

    expect(facade.identity(photo)).not.toBe(facade.identity({
      ...photo,
      ownerUid: 'owner-2',
    }));
  });

  it('refresca a prévia antes de abrir o viewer', async () => {
    const { facade, getProfilePublicMediaPreview$, open$ } = setup();

    await firstValueFrom(facade.open$('owner-1', photo, 0));

    expect(getProfilePublicMediaPreview$).toHaveBeenCalledWith(
      'owner-1',
      5,
      { propagateErrors: true }
    );
    expect(open$).toHaveBeenCalledWith({
      items: [photo, video],
      selected: photo,
      source: 'profile',
    });
    expect(facade.opening()).toBe(false);
  });

  it('avisa quando a mídia saiu da prévia pública', () => {
    const { facade, open$, showWarning } = setup({
      previewItems: [video],
    });

    facade.open$('owner-1', photo, 0).subscribe();

    expect(open$).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      'Esta mídia não está mais disponível para visitantes.'
    );
    expect(facade.opening()).toBe(false);
  });

  it('mantém falha do refresh no pipeline canônico de mídia', () => {
    const error = new Error('preview failed');
    const { facade, report } = setup({ previewError: error });

    facade.open$('owner-1', photo, 0).subscribe();

    expect(report).toHaveBeenCalledWith(error, {
      operation: 'refreshProfileMediaPreview',
      reasonHint: 'media_access_temporarily_unavailable',
      metadata: {
        scope: 'ProfileMediaShowcaseViewerFacade',
        hasOwnerUid: true,
      },
    });
    expect(facade.opening()).toBe(false);
  });
});
