import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ChatRepository } from './chat.repository';

describe('ChatRepository backend-only mutation boundary', () => {
  // Os tombstones não acessam nenhuma dependência injetada. Construção sem DI
  // garante que não haverá fallback que execute requests Firestore.
  const repository = Object.create(ChatRepository.prototype) as ChatRepository;

  const blocked = [
    ['findChatIdByParticipantsKey$', () => repository.findChatIdByParticipantsKey$('a_b')],
    ['createChat$', () => repository.createChat$(['a', 'b'], 'a_b')],
    ['updateChat$', () => repository.updateChat$('chat-1', { participants: ['a', 'b'] })],
    ['deleteChat$', () => repository.deleteChat$('chat-1')],
  ] as const;

  for (const [operation, execute] of blocked) {
    it(`bloqueia ${operation} sem retornar sucesso aparente`, async () => {
      await expect(firstValueFrom(execute())).rejects.toMatchObject({
        code: 'failed-precondition',
        operation,
      });
    });
  }

  it('não expõe uma operação de escrita em retorno síncrono', () => {
    const operation = repository.deleteChat$('chat-1');
    expect(typeof operation.subscribe).toBe('function');
  });
});
