import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityTopicModerationTransition,
  normalizeCommunityTopicModerationRequest,
} from './community-topic-moderation.model';

test('normaliza comando de moderação e remove caracteres de controle do motivo', () => {
  assert.deepEqual(
    normalizeCommunityTopicModerationRequest({
      requestId: 'moderation:123',
      communityId: 'community-1',
      topicId: 'topic-1',
      action: ' LOCK ',
      reason: '  conversa\nfora do foco  ',
    }),
    {
      requestId: 'moderation:123',
      communityId: 'community-1',
      topicId: 'topic-1',
      action: 'lock',
      reason: 'conversa fora do foco',
      reasonTooLong: false,
    }
  );
});

test('rejeita identificadores ou ação fora do contrato', () => {
  const command = normalizeCommunityTopicModerationRequest({
    requestId: '../request',
    communityId: 'community/1',
    topicId: 'topic 1',
    action: 'delete',
  });

  assert.equal(command.requestId, null);
  assert.equal(command.communityId, null);
  assert.equal(command.topicId, null);
  assert.equal(command.action, null);
});

test('sinaliza motivo acima do limite sem aceitar truncamento silencioso', () => {
  const command = normalizeCommunityTopicModerationRequest({
    requestId: 'moderation-long-reason',
    communityId: 'community-1',
    topicId: 'topic-1',
    action: 'remove',
    reason: 'x'.repeat(241),
  });

  assert.equal(command.reason?.length, 240);
  assert.equal(command.reasonTooLong, true);
});

test('encerra tópico ativo preservando moderação ativa', () => {
  assert.deepEqual(
    evaluateCommunityTopicModerationTransition({
      action: 'lock',
      currentStatus: 'active',
      currentModerationState: 'active',
      reason: null,
    }),
    {
      allowed: true,
      idempotent: false,
      nextStatus: 'locked',
      nextModerationState: 'active',
      deleteProjection: false,
      denialReason: null,
    }
  );
});

test('reabrir tópico encerrado volta ao estado ativo', () => {
  const decision = evaluateCommunityTopicModerationTransition({
    action: 'unlock',
    currentStatus: 'locked',
    currentModerationState: 'active',
    reason: null,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.idempotent, false);
  assert.equal(decision.nextStatus, 'active');
  assert.equal(decision.deleteProjection, false);
});

test('repetir lock ou unlock já aplicado é idempotente', () => {
  const locked = evaluateCommunityTopicModerationTransition({
    action: 'lock',
    currentStatus: 'locked',
    currentModerationState: 'active',
    reason: null,
  });
  const active = evaluateCommunityTopicModerationTransition({
    action: 'unlock',
    currentStatus: 'active',
    currentModerationState: 'active',
    reason: null,
  });

  assert.equal(locked.allowed, true);
  assert.equal(locked.idempotent, true);
  assert.equal(active.allowed, true);
  assert.equal(active.idempotent, true);
});

test('remoção exige motivo auditável e retira a projeção', () => {
  const denied = evaluateCommunityTopicModerationTransition({
    action: 'remove',
    currentStatus: 'active',
    currentModerationState: 'active',
    reason: 'x',
  });
  const allowed = evaluateCommunityTopicModerationTransition({
    action: 'remove',
    currentStatus: 'locked',
    currentModerationState: 'active',
    reason: 'Conteúdo incompatível com as regras da Comunidade.',
  });

  assert.equal(denied.allowed, false);
  assert.equal(denied.denialReason, 'removal_reason_required');
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.nextStatus, 'archived');
  assert.equal(allowed.nextModerationState, 'removed');
  assert.equal(allowed.deleteProjection, true);
});

test('tópico removido aceita remove idempotente mas nunca pode ser reaberto', () => {
  const repeatedRemove = evaluateCommunityTopicModerationTransition({
    action: 'remove',
    currentStatus: 'archived',
    currentModerationState: 'removed',
    reason: null,
  });
  const reopen = evaluateCommunityTopicModerationTransition({
    action: 'unlock',
    currentStatus: 'archived',
    currentModerationState: 'removed',
    reason: null,
  });

  assert.equal(repeatedRemove.allowed, true);
  assert.equal(repeatedRemove.idempotent, true);
  assert.equal(reopen.allowed, false);
  assert.equal(reopen.denialReason, 'removed_topic');
});
