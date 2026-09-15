import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveCommunityModerationPurgeBlocker,
} from './community-purge-moderation-evidence.policy';

describe('community purge moderation evidence policy', () => {
  it('não bloqueia quando não há denúncias', () => {
    assert.equal(
      resolveCommunityModerationPurgeBlocker({
        totalCount: 0,
        resolvedCount: 0,
        rejectedCount: 0,
      }),
      false
    );
  });

  it('preserva histórico encerrado sem criar hold permanente', () => {
    assert.equal(
      resolveCommunityModerationPurgeBlocker({
        totalCount: 5,
        resolvedCount: 3,
        rejectedCount: 2,
      }),
      false
    );
  });

  it('bloqueia quando existe denúncia não terminal ou desconhecida', () => {
    assert.equal(
      resolveCommunityModerationPurgeBlocker({
        totalCount: 5,
        resolvedCount: 2,
        rejectedCount: 2,
      }),
      true
    );
  });

  it('falha fechado para contagens inválidas', () => {
    assert.equal(
      resolveCommunityModerationPurgeBlocker({
        totalCount: 2,
        resolvedCount: 2,
        rejectedCount: 1,
      }),
      null
    );
    assert.equal(
      resolveCommunityModerationPurgeBlocker({
        totalCount: Number.NaN,
        resolvedCount: 0,
        rejectedCount: 0,
      }),
      null
    );
  });
});
