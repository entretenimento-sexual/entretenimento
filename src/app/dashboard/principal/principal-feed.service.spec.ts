// src/app/dashboard/principal/principal-feed.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { CommunityPreviewRepository } from 'src/app/community/data-access/community-preview.repository';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { PrincipalFeedService } from './principal-feed.service';

const photo = {
  id: 'photo-1',
  ownerUid: 'owner-1',
  url: 'https://example.com/photo-1.jpg',
  createdAt: 100,
  publishedAt: 100,
  visibility: 'PUBLIC',
  orderIndex: 0,
};

describe('PrincipalFeedService', () => {
  const mediaQuery = {
    getLatestPublicPhotos$: vi.fn(),
  };
  const communityRepository = {
    getDiscoveryPage$: vi.fn(),
  };
  const globalError = {
    handleError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mediaQuery.getLatestPublicPhotos$.mockReturnValue(of([photo]));
    communityRepository.getDiscoveryPage$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));

    TestBed.configureTestingModule({
      providers: [
        PrincipalFeedService,
        { provide: MediaPublicQueryService, useValue: mediaQuery },
        { provide: CommunityPreviewRepository, useValue: communityRepository },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });
  });

  it('entrega atualização pública sem consultar espaços com a flag desligada', async () => {
    const service = TestBed.inject(PrincipalFeedService);
    const state = await firstValueFrom(
      service.state$.pipe(
        filter((value) => value.status !== 'loading'),
        take(1)
      )
    );

    expect(state.status).toBe('ready');
    expect(state.items.map((item) => item.id)).toEqual([
      'profile-photo:photo-1',
    ]);
    expect(communityRepository.getDiscoveryPage$).not.toHaveBeenCalled();
  });

  it('falha fechado e registra diagnóstico quando a fonte pública falha', async () => {
    mediaQuery.getLatestPublicPhotos$.mockReturnValue(
      throwError(() => new Error('query failed'))
    );
    const service = TestBed.inject(PrincipalFeedService);
    const state = await firstValueFrom(
      service.state$.pipe(
        filter((value) => value.status !== 'loading'),
        take(1)
      )
    );

    expect(state.status).toBe('error');
    expect(state.items).toEqual([]);
    expect(state.failedSources).toEqual(['profiles']);
    expect(globalError.handleError).toHaveBeenCalledTimes(1);
  });
});
