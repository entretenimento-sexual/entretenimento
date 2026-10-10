import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ChatMessagesRepository } from './chat-messages.repository';

describe('ChatMessagesRepository legacy mutation boundary', () => {
  function setup() {
    const firestore = {} as any;
    const context = { run: vi.fn(() => {
      throw new Error('Uma escrita direta ao Firestore foi tentada.');
    }) };
    const globalError = { handleError: vi.fn() };
    const repository = new ChatMessagesRepository(
      firestore, context as any, globalError as any
    );
    return { repository, context, globalError };
  }

  it('não executa addDoc para mensagens diretas legadas', async () => {
    const { repository, context, globalError } = setup();
    const operation = repository.addMessage$('chat-1', {
      senderId: 'alice', content: 'mensagem privada',
    } as any);

    await expect(firstValueFrom(operation)).rejects.toMatchObject({
      code: 'failed-precondition',
      operation: 'addMessage$',
    });
    expect(context.run).not.toHaveBeenCalled();
    expect(globalError.handleError).not.toHaveBeenCalled();
  });

  it('não executa deleteDoc físico para mensagens diretas legadas', async () => {
    const { repository, context, globalError } = setup();
    const operation = repository.deleteMessage$('chat-1', 'msg-1');

    await expect(firstValueFrom(operation)).rejects.toMatchObject({
      code: 'failed-precondition',
      operation: 'deleteMessage$',
    });
    expect(context.run).not.toHaveBeenCalled();
    expect(globalError.handleError).not.toHaveBeenCalled();
  });

  it('não converte IDs inválidos em sucesso falso', async () => {
    const { repository, context } = setup();

    await expect(firstValueFrom(repository.addMessage$(' ', {} as any)))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(firstValueFrom(repository.deleteMessage$(' ', ' ')))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(context.run).not.toHaveBeenCalled();
  });
});
