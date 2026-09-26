import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPreventivePhotoReviewId,
  buildUnassessedPhotoScoreBreakdown,
  defaultPhotoPublicationModerationStatus,
  isPhotoPublicationApproved,
  normalizePhotoPublicationModerationStatus,
} from './photo-publication-moderation.policy';

describe('photo publication moderation policy', () => {
  it('nasce não avaliada e sem safetyScore implícito', () => {
    assert.equal(defaultPhotoPublicationModerationStatus(), 'PENDING_REVIEW');
    assert.deepEqual(buildUnassessedPhotoScoreBreakdown(), {
      rankingScore: 0,
      qualityScore: 0,
      engagementScore: 0,
      safetyScore: null,
    });
  });

  it('só considera APPROVED como aprovação explícita', () => {
    assert.equal(isPhotoPublicationApproved('APPROVED'), true);
    assert.equal(isPhotoPublicationApproved('PENDING_REVIEW'), false);
    assert.equal(isPhotoPublicationApproved('FLAGGED'), false);
    assert.equal(isPhotoPublicationApproved(''), false);
    assert.equal(normalizePhotoPublicationModerationStatus('unexpected'), 'UNKNOWN');
  });

  it('gera id determinístico por versão do ativo em revisão', () => {
    const first = buildPreventivePhotoReviewId('owner', 'photo', 123);
    const retry = buildPreventivePhotoReviewId('owner', 'photo', 123);
    const nextVersion = buildPreventivePhotoReviewId('owner', 'photo', 124);

    assert.equal(first, retry);
    assert.notEqual(first, nextVersion);
    assert.match(first, /^[a-f0-9]{48}$/);
  });
});
