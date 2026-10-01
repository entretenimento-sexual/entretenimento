import { firstValueFrom, of, throwError } from 'rxjs';
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
