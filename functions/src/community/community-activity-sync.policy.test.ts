// functions/src/community/community-activity-sync.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { canSyncCommunityActivity } from './community-activity-sync.policy';

test('permite sincronizar atividade de Comunidade ativa, pausada ou dormente', () => {
  for (const status of ['active', 'paused', 'dormant']) {
    assert.equal(
      canSyncCommunityActivity({
        source: { type: 'community' },
        status,
      }),
      true
    );
  }
});

test('congela atividade de Comunidade arquivada ou agendada para exclusão', () => {
  for (const status of ['archived', 'scheduled_for_deletion']) {
    assert.equal(
      canSyncCommunityActivity({
        source: { type: 'community' },
        status,
      }),
      false
    );
  }
});

test('não sincroniza atividade de Local pelo lifecycle de Comunidade', () => {
  assert.equal(
    canSyncCommunityActivity({ source: { type: 'venue' }, status: 'active' }),
    false
  );
});
