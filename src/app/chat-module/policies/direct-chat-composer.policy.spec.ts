import { describe, expect, it } from 'vitest';

import {
  DIRECT_CHAT_MAX_MESSAGE_LENGTH,
  directMessageLength,
  isDirectMessageNearLimit,
  isDirectMessageTooLong,
  normalizeDirectMessageContent,
  resolveDirectMessageBlockMessage,
  trimDirectMessageContent,
} from './direct-chat-composer.policy';

describe('direct-chat-composer.policy', () => {
  it('normaliza conteúdo sem perder espaços usados na contagem visual', () => {
    expect(normalizeDirectMessageContent(null)).toBe('');
    expect(trimDirectMessageContent('  oi  ')).toBe('oi');
    expect(directMessageLength('  oi  ')).toBe(6);
  });

  it('aplica limite e faixa de aviso canônicos', () => {
    expect(
      isDirectMessageTooLong('x'.repeat(DIRECT_CHAT_MAX_MESSAGE_LENGTH))
    ).toBe(false);
    expect(
      isDirectMessageTooLong('x'.repeat(DIRECT_CHAT_MAX_MESSAGE_LENGTH + 1))
    ).toBe(true);
    expect(isDirectMessageNearLimit('x'.repeat(850))).toBe(true);
    expect(isDirectMessageNearLimit('x'.repeat(849))).toBe(false);
  });

  it('resolve bloqueios conhecidos sem expor mensagem técnica', () => {
    expect(
      resolveDirectMessageBlockMessage({
        code: 'functions/failed-precondition',
        message: 'A conexão precisa estar aceita.',
      })
    ).toBe('Vocês precisam estar conectados para trocar mensagens.');

    expect(
      resolveDirectMessageBlockMessage({
        code: 'functions/permission-denied',
        message: 'backend detail',
      })
    ).toBe('Esta conversa não está disponível para envio.');

    expect(resolveDirectMessageBlockMessage(new Error('qualquer erro'))).toBeNull();
  });
});
