import { describe, expect, it } from 'vitest';
import { resolveDirectMessageTargetUid } from './direct-message.policy';

describe('resolveDirectMessageTargetUid', () => {
  it('aceita uma conversa direta com exatamente dois participantes distintos', () => {
    expect(resolveDirectMessageTargetUid({
      participants: ['user-a', 'user-b'],
      conversationType: 'direct',
      conversationStatus: 'active',
    }, 'user-a')).toBe('user-b');
  });

  it.each([
    ['participante duplicado adicional', ['user-a', 'user-b', 'user-b']],
    ['três participantes distintos', ['user-a', 'user-b', 'user-c']],
    ['dois UIDs idênticos', ['user-a', 'user-a']],
    ['participante vazio', ['user-a', '']],
    ['UID não textual', ['user-a', 123]],
    ['participante ausente', ['user-b', 'user-c']],
  ])('rejeita %s sem conceder autorização de envio', (_case, participants) => {
    expect(() => resolveDirectMessageTargetUid({
      participants,
      conversationType: 'direct',
      conversationStatus: 'active',
    }, 'user-a')).toThrowError(
      expect.objectContaining({ code: 'permission-denied' })
    );
  });
});
