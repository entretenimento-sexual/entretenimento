import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DirectReceiptsService } from './direct-receipts.service';

describe('DirectReceiptsService', () => {
  function setup(updateResult = of(void 0)) {
    const updateMessageStatus = vi.fn(() => updateResult as any);
    const report = vi.fn();
    const log = vi.fn();

    const service = new DirectReceiptsService(
      { updateMessageStatus } as any,
      { report } as any,
      { log } as any
    );

    return { service, updateMessageStatus, report, log };
  }

  it('avança sent para delivered e delivered para read', async () => {
    const { service, updateMessageStatus } = setup();

    const count = await firstValueFrom(
      service.markDeliveredAsRead$('chat-1', 'me', [
        {
          id: 'm1',
          senderId: 'peer',
          status: 'sent',
        } as any,
        {
          id: 'm2',
          senderId: 'peer',
          status: 'delivered',
        } as any,
        {
          id: 'm3',
          senderId: 'me',
          status: 'sent',
        } as any,
      ])
    );

    expect(count).toBe(2);
    expect(updateMessageStatus).toHaveBeenNthCalledWith(
      1,
      'chat-1',
      'm1',
      'delivered'
    );
    expect(updateMessageStatus).toHaveBeenNthCalledWith(
      2,
      'chat-1',
      'm2',
      'read'
    );
  });

  it('mantém falha de update como best-effort e diagnostica silenciosamente', async () => {
    const error = new Error('receipt failed');
    const { service, report } = setup(throwError(() => error));

    const count = await firstValueFrom(
      service.markDeliveredAsRead$('chat-1', 'me', [
        {
          id: 'm1',
          senderId: 'peer',
          status: 'sent',
        } as any,
      ])
    );

    expect(count).toBe(1);
    expect(report).toHaveBeenCalledWith(error, {
      feature: 'direct-receipts',
      operation:
        'DirectReceiptsService.markDeliveredAsRead$.updateMessageStatus',
      fallbackMessage:
        'Não foi possível concluir uma atualização interna de recibo.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'DirectReceiptsService',
        context:
          'DirectReceiptsService.markDeliveredAsRead$.updateMessageStatus',
        chatId: 'chat-1',
        messageId: 'm1',
        nextStatus: 'delivered',
      },
    });
  });

  it('ignora input inválido sem tocar no adapter', async () => {
    const { service, updateMessageStatus, report } = setup();

    const count = await firstValueFrom(
      service.markDeliveredAsRead$(' ', 'me', [])
    );

    expect(count).toBe(0);
    expect(updateMessageStatus).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
