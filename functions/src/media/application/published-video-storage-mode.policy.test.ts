import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizePublishedVideoPlaybackPath,
  decidePublishedVideoDeletionPath,
} from './published-video-storage-mode.policy';
const uid = 'owner';
const id = 'vid';
const canonical = 'users/' + uid + '/processed/videos/' + id + '/v1/output.mp4';
const prefix = 'users/' + uid + '/processed/videos/' + id + '/v1/';
const legacy = 'users/' + uid + '/published/videos/' + id + '/assets/v1';
test('explicit storage mode selects canonical or legacy asset strictly', () => {
  assert.equal(normalizePublishedVideoPlaybackPath(uid, id, canonical, 'PROCESSED_CANONICAL'), canonical);
  assert.equal(normalizePublishedVideoPlaybackPath(uid, id, canonical, undefined), null);
  assert.equal(normalizePublishedVideoPlaybackPath(uid, id, legacy, undefined), legacy);
  assert.equal(normalizePublishedVideoPlaybackPath(uid, id, legacy, 'PROCESSED_CANONICAL'), null);
  assert.equal(normalizePublishedVideoPlaybackPath(uid, id, canonical, 'UNKNOWN'), null);
  assert.equal(normalizePublishedVideoPlaybackPath('other', id, canonical, 'PROCESSED_CANONICAL'), null);
});
test('profile deletion lets canonical playback be cleaned only by exact owning prefix', () => {
  assert.equal(decidePublishedVideoDeletionPath(uid, id, canonical, prefix), 'HANDLED_BY_PROCESSED_PREFIX');
  assert.equal(decidePublishedVideoDeletionPath(uid, id, canonical, null), 'BLOCKED');
  assert.equal(decidePublishedVideoDeletionPath(uid, id, canonical,
    'users/' + uid + '/processed/videos/' + id + '/v2/'), 'BLOCKED');
  assert.equal(decidePublishedVideoDeletionPath(uid, id, legacy, prefix), 'COPIED_ASSET');
});
