// src/app/store/reducers/reducers.chat/invite.reducer.spec.ts
import { describe, expect, it } from 'vitest';

import { InviteInboxItem } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import * as InviteActions from '../../actions/actions.chat/invite.actions';
import { initialInviteState } from '../../states/states.chat/invite.state';
import { inviteReducer } from './invite.reducer';

function buildInvite(
  id: string,
  receiverId: string,
  overrides: Partial<InviteInboxItem> = {}
): InviteInboxItem {
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
    ...overrides,
  };
}

describe('inviteReducer session ownership', () => {
  it('limpa imediatamente a conta A ao iniciar a carga da conta B', () => {
    const stateA = inviteReducer(
      inviteReducer(
        initialInviteState,
        InviteActions.LoadInvites({ userId: 'user-a' })
      ),
      InviteActions.LoadInvitesSuccess({
        ownerUid: 'user-a',
        invites: [buildInvite('invite-a', 'user-a')],
      })
    );

    const stateBLoading = inviteReducer(
      stateA,
      InviteActions.LoadInvites({ userId: ' user-b ' })
    );

    expect(stateBLoading.ownerUid).toBe('user-b');
    expect(stateBLoading.invites).toEqual([]);
    expect(stateBLoading.loading).toBe(true);
    expect(stateBLoading.loaded).toBe(false);
  });

  it('ignora snapshot tardio cujo owner não corresponde ao estado', () => {
    const loadingB = inviteReducer(
      initialInviteState,
      InviteActions.LoadInvites({ userId: 'user-b' })
    );

    const lateA = inviteReducer(
      loadingB,
      InviteActions.LoadInvitesSuccess({
        ownerUid: 'user-a',
        invites: [buildInvite('invite-a', 'user-a')],
      })
    );

    expect(lateA).toBe(loadingB);
    expect(lateA.invites).toEqual([]);
  });

  it('armazena apenas o snapshot do owner ativo', () => {
    const loadingB = inviteReducer(
      initialInviteState,
      InviteActions.LoadInvites({ userId: 'user-b' })
    );
    const inviteB = buildInvite('invite-b', 'user-b');

    const loadedB = inviteReducer(
      loadingB,
      InviteActions.LoadInvitesSuccess({
        ownerUid: 'user-b',
        invites: [inviteB],
      })
    );

    expect(loadedB.ownerUid).toBe('user-b');
    expect(loadedB.invites).toEqual([inviteB]);
    expect(loadedB.loading).toBe(false);
    expect(loadedB.loaded).toBe(true);
  });

  it('remove o convite respondido somente para o owner atual', () => {
    const loadedB = inviteReducer(
      inviteReducer(
        initialInviteState,
        InviteActions.LoadInvites({ userId: 'user-b' })
      ),
      InviteActions.LoadInvitesSuccess({
        ownerUid: 'user-b',
        invites: [
          buildInvite('invite-1', 'user-b'),
          buildInvite('invite-2', 'user-b'),
        ],
      })
    );

    const ignoredA = inviteReducer(
      loadedB,
      InviteActions.AcceptInviteSuccess({
        ownerUid: 'user-a',
        inviteId: 'invite-1',
      })
    );
    const acceptedB = inviteReducer(
      ignoredA,
      InviteActions.AcceptInviteSuccess({
        ownerUid: 'user-b',
        inviteId: 'invite-1',
      })
    );

    expect(ignoredA).toBe(loadedB);
    expect(acceptedB.invites.map((invite) => invite.id)).toEqual(['invite-2']);
  });

  it('mantém actions e state serializáveis em round-trip JSON', () => {
    const action = InviteActions.LoadInvitesSuccess({
      ownerUid: 'user-a',
      invites: [buildInvite('invite-a', 'user-a')],
    });
    const state = inviteReducer(
      inviteReducer(
        initialInviteState,
        InviteActions.LoadInvites({ userId: 'user-a' })
      ),
      action
    );

    expect(JSON.parse(JSON.stringify(action))).toEqual(action);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
