import { BehaviorSubject, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DirectThreadFacade } from './direct-thread.facade';

describe('DirectThreadFacade', () => {
  function setup(input?: {
    selectedChatId?: string | null;
    canOpen$?: any;
    canSend$?: any;
    sendResult$?: any;
  }) {
    const directChatFacade = {
      selectedChatId$: of(
        input?.selectedChatId === undefined ? 'chat-1' : input.selectedChatId
      ),
      selectedChatCanOpen$: input?.canOpen$ ?? of(true),
    } as any;

    const directThreadService = {
      observeMessages$: vi.fn(() => of([])),
      sendMessage$: vi.fn(() => input?.sendResult$ ?? of('msg-1')),
      deleteMessage$: vi.fn(() => of(void 0)),
    } as any;

    const directReceiptsService = {
      markDeliveredAsRead$: vi.fn(() => of(0)),
    } as any;

    const authSession = {
      uid$: of('me'),
    } as any;

    const accessControl = {
      canListenRealtime$: input?.canSend$ ?? of(true),
    } as any;

    const applicationError = {
      report: vi.fn(),
    } as any;

    const privacyDebug = {
      log: vi.fn(),
    } as any;

    const facade = new DirectThreadFacade(
      directChatFacade,
      directThreadService,
      directReceiptsService,
      authSession,
      accessControl,
      applicationError,
      privacyDebug
    );

    return {
      facade,
      directThreadService,
      applicationError,
    };
  }

  it('não associa mensagens da thread anterior ao novo chat ou à nova sessão', () => {
    const selectedChatId$ = new BehaviorSubject<string | null>('chat-1');
    const uid$ = new BehaviorSubject<string | null>('user-a');
    const canListenRealtime$ = new BehaviorSubject(true);
    const chatOne$ = new Subject<any[]>();
    const chatTwo$ = new Subject<any[]>();
    const observeMessages$ = vi.fn((chatId: string) =>
      chatId === 'chat-1' ? chatOne$ : chatTwo$
    );
    const facade = new DirectThreadFacade(
      { selectedChatId$, selectedChatCanOpen$: of(true) } as any,
      { observeMessages$ } as any,
      { markDeliveredAsRead$: vi.fn() } as any,
      { uid$ } as any,
      { canListenRealtime$ } as any,
      { report: vi.fn() } as any,
      { log: vi.fn() } as any,
    );
    const states: Array<{ chatId: string | null; messages: any[] }> = [];
    const subscription = facade.state$.subscribe((state) => states.push(state));

    chatOne$.next([{ id: 'from-a' }]);
    expect(states.at(-1)).toMatchObject({ chatId: 'chat-1', messages: [{ id: 'from-a' }] });

    selectedChatId$.next('chat-2');
    expect(states.at(-1)).toMatchObject({ chatId: 'chat-2', messages: [] });
    chatOne$.next([{ id: 'stale-from-a' }]);
    expect(states.at(-1)?.messages).toEqual([]);

    chatTwo$.next([{ id: 'from-b' }]);
    expect(states.at(-1)).toMatchObject({ chatId: 'chat-2', messages: [{ id: 'from-b' }] });
    uid$.next(null);
    expect(states.at(-1)).toMatchObject({ chatId: null, messages: [] });
    chatTwo$.next([{ id: 'stale-after-logout' }]);
    expect(states.at(-1)?.messages).toEqual([]);

    uid$.next('user-b');
    expect(states.at(-1)).toMatchObject({ chatId: 'chat-2', messages: [] });
    canListenRealtime$.next(false);
    expect(states.at(-1)).toMatchObject({ chatId: null, messages: [] });
    subscription.unsubscribe();
  });

  it('descarta respostas tardias de envio, exclusão e leitura após troca de sessão', () => {
    const selectedChatId$ = new BehaviorSubject<string | null>('chat-1');
    const uid$ = new BehaviorSubject<string | null>('user-a');
    const canListenRealtime$ = new BehaviorSubject(true);
    const send$ = new Subject<string>();
    const delete$ = new Subject<void>();
    const receipts$ = new Subject<number>();
    const sendNext = vi.fn();
    const deleteNext = vi.fn();
    const receiptNext = vi.fn();
    const facade = new DirectThreadFacade(
      { selectedChatId$, selectedChatCanOpen$: of(true) } as any,
      {
        observeMessages$: vi.fn(() => of([])),
        sendMessage$: vi.fn(() => send$),
        deleteMessage$: vi.fn(() => delete$),
      } as any,
      { markDeliveredAsRead$: vi.fn(() => receipts$) } as any,
      { uid$ } as any,
      { canListenRealtime$ } as any,
      { report: vi.fn() } as any,
      { log: vi.fn() } as any,
    );
    facade.sendMessage$('oi').subscribe(sendNext);
    facade.deleteMessage$('message-1').subscribe(deleteNext);
    facade.markVisibleMessagesAsRead$([{ id: 'message-1' }] as any).subscribe(receiptNext);
    uid$.next('user-b');
    send$.next('old-result');
    delete$.next();
    receipts$.next(1);
    expect(sendNext).not.toHaveBeenCalled();
    expect(deleteNext).not.toHaveBeenCalled();
    expect(receiptNext).not.toHaveBeenCalled();
  });

  it('cancela comando pendente quando a conversa muda', () => {
    const selectedChatId$ = new BehaviorSubject<string | null>('chat-1');
    const result$ = new Subject<string>();
    const observer = vi.fn();
    const facade = new DirectThreadFacade(
      { selectedChatId$, selectedChatCanOpen$: of(true) } as any,
      { sendMessage$: vi.fn(() => result$) } as any,
      {} as any,
      { uid$: of('me') } as any,
      { canListenRealtime$: of(true) } as any,
      { report: vi.fn() } as any,
      { log: vi.fn() } as any,
    );
    facade.sendMessage$('oi').subscribe(observer);
    selectedChatId$.next('chat-2');
    result$.next('stale');
    expect(observer).not.toHaveBeenCalled();
  });

  it('envia mensagem pela conversa ativa quando o envio está liberado', async () => {
    const { facade, directThreadService, applicationError } = setup();

    await expect(
      firstValueFrom(facade.sendMessage$('  oi  '))
    ).resolves.toBe('msg-1');

    expect(directThreadService.sendMessage$).toHaveBeenCalledWith(
      'chat-1',
      'oi'
    );
    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('propaga falha do service sem converter para null', async () => {
    const error = new Error('send failed');
    const { facade } = setup({
      sendResult$: throwError(() => error),
    });

    await expect(
      firstValueFrom(facade.sendMessage$('oi'))
    ).rejects.toBe(error);
  });

  it('retorna null sem chamar service quando não há chat ativo', async () => {
    const { facade, directThreadService } = setup({
      selectedChatId: null,
    });

    await expect(
      firstValueFrom(facade.sendMessage$('oi'))
    ).resolves.toBeNull();

    expect(directThreadService.sendMessage$).not.toHaveBeenCalled();
  });

  it('diagnostica silenciosamente falha reativa pelo ApplicationErrorService', async () => {
    const error = new Error('can open failed');
    const { facade, applicationError } = setup({
      canOpen$: throwError(() => error),
    });

    await expect(firstValueFrom(facade.canOpen$)).resolves.toBe(false);

    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'direct-thread',
      operation: 'DirectThreadFacade.canOpen$',
      fallbackMessage:
        'Não foi possível concluir uma operação interna da conversa direta.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'DirectThreadFacade',
        context: 'DirectThreadFacade.canOpen$',
      },
    });
  });
});
