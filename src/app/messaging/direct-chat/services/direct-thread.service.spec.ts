// src/app/messaging/direct-chat/services/direct-thread.service.spec.ts
import { vi } from 'vitest';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';

const { functionsMocks } = vi.hoisted(() => {
  vi.resetModules();

  return {
    functionsMocks: {
      httpsCallable: vi.fn(),
    },
  };
});

vi.mock('@angular/fire/functions', () => ({
  Functions: class Functions {},
  httpsCallable: functionsMocks.httpsCallable,
}));

import { DirectThreadService } from './direct-thread.service';

type MockFn = ReturnType<typeof vi.fn>;

describe('DirectThreadService', () => {
  let service: DirectThreadService;

  let canListenRealtime$: BehaviorSubject<boolean>;
  let sendCallableMock: MockFn;

  let chatServiceMock: {
    monitorChat: MockFn;
    deleteMessage: MockFn;
  };

  let globalErrorHandlerMock: {
    handleError: MockFn;
  };

  let errorNotifierMock: {
    showWarning: MockFn;
    showError: MockFn;
  };

  let privacyDebugMock: {
    log: MockFn;
  };

  beforeEach(() => {
    canListenRealtime$ = new BehaviorSubject<boolean>(true);
    sendCallableMock = vi.fn();

    chatServiceMock = {
      monitorChat: vi.fn(),
      deleteMessage: vi.fn(),
    };

    globalErrorHandlerMock = {
      handleError: vi.fn(),
    };

    errorNotifierMock = {
      showWarning: vi.fn(),
      showError: vi.fn(),
    };

    privacyDebugMock = {
      log: vi.fn(),
    };

    functionsMocks.httpsCallable.mockReset();
    functionsMocks.httpsCallable.mockReturnValue(sendCallableMock as any);

    service = new DirectThreadService(
      {} as any,
      chatServiceMock as any,
      {
        canListenRealtime$: canListenRealtime$.asObservable(),
      } as any,
      globalErrorHandlerMock as any,
      errorNotifierMock as any,
      privacyDebugMock as any
    );
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();

    expect(functionsMocks.httpsCallable).toHaveBeenCalledWith(
      {},
      'sendDirectMessage'
    );
  });

  it('observeMessages$ deve retornar [] quando chatId vier vazio', async () => {
    const result = await firstValueFrom(service.observeMessages$('   '));

    expect(result).toEqual([]);
    expect(chatServiceMock.monitorChat).not.toHaveBeenCalled();
  });

  it('observeMessages$ deve retornar [] quando realtime estiver bloqueado', async () => {
    canListenRealtime$.next(false);

    const result = await firstValueFrom(service.observeMessages$('chat-1'));

    expect(result).toEqual([]);
    expect(chatServiceMock.monitorChat).not.toHaveBeenCalled();
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

    expect(privacyDebugMock.log).toHaveBeenCalledWith(
      'chat',
      'DirectThreadService: observeMessages$',
      {
        chatId: 'chat-1',
        count: 1,
      }
    );
  });

  it('observeMessages$ deve retornar [] e tratar erro silenciosamente', async () => {
    chatServiceMock.monitorChat.mockReturnValueOnce(
      throwError(() => new Error('firestore down'))
    );

    const result = await firstValueFrom(service.observeMessages$('chat-1'));

    expect(result).toEqual([]);
    expect(globalErrorHandlerMock.handleError).toHaveBeenCalledTimes(1);
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
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

  it('sendMessage$ deve bloquear mensagem acima de 1000 caracteres', async () => {
    const content = 'a'.repeat(1001);

    const result = await firstValueFrom(
      service.sendMessage$('chat-1', content, 'req-1')
    );

    expect(result).toBeNull();
    expect(sendCallableMock).not.toHaveBeenCalled();
    expect(errorNotifierMock.showWarning).toHaveBeenCalledWith(
      'A mensagem deve ter no máximo 1000 caracteres.'
    );
  });

  it('sendMessage$ deve bloquear clientRequestId vazio', async () => {
    const result = await firstValueFrom(
      service.sendMessage$('chat-1', 'olá', '   ')
    );

    expect(result).toBeNull();
    expect(sendCallableMock).not.toHaveBeenCalled();
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

  it('sendMessage$ deve retornar null, notificar e registrar erro quando callable falhar', async () => {
    sendCallableMock.mockRejectedValueOnce({
      code: 'permission-denied',
      message: 'denied',
    });

    const result = await firstValueFrom(
      service.sendMessage$('chat-1', 'olá', 'req-1')
    );

    expect(result).toBeNull();
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Esta conversa não está disponível para mensagens.'
    );
    expect(globalErrorHandlerMock.handleError).toHaveBeenCalledTimes(1);
  });

  it('sendMessage$ deve retornar null quando callable responder sem messageId', async () => {
    sendCallableMock.mockResolvedValueOnce({
      data: {
        chatId: 'chat-1',
        messageId: '',
        deduplicated: false,
      },
    });

    const result = await firstValueFrom(
      service.sendMessage$('chat-1', 'olá', 'req-1')
    );

    expect(result).toBeNull();
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível enviar a mensagem.'
    );
    expect(globalErrorHandlerMock.handleError).toHaveBeenCalledTimes(1);
  });

  it('deleteMessage$ deve ignorar ids inválidos', async () => {
    await firstValueFrom(service.deleteMessage$(' ', 'msg-1'));
    await firstValueFrom(service.deleteMessage$('chat-1', ' '));

    expect(chatServiceMock.deleteMessage).not.toHaveBeenCalled();
  });

  it('deleteMessage$ deve ignorar exclusão quando realtime estiver bloqueado', async () => {
    canListenRealtime$.next(false);

    await firstValueFrom(service.deleteMessage$('chat-1', 'msg-1'));

    expect(chatServiceMock.deleteMessage).not.toHaveBeenCalled();
  });

  it('deleteMessage$ deve chamar adapter quando ids forem válidos e gate estiver liberado', async () => {
    chatServiceMock.deleteMessage.mockReturnValueOnce(of(void 0));

    await firstValueFrom(service.deleteMessage$('chat-1', 'msg-1'));

    expect(chatServiceMock.deleteMessage).toHaveBeenCalledWith(
      'chat-1',
      'msg-1'
    );

    expect(privacyDebugMock.log).toHaveBeenCalledWith(
      'chat',
      'DirectThreadService: deleteMessage$',
      {
        chatId: 'chat-1',
        messageId: 'msg-1',
      }
    );
  });

  it('deleteMessage$ deve notificar e tratar erro quando adapter falhar', async () => {
    chatServiceMock.deleteMessage.mockReturnValueOnce(
      throwError(() => new Error('delete failed'))
    );

    await firstValueFrom(service.deleteMessage$('chat-1', 'msg-1'));

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível excluir a mensagem.'
    );
    expect(globalErrorHandlerMock.handleError).toHaveBeenCalledTimes(1);
  });
});