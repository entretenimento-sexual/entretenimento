import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeDirectChatDocumentId, normalizeDirectMessageContent, normalizeDirectMessageRequestId, resolveDirectMessageTargetUid } from './direct-message.policy';

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


describe('direct message input boundary', () => {
  for (const value of [null, {}, 123, [], '', '.', '..', 'a/b', '__reserved__', 'x'.repeat(257), 'a\\u0000b']) {
    it('rejects invalid document ID: ' + JSON.stringify(value), () => {
      assert.throws(() => normalizeDirectChatDocumentId(value === 'a\\u0000b' ? 'a\u0000b' : value), (error: unknown) =>
        (error as { code?: string }).code === 'invalid-argument');
    });
  }
  it('preserves valid legacy and deterministic IDs', () => {
    assert.equal(normalizeDirectChatDocumentId(' legacy-chat '), 'legacy-chat');
    assert.equal(normalizeDirectChatDocumentId('direct_' + 'a'.repeat(64)), 'direct_' + 'a'.repeat(64));
  });
  it('rejects implicit coercion of payloads', () => {
    for (const value of [123, {}, ['hello'], null]) {
      assert.throws(() => normalizeDirectMessageContent(value));
      assert.throws(() => normalizeDirectMessageRequestId(value));
    }
    assert.equal(normalizeDirectMessageContent(' hello '), 'hello');
  });
});
