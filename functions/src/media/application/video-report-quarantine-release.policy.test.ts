import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canReleaseVideoReportQuarantine,
  VIDEO_REPORT_QUARANTINE_REASON,
} from './video-report-quarantine-release.policy';

const ownerUid = 'owner-1';
const videoId = 'video-1';
const reportId = 'report-1';
const assetVersion = 1700000000000;

function caseFor(kind: 'preventive' | 'report') {
  const preventive = kind === 'preventive';
  const marker = preventive
    ? { preventiveReviewReportId: reportId }
    : { activeVideoQuarantineReportId: reportId };
  const moderationReason = preventive ? null : VIDEO_REPORT_QUARANTINE_REASON;
  const video = {
    id: videoId,
    ownerUid,
    visibility: 'PUBLIC',
    moderationStatus: preventive ? 'PENDING_REVIEW' : 'HIDDEN',
    moderationReason,
    assetVersion,
    ...marker,
  };
  const publication = {
    ownerUid,
    videoId,
    isPublished: true,
    visibility: 'PUBLIC',
    moderationStatus: preventive ? 'PENDING_REVIEW' : 'FLAGGED',
    moderationReason,
    assetVersion,
    ...marker,
  };
  const report = {
    contentQuarantined: true,
    reason: preventive ? 'preventive_media_review' : 'illegal_content',
    quarantinedAssetVersion: assetVersion,
  };
  return { ownerUid, videoId, reportId, report, video, publication };
}

describe('causal video quarantine release', () => {
  for (const kind of ['preventive', 'report'] as const) {
    it(kind + ': approves only its current, version-fenced restriction', () => {
      const input = caseFor(kind);
      assert.equal(canReleaseVideoReportQuarantine(input), true);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input, reportId: 'older-report',
      }), false);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input, video: { ...input.video, assetVersion: assetVersion + 1 },
      }), false);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input,
        publication: { ...input.publication, assetVersion: assetVersion + 1 },
      }), false);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input, video: null,
      }), false);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input, publication: null,
      }), false);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input, publication: { ...input.publication, isPublished: false },
      }), false);
    });

    it(kind + ': never releases an independent or superseding restriction', () => {
      const input = caseFor(kind);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input, video: { ...input.video, moderationStatus: 'REJECTED' },
      }), false);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input, publication: {
          ...input.publication, moderationStatus: 'HIDDEN',
        },
      }), false);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input, video: {
          ...input.video, moderationReason: 'Outra restrição administrativa',
        },
      }), false);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input, publication: {
          ...input.publication, visibility: 'PRIVATE',
        },
      }), false);
      assert.equal(canReleaseVideoReportQuarantine({
        ...input, video: {
          ...input.video, ownerUid: 'other-owner',
        },
      }), false);
    });
  }

  it('a conventional report cannot bypass a preventive hold', () => {
    const input = caseFor('report');
    assert.equal(canReleaseVideoReportQuarantine({
      ...input,
      video: { ...input.video, preventiveReviewReportId: 'preventive-2' },
    }), false);
    assert.equal(canReleaseVideoReportQuarantine({
      ...input,
      publication: {
        ...input.publication, preventiveReviewReportId: 'preventive-2',
      },
    }), false);
  });

  it('preventive approval cannot bypass a later report hold', () => {
    const input = caseFor('preventive');
    assert.equal(canReleaseVideoReportQuarantine({
      ...input, video: { ...input.video, activeVideoQuarantineReportId: 'r2' },
    }), false);
  });

  it('stale conventional reports without a causal marker fail closed', () => {
    const input = caseFor('report');
    const { activeVideoQuarantineReportId: _ignored, ...video } = input.video;
    assert.equal(canReleaseVideoReportQuarantine({ ...input, video }), false);
    assert.equal(canReleaseVideoReportQuarantine({
      ...input, report: { ...input.report, contentQuarantined: false },
    }), false);
  });

  it('legacy preventive reports are supported by the matching ID fence', () => {
    const input = caseFor('preventive');
    const { quarantinedAssetVersion: _ignored, ...report } = input.report;
    assert.equal(canReleaseVideoReportQuarantine({ ...input, report }), true);
    assert.equal(canReleaseVideoReportQuarantine({
      ...input, report: { ...report, quarantinedAssetVersion: null },
    }), false);
  });
});
