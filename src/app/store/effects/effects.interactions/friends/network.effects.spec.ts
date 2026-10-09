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
  let actions: Subject<ReturnType<typeof A.loadFriends> | ReturnType<typeof A.loadBlockedUsers> | ReturnType<typeof A.blockUser> | ReturnType<typeof A.unblockUser> | ReturnType<typeof A.endFriendship>>;
  let uid: BehaviorSubject<string | null>;
  let pendingFriends: Subject<unknown[]>;
  let pendingBlocked: Subject<unknown[]>;
  let effects: FriendsNetworkEffects;
  let pendingMutation: Subject<void>;
  let notifier: { showSuccess: ReturnType<typeof vi.fn>; showError: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    actions = new Subject();
    uid = new BehaviorSubject<string | null>('user-a');
    pendingFriends = new Subject();
    pendingBlocked = new Subject();
    pendingMutation = new Subject<void>();
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
        { provide: ErrorNotificationService, useValue: notifier },
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
  it.each([
    ['blockUser$', () => A.blockUser({ ownerUid: 'user-a', targetUid: 'other', reason: 'test' })],
    ['unblockUser$', () => A.unblockUser({ ownerUid: 'user-a', targetUid: 'other' })],
    ['endFriendship$', () => A.endFriendship({ ownerUid: 'user-a', friendUid: 'other' })],
  ] as const)('descarta retorno tardio de %s depois da troca de conta', (effectName, createAction) => {
    const output: unknown[] = [];
    const sub = effects[effectName].subscribe(action => output.push(action));
    actions.next(createAction());
    uid.next('user-b');
    pendingMutation.next();
    pendingMutation.complete();
    expect(output).toEqual([]);
    expect(notifier.showSuccess).not.toHaveBeenCalled();
    expect(notifier.showError).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

});
