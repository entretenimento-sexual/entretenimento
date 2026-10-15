import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const handler = readFileSync(
  resolve(__dirname, '../../../src/media/application/manage-video-publication.handler.ts'),
  'utf8'
);
const core = readFileSync(
  resolve(__dirname, '../../../src/media/application/video-publication-commit.firestore.ts'),
  'utf8'
);
const asset = readFileSync(
  resolve(__dirname, '../../../src/media/application/published-video-asset.service.ts'),
  'utf8'
);

test('publication uses the transactional source fence shared with emulator tests', () => {
  assert.ok(handler.includes('await copyPrivateVideoToPublishedAsset({'));
  assert.ok(handler.includes('commitCopiedVideoPublicationIfCurrent('));
  assert.ok(core.includes('firestore.runTransaction(async (transaction) => {'));
  assert.ok(core.includes('transaction.get(ownerVideoRef)'));
  assert.ok(core.includes('transaction.get(publicationRef)'));
  assert.ok(core.includes('assertPublishableVideo(currentOwnerVideo)'));
  assert.ok(core.includes('assertPublicationCanStart(currentPublication)'));
  assert.ok(core.includes('assertSourceWasNotRejected(currentPublication, sourceVideoStoragePath)'));
  assert.ok(core.includes('isCurrentVideoPublicationSource('));
  assert.ok(core.includes('transaction.set(publicationRef, publicationPatch, { merge: true })'));
  assert.ok(core.includes('transaction.set(publicVideoRef, publicVideoPatch, { merge: true })'));
  assert.ok(!handler.includes('const batch = db.batch()'));
  assert.ok(handler.includes('await rollbackPublishedAssets(ownerUid, videoId, publishedAssets)'));
});

test('published video copy reports exactly which processed version was copied', () => {
  assert.ok(asset.includes('sourceProcessedStoragePath: string;'));
  assert.ok(asset.includes('sourceProcessedStoragePath: processedStoragePath,'));
});
