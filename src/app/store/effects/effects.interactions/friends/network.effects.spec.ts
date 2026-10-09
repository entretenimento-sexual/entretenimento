import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { BehaviorSubject, Subject } from 'rxjs';
import { vi } from 'vitest';

import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import * as A from '../../../actions/actions.interactions/actions.friends';
import { FriendsNetworkEffects } from './network.effects';

describe('FriendsNetworkEffects / isolamento entre UIDs', () => {
  let actions: Subject<ReturnType<typeof A.loadFriends> | ReturnType<typeof A.loadBlockedUsers>>;
  let uid: BehaviorSubject<string | null>;
  let pendingFriends: Subject<unknown[]>;
  let pendingBlocked: Subject<unknown[]>;
  let effects: FriendsNetworkEffects;

  beforeEach(() => {
    actions = new Subject();
    uid = new BehaviorSubject<string | null>('user-a');
    pendingFriends = new Subject();
    pendingBlocked = new Subject();
    TestBed.configureTestingModule({
      providers: [
        FriendsNetworkEffects,
        { provide: Actions, useValue: new Actions(actions) },
        { provide: FriendshipService, useValue: {
          listFriends: vi.fn(() => pendingFriends.asObservable()),
          listBlocked: vi.fn(() => pendingBlocked.asObservable()),
        } },
        { provide: AccessControlService, useValue: {
          authUid$: uid.asObservable(),
          canEnterCore$: new BehaviorSubject(true),
          canUseAdultSocial$: new BehaviorSubject(true),
        } },
        { provide: ErrorNotificationService, useValue: {} },
        { provide: PrivacyDebugLoggerService, useValue: { log: vi.fn() } },
      ],
    });
    effects = TestBed.inject(FriendsNetworkEffects);
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
});
