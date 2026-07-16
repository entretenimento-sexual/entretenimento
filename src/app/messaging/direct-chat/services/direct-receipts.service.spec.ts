// src/app/messaging/direct-chat/services/direct-receipts.service.spec.ts
import { firstValueFrom, of, throwError } from 'rxjs';

import { DirectReceiptsService } from './direct-receipts.service';

type MockFn = ReturnType<typeof vi.fn>;

describe('DirectReceiptsService', () => {
  let service: DirectReceiptsService;

  let messagesRepositoryMock: {
    advanceMessageReceipts$: MockFn;
  };

  let globalErrorHandlerMock: {
    handleError: MockFn;
  };

  let privacyDebugMock: {
    log: MockFn;
  };

  beforeEach(() => {
    messagesRepositoryMock = {
      advanceMessageReceipts$: vi.fn(),
    };

    globalErrorHandlerMock = {
      handleError: vi.fn(),
    };

    privacyDebugMock = {
      log: vi.fn(),
    };

    service = new DirectReceiptsService(
      messagesRepositoryMock as any,
      globalErrorHandlerMock as any,
      privacyDebugMock as any
    );
  });

  it('deve retornar 0 quando chat, uid ou mensagens forem inválidos', async () => {
    await expect(
      firstValueFrom(service.markDeliveredAsRead$(' ', 'user-1', []))
    ).resolves.toBe(0);

    await expect(
      firstValueFrom(service.markDeliveredAsRead$('chat-1', ' ', []))
    ).resolves.toBe(0);

    expect(messagesRepositoryMock.advanceMessageReceipts$).not.toHaveBeenCalled();
  });

  it('deve ignorar mensagens próprias, lidas, sem id e legadas sem status', async () => {
    const messages = [
      {
        id: 'own-by-sender-id',
        senderId: 'user-1',
        status: 'sent',
      },
      {
        id: 'own-by-sender-uid',
        senderId: 'legacy-other',
        senderUid: 'user-1',
        status: 'delivered',
      },
      {
        id: 'already-read',
        senderId: 'user-2',
        status: 'read',
      },
      {
        id: 'legacy-without-status',
        senderId: 'user-2',
      },
      {
        senderId: 'user-2',
        status: 'sent',
      },
    ] as any;

    const result = await firstValueFrom(
      service.markDeliveredAsRead$('chat-1', 'user-1', messages)
    );

    expect(result).toBe(0);
    expect(messagesRepositoryMock.advanceMessageReceipts$).not.toHaveBeenCalled();
  });

  it('deve enviar ids únicos de mensagens recebidas com status explícito', async () => {
    messagesRepositoryMock.advanceMessageReceipts$.mockReturnValueOnce(of(2));

    const messages = [
      {
        id: 'msg-1',
        senderId: 'user-2',
        status: 'sent',
      },
      {
        id: 'msg-1',
        senderUid: 'user-2',
        senderId: 'legacy-value',
        status: 'sent',
      },
      {
        id: 'msg-2',
        senderUid: 'user-3',
        senderId: '',
        status: 'delivered',
      },
    ] as any;

    const result = await firstValueFrom(
      service.markDeliveredAsRead$(' chat-1 ', ' user-1 ', messages)
    );

    expect(result).toBe(2);
    expect(messagesRepositoryMock.advanceMessageReceipts$).toHaveBeenCalledWith(
      'chat-1',
      'user-1',
      ['msg-1', 'msg-2']
    );
    expect(privacyDebugMock.log).toHaveBeenCalledWith(
      'chat',
      'DirectReceiptsService: markDeliveredAsRead$',
      {
        chatId: 'chat-1',
        candidateCount: 2,
        updatedCount: 2,
      }
    );
  });

  it('deve limitar o lote a 50 mensagens', async () => {
    messagesRepositoryMock.advanceMessageReceipts$.mockReturnValueOnce(of(50));

    const messages = Array.from({ length: 65 }, (_, index) => ({
      id: `msg-${index + 1}`,
      senderId: 'user-2',
      status: 'sent',
    })) as any;

    const result = await firstValueFrom(
      service.markDeliveredAsRead$('chat-1', 'user-1', messages)
    );

    expect(result).toBe(50);

    const ids = messagesRepositoryMock.advanceMessageReceipts$.mock.calls[0][2];
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('msg-1');
    expect(ids[49]).toBe('msg-50');
  });

  it('deve retornar 0 e registrar erro silencioso quando o repository falhar', async () => {
    messagesRepositoryMock.advanceMessageReceipts$.mockReturnValueOnce(
      throwError(() => new Error('transaction failed'))
    );

    const result = await firstValueFrom(
      service.markDeliveredAsRead$('chat-1', 'user-1', [
        {
          id: 'msg-1',
          senderId: 'user-2',
          status: 'sent',
        } as any,
      ])
    );

    expect(result).toBe(0);
    expect(globalErrorHandlerMock.handleError).toHaveBeenCalledTimes(1);

    const handledError = globalErrorHandlerMock.handleError.mock.calls[0][0] as any;
    expect(handledError.silent).toBe(true);
    expect(handledError.skipUserNotification).toBe(true);
    expect(handledError.context).toBe(
      'DirectReceiptsService.markDeliveredAsRead$'
    );
  });
});
