import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';
import { DirectChatComposeAccessFacade, DirectChatComposeAccessState } from './direct-chat-compose-access.facade';

const access = { owner: 'me', epoch: 1, peer: 'peer-1', chatId: 'chat-1', readable: true, available: true };

describe('DirectChatComposeAccessFacade', () => {
  function setup() {
    const owner$ = new BehaviorSubject<string | null>('me');
    const peer$ = new BehaviorSubject<string | null>('peer-1');
    const type$ = new BehaviorSubject<'chat' | null>('chat');
    const chat$ = new BehaviorSubject<string | null>('chat-1');
    const gate$ = new BehaviorSubject(true);
    const thread$ = new BehaviorSubject(true);
    const access$ = new BehaviorSubject<typeof access | null>(access);
    const report = vi.fn();
    const facade = new DirectChatComposeAccessFacade(
      { canListenRealtime$: gate$ } as unknown as AccessControlService,
      { selectedChatAccess$: access$ } as unknown as DirectChatFacade,
      { canSend$: thread$ } as unknown as DirectThreadFacade,
      { report } as unknown as ApplicationErrorService
    );
    const values: DirectChatComposeAccessState[] = [];
    const sub = facade.observe$(owner$, peer$, type$, chat$).subscribe(value => values.push(value));
    return { owner$, peer$, type$, chat$, gate$, thread$, access$, report, sub,
      latest: () => values.at(-1)! };
  }

  it('libera somente com contexto canônico confirmado e autorização de envio', () => {
    const s = setup();
    expect(s.latest()).toEqual({
      canCompose: true, canSendDirect: true, hasAcceptedConnection: true,
      canSendCurrentMessage: true, statusMessage: 'Conversa direta liberada para envio.',
    });
    s.sub.unsubscribe();
  });

  it('revoga e restaura reativamente sem atribuir toda restrição à falta de amizade', () => {
    const s = setup();
    s.access$.next({ ...access, available: false });
    expect(s.latest().canSendCurrentMessage).toBe(false);
    expect(s.latest().statusMessage).toBe('Esta conversa direta não está disponível para envio agora.');
    s.access$.next(access);
    expect(s.latest().canSendCurrentMessage).toBe(true);
    s.gate$.next(false);
    expect(s.latest().canSendCurrentMessage).toBe(false);
    s.gate$.next(true);
    s.thread$.next(false);
    expect(s.latest().canSendCurrentMessage).toBe(false);
    s.thread$.next(true);
    expect(s.latest().canSendCurrentMessage).toBe(true);
    s.access$.next(null);
    expect(s.latest().canSendCurrentMessage).toBe(false);
    s.sub.unsubscribe();
  });

  it('rejeita autorização antiga na troca de chat, peer ou conta', () => {
    const s = setup();
    s.chat$.next('chat-2');
    expect(s.latest().canSendCurrentMessage).toBe(false);
    s.peer$.next('peer-2');
    expect(s.latest().canSendCurrentMessage).toBe(false);
    s.access$.next({ ...access, chatId: 'chat-2', peer: 'peer-2' });
    expect(s.latest().canSendCurrentMessage).toBe(true);
    s.owner$.next('other');
    expect(s.latest().canSendCurrentMessage).toBe(false);
    s.access$.next({ ...access, owner: 'other', chatId: 'chat-2', peer: 'peer-2', readable: false });
    expect(s.latest().canSendCurrentMessage).toBe(false);
    s.owner$.next(null);
    expect(s.latest().canSendCurrentMessage).toBe(false);
    s.sub.unsubscribe();
  });

  it('não libera sem peer confirmado', () => {
    const s = setup();
    s.peer$.next(null);
    expect(s.latest().hasAcceptedConnection).toBe(false);
    expect(s.latest().canSendCurrentMessage).toBe(false);
    s.sub.unsubscribe();
  });

  it('mantém falha da projeção silenciosa e conservadora', () => {
    const report = vi.fn();
    const facade = new DirectChatComposeAccessFacade(
      { canListenRealtime$: of(true) } as unknown as AccessControlService,
      { selectedChatAccess$: throwError(() => new Error('transport')) } as unknown as DirectChatFacade,
      { canSend$: of(true) } as unknown as DirectThreadFacade,
      { report } as unknown as ApplicationErrorService
    );
    const values: DirectChatComposeAccessState[] = [];
    facade.observe$(of('me'), of('peer-1'), of('chat'), of('chat-1')).subscribe(value => values.push(value));
    expect(report).toHaveBeenCalledTimes(1);
    expect(values[0]?.canSendCurrentMessage).toBe(false);
    expect(values[0]?.hasAcceptedConnection).toBe(false);
  });
});
