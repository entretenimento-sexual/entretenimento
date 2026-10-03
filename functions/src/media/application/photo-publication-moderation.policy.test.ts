import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildUnassessedPhotoScoreBreakdown,
  defaultPhotoPublicationModerationStatus,
  isPhotoPublicationApproved,
  normalizePhotoPublicationModerationStatus,
} from './photo-publication-moderation.policy';

describe('photo publication moderation policy', () => {
  it('publica imediatamente sem presumir safetyScore', () => {
    assert.equal(defaultPhotoPublicationModerationStatus(), 'APPROVED');
    assert.deepEqual(buildUnassessedPhotoScoreBreakdown(), {
      rankingScore: 0,
      qualityScore: 0,
      engagementScore: 0,
      safetyScore: null,
    });
  });

  it('preserva estados de moderação posterior', () => {
    assert.equal(isPhotoPublicationApproved('APPROVED'), true);
    assert.equal(isPhotoPublicationApproved('PENDING_REVIEW'), false);
    assert.equal(isPhotoPublicationApproved('FLAGGED'), false);
    assert.equal(isPhotoPublicationApproved('HIDDEN'), false);
    assert.equal(isPhotoPublicationApproved('REJECTED'), false);
    assert.equal(normalizePhotoPublicationModerationStatus('unexpected'), 'UNKNOWN');
  });
});
