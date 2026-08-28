import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import * as CommunityDiscoveryCacheActions from 'src/app/store/actions/actions.discovery/community-discovery-cache.actions';
import { CommunityDomainEventsService } from '../data-access/community-domain-events.service';
import {
  buildCommunityDiscoveryCacheKey,
  buildCommunityDiscoveryCacheQuery,
} from './community-discovery-cache.model';
import { CommunityDiscoveryCacheService } from './community-discovery-cache.service';

describe('CommunityDiscoveryCacheService', () => {
  const context = {
    sourceType: 'community' as const,
    discoveryMode: 'explore' as const,
    tagId: null,
    pageSize: 12,
  };
  const query = buildCommunityDiscoveryCacheQuery('viewer-1', context)!;
  const queryKey = buildCommunityDiscoveryCacheKey(query);

  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CommunityDiscoveryCacheService,
        CommunityDomainEventsService,
        provideMockStore({
          initialState: {
            communityDiscoveryCache: {
              activeViewerUid: 'viewer-1',
              byQuery: {},
            },
          },
        }),
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('viewer-1'),
            currentAuthUser: { uid: 'viewer-1' },
          },
        },
      ],
    });

    store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
  });

  it('invalida o viewer atual quando uma mutation de dominio altera a descoberta', () => {
    TestBed.inject(CommunityDiscoveryCacheService);
    vi.mocked(store.dispatch).mockClear();

    TestBed.inject(CommunityDomainEventsService).notifyDiscoveryChanged(
      'membership_changed',
      'community-1'
    );

    expect(store.dispatch).toHaveBeenCalledWith(
      CommunityDiscoveryCacheActions.invalidateCommunityDiscoveryViewer({
        viewerUid: 'viewer-1',
      })
    );
  });

  it('expõe cards, cursor e lifecycle diretamente do slice NgRx', async () => {
    const service = TestBed.inject(CommunityDiscoveryCacheService);
    store.setState({
      communityDiscoveryCache: {
        activeViewerUid: 'viewer-1',
        byQuery: {
          [queryKey]: {
            status: 'ready',
            items: [{
              communityId: 'community-1',
              name: 'Comunidade 1',
              slug: 'community-1',
              description: null,
              source: { type: 'community', id: 'community-1' },
              avatarUrl: null,
              coverUrl: null,
              metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
              access: {
                join: 'approval',
                minimumRole: null,
                requiresActiveSubscription: false,
              },
              tags: [],
            }],
            nextCursor: 'cursor-2',
            loadingMore: true,
            lastLoadedAt: Date.now(),
            lastAccessedAt: Date.now(),
            invalidated: false,
          },
        },
      },
    } as any);

    const state = await firstValueFrom(service.state$(context));

    expect(state.status).toBe('ready');
    expect(state.items.map((item) => item.communityId)).toEqual(['community-1']);
    expect(state.nextCursor).toBe('cursor-2');
    expect(state.loadingMore).toBe(true);
  });

  it('despacha lifecycle de início e falha para a mesma consulta viewer-scoped', () => {
    const service = TestBed.inject(CommunityDiscoveryCacheService);
    vi.mocked(store.dispatch).mockClear();

    service.beginLoad(context, true);
    service.failLoad(context, true);

    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: '[Community Discovery Cache] Begin Load',
        query,
        append: true,
      })
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: '[Community Discovery Cache] Fail Load',
        query,
        append: true,
      })
    );
  });
});
