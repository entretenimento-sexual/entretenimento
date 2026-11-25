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

test('CHAT-R1.9 canonical exposure precedes video social preconditions', () => {
  for (const [file, precondition] of [
    ['manage-video-comment.handler.ts', 'assertVideoAllowsComments(video);'],
    ['rate-video.handler.ts', 'assertRateableVideo(video);'],
    ['toggle-video-reaction.handler.ts', "if (video.visibility !== 'PUBLIC')"],
  ]) {
    const text = source(file);
    const transaction = text.indexOf('db.runTransaction(');
    const publicationRead = text.indexOf('transaction.get(publicationRef)', transaction);
    const exposure = text.indexOf('assertCurrentPublicVideoTransactionExposure({', transaction);
    const featureCheck = text.indexOf(precondition, transaction);
    assert.ok(transaction >= 0 && publicationRead > transaction, file);
    assert.ok(exposure > publicationRead && featureCheck > exposure, file);
  }
});

test('CHAT-R1.9 playback and accounting preflight mask restricted projections', () => {
  for (const file of [
    'record-video-view.handler.ts',
    'record-video-retention.handler.ts',
    'start-public-video-playback-session.handler.ts',
  ]) {
    const text = source(file);
    const moderation = text.indexOf("moderationStatus !== 'APPROVED'");
    assert.ok(moderation >= 0, file);
    const denial = text.indexOf('throw new HttpsError(', moderation);
    assert.ok(denial >= 0, file);
    assert.match(text.slice(denial, denial + 180), /HttpsError\(\s*'not-found'/, file);
  }
});
