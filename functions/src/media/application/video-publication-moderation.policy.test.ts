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
  await t.test('new publication starts active without implicit safety score', () => {
    assert.equal(defaultVideoPublicationModerationStatus(), 'APPROVED');
    assert.equal(buildUnassessedVideoScoreBreakdown().safetyScore, null);
  });

  await t.test('legacy pending state is recognized but no longer the default', () => {
    assert.equal(isLegacyPendingVideoModeration('PENDING_REVIEW'), true);
    assert.equal(isLegacyPendingVideoModeration('APPROVED'), false);
  });

  await t.test('non-restricted owner edits remain publishable', () => {
    assert.equal(resolveVideoModerationAfterOwnerEdit('PRIVATE'), 'APPROVED');
    assert.equal(resolveVideoModerationAfterOwnerEdit(''), 'APPROVED');
    assert.equal(resolveVideoModerationAfterOwnerEdit('APPROVED'), 'APPROVED');
    assert.equal(resolveVideoModerationAfterOwnerEdit('PENDING_REVIEW'), 'APPROVED');
  });

  await t.test('owner edit cannot release moderation restrictions', () => {
    assert.equal(resolveVideoModerationAfterOwnerEdit('FLAGGED'), 'FLAGGED');
    assert.equal(resolveVideoModerationAfterOwnerEdit('HIDDEN'), 'HIDDEN');
    assert.equal(resolveVideoModerationAfterOwnerEdit('REJECTED'), 'REJECTED');
    assert.equal(isRestrictedVideoModerationStatus('FLAGGED'), true);
    assert.equal(isRestrictedVideoModerationStatus('APPROVED'), false);
  });
});
