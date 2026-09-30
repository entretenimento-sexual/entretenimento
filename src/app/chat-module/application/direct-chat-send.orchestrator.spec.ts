import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';
import { DirectChatSendOrchestrator } from './direct-chat-send.orchestrator';

describe('DirectChatSendOrchestrator', () => {
  function setup(sendResult: ReturnType<typeof of> | ReturnType<typeof throwError>) {
    const selectChat = vi.fn();
    const sendMessage$ = vi.fn(() => sendResult as any);

    const orchestrator = new DirectChatSendOrchestrator(
      { selectChat } as unknown as DirectChatFacade,
      { sendMessage$ } as unknown as DirectThreadFacade
    );

    return { orchestrator, selectChat, sendMessage$ };
  }

  it('seleciona a conversa e devolve messageId no sucesso', async () => {
    const { orchestrator, selectChat, sendMessage$ } = setup(of('msg-1'));

    await expect(
      firstValueFrom(orchestrator.send$(' chat-1 ', ' olá '))
    ).resolves.toEqual({
      messageId: 'msg-1',
      blockedReason: null,
    });

    expect(selectChat).toHaveBeenCalledWith('chat-1');
    expect(sendMessage$).toHaveBeenCalledWith('olá');
  });

  it('traduz bloqueio conhecido sem lançar para o shell', async () => {
    const { orchestrator } = setup(
      throwError(() => ({
        code: 'functions/failed-precondition',
        message: 'A conexão precisa estar aceita.',
      }))
    );

    await expect(
      firstValueFrom(orchestrator.send$('chat-1', 'olá'))
    ).resolves.toEqual({
      messageId: null,
      blockedReason: 'Vocês precisam estar conectados para trocar mensagens.',
    });
  });

  it('mantém falha genérica sem inventar motivo de bloqueio', async () => {
    const { orchestrator } = setup(
      throwError(() => new Error('transport'))
    );

    await expect(
      firstValueFrom(orchestrator.send$('chat-1', 'olá'))
    ).resolves.toEqual({
      messageId: null,
      blockedReason: null,
    });
  });

  it('ignora comando vazio sem selecionar conversa', async () => {
    const { orchestrator, selectChat, sendMessage$ } = setup(of('msg-1'));

    await expect(
      firstValueFrom(orchestrator.send$(' ', ' '))
    ).resolves.toEqual({
      messageId: null,
      blockedReason: null,
    });

    expect(selectChat).not.toHaveBeenCalled();
    expect(sendMessage$).not.toHaveBeenCalled();
  });
});
