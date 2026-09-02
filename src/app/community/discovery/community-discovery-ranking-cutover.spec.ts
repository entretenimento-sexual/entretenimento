import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { filter, firstValueFrom, of, take, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ProfilePreferencesService } from 'src/app/preferences/services/profile-preferences.service';
import { CommunityCreationGateService } from '../community-create/community-creation-gate.service';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import { CommunityDiscoveryCacheService } from './community-discovery-cache.service';
import { CommunityDiscoveryPageComponent } from './community-discovery-page.component';

function communityCard(name: string) {
  return {
    communityId: 'community-1',
    name,
    slug: 'comunidade-ranking',
    description: 'Comunidade usada para validar a troca segura de ranking.',
    source: { type: 'community' as const, id: 'community-1' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 12, postCount: 8, mediaCount: 1 },
    access: {
      join: 'approval' as const,
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
  };
}

describe('CommunityDiscoveryPageComponent / ranking cutover', () => {
  const getDiscoveryPage$ = vi.fn();
  const getMembershipContext$ = vi.fn();
  const readSnapshot$ = vi.fn();
  const rememberPage = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    readSnapshot$.mockReturnValue(of(null));
    getMembershipContext$.mockReturnValue(
      of({ activeCommunityIds: [], generatedAt: 123 })
    );

    TestBed.configureTestingModule({
      imports: [CommunityDiscoveryPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { sourceType: 'community', discoveryMode: 'explore' },
              queryParamMap: convertToParamMap({}),
            },
            queryParamMap: of(convertToParamMap({})),
          },
        },
        {
          provide: AuthSessionService,
          useValue: { uid$: of(null) },
        },
        {
          provide: ProfilePreferencesService,
          useValue: { getProfile$: vi.fn(() => of(null)) },
        },
        {
          provide: CommunityPreviewRepository,
          useValue: { getDiscoveryPage$ },
        },
        {
          provide: CommunityMembershipRepository,
          useValue: { getMembershipContext$ },
        },
        {
          provide: CommunityTagRepository,
          useValue: {
            getCommunityTagCatalog$: vi.fn(() =>
              of({ items: [], generatedAt: 123 })
            ),
          },
        },
        {
          provide: CommunityDiscoveryCacheService,
          useValue: { readSnapshot$, rememberPage },
        },
        {
          provide: CommunityCreationGateService,
          useValue: { requestCreation$: vi.fn(() => of(void 0)) },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError,
            showWarning: vi.fn(),
            showInfo: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError },
        },
      ],
    });
  });

  it('reinicia a primeira página quando o cursor pertence ao ranking anterior', async () => {
    const initialPage = {
      items: [communityCard('Comunidade antiga')],
      nextCursor: 'cursor1:legacy:community-1',
      generatedAt: 100,
    };
    const refreshedPage = {
      items: [communityCard('Comunidade reordenada')],
      nextCursor: 'cursor1:score_v2:community-1',
      generatedAt: 200,
    };
    getDiscoveryPage$
      .mockReturnValueOnce(of(initialPage))
      .mockReturnValueOnce(throwError(() => ({ code: 'functions/aborted' })))
      .mockReturnValueOnce(of(refreshedPage));
    const component = TestBed.runInInjectionContext(
      () => new CommunityDiscoveryPageComponent()
    );
    const persistentSubscription = component.state$.subscribe();

    const initialState = await firstValueFrom(
      component.state$.pipe(
        filter((state) => state.status === 'ready'),
        take(1)
      )
    );
    expect(initialState.nextCursor).toBe('cursor1:legacy:community-1');

    const refreshedStatePromise = firstValueFrom(
      component.state$.pipe(
        filter((state) => state.items[0]?.name === 'Comunidade reordenada'),
        take(1)
      )
    );
    component.loadMore(initialState.nextCursor);
    const refreshedState = await refreshedStatePromise;

    persistentSubscription.unsubscribe();

    expect(refreshedState.nextCursor).toBe('cursor1:score_v2:community-1');
    expect(getDiscoveryPage$).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: 'cursor1:legacy:community-1',
    }));
    expect(getDiscoveryPage$).toHaveBeenNthCalledWith(3, expect.objectContaining({
      cursor: null,
    }));
    expect(rememberPage).toHaveBeenLastCalledWith(
      expect.anything(),
      refreshedPage,
      false
    );
    expect(showError).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledOnce();
  });
});