import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIDEO_PREVENTIVE_REVIEW_REASON,
  buildPreventiveVideoReviewId,
  buildUnassessedVideoScoreBreakdown,
  defaultVideoPublicationModerationStatus,
  isLegacyPendingVideoModeration,
  isRestrictedVideoModerationStatus,
  resolveVideoModerationAfterOwnerEdit,
} from './video-publication-moderation.policy';

test('video-publication-moderation policy', async (t) => {
  await t.test('new publication starts in preventive review', () => {
    assert.equal(defaultVideoPublicationModerationStatus(), 'PENDING_REVIEW');
    assert.equal(VIDEO_PREVENTIVE_REVIEW_REASON, 'preventive_media_review');
    assert.equal(buildUnassessedVideoScoreBreakdown().safetyScore, null);
    assert.equal(
      buildPreventiveVideoReviewId('owner', 'video', 100),
      buildPreventiveVideoReviewId('owner', 'video', 100)
    );
  });

  await t.test('pending state remains pending after owner edit', () => {
    assert.equal(
      resolveVideoModerationAfterOwnerEdit('PENDING_REVIEW'),
      'PENDING_REVIEW'
    );
    assert.equal(isLegacyPendingVideoModeration('PENDING_REVIEW'), true);
  });

  await t.test('unassessed states cannot become approved through owner edit', () => {
    assert.equal(resolveVideoModerationAfterOwnerEdit('PRIVATE'), 'PENDING_REVIEW');
    assert.equal(resolveVideoModerationAfterOwnerEdit(''), 'PENDING_REVIEW');
    assert.equal(resolveVideoModerationAfterOwnerEdit('APPROVED'), 'APPROVED');
  });

  await t.test('owner edit cannot release moderation restrictions', () => {
    assert.equal(resolveVideoModerationAfterOwnerEdit('FLAGGED'), 'FLAGGED');
    assert.equal(resolveVideoModerationAfterOwnerEdit('HIDDEN'), 'HIDDEN');
    assert.equal(resolveVideoModerationAfterOwnerEdit('REJECTED'), 'REJECTED');
    assert.equal(isRestrictedVideoModerationStatus('FLAGGED'), true);
    assert.equal(isRestrictedVideoModerationStatus('APPROVED'), false);
  });
});
