import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCommunitySettingsUpdate } from './community-settings.policy';

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
