// src/app/store/effects/effects.chat/invite.effects.spec.ts
import { Actions } from '@ngrx/effects';
import { Action } from '@ngrx/store';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { InviteInboxItem } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { InviteInboxService } from 'src/app/core/services/batepapo/invite-service/invite-inbox.service';
import { RoomInviteFlowService } from 'src/app/core/services/batepapo/room-services/room-invite-flow.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import * as InviteActions from '../../actions/actions.chat/invite.actions';
import { authSessionChanged } from '../../actions/actions.user/auth.actions';
import { InviteEffects } from './invite.effects';

function buildInvite(id: string, receiverId: string): InviteInboxItem {
  return {
    id,
    type: 'room',
    targetId: `room-${id}`,
    targetName: `Sala ${id}`,
    senderId: `sender-${id}`,
    receiverId,
    status: 'pending',
    sentAtMs: 1000,
    expiresAtMs: 2000,
    roomId: `room-${id}`,
    roomName: `Sala ${id}`,
  };
}

describe('InviteEffects room session isolation', () => {
  it('cancela A, ignora emissão tardia e publica somente B', () => {
    const actionSubject = new Subject<Action>();
    const userAInvites = new Subject<InviteInboxItem[]>();
    const userBInvites = new Subject<InviteInboxItem[]>();
    const uidSubject = new BehaviorSubject<string | null>('user-a');

    const inbox = {
      observeMyPendingRoomInvites: vi.fn(
        (uid: string): Observable<InviteInboxItem[]> =>
          uid === 'user-a' ? userAInvites : userBInvites
      ),
      clearAllCache: vi.fn(),
    } as unknown as InviteInboxService;

    const roomInviteFlow = {
      acceptRoomInvite$: () => of(void 0),
      declineRoomInvite$: () => of(void 0),
    } as unknown as RoomInviteFlowService;

    const notifier = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
    } as unknown as ErrorNotificationService;

    const authSession = {
      uid$: uidSubject.asObservable(),
    } as unknown as AuthSessionService;

    const effects = new InviteEffects(
      new Actions(actionSubject),
      inbox,
      roomInviteFlow,
      authSession,
      notifier
    );

    const emitted: Action[] = [];
    const subscription = effects.loadInvites$.subscribe((action) => {
      emitted.push(action);
    });

    actionSubject.next(InviteActions.LoadInvites({ userId: 'user-a' }));
    userAInvites.next([buildInvite('invite-a', 'user-a')]);

    uidSubject.next('user-b');
    actionSubject.next(
      authSessionChanged({ uid: 'user-b', emailVerified: true })
    );
    actionSubject.next(InviteActions.LoadInvites({ userId: 'user-b' }));

    userAInvites.next([buildInvite('late-a', 'user-a')]);
    userBInvites.next([buildInvite('invite-b', 'user-b')]);

    expect(emitted).toEqual([
      InviteActions.LoadInvitesSuccess({
        ownerUid: 'user-a',
        invites: [buildInvite('invite-a', 'user-a')],
      }),
      InviteActions.LoadInvitesSuccess({
        ownerUid: 'user-b',
        invites: [buildInvite('invite-b', 'user-b')],
      }),
    ]);

    subscription.unsubscribe();
  });

  it('não publica sucesso de resposta depois que a sessão troca', () => {
    const actionSubject = new Subject<Action>();
    const uidSubject = new BehaviorSubject<string | null>('user-a');
    const acceptResult = new Subject<void>();

    const inbox = {
      observeMyPendingRoomInvites: () => of([]),
      clearAllCache: vi.fn(),
    } as unknown as InviteInboxService;

    const roomInviteFlow = {
      acceptRoomInvite$: vi.fn(() => acceptResult.asObservable()),
      declineRoomInvite$: () => of(void 0),
    } as unknown as RoomInviteFlowService;

    const notifier = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
    } as unknown as ErrorNotificationService;

    const authSession = {
      uid$: uidSubject.asObservable(),
    } as unknown as AuthSessionService;

    const effects = new InviteEffects(
      new Actions(actionSubject),
      inbox,
      roomInviteFlow,
      authSession,
      notifier
    );

    const emitted: Action[] = [];
    const subscription = effects.acceptInvite$.subscribe((action) => {
      emitted.push(action);
    });

    actionSubject.next(
      InviteActions.AcceptInvite({
        ownerUid: 'user-a',
        inviteId: 'room:room-1:to:user-a',
      })
    );

    uidSubject.next('user-b');
    acceptResult.next();
    acceptResult.complete();

    expect(emitted).toEqual([]);
    expect(notifier.showSuccess).not.toHaveBeenCalled();

    subscription.unsubscribe();
  });
});
