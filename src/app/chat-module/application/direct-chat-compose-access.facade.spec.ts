import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';
import { DirectChatComposeAccessFacade } from './direct-chat-compose-access.facade';

describe('DirectChatComposeAccessFacade', () => {
  function setup(input?: {
    canListen?: boolean;
    canSendDirect?: boolean;
    friends?: Array<{ friendUid: string }>;
  }) {
    const accessControl = {
      canListenRealtime$: of(input?.canListen ?? true),
    } as unknown as AccessControlService;

    const watchFriends = vi.fn(() =>
      of((input?.friends ?? [{ friendUid: 'peer-1' }]) as any)
    );
    const friendship = {
      watchFriends,
    } as unknown as FriendshipService;

    const directThread = {
      canSend$: of(input?.canSendDirect ?? true),
    } as unknown as DirectThreadFacade;

    const report = vi.fn();
    const applicationError = {
      report,
    } as unknown as ApplicationErrorService;

    return {
      watchFriends,
      report,
      facade: new DirectChatComposeAccessFacade(
        accessControl,
        friendship,
        directThread,
        applicationError
      ),
    };
  }

  it('libera o composer apenas com sessão, conversa direta e conexão aceita', () => {
    const { facade } = setup();
    const values: unknown[] = [];

    facade
      .observe$(
        of('me'),
        of('peer-1'),
        of('chat'),
        of('chat-1')
      )
      .subscribe((value) => values.push(value));

    expect(values).toEqual([
      {
        canCompose: true,
        canSendDirect: true,
        hasAcceptedConnection: true,
        canSendCurrentMessage: true,
        statusMessage: 'Conversa direta liberada para envio.',
      },
    ]);
  });

  it('bloqueia quando não existe conexão aceita', () => {
    const { facade } = setup({ friends: [] });
    const values: any[] = [];

    facade
      .observe$(
        of('me'),
        of('peer-1'),
        of('chat'),
        of('chat-1')
      )
      .subscribe((value) => values.push(value));

    expect(values[0]?.canSendCurrentMessage).toBe(false);
    expect(values[0]?.statusMessage).toBe(
      'Vocês precisam estar conectados para trocar mensagens.'
    );
  });

  it('não consulta amizades sem peer resolvido', () => {
    const { facade, watchFriends } = setup();
    const values: any[] = [];

    facade
      .observe$(
        of('me'),
        of(null),
        of('chat'),
        of('chat-1')
      )
      .subscribe((value) => values.push(value));

    expect(watchFriends).not.toHaveBeenCalled();
    expect(values[0]?.hasAcceptedConnection).toBe(false);
  });

  it('mantém falha de amizade silenciosa e conservadora', () => {
    const accessControl = {
      canListenRealtime$: of(true),
    } as unknown as AccessControlService;

    const friendship = {
      watchFriends: vi.fn(() => {
        throw new Error('transport');
      }),
    } as unknown as FriendshipService;

    const directThread = {
      canSend$: of(true),
    } as unknown as DirectThreadFacade;

    const report = vi.fn();
    const facade = new DirectChatComposeAccessFacade(
      accessControl,
      friendship,
      directThread,
      { report } as unknown as ApplicationErrorService
    );

    expect(() => {
      facade
        .observe$(of('me'), of('peer-1'), of('chat'), of('chat-1'))
        .subscribe();
    }).toThrow('transport');

    expect(report).not.toHaveBeenCalled();
  });
});
