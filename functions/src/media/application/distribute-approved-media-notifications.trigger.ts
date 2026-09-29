// functions/src/media/application/distribute-approved-media-notifications.trigger.ts
// -----------------------------------------------------------------------------
// APPROVED MEDIA NOTIFICATION DISTRIBUTION
// -----------------------------------------------------------------------------
// Fan-out defensivo para conexões bilaterais quando Foto/Vídeo entra em estado
// público aprovado. Não usa trendScore, score orgânico ou Promotion/Boost.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  evaluateCanonicalOwnerLifecycle,
} from './owner-lifecycle-exposure.policy';
import {
  buildMediaDistributionNotificationId,
  buildMediaNotificationCopy,
  canReceiveMediaDistributionNotification,
  evaluateMediaNotificationCaps,
  MEDIA_NOTIFICATION_MAX_RECIPIENTS_PER_PUBLICATION,
  resolveMediaDistributionNotificationType,
  resolveMediaDistributionType,
  shouldDistributeApprovedMedia,
  type MediaNotificationDeliveryState,
  type MediaNotificationRecipientUser,
} from './media-notification-distribution.policy';

interface PreferenceDocument {
  notificationPreferences?: {
    media?: unknown;
  };
}

interface BlockDocument {
  isBlocked?: unknown;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized
    && normalized.length <= 128
    && !normalized.includes('/')
    ? normalized
    : '';
}

function mediaPreferenceEnabled(
  preference: PreferenceDocument | null | undefined
): boolean {
  return preference?.notificationPreferences?.media !== false;
}

function activeBlock(
  block: BlockDocument | null | undefined
): boolean {
  return block?.isBlocked === true;
}

function mediaRoute(
  ownerUid: string,
  mediaType: 'photo' | 'video'
): string {
  return mediaType === 'photo'
    ? `/media/perfil/${ownerUid}/fotos-publicas`
    : `/media/perfil/${ownerUid}/videos-publicos`;
}

