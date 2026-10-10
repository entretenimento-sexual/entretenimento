import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDirectChatPairIdentity } from './direct-chat.policy';
import { auditDirectChatPair } from './direct-chat-reconciliation.audit';

describe('direct chat reconciliation dry-run classifier', () => {
  const participants: [string, string] = ['alex', 'bia'];
  const pair = buildDirectChatPairIdentity(...participants);
  const candidate = (id: string) => ({
    id, participants: [...pair.participants], participantsKey: pair.legacyKey,
  });

  it('classifica um histórico íntegro sem exigir reconciliação', () => {
    const result = auditDirectChatPair({
      participants, chats: [candidate('legacy-1')],
    });
    assert.deepEqual(result.findings, ['SINGLE_ELIGIBLE_HISTORY']);
    assert.equal(result.requiresManualReview, false);
    assert.deepEqual(result.eligibleChatIds, ['legacy-1']);
  });

  it('não elege um vencedor entre históricos duplicados', () => {
    const result = auditDirectChatPair({
      participants, chats: [candidate('legacy-2'), candidate('legacy-1')],
    });
    assert.deepEqual(result.eligibleChatIds, ['legacy-1', 'legacy-2']);
    assert.ok(result.findings.includes('MULTIPLE_HISTORIES'));
    assert.equal(result.requiresManualReview, true);
  });

  it('identifica registro canônico ausente do conjunto inspecionado', () => {
    const result = auditDirectChatPair({
      participants, chats: [], canonicalRegistryChatId: 'missing',
    });
    assert.ok(result.findings.includes('CANONICAL_REGISTRY_MISSING_CHAT'));
    assert.equal(result.requiresManualReview, true);
  });

  it('detecta colisão de participantsKey v1 entre pares distintos', () => {
    const result = auditDirectChatPair({
      participants, chats: [{
        id: 'wrong-pair', participants: ['other', 'pair'],
        participantsKey: pair.legacyKey,
      }],
    });
    assert.ok(result.findings.includes('LEGACY_KEY_COLLISION'));
    assert.equal(result.eligibleChatIds.length, 0);
  });

  it('detecta referência v2 apontando para par diferente', () => {
    const result = auditDirectChatPair({
      participants, canonicalRegistryChatId: 'foreign',
      chats: [{ id: 'foreign', participants: ['other', 'pair'] }],
    });
    assert.ok(result.findings.includes('CANONICAL_REGISTRY_WRONG_PAIR'));
  });

  it('falha fechado em amostra truncada', () => {
    const result = auditDirectChatPair({
      participants, chats: [candidate('legacy-1')], truncated: true,
    });
    assert.ok(result.findings.includes('SCAN_TRUNCATED'));
    assert.equal(result.requiresManualReview, true);
  });
});
