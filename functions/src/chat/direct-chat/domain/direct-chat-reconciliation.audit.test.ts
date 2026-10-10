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
      verifiedReferences: { missing: false },
    });
    assert.ok(result.findings.includes('CANONICAL_REGISTRY_MISSING_CHAT'));
    assert.equal(result.requiresManualReview, true);
  });

  it('não confunde referência não carregada com chat inexistente', () => {
    const result = auditDirectChatPair({
      participants, chats: [], canonicalRegistryChatId: 'not-loaded',
    });
    assert.ok(result.findings.includes('REFERENCE_NOT_VERIFIED'));
    assert.ok(!result.findings.includes('CANONICAL_REGISTRY_MISSING_CHAT'));
    assert.equal(result.requiresManualReview, true);
  });

  it('não classifica amostra truncada como histórico único conclusivo', () => {
    const result = auditDirectChatPair({
      participants, chats: [candidate('legacy-1')], truncated: true,
    });
    assert.ok(!result.findings.includes('SINGLE_ELIGIBLE_HISTORY'));
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

  it('registra ausência comprovada da referência v1', () => {
    const result = auditDirectChatPair({
      participants, chats: [], legacyRegistryChatId: 'gone',
      verifiedReferences: { gone: false },
    });
    assert.ok(result.findings.includes('LEGACY_REGISTRY_MISSING_CHAT'));
    assert.equal(result.requiresManualReview, true);
  });

  it('mantém referência v1 não lida como inconclusiva', () => {
    const result = auditDirectChatPair({
      participants, chats: [], legacyRegistryChatId: 'not-read',
    });
    assert.ok(result.findings.includes('REFERENCE_NOT_VERIFIED'));
    assert.ok(!result.findings.includes('LEGACY_REGISTRY_MISSING_CHAT'));
  });

  it('não silencia candidatos repetidos com o mesmo ID', () => {
    const result = auditDirectChatPair({
      participants, chats: [candidate('repeat'), candidate('repeat')],
    });
    assert.ok(result.findings.includes('DUPLICATE_CANDIDATE_ID'));
    assert.equal(result.requiresManualReview, true);
  });

  it('identifica ID determinístico v2 ocupado por par diferente', () => {
    const result = auditDirectChatPair({
      participants, chats: [{
        id: `direct_${pair.canonicalHash}`,
        participants: ['another', 'pair'],
      }],
    });
    assert.ok(result.findings.includes('DETERMINISTIC_ID_WRONG_PAIR'));
  });

  it('falha fechado em amostra truncada', () => {
    const result = auditDirectChatPair({
      participants, chats: [candidate('legacy-1')], truncated: true,
    });
    assert.ok(result.findings.includes('SCAN_TRUNCATED'));
    assert.equal(result.requiresManualReview, true);
  });
});
