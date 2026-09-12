// functions/src/community/sync-community-notification-summary.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY NOTIFICATION SUMMARY
// -----------------------------------------------------------------------------
// Projeta a coleção canônica `notifications` em um único resumo privado por
// usuário/Comunidade. O estado aplicado por notificationId torna o processamento
// convergente e idempotente mesmo com retries ou eventos fora de ordem: cada
// execução relê a notificação atual antes de calcular a diferença.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  isCommunityNotificationInCurrentMembershipCycle,
  isCommunitySocialActivityNotificationType,
} from './community-notification.policy';
import {
  type CommunityNotificationSummaryContribution,
  normalizeCommunityNotificationSummaryCount,
  projectCommunityNotificationSummaryContribution,
  sameCommunityNotificationSummaryContribution,
} from './community-notification-summary.projection';

interface CommunityNotificationSummaryDelta {
  userId: string;
  communityId: string;
  unreadCount: number;
  priorityUnreadCount: number;
}

function normalizeAppliedContribution(
  raw: FirebaseFirestore.DocumentData | undefined
): CommunityNotificationSummaryContribution | null {
  if (!raw) return null;

  const userId = String(raw['userId'] ?? '').trim();
  const communityId = String(raw['communityId'] ?? '').trim();
  const unreadCount = normalizeCommunityNotificationSummaryCount(raw['unreadCount']);
  const priorityUnreadCount = normalizeCommunityNotificationSummaryCount(
    raw['priorityUnreadCount']
  );

  if (!userId || !communityId || unreadCount <= 0) return null;

  return {
    userId,
    communityId,
    unreadCount,
    priorityUnreadCount: Math.min(priorityUnreadCount, unreadCount),
  };
}

function contributionKey(
  contribution: Pick<CommunityNotificationSummaryContribution, 'userId' | 'communityId'>
): string {
  return `${contribution.userId}\u0000${contribution.communityId}`;
}

function buildDeltas(
  applied: CommunityNotificationSummaryContribution | null,
  desired: CommunityNotificationSummaryContribution | null
): CommunityNotificationSummaryDelta[] {
  const deltas = new Map<string, CommunityNotificationSummaryDelta>();

  const apply = (
    contribution: CommunityNotificationSummaryContribution,
    direction: -1 | 1
  ): void => {
    const key = contributionKey(contribution);
    const current = deltas.get(key) ?? {
      userId: contribution.userId,
      communityId: contribution.communityId,
      unreadCount: 0,
      priorityUnreadCount: 0,
    };
    current.unreadCount += direction * contribution.unreadCount;
    current.priorityUnreadCount += direction * contribution.priorityUnreadCount;
    deltas.set(key, current);
  };

  if (applied) apply(applied, -1);
  if (desired) apply(desired, 1);

  return Array.from(deltas.values()).filter(
    (delta) => delta.unreadCount !== 0 || delta.priorityUnreadCount !== 0
  );
}

export const syncCommunityNotificationSummary = onDocumentWritten(
  {
    document: 'notifications/{notificationId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const notificationId = String(event.params['notificationId'] ?? '').trim();
    if (!notificationId) return;

    const notificationRef = db.collection('notifications').doc(notificationId);
    const stateRef = db
      .collection('community_notification_projection_state')
      .doc(notificationId);

    await db.runTransaction(async (transaction) => {
      const [notificationSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(notificationRef),
        transaction.get(stateRef),
      ]);

      const notification = notificationSnapshot.exists
        ? notificationSnapshot.data()
        : undefined;
      const projected = notification
        ? projectCommunityNotificationSummaryContribution(notification)
        : null;
      let desired = projected;
      let suppressedByMembership = false;

      if (
        projected
        && notification
        && isCommunitySocialActivityNotificationType(notification['type'])
      ) {
        const membershipRef = db
          .collection('communities')
          .doc(projected.communityId)
          .collection('members')
          .doc(projected.userId);
        const membershipSnapshot = await transaction.get(membershipRef);
        const eligible = membershipSnapshot.exists
          && isCommunityNotificationInCurrentMembershipCycle(
            membershipSnapshot.data(),
            notification['createdAt']
          );

        if (!eligible) {
          desired = null;
          suppressedByMembership = true;
        }
      }

      const applied = stateSnapshot.exists
        ? normalizeAppliedContribution(stateSnapshot.data())
        : null;

      if (sameCommunityNotificationSummaryContribution(applied, desired)) {
        if (suppressedByMembership && notification && projected && !stateSnapshot.exists) {
          transaction.set(stateRef, {
            userId: projected.userId,
            communityId: projected.communityId,
            unreadCount: 0,
            priorityUnreadCount: 0,
            suppressedByMembership: true,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        return;
      }

      const deltas = buildDeltas(applied, desired);
      const summaryRefs = deltas.map((delta) => db
        .collection('community_notification_summaries')
        .doc(delta.userId)
        .collection('items')
        .doc(delta.communityId));
      const summarySnapshots = await Promise.all(
        summaryRefs.map((summaryRef) => transaction.get(summaryRef))
      );

      deltas.forEach((delta, index) => {
        const summaryRef = summaryRefs[index];
        const summarySnapshot = summarySnapshots[index];
        if (!summaryRef || !summarySnapshot) return;

        const currentUnreadCount = normalizeCommunityNotificationSummaryCount(
          summarySnapshot.data()?.['unreadCount']
        );
        const currentPriorityUnreadCount = normalizeCommunityNotificationSummaryCount(
          summarySnapshot.data()?.['priorityUnreadCount']
        );
        const unreadCount = Math.max(0, currentUnreadCount + delta.unreadCount);
        const priorityUnreadCount = Math.max(
          0,
          Math.min(
            unreadCount,
            currentPriorityUnreadCount + delta.priorityUnreadCount
          )
        );

        if (unreadCount === 0) {
          transaction.delete(summaryRef);
          return;
        }

        transaction.set(summaryRef, {
          userId: delta.userId,
          communityId: delta.communityId,
          unreadCount,
          priorityUnreadCount,
          hasPriorityUnread: priorityUnreadCount > 0,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      if (desired) {
        transaction.set(stateRef, {
          ...desired,
          suppressedByMembership: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else if (notificationSnapshot.exists && projected) {
        transaction.set(stateRef, {
          userId: projected.userId,
          communityId: projected.communityId,
          unreadCount: 0,
          priorityUnreadCount: 0,
          suppressedByMembership,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.delete(stateRef);
      }
    });
  }
);
