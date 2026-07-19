// src/app/community/discovery/community-discovery-my-page.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { filter, firstValueFrom, of, take } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityDiscoveryPageComponent } from './community-discovery-page.component';

function communityCard() {
  return {
    communityId: 'community-owned-1',
    name: 'Minha Comunidade',
    slug: 'minha-comunidade',
    description: 'Grupo administrado pelo usuário.',
    source: { type: 'community' as const, id: 'community-owned-1' },
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

describe('CommunityDiscoveryPageComponent / Minhas comunidades', () => {
  const getDiscoveryPage$ = vi.fn();
  const getMyCommunitiesPage$ = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getMyCommunitiesPage$.mockReturnValue(
      of({
        items: [communityCard()],
        nextCursor: null,
        generatedAt: 123,
      })
    );

    TestBed.configureTestingModule({
      imports: [CommunityDiscoveryPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { sourceType: 'community', discoveryMode: 'mine' },
            },
          },
        },
        {
          provide: CommunityPreviewRepository,
          useValue: { getDiscoveryPage$, getMyCommunitiesPage$ },
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

  it('usa a callable privada e não a descoberta global', async () => {
    const component = TestBed.runInInjectionContext(
      () => new CommunityDiscoveryPageComponent()
    );
    const state = await firstValueFrom(
      component.state$.pipe(
        filter((value) => value.status === 'ready'),
        take(1)
      )
    );

    expect(component.discoveryMode).toBe('mine');
    expect(component.title).toBe('Minhas comunidades');
    expect(getMyCommunitiesPage$).toHaveBeenCalledWith({
      limit: 12,
      cursor: null,
      sourceType: 'community',
    });
    expect(getDiscoveryPage$).not.toHaveBeenCalled();
    expect(state.items.map((item) => item.communityId)).toEqual([
      'community-owned-1',
    ]);
  });
});
