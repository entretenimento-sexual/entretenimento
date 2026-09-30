import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DirectThreadFacade } from './direct-thread.facade';

describe('DirectThreadFacade sendMessage$', () => {
  it('propaga falha do DirectThreadService sem convertê-la em null', async () => {
    const error = {
      code: 'functions/failed-precondition',
      message: 'A conexão precisa estar aceita.',
    };

    const directChatFacade = {
      selectedChatId$: of('chat-1'),
      selectedChatCanOpen$: of(true),
    } as any;

    const directThreadService = {
      observeMessages$: vi.fn(() => of([])),
      sendMessage$: vi.fn(() => throwError(() => error)),
      deleteMessage$: vi.fn(() => of(void 0)),
    } as any;

    const directReceiptsService = {
      markDeliveredAsRead$: vi.fn(() => of(0)),
    } as any;

    const authSession = {
      uid$: of('me'),
    } as any;

    const accessControl = {
      canListenRealtime$: of(true),
    } as any;

    const globalErrorHandler = {
      handleError: vi.fn(),
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
      globalErrorHandler,
      privacyDebug
    );

    await expect(
      firstValueFrom(facade.sendMessage$('olá'))
    ).rejects.toEqual(error);

    expect(directThreadService.sendMessage$).toHaveBeenCalledWith(
      'chat-1',
      'olá'
    );
    expect(globalErrorHandler.handleError).not.toHaveBeenCalled();
  });
});
