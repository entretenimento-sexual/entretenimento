import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import {
  IPublicPhotoItem,
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import {
  IPublicVideoItem,
  IPublicVideoProjection,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { PublicPhotoAccessService } from './public-photo-access.service';
import { PublicMediaSnapshotService } from './public-media-snapshot.service';
import { PublicVideoAccessService } from './public-video-access.service';

describe('PublicMediaSnapshotService', () => {
  function setup(
    cached: unknown = null,
    initialUid: string | null = 'viewer-1'
  ) {
    const uid$ = new BehaviorSubject<string | null>(initialUid);
    const get = vi.fn(() => of(cached));
    const set = vi.fn();
    const deleteCache = vi.fn();
    const hydratePublicPhotoUrls$ = vi.fn(
      (projections: readonly IPublicPhotoProjection[]) =>
        of(
          projections.map(
            (projection) =>
              ({
                ...projection,
                url: `https://signed.example.test/${projection.id}`,
              }) as IPublicPhotoItem
          )
        )
    );
    const hydratePublicVideoPreviews$ = vi.fn(
      (projections: readonly IPublicVideoProjection[]) =>
        of(
          projections.map(
            (projection) =>
              ({
                ...projection,
                url: null,
                posterUrl: `https://signed.example.test/${projection.id}.webp`,
                accessExpiresAt: 999_999,
              }) as IPublicVideoItem
          )
        )
    );

    TestBed.configureTestingModule({
      providers: [
        PublicMediaSnapshotService,
        {
          provide: CacheService,
          useValue: {
            get,
            set,
            delete: deleteCache,
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            ready$: of(true),
            uid$,
          },
        },
        {
          provide: PublicPhotoAccessService,
          useValue: {
            hydratePublicPhotoUrls$,
          },
        },
        {
          provide: PublicVideoAccessService,
          useValue: {
            hydratePublicVideoPreviews$,
          },
        },
      ],
    });

    const service = TestBed.inject(PublicMediaSnapshotService);
    deleteCache.mockClear();

    return {
      service,
      uid$,
      get,
      set,
      deleteCache,
      hydratePublicPhotoUrls$,
      hydratePublicVideoPreviews$,
    };
  }

  it('rehidrata a URL a partir de uma projeção persistida', async () => {
    const cached = [projection('photo-1', 'owner-1')];
    const { service, get, hydratePublicPhotoUrls$ } = setup(cached);

    const items = await firstValueFrom(service.read$('top-photos'));

    expect(get).toHaveBeenCalledWith(
      'media:public:snapshot:uid:viewer-1:top-photos'
    );
    expect(hydratePublicPhotoUrls$).toHaveBeenCalledWith(cached);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe(
      'https://signed.example.test/photo-1'
    );
  });

  it('remove URL de acesso antes de persistir o snapshot', () => {
    const { service, set } = setup();
    const source = {
      ...projection('photo-1', 'owner-1'),
      url: 'https://signed.example.test/private-token',
    } as IPublicPhotoItem;

    service.write('top-photos', [source]);

    expect(set).toHaveBeenCalledTimes(1);
    const [, persisted, ttl, options] = set.mock.calls[0];

    expect(persisted).toEqual([
      projection('photo-1', 'owner-1'),
    ]);
    expect((persisted as any[])[0]).not.toHaveProperty('url');
    expect(ttl).toBe(300_000);
    expect(options).toEqual({ persist: true });
  });

  it('rehidrata preview de vídeo sem restaurar playback persistido', async () => {
    const cached = [videoProjection('video-1', 'owner-1')];
    const { service, get, hydratePublicVideoPreviews$ } = setup(cached);

    const items = await firstValueFrom(service.read$('top-videos'));

    expect(get).toHaveBeenCalledWith(
      'media:public:snapshot:uid:viewer-1:top-videos'
    );
    expect(hydratePublicVideoPreviews$).toHaveBeenCalledWith(cached);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBeNull();
    expect(items[0]?.posterUrl).toContain('video-1.webp');
  });

  it('remove poster, playback e tokens temporários antes de persistir vídeo', () => {
    const { service, set } = setup();
    const source = {
      ...videoProjection('video-1', 'owner-1'),
      url: 'https://signed.example.test/playback-token',
      posterUrl: 'https://signed.example.test/poster-token',
      accessExpiresAt: 123,
      playbackToken: 'secret',
      retentionToken: 'secret-retention',
    } as unknown as IPublicVideoItem;

    service.write('latest-videos', [source]);

    expect(set).toHaveBeenCalledTimes(1);
    const [, persisted] = set.mock.calls[0];
    const item = (persisted as any[])[0];

    expect(item).not.toHaveProperty('url');
    expect(item).not.toHaveProperty('posterUrl');
    expect(item).not.toHaveProperty('accessExpiresAt');
    expect(item).not.toHaveProperty('playbackToken');
    expect(item).not.toHaveProperty('retentionToken');
  });

  it('separa snapshots orgânicos persistentes por UID e limpa a sessão anterior', async () => {
    const { service, uid$, get, deleteCache } = setup([]);

    await firstValueFrom(service.read$('latest-photos'));
    expect(get).toHaveBeenLastCalledWith(
      'media:public:snapshot:uid:viewer-1:latest-photos'
    );

    uid$.next('viewer-2');

    expect(deleteCache).toHaveBeenCalledWith(
      'media:public:snapshot:uid:viewer-1:latest-photos'
    );
    expect(deleteCache).toHaveBeenCalledWith(
      'media:public:snapshot:uid:viewer-1:top-photos'
    );
    expect(deleteCache).toHaveBeenCalledWith(
      'media:public:snapshot:uid:viewer-1:latest-videos'
    );
    expect(deleteCache).toHaveBeenCalledWith(
      'media:public:snapshot:uid:viewer-1:top-videos'
    );

    await firstValueFrom(service.read$('top-photos'));
    expect(get).toHaveBeenLastCalledWith(
      'media:public:snapshot:uid:viewer-2:top-photos'
    );
  });

  it('não lê nem persiste snapshot sem UID autenticado', async () => {
    const { service, get, set } = setup([], null);

    await expect(
      firstValueFrom(service.read$('top-photos'))
    ).resolves.toEqual([]);

    service.write('top-photos', [projection('photo-1', 'owner-1')]);

    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('normaliza, deduplica por owner+id e limita a 48 projeções', async () => {
    const cached = [
      projection('photo-1', 'owner-1'),
      {
        ...projection('photo-1', 'owner-1'),
        url: 'https://signed.example.test/should-not-survive',
      },
      projection('photo-1', 'owner-2'),
      ...Array.from({ length: 60 }, (_, index) =>
        projection(`photo-${index + 2}`, 'owner-1')
      ),
    ];
    const { service, hydratePublicPhotoUrls$ } = setup(cached);

    const items = await firstValueFrom(service.read$('top-photos'));

    expect(items.length).toBeLessThanOrEqual(48);
    const hydratedInput = hydratePublicPhotoUrls$.mock.calls[0]?.[0] ?? [];
    expect(hydratedInput).toHaveLength(items.length);
    expect(hydratedInput.some((item: any) => 'url' in item)).toBe(false);
    expect(
      hydratedInput.filter(
        (item: IPublicPhotoProjection) => item.id === 'photo-1'
      )
    ).toHaveLength(2);
  });
});

function projection(
  id: string,
  ownerUid: string
): IPublicPhotoProjection {
  return {
    id,
    ownerUid,
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    createdAt: 1,
    publishedAt: 1,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
  };
}


function videoProjection(
  id: string,
  ownerUid: string
): IPublicVideoProjection {
  return {
    id,
    ownerUid,
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'SIGNED_URL',
    title: 'Vídeo público',
    description: null,
    alt: 'Vídeo público',
    mimeType: 'video/mp4',
    sizeBytes: 1024,
    durationMs: 10000,
    createdAt: 1,
    publishedAt: 1,
    updatedAt: 1,
    lastViewedAt: null,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    moderationReason: null,
    reactionsEnabled: true,
    commentsEnabled: true,
    ratingsEnabled: true,
    viewsCount: 0,
    uniqueViewersCount: 0,
    reactionsCount: 0,
    commentsCount: 0,
    ratingsCount: 0,
    ratingAverage: 0,
    reportsCount: 0,
    openReportsCount: 0,
    confirmedReportsCount: 0,
    viewScore: 0,
    engagementScore: 0,
    score: 0,
    scoreBreakdown: {
      rankingScore: 0,
      qualityScore: 0,
      engagementScore: 0,
      safetyScore: 100,
    },
    owner: null,
  };
}
