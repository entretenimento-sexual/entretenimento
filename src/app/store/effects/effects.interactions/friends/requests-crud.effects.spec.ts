import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { BehaviorSubject, Subject } from 'rxjs';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import * as A from '../../../actions/actions.interactions/actions.friends';
import { FriendsRequestsCrudEffects } from './requests-crud.effects';

describe('FriendsRequestsCrudEffects / atualização direcional', () => {
  it('mantém contingência apenas na direção afetada e atualiza amigos no aceite', () => {
    const actions = new Subject<ReturnType<typeof A.sendFriendRequestSuccess> | ReturnType<typeof A.cancelFriendRequestSuccess> | ReturnType<typeof A.acceptFriendRequestSuccess> | ReturnType<typeof A.declineFriendRequestSuccess>>();
    const uid = new BehaviorSubject<string | null>('user-a');
    TestBed.configureTestingModule({
      providers: [
        FriendsRequestsCrudEffects,
        { provide: Actions, useValue: new Actions(actions) },
        { provide: Store, useValue: { select: () => uid.asObservable() } },
        { provide: FriendshipService, useValue: {} },
        { provide: ErrorNotificationService, useValue: {} },
      ],
    });
    const effects = TestBed.inject(FriendsRequestsCrudEffects);
    const output: unknown[] = [];
    const sub = effects.syncAfterRequestMutation$.subscribe(action => output.push(action));
    try {
      actions.next(A.sendFriendRequestSuccess());
      actions.next(A.cancelFriendRequestSuccess({ requestId: 'req' }));
      actions.next(A.declineFriendRequestSuccess({ requestId: 'req' }));
      actions.next(A.acceptFriendRequestSuccess({ requestId: 'req' }));
      expect(output).toEqual([
        A.loadOutboundRequests({ uid: 'user-a', source: 'post-mutation' }),
        A.loadOutboundRequests({ uid: 'user-a', source: 'post-mutation' }),
        A.loadInboundRequests({ uid: 'user-a', source: 'post-mutation' }),
        A.loadInboundRequests({ uid: 'user-a', source: 'post-mutation' }),
        A.loadFriends({ uid: 'user-a' }),
      ]);
      uid.next(null);
      actions.next(A.sendFriendRequestSuccess());
      expect(output).toHaveLength(5);
    } finally { sub.unsubscribe(); }
  });
});
