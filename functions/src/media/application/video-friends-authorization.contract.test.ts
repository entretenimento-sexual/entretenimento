import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (filename: string) => readFileSync(
  resolve(__dirname, '../../../src/media/application', filename), 'utf8'
);

describe('video FRIENDS authorization boundaries', () => {
  it('profile discovery uses reciprocal friendship and never emits FRIENDS globally', () => {
    const gallery = read('get-authorized-video-owner-page.handler.ts');
    const global = read('get-public-media-discovery.handler.ts');
    assert.ok(gallery.includes('resolveSocialConnectionAccess(viewerUid, [ownerUid])'));
    assert.ok(gallery.includes("visibility: 'FRIENDS'"));
    assert.ok(gallery.includes('social.friendTargetUids.has(ownerUid)'));
    assert.ok(gallery.includes('social.blockedTargetUids'));
    assert.ok(global.includes(".where('visibility', '==', 'PUBLIC')"));
  });

  it('signed URLs are per-item, friend-aware and revalidated on each issuance', () => {
    const callable = read('get-public-video-access-urls.handler.ts');
    const signer = read('public-video-access-resolution.firestore.ts');
    assert.ok(callable.includes('resolveSocialConnectionAccess(viewerUid, ownerUids)'));
    assert.ok(callable.includes('socialAccess.friendTargetUids.has(ownerUid)'));
    assert.ok(callable.includes('socialAccess.blockedTargetUids'));
    assert.ok(signer.includes('viewerCanReadFriends === true'));
    assert.ok(signer.includes('isCurrentPublicMediaAssetExposure({'));
  });

  it('playback, view and retention transactions revalidate social access', () => {
    const policy = read('video-audience-access.policy.ts');
    assert.ok(policy.includes('resolveSocialConnectionAccessInTransaction'));
    for (const file of [
      'start-public-video-playback-session.handler.ts',
      'record-video-view.handler.ts',
      'record-video-retention.handler.ts',
    ]) {
      const code = read(file);
      assert.ok(code.includes('assertVideoAudienceAccessInTransaction('), file);
      assert.ok(code.includes('viewerCanReadFriends'), file);
    }
  });
});
