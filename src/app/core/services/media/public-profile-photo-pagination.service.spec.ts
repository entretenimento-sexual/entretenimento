import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  IPublicPhotoItem,
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import { MediaApplicationErrorService } from './media-application-error.service';
import { PublicPhotoAccessService } from './public-photo-access.service';
import { PublicMediaReadBoundaryService } from './public-media-read-boundary.service';
import { PublicProfilePhotoPaginationService } from './public-profile-photo-pagination.service';

const PHOTO: IPublicPhotoProjection = {
  id: 'photo-1',
  ownerUid: 'owner-1',
  createdAt: 1,
  publishedAt: 100,
  orderIndex: 0,
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  assetAccess: 'SIGNED_URL',
};

const ITEM: IPublicPhotoItem = {
  ...PHOTO,
  url: 'https://example.test/photo.jpg',
};

const CURSOR = {
  documentPath: 'public_profiles/owner-1/public_photos/photo-1',
  orderIndex: 0,
  publishedAt: 100,
};

describe('PublicProfilePhotoPaginationService', () => {
  let service: PublicProfilePhotoPaginationService;

  const read = { read$: vi.fn() };
  const access = { hydratePublicPhotoUrls$: vi.fn() };
  const mediaError = { reportSilently: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();

    read.read$.mockReturnValue(of({
      items: [PHOTO],
      nextCursor: CURSOR,
      hasMore: true,
      fetchedAt: 1,
      scanned: 1,
    }));

    access.hydratePublicPhotoUrls$.mockReturnValue(of([ITEM]));

    TestBed.configureTestingModule({
      providers: [
        PublicProfilePhotoPaginationService,
        {
          provide: PublicMediaReadBoundaryService,
          useValue: read,
        },
        {
          provide: PublicPhotoAccessService,
          useValue: access,
        },
        {
          provide: MediaApplicationErrorService,
          useValue: mediaError,
        },
      ],
    });

    service = TestBed.inject(PublicProfilePhotoPaginationService);
  });

  it('busca pagina publica limitada e hidrata as URLs', async () => {
    const page = await firstValueFrom(service.loadPage$('owner-1'));

    expect(read.read$).toHaveBeenCalledWith({
      mediaType: 'PHOTO',
      mode: 'PROFILE',
      ownerUids: ['owner-1'],
      limit: 24,
      cursor: null,
    });

    expect(access.hydratePublicPhotoUrls$).toHaveBeenCalledWith([PHOTO]);

    expect(page).toEqual({
      items: [ITEM],
      nextCursor: {
        documentId: 'photo-1',
        orderIndex: 0,
        publishedAt: 100,
      },
      hasMore: true,
    });
  });

  it('envia cursor da pagina seguinte com proprietario correto', async () => {
    await firstValueFrom(service.loadPage$('owner-1', {
      pageSize: 12,
      cursor: {
        documentId: 'photo-1',
        orderIndex: 0,
        publishedAt: 100,
      },
    }));

    expect(read.read$).toHaveBeenCalledWith({
      mediaType: 'PHOTO',
      mode: 'PROFILE',
      ownerUids: ['owner-1'],
      limit: 12,
      cursor: CURSOR,
    });
  });

  it('exclui fotos privadas, reprovadas ou de outro perfil', async () => {
    read.read$.mockReturnValue(of({
      items: [
        { ...PHOTO, id: 'private', visibility: 'PRIVATE' },
        { ...PHOTO, id: 'flagged', moderationStatus: 'FLAGGED' },
        { ...PHOTO, id: 'other', ownerUid: 'owner-2' },
        PHOTO,
      ],
      nextCursor: null,
      hasMore: false,
    }));

    const page = await firstValueFrom(service.loadPage$('owner-1'));

    expect(access.hydratePublicPhotoUrls$).toHaveBeenCalledWith([PHOTO]);
    expect(page.hasMore).toBe(false);
  });

  it('recusa cursor retornado para outro perfil', async () => {
    read.read$.mockReturnValue(of({
      items: [PHOTO],
      nextCursor: {
        ...CURSOR,
        documentPath: 'public_profiles/owner-2/public_photos/photo-1',
      },
      hasMore: true,
    }));

    const page = await firstValueFrom(service.loadPage$('owner-1'));

    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  it('preserva cursor quando a hidratacao filtra todos os itens', async () => {
    access.hydratePublicPhotoUrls$.mockReturnValue(of([]));

    const page = await firstValueFrom(service.loadPage$('owner-1'));

    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(true);
  });

  it('nao consulta backend para proprietario invalido', async () => {
    const page = await firstValueFrom(
      service.loadPage$('invalid/owner')
    );

    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(read.read$).not.toHaveBeenCalled();
  });

  it('propaga erro de leitura sem transformar falha em vazio', async () => {
    read.read$.mockReturnValue(
      throwError(() => new Error('backend unavailable'))
    );

    await expect(
      firstValueFrom(service.loadPage$('owner-1'))
    ).rejects.toThrow('backend unavailable');

    expect(mediaError.reportSilently).toHaveBeenCalledTimes(1);
  });
});