// src/app/messaging/direct-chat/services/direct-thread.service.spec.ts
import { BehaviorSubject, firstValueFrom, of, Subject, throwError } from 'rxjs';

const functionsMocks = {
  httpsCallable: vi.fn(),
};

type MockFn = ReturnType<typeof vi.fn>;

describe('DirectThreadService', () => {
  let service: any;
  let DirectThreadServiceToken: any;

  let canListenRealtime$: BehaviorSubject<boolean>;
  let authUid$: BehaviorSubject<string | null>;
  let sendCallableMock: MockFn;
  let deleteCallableMock: MockFn;

  let chatServiceMock: {
    monitorChat: MockFn;
    deleteMessage: MockFn;
  };

  let applicationErrorMock: {
    report: MockFn;
  };

  let errorNotifierMock: {
    showWarning: MockFn;
    showError: MockFn;
  };

  let privacyDebugMock: {
    log: MockFn;
  };

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('@angular/fire/functions', () => ({
      Functions: class Functions {},
      httpsCallable: functionsMocks.httpsCallable,
    }));

    const serviceModule = await import('./direct-thread.service');
    DirectThreadServiceToken = serviceModule.DirectThreadService;
  });

  afterAll(() => {
    vi.doUnmock('@angular/fire/functions');
    vi.resetModules();
  });

  beforeEach(() => {
    canListenRealtime$ = new BehaviorSubject<boolean>(true);
    authUid$ = new BehaviorSubject<string | null>('user-a');
    sendCallableMock = vi.fn();
    deleteCallableMock = vi.fn();

    chatServiceMock = {
      monitorChat: vi.fn(),
      deleteMessage: vi.fn(),
    };

    applicationErrorMock = {
      report: vi.fn(),
    };

    errorNotifierMock = {
      showWarning: vi.fn(),
      showError: vi.fn(),
    };

    privacyDebugMock = {
      log: vi.fn(),
    };

    functionsMocks.httpsCallable.mockReset();
    functionsMocks.httpsCallable.mockImplementation((_functions: any, name: string) =>
      name === 'sendDirectMessage' ? sendCallableMock : deleteCallableMock
    );

    service = new DirectThreadServiceToken(
      {},
      chatServiceMock,
      {
        canListenRealtime$: canListenRealtime$.asObservable(),
        authUid$: authUid$.asObservable(),
      },
      applicationErrorMock,
      errorNotifierMock,
      privacyDebugMock
    );
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
    expect(functionsMocks.httpsCallable).toHaveBeenCalledWith({}, 'sendDirectMessage');
    expect(functionsMocks.httpsCallable).toHaveBeenCalledWith({}, 'deleteDirectMessage');
  });

  it('observeMessages$ deve retornar [] quando chatId vier vazio', async () => {
    const result = await firstValueFrom(service.observeMessages$('   '));

    expect(result).toEqual([]);
    expect(chatServiceMock.monitorChat).not.toHaveBeenCalled();
    expect(applicationErrorMock.report).not.toHaveBeenCalled();
  });

  it('observeMessages$ deve retornar [] quando realtime estiver bloqueado', async () => {
    canListenRealtime$.next(false);

    const result = await firstValueFrom(service.observeMessages$('chat-1'));

    expect(result).toEqual([]);
    expect(chatServiceMock.monitorChat).not.toHaveBeenCalled();
    expect(applicationErrorMock.report).not.toHaveBeenCalled();
  });

  it('observeMessages$ deve delegar para ChatService quando realtime estiver liberado', async () => {
    const messages = [
      {
        id: 'msg-1',
        chatId: 'chat-1',
        content: 'conteudo de teste',
      },
    ];

    chatServiceMock.monitorChat.mockReturnValueOnce(of(messages));

    const result = await firstValueFrom(service.observeMessages$('chat-1'));

    expect(chatServiceMock.monitorChat).toHaveBeenCalledWith('chat-1');
    expect(result).toEqual(messages);
    expect(applicationErrorMock.report).not.toHaveBeenCalled();

    expect(privacyDebugMock.log).toHaveBeenCalledWith(
      'chat',
      'DirectThreadService: observeMessages$',
      {
        chatId: 'chat-1',
        count: 1,
      }
    );
  });

  it('observeMessages$ não deve rediagnosticar erro já pertencente ao ChatService', async () => {
    chatServiceMock.monitorChat.mockReturnValueOnce(
      throwError(() => new Error('firestore down'))
    );

    const result = await firstValueFrom(service.observeMessages$('chat-1'));

    expect(result).toEqual([]);
    expect(applicationErrorMock.report).not.toHaveBeenCalled();
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
  });

  it('observeMessages$ diagnostica silenciosamente falha originada no gate', async () => {
    const error = new Error('gate failed');
    canListenRealtime$.error(error);

    const result = await firstValueFrom(service.observeMessages$('chat-1'));

    expect(result).toEqual([]);
    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'direct-thread',
      operation: 'DirectThreadService.observeMessages$',
      fallbackMessage:
        'Não foi possível concluir uma operação interna da conversa direta.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'DirectThreadService',
        context: 'DirectThreadService.observeMessages$',
        chatId: 'chat-1',
      },
    });
  });

  it('observeMessages$ encerra listener de A antes de ativar B', () => {
    const oldMessages = new Subject<any[]>();
    const newMessages = new Subject<any[]>();
    chatServiceMock.monitorChat
      .mockReturnValueOnce(oldMessages.asObservable())
      .mockReturnValueOnce(newMessages.asObservable());

    const emitted: any[][] = [];
    const sub = service.observeMessages$('chat-1').subscribe(
      (messages: any[]) => emitted.push(messages)
    );
    expect(chatServiceMock.monitorChat).toHaveBeenCalledTimes(1);

    authUid$.next(null);
    expect(emitted.at(-1)).toEqual([]);
    authUid$.next('user-b');
    expect(chatServiceMock.monitorChat).toHaveBeenCalledTimes(2);

    oldMessages.next([{ id: 'old-message' }]);
    expect(emitted.some(items => items.some(x => x.id === 'old-message'))).toBe(false);

    newMessages.next([{ id: 'new-message' }]);
    expect(emitted.at(-1)).toEqual([{ id: 'new-message' }]);
    sub.unsubscribe();
  });

  it('descarta falha tardia da callable após troca de conta sem snackbar', async () => {
    let rejectPending!: (reason: unknown) => void;
    sendCallableMock.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectPending = reject;
    }));
    const values: unknown[] = [];
    const errors: unknown[] = [];
    const subscription = service.sendMessage$('chat-1', 'olá', 'req-1')
      .subscribe({ next: (value: unknown) => values.push(value), error: (error: unknown) => errors.push(error) });

    expect(sendCallableMock).toHaveBeenCalledTimes(1);
    authUid$.next('user-b');
    rejectPending(new Error('old session failure'));
    await Promise.resolve();
    await Promise.resolve();

    expect(values).toEqual([]);
    expect(errors).toEqual([]);
    expect(applicationErrorMock.report).not.toHaveBeenCalled();
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('não despacha callable quando não há sessão ou permissão', async () => {
    authUid$.next(null);
    expect(await firstValueFrom(service.sendMessage$('chat-1', 'olá', 'req-1'))).toBeNull();
    authUid$.next('user-a');
    canListenRealtime$.next(false);
    expect(await firstValueFrom(service.sendMessage$('chat-1', 'olá', 'req-2'))).toBeNull();
    expect(sendCallableMock).not.toHaveBeenCalled();
  });

  it('sendMessage$ deve retornar null quando chatId vier vazio', async () => {
    const result = await firstValueFrom(
      service.sendMessage$('   ', 'olá', 'req-1')
    );

    expect(result).toBeNull();
    expect(sendCallableMock).not.toHaveBeenCalled();
  });

  it('sendMessage$ deve retornar null quando conteúdo vier vazio', async () => {
    const result = await firstValueFrom(
      service.sendMessage$('chat-1', '   ', 'req-1')
    );

    expect(result).toBeNull();
    expect(sendCallableMock).not.toHaveBeenCalled();
  });

  it('sendMessage$ deve bloquear mensagem acima de 1000 caracteres como validação local', async () => {
    const content = 'a'.repeat(1001);

    const result = await firstValueFrom(
      service.sendMessage$('chat-1', content, 'req-1')
    );

    expect(result).toBeNull();
    expect(sendCallableMock).not.toHaveBeenCalled();
    expect(applicationErrorMock.report).not.toHaveBeenCalled();
    expect(errorNotifierMock.showWarning).toHaveBeenCalledWith(
      'A mensagem deve ter no máximo 1000 caracteres.'
    );
  });

  it('sendMessage$ deve bloquear clientRequestId vazio como validação local', async () => {
    const result = await firstValueFrom(
      service.sendMessage$('chat-1', 'olá', '   ')
    );

    expect(result).toBeNull();
    expect(sendCallableMock).not.toHaveBeenCalled();
    expect(applicationErrorMock.report).not.toHaveBeenCalled();
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível preparar o envio da mensagem.'
    );
  });

  it('sendMessage$ deve chamar callable e retornar messageId no sucesso', async () => {
    sendCallableMock.mockResolvedValueOnce({
      data: {
        chatId: 'chat-1',
        messageId: 'msg-1',
        deduplicated: false,
      },
    });

    const result = await firstValueFrom(
      service.sendMessage$(' chat-1 ', ' olá ', ' req-1 ')
    );

    expect(sendCallableMock).toHaveBeenCalledWith({
      chatId: 'chat-1',
      content: 'olá',
      clientRequestId: 'req-1',
    });
    expect(result).toBe('msg-1');
    expect(applicationErrorMock.report).not.toHaveBeenCalled();

    expect(privacyDebugMock.log).toHaveBeenCalledWith(
      'chat',
      'DirectThreadService: sendMessage$ callable ok',
      {
        chatId: 'chat-1',
        messageId: 'msg-1',
        deduplicated: false,
      }
    );
  });

  it('sendMessage$ centraliza falha do callable em um único diagnóstico e snackbar', async () => {
    const error = {
      code: 'functions/permission-denied',
      message: 'denied',
    };
    sendCallableMock.mockRejectedValueOnce(error);

    await expect(
      firstValueFrom(service.sendMessage$('chat-1', 'olá', 'req-1'))
    ).rejects.toEqual(error);
    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'direct-thread',
      operation: 'DirectThreadService.sendMessage$',
      fallbackMessage:
        'Esta conversa não está disponível para mensagens.',
      codeMessages: {
        unauthenticated:
          'Esta conversa não está disponível para mensagens.',
        'invalid-argument':
          'Esta conversa não está disponível para mensagens.',
        'failed-precondition':
          'Esta conversa não está disponível para mensagens.',
        'permission-denied':
          'Esta conversa não está disponível para mensagens.',
      },
      presentation: { surface: 'snackbar', severity: 'error' },
      metadata: {
        scope: 'DirectThreadService',
        context: 'DirectThreadService.sendMessage$',
        chatId: 'chat-1',
      },
    });
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
  });

  it('sendMessage$ usa mensagem genérica quando callable responder sem messageId', async () => {
    sendCallableMock.mockResolvedValueOnce({
      data: {
        chatId: 'chat-1',
        messageId: '',
        deduplicated: false,
      },
    });

    await expect(
      firstValueFrom(service.sendMessage$('chat-1', 'olá', 'req-1'))
    ).rejects.toEqual(expect.any(Error));

    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        feature: 'direct-thread',
        operation: 'DirectThreadService.sendMessage$',
        fallbackMessage: 'Não foi possível enviar a mensagem.',
        presentation: { surface: 'snackbar', severity: 'error' },
      })
    );
  });

  it('sendMessage$ preserva feedback se a camada canônica falhar', async () => {
    const error = {
      code: 'functions/unauthenticated',
      message: 'session expired',
    };
    sendCallableMock.mockRejectedValueOnce(error);
    applicationErrorMock.report.mockImplementationOnce(() => {
      throw new Error('application error unavailable');
    });

    await expect(
      firstValueFrom(service.sendMessage$('chat-1', 'olá', 'req-1'))
    ).rejects.toEqual(error);

    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(errorNotifierMock.showError).toHaveBeenCalledTimes(1);
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Entre novamente para enviar mensagens.'
    );
  });

  it('deleteMessage$ não chama callable sem UID autenticado', async () => {
    authUid$.next(null);
    await firstValueFrom(service.deleteMessage$('chat-1', 'msg-1'));
    expect(deleteCallableMock).not.toHaveBeenCalled();
  });

  it('deleteMessage$ descarta falha tardia após troca de UID', async () => {
    let rejectPending!: (reason: unknown) => void;
    deleteCallableMock.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectPending = reject;
    }));
    const values: void[] = [];
    const sub = service.deleteMessage$('chat-1', 'msg-1').subscribe(
      (value: void) => values.push(value)
    );
    expect(deleteCallableMock).toHaveBeenCalledTimes(1);
    authUid$.next('user-b');
    rejectPending(new Error('old session failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(values).toEqual([]);
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
    expect(applicationErrorMock.report).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('deleteMessage$ ignora IDs inválidos', async () => {
    await firstValueFrom(service.deleteMessage$(' ', 'msg-1'));
    await firstValueFrom(service.deleteMessage$('chat-1', ' '));
    expect(deleteCallableMock).not.toHaveBeenCalled();
  });

  it('deleteMessage$ não despacha sem realtime liberado', async () => {
    canListenRealtime$.next(false);
    await firstValueFrom(service.deleteMessage$('chat-1', 'msg-1'));
    expect(deleteCallableMock).not.toHaveBeenCalled();
  });

  it('deleteMessage$ usa callable com IDs válidos', async () => {
    deleteCallableMock.mockResolvedValueOnce({
      data: { chatId: 'chat-1', messageId: 'msg-1', deleted: true },
    });
    await firstValueFrom(service.deleteMessage$('chat-1', 'msg-1'));
    expect(deleteCallableMock).toHaveBeenCalledWith({
      chatId: 'chat-1', messageId: 'msg-1',
    });
    expect(privacyDebugMock.log).toHaveBeenCalledWith(
      'chat', 'DirectThreadService: deleteMessage$',
      { chatId: 'chat-1', messageId: 'msg-1' }
    );
  });

  it('deleteMessage$ apresenta erro da callable', async () => {
    deleteCallableMock.mockRejectedValueOnce(new Error('delete failed'));
    await firstValueFrom(service.deleteMessage$('chat-1', 'msg-1'));
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível excluir a mensagem.'
    );
  });

  it('deleteMessage$ diagnostica silenciosamente falha originada no gate', async () => {
    const error = new Error('gate failed');
    canListenRealtime$.error(error);

    await firstValueFrom(service.deleteMessage$('chat-1', 'msg-1'));

    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'direct-thread',
      operation: 'DirectThreadService.deleteMessage$',
      fallbackMessage:
        'Não foi possível concluir uma operação interna da conversa direta.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'DirectThreadService',
        context: 'DirectThreadService.deleteMessage$',
        chatId: 'chat-1',
        messageId: 'msg-1',
      },
    });
  });
});
