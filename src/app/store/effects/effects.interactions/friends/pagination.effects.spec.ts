import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import type { User } from 'firebase/auth';
import { vi } from 'vitest';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import type { Friend, FriendsPageCursor } from 'src/app/core/interfaces/friendship/friend.interface';
import * as P from '../../../actions/actions.interactions/friends/friends-pagination.actions';
import { selectFriendsPageNextOrder, selectFriendsPageReachedEnd } from '../../../selectors/selectors.interactions/friends/pagination.selectors';
import { FriendsPaginationEffects } from './pagination.effects';

describe('FriendsPaginationEffects / sessão operacional', () => {
  const cursor: FriendsPageCursor = { seconds: 1, nanoseconds: 123456000, documentId: 'peer-24' };
  const user = (uid: string) => ({ uid } as User);
  const page = { items: [{ friendUid: 'peer-25' }] as Friend[], nextAfter: cursor, reachedEnd: true };
  let actions: Subject<Action>;
  let session: BehaviorSubject<User | null>;
  let pending: Subject<typeof page>;
  let list: ReturnType<typeof vi.fn>;
  let effects: FriendsPaginationEffects;
  beforeEach(() => {
    actions = new Subject<Action>();
    session = new BehaviorSubject<User | null>(user('owner'));
    pending = new Subject<typeof page>();
    list = vi.fn(() => pending.asObservable());
    TestBed.configureTestingModule({ providers: [
      FriendsPaginationEffects,
      { provide: Actions, useValue: new Actions(actions) },
      { provide: AuthSessionService, useValue: { authUser$: session.asObservable() } },
      { provide: FriendshipService, useValue: { listFriendsPage: list } },
      { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      provideMockStore({ selectors: [
        { selector: selectFriendsPageNextOrder('owner'), value: cursor },
        { selector: selectFriendsPageReachedEnd('owner'), value: false },
      ] }),
    ] });
    effects = TestBed.inject(FriendsPaginationEffects);
  });
  it.each([
    ['loadFirstOrRefresh$', P.loadFriendsFirstPage({ uid: 'owner' }), null],
    ['loadNext$', P.loadFriendsNextPage({ uid: 'owner' }), cursor],
  ] as const)('cancela %s na substituição da sessão com mesmo UID', (effect, action, expectedCursor) => {
    const results: unknown[] = [];
    const sub = (effects[effect] as Observable<unknown>).subscribe(value => results.push(value));
    actions.next(action);
    expect(list).toHaveBeenCalledWith('owner', 24, expectedCursor);
    session.next(user('owner'));
    pending.next(page);
    expect(results).toEqual([]);
    actions.next(action);
    pending.next(page);
    expect(results).toEqual([P.loadFriendsPageSuccess({
      uid: 'owner', items: page.items, nextOrderValue: cursor, reachedEnd: true, append: effect === 'loadNext$',
    })]);
    sub.unsubscribe();
  });
  it('não inicia leitura para UID antigo depois do logout ou troca', () => {
    const sub = effects.loadFirstOrRefresh$.subscribe();
    session.next(null);
    actions.next(P.loadFriendsFirstPage({ uid: 'owner' }));
    session.next(user('other'));
    actions.next(P.refreshFriendsPage({ uid: 'owner' }));
    expect(list).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
  it('cancela append pendente ao atualizar a primeira página', () => {
    const results: unknown[] = [];
    const sub = effects.loadNext$.subscribe(value => results.push(value));
    actions.next(P.loadFriendsNextPage({ uid: 'owner' }));
    actions.next(P.refreshFriendsPage({ uid: 'owner' }));
    pending.next(page);
    expect(results).toEqual([]);
    sub.unsubscribe();
  });
});
