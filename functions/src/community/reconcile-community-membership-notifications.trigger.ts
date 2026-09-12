// functions/src/community/reconcile-community-membership-notifications.trigger.ts
// -----------------------------------------------------------------------------
// RECONCILE COMMUNITY MEMBERSHIP NOTIFICATIONS
// -----------------------------------------------------------------------------
// Quando o ciclo canônico de membership termina ou muda, remove do resumo apenas
// contribuições sociais que já não pertencem ao ciclo atual. Notificações e estado
// de deduplicação permanecem preservados; moderação obrigatória não é suprimida.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  isCommunityNotificationMembershipCycleCurrent,
  shouldReconcileCommunityNotificationMembership,
} from './community-notification-membership.policy';
import {
  isCommunitySocialNotificationType,
  normalizeCommunityNotificationSummaryCount,
} from './community-notification-summary.projection';

export const reconcileCommunityMembershipNotifications = onDocumentWritten(
  {
    document: 'communities/{communityId}/members/{uid}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const before = event.data?.before.exists ? event.data.before.data() : null;
    const after = event.data?.after.exists ? event.data.after.data() : null;
    if (!shouldReconcileCommunityNotificationMembership(before, after)) return;

    const communityId = String(event.params['communityId'] ?? '').trim();
    const uid = String(event.params['uid'] ?? '').trim();
    if (!communityId || !uid) return;

    const membershipRef = db
      .collection('communities')
      .doc(communityId)
      .collection('members')
      .doc(uid);
    const summaryRef = db
      .collection('community_notification_summaries')
      .doc(uid)
      .collection('items')
      .doc(communityId);
    const preferenceRef = db
      .collection('community_notification_preferences')
      .doc(uid)
      .collection('items')
      .doc(communityId);
    const stateQuery = db
      .collection('community_notification_projection_state')
      .where('userId', '==', uid);

    const result = await db.runTransaction(async (transaction) => {
      const membershipSnapshot = await transaction.get(membershipRef);
      const currentMembership = membershipSnapshot.exists
        ? membershipSnapshot.data()
        : null;
      const stateSnapshot = await transaction.get(stateQuery);
      const candidateStates = stateSnapshot.docs.filter((stateDoc) => {
        const state = stateDoc.data();
        return String(state['communityId'] ?? '').trim() === communityId
          && normalizeCommunityNotificationSummaryCount(state['unreadCount']) > 0;
      });
      const notificationSnapshots = [];
      for (const stateDoc of candidateStates) {
        notificationSnapshots.push(
          await transaction.get(db.collection('notifications').doc(stateDoc.id))
        );
      }
      const summarySnapshot = await transaction.get(summaryRef);

      const staleSocialStates = candidateStates.filter((_stateDoc, index) => {
        const notificationSnapshot = notificationSnapshots[index];
        if (!notificationSnapshot?.exists) return false;
        const notification = notificationSnapshot.data() ?? {};
        return isCommunitySocialNotificationType(notification['type'])
          && !isCommunityNotificationMembershipCycleCurrent(
            currentMembership,
            notification['membershipCycleStartedAtMs']
          );
      });

      let removedUnreadCount = 0;
      let removedPriorityUnreadCount = 0;
      for (const stateDoc of staleSocialStates) {
        const state = stateDoc.data();
        removedUnreadCount += normalizeCommunityNotificationSummaryCount(
          state['unreadCount']
        );
        removedPriorityUnreadCount += normalizeCommunityNotificationSummaryCount(
          state['priorityUnreadCount']
        );
      }

      if (removedUnreadCount > 0 && summarySnapshot.exists) {
        const currentUnreadCount = normalizeCommunityNotificationSummaryCount(
          summarySnapshot.data()?.['unreadCount']
        );
        const currentPriorityUnreadCount = normalizeCommunityNotificationSummaryCount(
          summarySnapshot.data()?.['priorityUnreadCount']
        );
        const unreadCount = Math.max(0, currentUnreadCount - removedUnreadCount);
        const priorityUnreadCount = Math.max(
          0,
          Math.min(
            unreadCount,
            currentPriorityUnreadCount - removedPriorityUnreadCount
          )
        );

        if (unreadCount === 0) {
          transaction.delete(summaryRef);
        } else {
          transaction.set(summaryRef, {
            userId: uid,
            communityId,
            unreadCount,
            priorityUnreadCount,
            hasPriorityUnread: priorityUnreadCount > 0,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      }

      for (const stateDoc of staleSocialStates) {
        transaction.set(stateDoc.ref, {
          userId: uid,
          communityId,
          unreadCount: 0,
          priorityUnreadCount: 0,
          suppressedAt: FieldValue.serverTimestamp(),
          suppressionReason: 'membership_cycle_inactive',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      const membershipStatus = String(
        (currentMembership as Record<string, unknown> | null)?.['status'] ?? ''
      ).trim();
      if (membershipStatus !== 'active') {
        transaction.delete(preferenceRef);
      }

      return {
        removedUnreadCount,
        staleSocialStateCount: staleSocialStates.length,
        preferenceRemoved: membershipStatus !== 'active',
      };
    });

    logger.info('community_membership_notifications_reconciled', {
      communityId,
      uid,
      ...result,
    });
  }
);
