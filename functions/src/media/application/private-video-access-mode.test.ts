import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizePrivateVideoAccessMode,
  shouldIssuePrivateVideoPlaybackAccess,
} from './private-video-access-mode';

test('private-video-access-mode', async (t) => {
  await t.test('defaults legacy requests to PLAYBACK', () => {
    assert.equal(normalizePrivateVideoAccessMode(undefined), 'PLAYBACK');
    assert.equal(shouldIssuePrivateVideoPlaybackAccess('PLAYBACK'), true);
  });

  await t.test('accepts PREVIEW without playback access', () => {
    assert.equal(normalizePrivateVideoAccessMode('preview'), 'PREVIEW');
    assert.equal(shouldIssuePrivateVideoPlaybackAccess('PREVIEW'), false);
  });

  await t.test('unknown modes remain backward compatible', () => {
    assert.equal(normalizePrivateVideoAccessMode('unknown'), 'PLAYBACK');
  });
});
