import { TestBed } from '@angular/core/testing';
import { Actions, getEffectsMetadata } from '@ngrx/effects';
import { Action } from '@ngrx/store';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import * as A from '../../../actions/actions.interactions/actions.friends';
import { FriendsRequestsCrudEffects } from './requests-crud.effects';

describe('FriendsRequestsCrudEffects / aceite reativo', () => {
  it('aceita sem effect redundante de recarga de amigos ou solicitações', () => {
    const actions = new Subject<Action>();
    const accept = vi.fn(() => of(undefined));
    const listFriends = vi.fn();
    TestBed.configureTestingModule({ providers: [
      FriendsRequestsCrudEffects,
      { provide: Actions, useValue: new Actions(actions) },
      { provide: FriendshipService, useValue: { acceptRequest: accept, listFriends } },
      { provide: ErrorNotificationService, useValue: {} },
    ] });
    const effects = TestBed.inject(FriendsRequestsCrudEffects);
    const output: Action[] = [];
    const sub = effects.acceptRequest$.subscribe(action => output.push(action));
    try {
      actions.next(A.acceptFriendRequest({ requestId: 'req', requesterUid: 'sender', targetUid: 'receiver' }));
      expect(accept).toHaveBeenCalledWith('req', 'sender', 'receiver');
      expect(output).toEqual([A.acceptFriendRequestSuccess({ requestId: 'req' })]);
      expect(listFriends).not.toHaveBeenCalled();
      expect(Object.keys(getEffectsMetadata(effects))).not.toContain('syncAfterRequestMutation$');
    } finally { sub.unsubscribe(); }
  });
});
