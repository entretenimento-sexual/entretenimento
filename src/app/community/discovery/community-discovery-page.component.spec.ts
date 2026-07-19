// src/app/community/discovery/community-discovery-page.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { filter, firstValueFrom, of, take } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityDiscoveryPageComponent } from './community-discovery-page.component';

function venueCard() {
  return {
    communityId: 'community-local-1',
    name: 'Local Funcional',
    slug: 'local-funcional',
    description: 'Atualizações do lugar.',
    source: { type: 'venue' as const, id: 'venue-local-1' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
    access: {
      join: 'approval' as const,
      minimumRole: null,
      requiresActiveSubscription: false,
    },
  };
}

describe('CommunityDiscoveryPageComponent / Locais', () => {
  const getDiscoveryPage$ = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getDiscoveryPage$.mockReturnValue(
      of({
        items: [venueCard()],
        nextCursor: null,
        generatedAt: 123,
      })
    );

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { sourceType: 'venue' } } },
        },
        {
          provide: CommunityPreviewRepository,
          useValue: { getDiscoveryPage$ },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError: vi.fn() },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });
  });

  it('carrega somente comunidades originadas de Local', async () => {
    const component = TestBed.runInInjectionContext(
      () => new CommunityDiscoveryPageComponent()
    );
    const state = await firstValueFrom(
      component.state$.pipe(
        filter((value) => value.status === 'ready'),
        take(1)
      )
    );

    expect(component.title).toBe('Locais');
    expect(component.canCreateVenue).toBe(true);
    expect(getDiscoveryPage$).toHaveBeenCalledWith({
      limit: 12,
      cursor: null,
      sourceType: 'venue',
    });
    expect(state.items).toHaveLength(1);
    expect(component.detailsRoute(state.items[0])).toEqual([
      '/dashboard/comunidades/locais',
      'community-local-1',
    ]);
  });
});
