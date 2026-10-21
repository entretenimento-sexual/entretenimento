import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = (name: string) => readFileSync(
  resolve(__dirname, '../../../src/media/application/' + name), 'utf8'
);

test('VF1-B2 session, view and retention share signer publication authority', () => {
  for (const file of [
    'start-public-video-playback-session.handler.ts',
    'record-video-view.handler.ts',
    'record-video-retention.handler.ts',
  ]) {
    const text = source(file);
    assert.ok(text.includes('transaction.get(publicVideoRef)'), file);
    assert.ok(text.includes('transaction.get(publicationRef)'), file);
    assert.ok(text.includes('assertCurrentPublicVideoTransactionExposure({'), file);
  }
  assert.ok(source('public-video-access-resolution.firestore.ts')
    .includes('isCurrentPublicMediaAssetExposure({'));
  assert.ok(source('public-video-transaction-exposure.policy.ts')
    .includes('isCurrentPublicMediaAssetExposure({'));
});
