import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import * as CommunityDiscoveryCacheActions from 'src/app/store/actions/actions.discovery/community-discovery-cache.actions';
import { CommunityDomainEventsService } from '../data-access/community-domain-events.service';
import { CommunityDiscoveryCacheService } from './community-discovery-cache.service';

describe('CommunityDiscoveryCacheService', () => {
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
});
