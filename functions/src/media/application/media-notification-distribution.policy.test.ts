import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMediaDistributionNotificationId,
  buildMediaNotificationCopy,
  canReceiveMediaDistributionNotification,
  evaluateMediaNotificationCaps,
  MEDIA_NOTIFICATION_DISTRIBUTION_WINDOW_MS,
  MEDIA_NOTIFICATION_MAX_PER_OWNER_RECIPIENT_WINDOW,
  MEDIA_NOTIFICATION_MAX_PER_RECIPIENT_WINDOW,
  MEDIA_NOTIFICATION_MAX_RECIPIENTS_PER_PUBLICATION,
  resolveMediaDistributionNotificationType,
  resolveMediaDistributionType,
  shouldDistributeApprovedMedia,
} from './media-notification-distribution.policy';

describe('media notification distribution policy', () => {
  it('distributes only on transition into approved public/friends state', () => {
    assert.equal(shouldDistributeApprovedMedia({
      before: {moderationStatus: 'PENDING_REVIEW', visibility: 'PUBLIC'},
      after: {moderationStatus: 'APPROVED', visibility: 'PUBLIC', mediaType: 'PHOTO'},
      mediaCollection: 'public_photos',
    }), true);

    assert.equal(shouldDistributeApprovedMedia({
      before: {moderationStatus: 'APPROVED', visibility: 'PUBLIC'},
      after: {moderationStatus: 'APPROVED', visibility: 'PUBLIC', mediaType: 'PHOTO'},
      mediaCollection: 'public_photos',
    }), false);

    assert.equal(shouldDistributeApprovedMedia({
      before: {moderationStatus: 'PENDING_REVIEW', visibility: 'PUBLIC'},
      after: {moderationStatus: 'FLAGGED', visibility: 'PUBLIC', mediaType: 'PHOTO'},
      mediaCollection: 'public_photos',
    }), false);
  });

  it('keeps notification ids stable for dedupe', () => {
    const first = buildMediaDistributionNotificationId({
      recipientUid: 'recipient',
      ownerUid: 'owner',
      mediaType: 'photo',
      mediaId: 'photo-1',
    });
    const second = buildMediaDistributionNotificationId({
      recipientUid: 'recipient',
      ownerUid: 'owner',
      mediaType: 'photo',
      mediaId: 'photo-1',
    });

    assert.equal(first, second);
    assert.match(first, /^media_distribution_/);
  });

  it('enforces defensive recipient and owner-recipient caps', () => {
    const now = Date.now();

    const ownerCapped = evaluateMediaNotificationCaps({
      ownerUid: 'owner',
      nowMs: now,
      state: {
        windowStartedAtMs: now,
        count: MEDIA_NOTIFICATION_MAX_PER_OWNER_RECIPIENT_WINDOW,
        ownerCounts: {
          owner: MEDIA_NOTIFICATION_MAX_PER_OWNER_RECIPIENT_WINDOW,
        },
      },
    });
    assert.equal(ownerCapped.allowed, false);
    assert.equal(ownerCapped.reason, 'OWNER_RECIPIENT_CAP');

    const recipientCapped = evaluateMediaNotificationCaps({
      ownerUid: 'owner-b',
      nowMs: now,
      state: {
        windowStartedAtMs: now,
        count: MEDIA_NOTIFICATION_MAX_PER_RECIPIENT_WINDOW,
        ownerCounts: {},
      },
    });
    assert.equal(recipientCapped.allowed, false);
    assert.equal(recipientCapped.reason, 'RECIPIENT_CAP');

    const reset = evaluateMediaNotificationCaps({
      ownerUid: 'owner',
      nowMs: now,
      state: {
        windowStartedAtMs:
          now - MEDIA_NOTIFICATION_DISTRIBUTION_WINDOW_MS - 1,
        count: 99,
        ownerCounts: {owner: 99},
      },
    });
    assert.equal(reset.allowed, true);
    assert.equal(reset.nextCount, 1);
    assert.equal(reset.nextOwnerCounts['owner'], 1);
  });

  it('requires active recipient lifecycle', () => {
    const active = {
      uid: 'recipient',
      accountStatus: 'active',
      profileCompleted: true,
      loginAllowed: true,
    };

    assert.equal(canReceiveMediaDistributionNotification(
      active,
      'recipient',
      'owner'
    ), true);

    assert.equal(canReceiveMediaDistributionNotification(
      {...active, suspended: true},
      'recipient',
      'owner'
    ), false);

    assert.equal(canReceiveMediaDistributionNotification(
      {...active, interactionBlocked: true},
      'recipient',
      'owner'
    ), false);
  });

  it('keeps supported media types and defensive fanout explicit', () => {
    assert.equal(resolveMediaDistributionType('PHOTO', 'public_photos'), 'photo');
    assert.equal(resolveMediaDistributionType('VIDEO', 'public_videos'), 'video');
    assert.equal(resolveMediaDistributionNotificationType('photo'),
      'media.photo.published');
    assert.ok(MEDIA_NOTIFICATION_MAX_RECIPIENTS_PER_PUBLICATION > 0);
    assert.match(buildMediaNotificationCopy('video').title, /vídeo/i);
  });
});
