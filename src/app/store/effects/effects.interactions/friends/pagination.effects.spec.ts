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
  let watch: ReturnType<typeof vi.fn>;
  let effects: FriendsPaginationEffects;
  beforeEach(() => {
    actions = new Subject<Action>();
    session = new BehaviorSubject<User | null>(user('owner'));
    pending = new Subject<typeof page>();
    list = vi.fn(() => pending.asObservable());
    watch = vi.fn(() => pending.asObservable());
    TestBed.configureTestingModule({ providers: [
      FriendsPaginationEffects,
      { provide: Actions, useValue: new Actions(actions) },
      { provide: AuthSessionService, useValue: { authUser$: session.asObservable() } },
      { provide: FriendshipService, useValue: { listFriendsPage: list, watchFriendsPage: watch } },
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
    if (effect === 'loadFirstOrRefresh$') {
      expect(watch).toHaveBeenCalledWith('owner', 24);
      expect(list).not.toHaveBeenCalled();
    } else {
      expect(list).toHaveBeenCalledWith('owner', 24, expectedCursor);
      expect(watch).not.toHaveBeenCalled();
    }
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
    expect(watch).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
  it('mantém primeira página viva, emite substituições e libera no reset da rota', () => {
    const results: unknown[] = [];
    const sub = effects.loadFirstOrRefresh$.subscribe(value => results.push(value));
    actions.next(P.loadFriendsFirstPage({ uid: 'owner' }));
    pending.next(page);
    const accepted = { ...page, items: [{ friendUid: 'new-peer' }] as Friend[] };
    pending.next(accepted);
    expect(results).toEqual([page, accepted].map(snapshot => P.loadFriendsPageSuccess({
      uid: 'owner', items: snapshot.items, nextOrderValue: cursor, reachedEnd: true, append: false,
    })));
    expect(watch).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
    actions.next(P.resetFriendsPagination({ uid: 'owner' }));
    pending.next(page);
    expect(results).toHaveLength(2);
    sub.unsubscribe();
  });
  it('cancela append antigo após snapshot canônico substituir a primeira página', () => {
    const results: unknown[] = [];
    const sub = effects.loadNext$.subscribe(value => results.push(value));
    actions.next(P.loadFriendsNextPage({ uid: 'owner' }));
    actions.next(P.loadFriendsPageSuccess({ uid: 'other', items: [], nextOrderValue: null, reachedEnd: true, append: false }));
    actions.next(P.loadFriendsPageSuccess({ uid: 'owner', items: page.items, nextOrderValue: cursor, reachedEnd: false, append: false }));
    pending.next(page);
    expect(results).toEqual([]);
    sub.unsubscribe();
  });
  it('cancela append pendente após confirmação local do encerramento', () => {
    const results: unknown[] = [];
    const sub = effects.loadNext$.subscribe(value => results.push(value));
    actions.next(P.loadFriendsNextPage({ uid: 'owner' }));
    actions.next(P.removeFriendFromFriendsPage({ uid: 'other', friendUid: 'peer' }));
    actions.next(P.removeFriendFromFriendsPage({ uid: 'owner', friendUid: 'peer' }));
    pending.next(page);
    expect(results).toEqual([]);
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
  it('marca falha da primeira página para descartar projeção anterior', () => {
    const results: unknown[] = [];
    const sub = effects.loadFirstOrRefresh$.subscribe(value => results.push(value));
    actions.next(P.loadFriendsFirstPage({ uid: 'owner' }));
    pending.error(new Error('read failed'));
    expect(results).toEqual([P.loadFriendsPageFailure({ uid: 'owner', error: 'read failed', replace: true })]);
    sub.unsubscribe();
  });
});