export const distributeApprovedMediaNotifications = onDocumentWritten(
  {
    document: 'public_profiles/{ownerUid}/{mediaCollection}/{mediaId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const mediaCollection = String(event.params['mediaCollection'] ?? '').trim();
    if (
      mediaCollection !== 'public_photos'
      && mediaCollection !== 'public_videos'
    ) {
      return;
    }

    const before = event.data?.before.exists
      ? event.data.before.data()
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data()
      : null;

    if (!shouldDistributeApprovedMedia({
      before,
      after,
      mediaCollection,
    })) {
      return;
    }

    const ownerUid = cleanId(event.params['ownerUid']);
    const mediaId = cleanId(event.params['mediaId']);
    const mediaType = resolveMediaDistributionType(
      after?.['mediaType'],
      mediaCollection
    );

    if (!ownerUid || !mediaId || !mediaType) return;

    const ownerSnapshot = await db.collection('users').doc(ownerUid).get();
    const ownerLifecycle = evaluateCanonicalOwnerLifecycle(
      ownerSnapshot.exists ? ownerSnapshot.data() : null
    );

    if (!ownerLifecycle.allowed) {
      logger.info('media_notification_distribution_suppressed_owner_lifecycle', {
        ownerUid,
        mediaId,
        mediaType,
        reason: ownerLifecycle.denialReason,
      });
      return;
    }

    const candidateSnapshot = await db
      .collection('users')
      .doc(ownerUid)
      .collection('friends')
      .limit(MEDIA_NOTIFICATION_MAX_RECIPIENTS_PER_PUBLICATION)
      .get();

    if (candidateSnapshot.empty) return;

    const notificationType =
      resolveMediaDistributionNotificationType(mediaType);
    const copy = buildMediaNotificationCopy(mediaType);
    const nowMs = Date.now();
    let delivered = 0;
    let deduped = 0;
    let preferenceSuppressed = 0;
    let lifecycleSuppressed = 0;
    let relationshipSuppressed = 0;
    let capSuppressed = 0;

    for (const candidate of candidateSnapshot.docs) {
      const recipientUid = cleanId(
        candidate.data()?.['friendUid'] ?? candidate.id
      );
      if (!recipientUid || recipientUid === ownerUid) continue;

      const notificationId = buildMediaDistributionNotificationId({
        recipientUid,
        ownerUid,
        mediaType,
        mediaId,
      });
      const notificationRef = db
        .collection('notifications')
        .doc(notificationId);
      const stateRef = db
        .collection('media_notification_delivery_state')
        .doc(recipientUid);

      const result = await db.runTransaction(async (transaction) => {
        const ownerFriendRef = db.doc(
          `users/${ownerUid}/friends/${recipientUid}`
        );
        const recipientFriendRef = db.doc(
          `users/${recipientUid}/friends/${ownerUid}`
        );
        const ownerBlockRef = db.doc(
          `users/${ownerUid}/blocks/${recipientUid}`
        );
        const recipientBlockRef = db.doc(
          `users/${recipientUid}/blocks/${ownerUid}`
        );
        const recipientUserRef = db.collection('users').doc(recipientUid);
        const preferenceRef = db.collection('preferences').doc(recipientUid);

        const [
          existingNotification,
          stateSnapshot,
          ownerFriendSnapshot,
          recipientFriendSnapshot,
          ownerBlockSnapshot,
          recipientBlockSnapshot,
          recipientUserSnapshot,
          preferenceSnapshot,
        ] = await Promise.all([
          transaction.get(notificationRef),
          transaction.get(stateRef),
          transaction.get(ownerFriendRef),
          transaction.get(recipientFriendRef),
          transaction.get(ownerBlockRef),
          transaction.get(recipientBlockRef),
          transaction.get(recipientUserRef),
          transaction.get(preferenceRef),
        ]);

        if (existingNotification.exists) {
          return 'DEDUPED' as const;
        }

        if (
          !ownerFriendSnapshot.exists
          || !recipientFriendSnapshot.exists
          || activeBlock(
            ownerBlockSnapshot.exists
              ? ownerBlockSnapshot.data() as BlockDocument
              : null
          )
          || activeBlock(
            recipientBlockSnapshot.exists
              ? recipientBlockSnapshot.data() as BlockDocument
              : null
          )
        ) {
          return 'RELATIONSHIP' as const;
        }

        const recipient = recipientUserSnapshot.exists
          ? recipientUserSnapshot.data() as MediaNotificationRecipientUser
          : null;

        if (
          !canReceiveMediaDistributionNotification(
            recipient,
            recipientUid,
            ownerUid
          )
        ) {
          return 'LIFECYCLE' as const;
        }

        const preferences = preferenceSnapshot.exists
          ? preferenceSnapshot.data() as PreferenceDocument
          : null;

        if (!mediaPreferenceEnabled(preferences)) {
          return 'PREFERENCE' as const;
        }

        const capDecision = evaluateMediaNotificationCaps({
          state: stateSnapshot.exists
            ? stateSnapshot.data() as MediaNotificationDeliveryState
            : null,
          ownerUid,
          nowMs,
        });

        if (!capDecision.allowed) {
          return 'CAP' as const;
        }

        const now = FieldValue.serverTimestamp();

        transaction.create(notificationRef, {
          userId: recipientUid,
          actorUid: ownerUid,
          type: notificationType,
          mediaType,
          mediaId,
          title: copy.title,
          body: copy.body,
          route: mediaRoute(ownerUid, mediaType),
          readAt: null,
          pushMode: 'ESSENTIAL',
          distributionSource: 'approved_media_connection',
          createdAt: now,
          updatedAt: now,
        });

        transaction.set(stateRef, {
          userId: recipientUid,
          windowStartedAtMs: capDecision.nextWindowStartedAtMs,
          count: capDecision.nextCount,
          ownerCounts: capDecision.nextOwnerCounts,
          updatedAt: now,
        }, {merge: true});

        return 'DELIVERED' as const;
      });

      switch (result) {
        case 'DELIVERED':
          delivered += 1;
          break;
        case 'DEDUPED':
          deduped += 1;
          break;
        case 'PREFERENCE':
          preferenceSuppressed += 1;
          break;
        case 'LIFECYCLE':
          lifecycleSuppressed += 1;
          break;
        case 'RELATIONSHIP':
          relationshipSuppressed += 1;
          break;
        case 'CAP':
          capSuppressed += 1;
          break;
      }
    }

    logger.info('media_notification_distribution_processed', {
      ownerUid,
      mediaId,
      mediaType,
      notificationType,
      candidateCount: candidateSnapshot.size,
      delivered,
      deduped,
      preferenceSuppressed,
      lifecycleSuppressed,
      relationshipSuppressed,
      capSuppressed,
      fanoutCap: MEDIA_NOTIFICATION_MAX_RECIPIENTS_PER_PUBLICATION,
      trendScoreUsed: false,
      rankingScoreUsed: false,
      promotionUsed: false,
    });
  }
);
