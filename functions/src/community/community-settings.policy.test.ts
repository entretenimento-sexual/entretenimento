import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunitySettingsIdempotencyReplay,
  evaluateCommunitySettingsUpdate,
} from './community-settings.policy';

const BASE_INPUT = Object.freeze({
  sourceType: 'community' as const,
  communityStatus: 'active',
  moderationState: 'active',
  actorStatus: 'active',
  actorRole: 'admin' as const,
  capacityChanged: false,
});

test('owner e admin editam Comunidade ativa ou pausada', () => {
  for (const actorRole of ['owner', 'admin'] as const) {
    for (const communityStatus of ['active', 'paused']) {
      const decision = evaluateCommunitySettingsUpdate({
        ...BASE_INPUT,
        actorRole,
        communityStatus,
      });

      assert.equal(decision.allowed, true);
      assert.equal(decision.denialReason, null);
    }
  }
});

test('moderador, membro e vínculo inativo não editam configurações', () => {
  for (const actorRole of ['moderator', 'member'] as const) {
    assert.equal(
      evaluateCommunitySettingsUpdate({ ...BASE_INPUT, actorRole }).denialReason,
      'manager_required'
    );
  }

  assert.equal(
    evaluateCommunitySettingsUpdate({
      ...BASE_INPUT,
      actorStatus: 'left',
    }).denialReason,
    'manager_required'
  );
});

test('somente owner altera a capacidade de membros', () => {
  assert.equal(
    evaluateCommunitySettingsUpdate({
      ...BASE_INPUT,
      capacityChanged: true,
    }).denialReason,
    'owner_required_for_capacity'
  );
  assert.equal(
    evaluateCommunitySettingsUpdate({
      ...BASE_INPUT,
      actorRole: 'owner',
      capacityChanged: true,
    }).allowed,
    true
  );
});

test('isola Local e bloqueia estados não editáveis ou moderação inativa', () => {
  assert.equal(
    evaluateCommunitySettingsUpdate({
      ...BASE_INPUT,
      sourceType: 'venue',
    }).denialReason,
    'source_unsupported'
  );

  for (const communityStatus of [
    'dormant',
    'archived',
    'scheduled_for_deletion',
  ]) {
    assert.equal(
      evaluateCommunitySettingsUpdate({
        ...BASE_INPUT,
        communityStatus,
      }).denialReason,
      'community_unavailable'
    );
  }

  assert.equal(
    evaluateCommunitySettingsUpdate({
      ...BASE_INPUT,
      moderationState: 'blocked',
    }).denialReason,
    'community_unavailable'
  );
});


const SETTINGS_REPLAY_BASE = Object.freeze({
  rawRequest: {
    actorUid: 'owner-1',
    communityId: 'community-1',
    status: 'completed',
    changedFields: ['rules', 'joinPolicy'],
    generatedAt: 123_456,
  },
  expectedActorUid: 'owner-1',
  expectedCommunityId: 'community-1',
});

test('aceita replay idempotente íntegro de configurações', () => {
  assert.deepEqual(
    evaluateCommunitySettingsIdempotencyReplay(SETTINGS_REPLAY_BASE),
    {
      state: 'valid',
      changedFields: ['rules', 'joinPolicy'],
      generatedAt: 123_456,
    }
  );
});

test('classifica identidade divergente do replay de configurações como conflito', () => {
  for (const input of [
    { ...SETTINGS_REPLAY_BASE, expectedActorUid: 'owner-2' },
    { ...SETTINGS_REPLAY_BASE, expectedCommunityId: 'community-2' },
  ]) {
    assert.deepEqual(
      evaluateCommunitySettingsIdempotencyReplay(input),
      { state: 'conflict' }
    );
  }
});

test('replay de configurações corrompido falha fechado', () => {
  for (const rawRequest of [
    { ...SETTINGS_REPLAY_BASE.rawRequest, status: 'pending' },
    { ...SETTINGS_REPLAY_BASE.rawRequest, generatedAt: undefined },
    { ...SETTINGS_REPLAY_BASE.rawRequest, generatedAt: '123456' },
    { ...SETTINGS_REPLAY_BASE.rawRequest, generatedAt: 123.5 },
    { ...SETTINGS_REPLAY_BASE.rawRequest, generatedAt: 0 },
    { ...SETTINGS_REPLAY_BASE.rawRequest, changedFields: 'rules' },
    { ...SETTINGS_REPLAY_BASE.rawRequest, changedFields: ['rules', 'unknown'] },
    { ...SETTINGS_REPLAY_BASE.rawRequest, changedFields: ['rules', 'rules'] },
    { ...SETTINGS_REPLAY_BASE.rawRequest, changedFields: ['rules', 1] },
  ]) {
    assert.deepEqual(
      evaluateCommunitySettingsIdempotencyReplay({
        ...SETTINGS_REPLAY_BASE,
        rawRequest,
      }),
      { state: 'invalid' }
    );
  }
});

test('aceita replay idempotente de edição sem mudanças', () => {
  assert.deepEqual(
    evaluateCommunitySettingsIdempotencyReplay({
      ...SETTINGS_REPLAY_BASE,
      rawRequest: {
        ...SETTINGS_REPLAY_BASE.rawRequest,
        changedFields: [],
      },
    }),
    { state: 'valid', changedFields: [], generatedAt: 123_456 }
  );
});
