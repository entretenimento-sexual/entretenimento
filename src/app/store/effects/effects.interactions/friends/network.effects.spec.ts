import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { vi } from 'vitest';

import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import type { User } from 'firebase/auth';
import type { FriendshipVersion } from 'src/app/core/interfaces/friendship/friend.interface';
import * as P from '../../../actions/actions.interactions/friends/friends-pagination.actions';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import * as A from '../../../actions/actions.interactions/actions.friends';
import { FriendsNetworkEffects } from './network.effects';
import * as RT from '../../../actions/actions.interactions/friends/friends-realtime.actions';

describe('FriendsNetworkEffects / isolamento entre UIDs', () => {
  let actions: Subject<ReturnType<typeof A.loadFriends> | ReturnType<typeof A.loadBlockedUsers> | ReturnType<typeof A.blockUser> | ReturnType<typeof A.unblockUser> | ReturnType<typeof A.endFriendship>>;
  let uid: BehaviorSubject<string | null>;
  let pendingFriends: Subject<unknown[]>;
  let pendingBlocked: Subject<unknown[]>;
  let effects: FriendsNetworkEffects;
  let pendingMutation: Subject<FriendshipVersion | null>;
  let session: BehaviorSubject<User | null>;
  let notifier: { showSuccess: ReturnType<typeof vi.fn>; showError: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    actions = new Subject();
    uid = new BehaviorSubject<string | null>('user-a');
    pendingFriends = new Subject();
    pendingBlocked = new Subject();
    pendingMutation = new Subject<FriendshipVersion | null>();
    session = new BehaviorSubject<User | null>({ uid: 'user-a' } as User);
    notifier = { showSuccess: vi.fn(), showError: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        FriendsNetworkEffects,
        { provide: Actions, useValue: new Actions(actions) },
        { provide: FriendshipService, useValue: {
          listFriends: vi.fn(() => pendingFriends.asObservable()),
          listBlocked: vi.fn(() => pendingBlocked.asObservable()),
          blockUser: vi.fn(() => pendingMutation.asObservable()),
          unblockUser: vi.fn(() => pendingMutation.asObservable()),
          endFriendship: vi.fn(() => pendingMutation.asObservable()),
        } },
        { provide: AccessControlService, useValue: {
          authUid$: uid.asObservable(),
          canEnterCore$: new BehaviorSubject(true),
          canUseAdultSocial$: new BehaviorSubject(true),
        } },
        { provide: AuthSessionService, useValue: { authUser$: session.asObservable() } },
        { provide: ErrorNotificationService, useValue: notifier },
        { provide: PrivacyDebugLoggerService, useValue: { log: vi.fn() } },
      ],
    });
    effects = TestBed.inject(FriendsNetworkEffects);
  });

  it('inicializa amigos e solicitações apenas pelos listeners, preservando bloqueados', () => {
    const output: unknown[] = [];
    const sub = effects.bootstrapOnEligibleUser$.subscribe(action => output.push(action));
    expect(output).toEqual([
      A.loadBlockedUsers({ uid: 'user-a' }),
      RT.startFriendsListener({ uid: 'user-a' }),
      RT.startInboundRequestsListener({ uid: 'user-a' }),
      RT.startOutboundRequestsListener({ uid: 'user-a' }),
    ]);
    output.length = 0;
    uid.next(null);
    expect(output).toEqual([
      RT.stopFriendsListener(),
      RT.stopInboundRequestsListener(),
      RT.stopOutboundRequestsListener(),
      A.loadFriendsSuccess({ friends: [] }),
      A.loadInboundRequestsSuccess({ requests: [] }),
      A.loadOutboundRequestsSuccess({ requests: [] }),
      A.loadBlockedUsersSuccess({ blocked: [] }),
    ]);
    output.length = 0;
    uid.next('user-b');
    expect(output).toEqual([
      A.loadBlockedUsers({ uid: 'user-b' }),
      RT.startFriendsListener({ uid: 'user-b' }),
      RT.startInboundRequestsListener({ uid: 'user-b' }),
      RT.startOutboundRequestsListener({ uid: 'user-b' }),
    ]);
    expect(TestBed.inject(FriendshipService).listFriends).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('mantém a leitura pontual explícita fora do bootstrap', () => {
    const output: unknown[] = [];
    const sub = effects.loadFriends$.subscribe(action => output.push(action));
    actions.next(A.loadFriends({ uid: 'user-a' }));
    expect(TestBed.inject(FriendshipService).listFriends).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(FriendshipService).listFriends).toHaveBeenCalledWith('user-a');
    pendingFriends.next([]);
    expect(output).toEqual([A.loadFriendsSuccess({ friends: [] })]);
    sub.unsubscribe();
  });

  it('encerra sem loadFriends e transporta a fronteira canônica para os dois estados', () => {
    const output: unknown[] = [];
    const sub = effects.endFriendship$.subscribe(action => output.push(action));
    const endedThrough = { seconds: 10, nanoseconds: 123456000 };
    actions.next(A.endFriendship({ ownerUid: 'user-a', friendUid: 'peer' }));
    pendingMutation.next(endedThrough);
    expect(output).toEqual([
      A.endFriendshipSuccess({ ownerUid: 'user-a', friendUid: 'peer', endedThrough }),
      P.removeFriendFromFriendsPage({ uid: 'user-a', friendUid: 'peer', endedThrough }),
    ]);
    expect(notifier.showSuccess).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(FriendshipService).listFriends).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('cancela encerramento e leitura pontual na substituição da sessão com mesmo UID', () => {
    const output: unknown[] = [];
    const one = effects.endFriendship$.subscribe(action => output.push(action));
    const two = effects.loadFriends$.subscribe(action => output.push(action));
    actions.next(A.endFriendship({ ownerUid: 'user-a', friendUid: 'peer' }));
    actions.next(A.loadFriends({ uid: 'user-a' }));
    session.next({ uid: 'user-a' } as User);
    pendingMutation.next({ seconds: 10, nanoseconds: 0 });
    pendingFriends.next([{ friendUid: 'old' }]);
    expect(output).toEqual([]);
    expect(notifier.showSuccess).not.toHaveBeenCalled();
    one.unsubscribe(); two.unsubscribe();
  });

  it('cancela resultado de lista de amigos A ao trocar para B', () => {
    const output: unknown[] = [];
    const sub = effects.loadFriends$.subscribe(action => output.push(action));
    actions.next(A.loadFriends({ uid: 'user-a' }));
    uid.next('user-b');
    pendingFriends.next([{ uid: 'friend-a' }]);
    expect(output).toEqual([]);
    sub.unsubscribe();
  });

  it('ignora action de amigos da sessão anterior', () => {
    const output: unknown[] = [];
    const sub = effects.loadFriends$.subscribe(action => output.push(action));
    uid.next('user-b');
    actions.next(A.loadFriends({ uid: 'user-a' }));
    pendingFriends.next([{ uid: 'friend-a' }]);
    expect(output).toEqual([]);
    sub.unsubscribe();
  });

  it('cancela resultado de bloqueados A ao trocar para B', () => {
    const output: unknown[] = [];
    const sub = effects.loadBlocked$.subscribe(action => output.push(action));
    actions.next(A.loadBlockedUsers({ uid: 'user-a' }));
    uid.next('user-b');
    pendingBlocked.next([{ uid: 'blocked-a' }]);
    expect(output).toEqual([]);
    sub.unsubscribe();
  });
  it.each([
    ['blockUser$', () => A.blockUser({ ownerUid: 'user-a', targetUid: 'other', reason: 'test' })],
    ['unblockUser$', () => A.unblockUser({ ownerUid: 'user-a', targetUid: 'other' })],
    ['endFriendship$', () => A.endFriendship({ ownerUid: 'user-a', friendUid: 'other' })],
  ] as const)('descarta retorno tardio de %s depois da troca de conta', (effectName, createAction) => {
    const output: unknown[] = [];
    const sub = (effects[effectName] as Observable<unknown>).subscribe((action: unknown) => output.push(action));
    actions.next(createAction());
    uid.next('user-b');
    pendingMutation.next(null);
    pendingMutation.complete();
    expect(output).toEqual([]);
    expect(notifier.showSuccess).not.toHaveBeenCalled();
    expect(notifier.showError).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

});
