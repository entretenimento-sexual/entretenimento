import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { BehaviorSubject, Subject } from 'rxjs';
import { vi } from 'vitest';

import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { DiscoveryPublicProfilesRepository } from 'src/app/dashboard/discovery/data-access/discovery-public-profiles.repository';
import * as D from '../../actions/actions.discovery/discovery-feed.actions';
import { DiscoveryFeedEffects } from './discovery-feed.effects';

describe('DiscoveryFeedEffects / isolamento por viewerUid', () => {
  const request = { viewerUid: 'user-a', mode: 'all' as const, pageSize: 24 };

  it('cancela retorno de primeira página após mudança de conta', () => {
    const actions = new Subject<ReturnType<typeof D.loadDiscoveryFirstPage>>();
    const uid = new BehaviorSubject<string | null>('user-a');
    const response = new Subject<any>();
    const repository = { loadPage$: vi.fn(() => response.asObservable()) };
    TestBed.configureTestingModule({
      providers: [
        DiscoveryFeedEffects,
        { provide: Actions, useValue: new Actions(actions) },
        { provide: Store, useValue: { select: vi.fn() } },
        { provide: DiscoveryPublicProfilesRepository, useValue: repository },
        { provide: AccessControlService, useValue: { authUid$: uid.asObservable() } },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });
    const effects = TestBed.inject(DiscoveryFeedEffects);
    const output: unknown[] = [];
    const sub = effects.loadFirstOrRefresh$.subscribe(value => output.push(value));

    actions.next(D.loadDiscoveryFirstPage({ request }));
    expect(repository.loadPage$).toHaveBeenCalledTimes(1);
    uid.next('user-b');
    response.next({ items: [], nextCursor: null, reachedEnd: true, source: 'server', fetchedAt: 1 });
    expect(output).toEqual([]);

    actions.next(D.loadDiscoveryFirstPage({ request }));
    expect(repository.loadPage$).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it('rejeita paginação iniciada por outra identidade', () => {
    const actions = new Subject<ReturnType<typeof D.loadDiscoveryNextPage>>();
    const uid = new BehaviorSubject<string | null>('user-b');
    const repository = { loadPage$: vi.fn() };
    const slice = {
      loadingInitial: false, loadingMore: false, refreshing: false,
      reachedEnd: false, nextCursor: { uid: 'cursor', updatedAtMs: 1 },
    };
    TestBed.configureTestingModule({
      providers: [
        DiscoveryFeedEffects,
        { provide: Actions, useValue: new Actions(actions) },
        { provide: Store, useValue: { select: vi.fn(() => new BehaviorSubject(slice)) } },
        { provide: DiscoveryPublicProfilesRepository, useValue: repository },
        { provide: AccessControlService, useValue: { authUid$: uid.asObservable() } },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });
    const effects = TestBed.inject(DiscoveryFeedEffects);
    const sub = effects.loadNext$.subscribe();
    actions.next(D.loadDiscoveryNextPage({ request }));
    expect(repository.loadPage$).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
});
