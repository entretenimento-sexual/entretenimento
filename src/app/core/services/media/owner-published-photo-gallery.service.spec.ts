import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicPhotoOwnerPage } from 'src/app/core/interfaces/media/i-public-media-owner-page';
import { MediaApplicationErrorService } from './media-application-error.service';
import { PublicMediaOwnerPageQueryService } from './public-media-owner-page-query.service';
import {
  mergeOwnerPublishedPhotos,
  OwnerPublishedPhotoGalleryService,
} from './owner-published-photo-gallery.service';

const PHOTO: IPublicPhotoItem = {
  id: 'photo-1',
  ownerUid: 'owner-a',
  createdAt: 1,
  publishedAt: 200,
  orderIndex: 0,
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  url: 'https://example.test/photo-1.jpg',
};
const FRIENDS: IPublicPhotoItem = {
  ...PHOTO,
  id: 'photo-2',
  visibility: 'FRIENDS',
  publishedAt: 100,
  url: 'https://example.test/photo-2.jpg',
};
const OTHER: IPublicPhotoItem = {
  ...PHOTO,
  id: 'foreign',
  ownerUid: 'owner-b',
};
const CURSOR = {
  kind: 'PHOTO' as const,
  publishedAt: 200,
  documentPath: 'public_profiles/owner-a/public_photos/photo-1',
};

function page(
  items: IPublicPhotoItem[],
  nextCursor: IPublicPhotoOwnerPage['nextCursor'],
  failed = false
): IPublicPhotoOwnerPage {
  return {
    items, nextCursor, failed,
    hasMore: nextCursor !== null,
    loadedAt: Date.now(),
  };
}

describe('OwnerPublishedPhotoGalleryService', () => {
  let service: OwnerPublishedPhotoGalleryService;
  let load: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    load = vi.fn((_request: unknown) => of(page([PHOTO], CURSOR)));
    report = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        OwnerPublishedPhotoGalleryService,
        { provide: PublicMediaOwnerPageQueryService, useValue: { loadPhotoPage$: load } },
        { provide: MediaApplicationErrorService, useValue: { report } },
      ],
    });
    service = TestBed.inject(OwnerPublishedPhotoGalleryService);
  });

  it('consulta as publicações autorizadas com o limite e escopo do proprietário', () => {
    let latest: unknown;
    service.state$.subscribe((state) => latest = state);
    service.connect('owner-a', true);

    expect(load).toHaveBeenCalledWith({
      ownerUids: ['owner-a'],
      pageSize: 24,
      cursor: null,
      notifyOnError: false,
    });
    expect(latest).toMatchObject({
      ownerUid: 'owner-a', items: [PHOTO], hasMore: true, loading: false,
    });
  });

  it('não consulta nem apresenta galeria quando o acesso é negado', () => {
    let latest: unknown;
    service.state$.subscribe((state) => latest = state);
    service.connect('owner-a', false);
    expect(load).not.toHaveBeenCalled();
    expect(latest).toMatchObject({ ownerUid: 'owner-a', items: [] });
  });

  it('carrega a segunda página e preserva itens sem duplicar', () => {
    load.mockImplementation((request: { cursor?: unknown }) =>
      of(request.cursor ? page([PHOTO, FRIENDS, OTHER], null) : page([PHOTO], CURSOR))
    );
    let latest: IPublicPhotoItem[] = [];
    service.state$.subscribe((state) => latest = [...state.items]);
    service.connect('owner-a', true);
    service.loadMorePhotos();

    expect(latest).toEqual([PHOTO, FRIENDS]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('mantém a primeira página e oferece nova tentativa após falha', () => {
    let attempts = 0;
    load.mockImplementation((request: { cursor?: unknown }) => {
      if (!request.cursor) return of(page([PHOTO], CURSOR));
      attempts++;
      return of(attempts === 1
        ? { ...page([], CURSOR), failed: true }
        : page([FRIENDS], null));
    });
    let latest: IPublicPhotoOwnerPage | undefined;
    service.state$.subscribe((state) => latest = state as unknown as IPublicPhotoOwnerPage);
    service.connect('owner-a', true);
    service.loadMorePhotos();
    expect(latest).toMatchObject({ items: [PHOTO], pageError: true });
    service.retry();
    expect(latest).toMatchObject({ items: [PHOTO, FRIENDS], pageError: false });
  });

  it('descarta uma resposta tardia ao trocar o proprietário', () => {
    const pending = new Subject<IPublicPhotoOwnerPage>();
    load.mockImplementation((request: { ownerUids: string[]; cursor?: unknown }) => {
      if (request.ownerUids[0] === 'owner-b') return of(page([{ ...OTHER }], null));
      return request.cursor ? pending : of(page([PHOTO], CURSOR));
    });
    let latest: IPublicPhotoItem[] = [];
    service.state$.subscribe((state) => latest = [...state.items]);
    service.connect('owner-a', true);
    service.loadMorePhotos();
    service.connect('owner-b', true);
    pending.next(page([FRIENDS], null));
    expect(latest).toEqual([OTHER]);
  });

  it('não reabre a mesma consulta por mudanças redundantes de estado', () => {
    service.connect('owner-a', true);
    service.connect('owner-a', true);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('mergeOwnerPublishedPhotos', () => {
  it('elimina repetição e rejeita mídias de outra conta', () => {
    expect(mergeOwnerPublishedPhotos('owner-a', [PHOTO], [PHOTO, FRIENDS, OTHER]))
      .toEqual([PHOTO, FRIENDS]);
  });
});
