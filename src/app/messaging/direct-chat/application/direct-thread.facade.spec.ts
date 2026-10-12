import { BehaviorSubject, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DirectThreadFacade } from './direct-thread.facade';
import { DirectChatFacade } from './direct-chat.facade';

describe('DirectChatFacade → DirectThreadFacade access lifecycle', () => {
  it('revoga histórico e comandos no bloqueio e só reabre após novo snapshot autorizado', () => {
    const uid$ = new BehaviorSubject<string | null>('user-a');
    const chats$ = new BehaviorSubject<any[]>([
      { id: 'chat-1', participants: ['user-a', 'peer-b'], isRoom: false },
    ]);
    // Simula a projeção bilateral observada no Firestore.
    const availability$ = new BehaviorSubject(false);
    const observeAccess = vi.fn(() => availability$.asObservable());
    const chatFacade = new DirectChatFacade(
      { getMyDirectChats$: () => chats$.asObservable() } as any,
      { uid$: uid$.asObservable() } as any,
      { getUsersPublicMap$: () => of({}) } as any,
      { report: vi.fn() } as any,
      { destroyed: false, onDestroy: () => () => undefined } as any,
      { observe$: observeAccess } as any
    );
    const messages$ = new Subject<any[]>();
    const sendMessage$ = vi.fn(() => of('new-message'));
    const observeMessages$ = vi.fn(() => messages$.asObservable());
    const threadFacade = new DirectThreadFacade(
      chatFacade,
      { observeMessages$, sendMessage$ } as any,
      { markDeliveredAsRead$: vi.fn(() => of(0)) } as any,
      { uid$: uid$.asObservable() } as any,
      { canListenRealtime$: of(true) } as any,
      { report: vi.fn() } as any,
      { log: vi.fn() } as any
    );
    const states: any[] = [];
    const canSend: boolean[] = [];
    const stateSub = threadFacade.state$.subscribe(state => states.push(state));
    const canSendSub = threadFacade.canSend$.subscribe(allowed => canSend.push(allowed));

    chatFacade.selectChat('chat-1');
    expect(states.at(-1)?.messages).toEqual([]);
    expect(canSend.at(-1)).toBe(false);
    expect(observeMessages$).not.toHaveBeenCalled();

    availability$.next(true);
    expect(canSend.at(-1)).toBe(true);
    expect(observeMessages$).toHaveBeenCalledTimes(1);
    messages$.next([{ id: 'private-before-block' }]);
    expect(states.at(-1)?.messages).toEqual([{ id: 'private-before-block' }]);

    // Bloqueio remoto atualiza o espelho de acesso e cancela o listener.
    availability$.next(false);
    expect(canSend.at(-1)).toBe(false);
    expect(states.at(-1)).toMatchObject({ chatId: null, messages: [] });
    expect(messages$.observers.length).toBe(0);
    const denied: Array<string | null> = [];
    threadFacade.sendMessage$('blocked').subscribe(result => denied.push(result));
    expect(denied).toEqual([null]);
    expect(sendMessage$).not.toHaveBeenCalled();

    messages$.next([{ id: 'stale-after-block' }]);
    expect(states.at(-1)?.messages).toEqual([]);

    // Desbloqueio sem confirmação no snapshot não reabre nada.
    expect(canSend.at(-1)).toBe(false);
    availability$.next(true);
    expect(states.at(-1)).toMatchObject({ chatId: 'chat-1', messages: [] });
    expect(observeMessages$).toHaveBeenCalledTimes(2);
    expect(canSend.at(-1)).toBe(true);

    uid$.next(null);
    expect(states.at(-1)).toMatchObject({ chatId: null, messages: [] });
    expect(messages$.observers.length).toBe(0);
    stateSub.unsubscribe();
    canSendSub.unsubscribe();
  });
});

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

  it('não rediagnostica falha realtime já registrada pelo ChatService', async () => {
    const { facade, directThreadService, applicationError } = setup();
    const error = Object.assign(new Error('transport failed'), {
      chatApplicationErrorReported: true,
    });
    directThreadService.observeMessages$.mockReturnValue(throwError(() => error));

    const state = await firstValueFrom(facade.state$);
    expect(state.messages).toEqual([]);
    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it.each([
    ['permission-denied', 'Você não tem mais acesso a esta conversa.'],
    ['unauthenticated', 'Entre novamente para acessar esta conversa.'],
    ['unavailable', 'Não foi possível carregar as mensagens. Verifique sua conexão.'],
  ])('distingue erro realtime %s de conversa vazia', async (code, message) => {
    const { facade, directThreadService } = setup();
    directThreadService.observeMessages$.mockReturnValue(
      throwError(() => Object.assign(new Error('failed'), { code }))
    );
    const states: any[] = [];
    const sub = facade.state$.subscribe((state) => states.push(state));
    expect(states.at(-1)).toMatchObject({
      chatId: 'chat-1', messages: [], errorMessage: message, loaded: false,
    });
    sub.unsubscribe();
  });

  it('diagnostica falha nova do listener uma única vez', async () => {
    const { facade, directThreadService, applicationError } = setup();
    const error = new Error('unexpected gate error');
    directThreadService.observeMessages$.mockReturnValue(throwError(() => error));

    const state = await firstValueFrom(facade.state$);
    expect(state.messages).toEqual([]);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });

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

  it('revogação de acesso esvazia histórico, cancela listener e bloqueia envio até reautorização', () => {
    const selectedChatId$ = new BehaviorSubject<string | null>('chat-1');
    const canOpen$ = new BehaviorSubject(true);
    const messages$ = new Subject<any[]>();
    const sendMessage$ = vi.fn(() => of('message-new'));
    const observeMessages$ = vi.fn(() => messages$);
    const facade = new DirectThreadFacade(
      { selectedChatId$, selectedChatCanOpen$: canOpen$ } as any,
      { observeMessages$, sendMessage$ } as any,
      { markDeliveredAsRead$: vi.fn(() => of(0)) } as any,
      { uid$: of('user-a') } as any,
      { canListenRealtime$: of(true) } as any,
      { report: vi.fn() } as any,
      { log: vi.fn() } as any,
    );
    const states: Array<{ chatId: string | null; messages: any[] }> = [];
    const subscription = facade.state$.subscribe(state => states.push(state));
    const canSend: boolean[] = [];
    const sending = facade.canSend$.subscribe(value => canSend.push(value));

    messages$.next([{ id: 'private-before-block' }]);
    expect(states.at(-1)?.messages).toEqual([{ id: 'private-before-block' }]);

    canOpen$.next(false);
    expect(states.at(-1)).toMatchObject({ chatId: null, messages: [] });
    expect(messages$.observers.length).toBe(0);
    expect(canSend.at(-1)).toBe(false);

    messages$.next([{ id: 'stale-during-block' }]);
    expect(states.at(-1)?.messages).toEqual([]);

    canOpen$.next(true);
    expect(states.at(-1)).toMatchObject({ chatId: 'chat-1', messages: [] });
    expect(messages$.observers.length).toBe(1);
    expect(canSend.at(-1)).toBe(true);
    expect(observeMessages$).toHaveBeenCalledTimes(2);

    subscription.unsubscribe();
    sending.unsubscribe();
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
