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
    expect(shouldDistributeApprovedMedia({
      before: {moderationStatus: 'PENDING_REVIEW', visibility: 'PUBLIC'},
      after: {moderationStatus: 'APPROVED', visibility: 'PUBLIC', mediaType: 'PHOTO'},
      mediaCollection: 'public_photos',
    })).toBe(true);

    expect(shouldDistributeApprovedMedia({
      before: {moderationStatus: 'APPROVED', visibility: 'PUBLIC'},
      after: {moderationStatus: 'APPROVED', visibility: 'PUBLIC', mediaType: 'PHOTO'},
      mediaCollection: 'public_photos',
    })).toBe(false);

    expect(shouldDistributeApprovedMedia({
      before: {moderationStatus: 'PENDING_REVIEW', visibility: 'PUBLIC'},
      after: {moderationStatus: 'FLAGGED', visibility: 'PUBLIC', mediaType: 'PHOTO'},
      mediaCollection: 'public_photos',
    })).toBe(false);
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

    expect(first).toBe(second);
    expect(first).toMatch(/^media_distribution_/);
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
    expect(ownerCapped.allowed).toBe(false);
    expect(ownerCapped.reason).toBe('OWNER_RECIPIENT_CAP');

    const recipientCapped = evaluateMediaNotificationCaps({
      ownerUid: 'owner-b',
      nowMs: now,
      state: {
        windowStartedAtMs: now,
        count: MEDIA_NOTIFICATION_MAX_PER_RECIPIENT_WINDOW,
        ownerCounts: {},
      },
    });
    expect(recipientCapped.allowed).toBe(false);
    expect(recipientCapped.reason).toBe('RECIPIENT_CAP');

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
    expect(reset.allowed).toBe(true);
    expect(reset.nextCount).toBe(1);
    expect(reset.nextOwnerCounts['owner']).toBe(1);
  });

  it('requires active recipient lifecycle', () => {
    const active = {
      uid: 'recipient',
      accountStatus: 'active',
      profileCompleted: true,
      loginAllowed: true,
    };

    expect(canReceiveMediaDistributionNotification(
      active,
      'recipient',
      'owner'
    )).toBe(true);

    expect(canReceiveMediaDistributionNotification(
      {...active, suspended: true},
      'recipient',
      'owner'
    )).toBe(false);

    expect(canReceiveMediaDistributionNotification(
      {...active, interactionBlocked: true},
      'recipient',
      'owner'
    )).toBe(false);
  });

  it('keeps supported media types and defensive fanout explicit', () => {
    expect(resolveMediaDistributionType('PHOTO', 'public_photos')).toBe('photo');
    expect(resolveMediaDistributionType('VIDEO', 'public_videos')).toBe('video');
    expect(resolveMediaDistributionNotificationType('photo')).toBe(
      'media.photo.published'
    );
    expect(MEDIA_NOTIFICATION_MAX_RECIPIENTS_PER_PUBLICATION).toBeGreaterThan(0);
    expect(buildMediaNotificationCopy('video').title).toContain('vídeo');
  });
});
