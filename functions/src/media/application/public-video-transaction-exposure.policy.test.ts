import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertCurrentPublicVideoTransactionExposure,
} from './public-video-transaction-exposure.policy';

const nowMs = 1800000000000;

function currentVideo() {
  return {
    publicVideo: { visibility: 'PUBLIC', moderationStatus: 'APPROVED' },
    publication: {
      isPublished: true, visibility: 'PUBLIC', moderationStatus: 'APPROVED',
    },
    nowMs,
  };
}

describe('VF1-B2 video transaction exposure policy', () => {
  it('permits an approved projection backed by an approved publication', () => {
    assert.doesNotThrow(() => assertCurrentPublicVideoTransactionExposure(
      currentVideo()
    ));
  });

  it('FRIENDS exige autorização social atual em cada transação', () => {
    const base = currentVideo();
    const restricted = {
      ...base,
      publicVideo: { ...base.publicVideo, visibility: 'FRIENDS' },
      publication: { ...base.publication, visibility: 'FRIENDS' },
    };
    assert.throws(() => assertCurrentPublicVideoTransactionExposure(restricted));
    assert.doesNotThrow(() => assertCurrentPublicVideoTransactionExposure({
      ...restricted, viewerCanReadFriends: true,
    }));
    assert.throws(() => assertCurrentPublicVideoTransactionExposure({
      ...restricted,
      viewerCanReadFriends: true,
      publication: { ...restricted.publication, isPublished: false },
    }));
  });

  for (const state of [
    'PENDING_REVIEW', 'FLAGGED', 'HIDDEN', 'REJECTED',
  ]) {
    it('rejects canonical publication ' + state + ' even if projection is stale approved', () => {
      const f = currentVideo();
      assert.throws(
        () => assertCurrentPublicVideoTransactionExposure({
          ...f, publication: { ...f.publication, moderationStatus: state },
        }),
        (e: unknown) => !!e && typeof e === 'object' &&
          'code' in e && e.code === 'not-found'
      );
    });
    it('rejects projection ' + state, () => {
      const f = currentVideo();
      assert.throws(() => assertCurrentPublicVideoTransactionExposure({
        ...f, publicVideo: { ...f.publicVideo, moderationStatus: state },
      }));
    });
  }

  it('rejects unpublish, private audience, missing publication or video', () => {
    const f = currentVideo();
    for (const publication of [
      { ...f.publication, isPublished: false },
      { ...f.publication, visibility: 'PRIVATE' },
      null,
    ]) {
      assert.throws(() => assertCurrentPublicVideoTransactionExposure({
        ...f, publication,
      }));
    }
    assert.throws(() => assertCurrentPublicVideoTransactionExposure({
      ...f, publicVideo: null,
    }));
  });
});
