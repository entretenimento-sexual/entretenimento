import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultVideoPublicationModerationStatus,
  isLegacyPendingVideoModeration,
  isRestrictedVideoModerationStatus,
  resolveVideoModerationAfterOwnerEdit,
} from './video-publication-moderation.policy';

test('video-publication-moderation policy', async (t) => {
  await t.test('normal publication is immediately eligible', () => {
    assert.equal(defaultVideoPublicationModerationStatus(), 'APPROVED');
  });

  await t.test('legacy pending state is normalized after owner edit', () => {
    assert.equal(resolveVideoModerationAfterOwnerEdit('PENDING_REVIEW'), 'APPROVED');
    assert.equal(isLegacyPendingVideoModeration('PENDING_REVIEW'), true);
  });

  await t.test('legacy private and unknown states do not recreate private video', () => {
    assert.equal(resolveVideoModerationAfterOwnerEdit('PRIVATE'), 'APPROVED');
    assert.equal(resolveVideoModerationAfterOwnerEdit(''), 'APPROVED');
  });

  await t.test('owner edit cannot release moderation restrictions', () => {
    assert.equal(resolveVideoModerationAfterOwnerEdit('FLAGGED'), 'FLAGGED');
    assert.equal(resolveVideoModerationAfterOwnerEdit('HIDDEN'), 'HIDDEN');
    assert.equal(resolveVideoModerationAfterOwnerEdit('REJECTED'), 'REJECTED');
    assert.equal(isRestrictedVideoModerationStatus('FLAGGED'), true);
    assert.equal(isRestrictedVideoModerationStatus('APPROVED'), false);
  });
});
