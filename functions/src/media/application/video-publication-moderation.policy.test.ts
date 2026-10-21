import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUnassessedVideoScoreBreakdown,
  defaultVideoPublicationModerationStatus,
  isLegacyPendingVideoModeration,
  isRestrictedVideoModerationStatus,
  resolveVideoModerationAfterOwnerEdit,
} from './video-publication-moderation.policy';

test('video-publication-moderation policy', async (t) => {
  await t.test('new publication requires preventive review', () => {
    assert.equal(defaultVideoPublicationModerationStatus(), 'PENDING_REVIEW');
    assert.equal(buildUnassessedVideoScoreBreakdown().safetyScore, null);
  });

  await t.test('legacy pending state is recognized but no longer the default', () => {
    assert.equal(isLegacyPendingVideoModeration('PENDING_REVIEW'), true);
    assert.equal(isLegacyPendingVideoModeration('APPROVED'), false);
  });

  await t.test('owner edits never promote pending, private or unknown media', () => {
    assert.equal(resolveVideoModerationAfterOwnerEdit('PRIVATE'), 'PRIVATE');
    assert.equal(resolveVideoModerationAfterOwnerEdit(''), 'UNKNOWN');
    assert.equal(resolveVideoModerationAfterOwnerEdit('APPROVED'), 'APPROVED');
    assert.equal(resolveVideoModerationAfterOwnerEdit('PENDING_REVIEW'), 'PENDING_REVIEW');
    assert.equal(isRestrictedVideoModerationStatus('PENDING_REVIEW'), true);
  });

  await t.test('owner edit cannot release moderation restrictions', () => {
    assert.equal(resolveVideoModerationAfterOwnerEdit('FLAGGED'), 'FLAGGED');
    assert.equal(resolveVideoModerationAfterOwnerEdit('HIDDEN'), 'HIDDEN');
    assert.equal(resolveVideoModerationAfterOwnerEdit('REJECTED'), 'REJECTED');
    assert.equal(isRestrictedVideoModerationStatus('FLAGGED'), true);
    assert.equal(isRestrictedVideoModerationStatus('APPROVED'), false);
  });
});
