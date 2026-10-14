import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCurrentVideoPublicationSource,
  resolveVideoPublicationPrivateSource,
  resolveVideoPublicationProcessedSource,
} from './video-publication-source-fence.policy';

const ownerUid = 'owner';
const videoId = 'sample';
const privateSource = 'users/owner/uploads/videos/sample-original.mp4';
const processedSource =
  'users/owner/processed/videos/sample/version-one/video.mp4';

function privateVideo() {
  return {
    status: 'ready',
    path: privateSource,
    processedStoragePath: processedSource,
    playbackPath: processedSource,
  };
}

test('only the ready private source and copied processing version can publish', () => {
  assert.equal(isCurrentVideoPublicationSource(
    ownerUid, videoId, privateVideo(), privateSource, processedSource
  ), true);
  assert.equal(isCurrentVideoPublicationSource(
    ownerUid, videoId, { ...privateVideo(), status: 'processing' },
    privateSource, processedSource
  ), false);
  assert.equal(isCurrentVideoPublicationSource(
    ownerUid, videoId, null, privateSource, processedSource
  ), false);
});

test('replaced private file or processed version fences delayed copies', () => {
  assert.equal(isCurrentVideoPublicationSource(
    ownerUid, videoId,
    { ...privateVideo(), path: 'users/owner/uploads/videos/sample-new.mp4' },
    privateSource, processedSource
  ), false);
  assert.equal(isCurrentVideoPublicationSource(
    ownerUid, videoId,
    { ...privateVideo(),
      processedStoragePath: 'users/owner/processed/videos/sample/version-two/video.mp4' },
    privateSource, processedSource
  ), false);
});

test('legacy playback path is accepted only within the same owned namespace', () => {
  const legacy = {
    ...privateVideo(), processedStoragePath: null, playbackPath: processedSource,
  };
  assert.equal(resolveVideoPublicationProcessedSource(
    ownerUid, videoId, legacy
  ), processedSource);
  assert.equal(isCurrentVideoPublicationSource(
    ownerUid, videoId, legacy, privateSource, processedSource
  ), true);
  assert.equal(resolveVideoPublicationPrivateSource(
    ownerUid, videoId,
    { ...legacy, path: 'users/other/uploads/videos/sample-original.mp4' }
  ), null);
});

test('foreign processed path and empty expectations fail closed', () => {
  const foreign = 'users/other/processed/videos/sample/version-one/video.mp4';
  assert.equal(isCurrentVideoPublicationSource(
    ownerUid, videoId,
    { ...privateVideo(), processedStoragePath: foreign, playbackPath: null },
    privateSource, processedSource
  ), false);
  assert.equal(isCurrentVideoPublicationSource(
    ownerUid, videoId, privateVideo(), '', processedSource
  ), false);
  assert.equal(isCurrentVideoPublicationSource(
    ownerUid, videoId, privateVideo(), privateSource, ''
  ), false);
});
