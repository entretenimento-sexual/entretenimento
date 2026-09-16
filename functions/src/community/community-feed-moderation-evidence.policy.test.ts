import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isBlockingCommunityFeedModerationReportStatus,
  resolveCommunityFeedPostMediaRetention,
} from './community-feed-moderation-evidence.policy';

describe('community feed moderation evidence policy', () => {
  it('trata somente resolved/rejected como estados terminais conhecidos', () => {
    assert.equal(isBlockingCommunityFeedModerationReportStatus('resolved'), false);
    assert.equal(isBlockingCommunityFeedModerationReportStatus('rejected'), false);
    assert.equal(isBlockingCommunityFeedModerationReportStatus('open'), true);
    assert.equal(isBlockingCommunityFeedModerationReportStatus('reviewing'), true);
    assert.equal(isBlockingCommunityFeedModerationReportStatus(''), true);
    assert.equal(isBlockingCommunityFeedModerationReportStatus('corrupt'), true);
  });

  it('preserva mídia quando existe report não terminal, inclusive em posts legados', () => {
    assert.equal(resolveCommunityFeedPostMediaRetention(undefined, true), true);
    assert.equal(resolveCommunityFeedPostMediaRetention(null, true), true);
    assert.equal(resolveCommunityFeedPostMediaRetention(false, true), true);
  });

  it('libera mídia quando não existe blocker e o hold está ausente ou falso', () => {
    assert.equal(resolveCommunityFeedPostMediaRetention(undefined, false), false);
    assert.equal(resolveCommunityFeedPostMediaRetention(null, false), false);
    assert.equal(resolveCommunityFeedPostMediaRetention(false, false), false);
  });

  it('hold verdadeiro prevalece sobre reports terminais', () => {
    assert.equal(resolveCommunityFeedPostMediaRetention(true, false), true);
  });

  it('falha fechado para hold corrompido', () => {
    assert.equal(resolveCommunityFeedPostMediaRetention('true', false), null);
    assert.equal(resolveCommunityFeedPostMediaRetention(1, false), null);
  });
});
