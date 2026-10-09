import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDirectMessageTargetUid } from './direct-message.policy';

describe('resolveDirectMessageTargetUid', () => {
  it('aceita somente dois participantes distintos', () => {
    assert.equal(resolveDirectMessageTargetUid({
      participants: ['user-a', 'user-b'],
      conversationType: 'direct',
      conversationStatus: 'active',
    }, 'user-a'), 'user-b');
  });

  const invalidCases: Array<[string, unknown[]]> = [
    ['participante duplicado adicional', ['user-a', 'user-b', 'user-b']],
    ['três participantes distintos', ['user-a', 'user-b', 'user-c']],
    ['dois UIDs idênticos', ['user-a', 'user-a']],
    ['participante vazio', ['user-a', '']],
    ['UID não textual', ['user-a', 123]],
    ['participante ausente', ['user-b', 'user-c']],
  ];

  for (const [description, participants] of invalidCases) {
    it(`rejeita ${description}`, () => {
      assert.throws(() => resolveDirectMessageTargetUid({
        participants,
        conversationType: 'direct',
        conversationStatus: 'active',
      }, 'user-a'), (error: unknown) =>
        (error as { code?: string }).code === 'permission-denied'
      );
    });
  }
});
