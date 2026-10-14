import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const handler = readFileSync(
  resolve(__dirname, '../../../src/media/application/manage-video-publication.handler.ts'),
  'utf8'
);
const asset = readFileSync(
  resolve(__dirname, '../../../src/media/application/published-video-asset.service.ts'),
  'utf8'
);

test('publication rechecks private source and moderation transactionally after copying', () => {
  assert.ok(handler.includes('await copyPrivateVideoToPublishedAsset({'));
  assert.ok(handler.includes('committedPreviousPublication = await db.runTransaction('));
  assert.ok(handler.includes('transaction.get(ownerVideoRef)'));
  assert.ok(handler.includes('transaction.get(publicationRef)'));
  assert.ok(handler.includes('assertPublishableVideo(currentOwnerVideo)'));
  assert.ok(handler.includes('assertPublicationCanStart(currentPublication)'));
  assert.ok(handler.includes('assertSourceWasNotRejected(currentPublication, sourceVideoStoragePath)'));
  assert.ok(handler.includes('isCurrentVideoPublicationSource('));
  assert.ok(handler.includes('publishedAssets.sourceProcessedStoragePath'));
  assert.ok(handler.includes('transaction.set(publicationRef,'));
  assert.ok(handler.includes('transaction.set(publicVideoRef,'));
  assert.ok(!handler.includes('const batch = db.batch()'));
  assert.ok(handler.includes('await rollbackPublishedAssets(ownerUid, videoId, publishedAssets)'));
});

test('published video copy reports exactly which processed version was copied', () => {
  assert.ok(asset.includes('sourceProcessedStoragePath: string;'));
  assert.ok(asset.includes('sourceProcessedStoragePath: processedStoragePath,'));
});
