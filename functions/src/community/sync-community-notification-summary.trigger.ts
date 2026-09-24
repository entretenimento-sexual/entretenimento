// functions/src/community/sync-community-notification-summary.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY NOTIFICATION SUMMARY
// -----------------------------------------------------------------------------
// Projeta a coleção canônica `notifications` em:
// 1) detalhe privado por usuário/Comunidade, paginado sob /items;
// 2) um único documento global O(1) por usuário com totais + pequena janela.
//
// O estado aplicado por notificationId mantém o processamento convergente e
// idempotente mesmo com retries ou eventos fora de ordem.
// -----------------------------------------------------------------------------

import { Timestamp } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildCommunityNotificationSummaryItem,
  normalizeCommunityNotificationSummaryItem,
  type CommunityNotificationSummaryChange,
} from './community-notification-global-summary.policy';
import {
  prepareCommunityNotificationGlobalSummaryWrite,
} from './community-notification-global-summary.transaction';
import { isCommunityNotificationMembershipCycleCurrent } from './community-notification-membership.policy';
import {
  type CommunityNotificationSummaryContribution,
  isCommunitySocialNotificationType,
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

interface PreparedSummaryMutation {
  readonly ref: FirebaseFirestore.DocumentReference;
  readonly userId: string;
  readonly communityId: string;
  readonly before: ReturnType<typeof normalizeCommunityNotificationSummaryItem>;
  readonly after: ReturnType<typeof buildCommunityNotificationSummaryItem>;
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
      const rawNotification = notificationSnapshot.exists
        ? notificationSnapshot.data()
        : undefined;
      let desired = rawNotification
        ? projectCommunityNotificationSummaryContribution(rawNotification)
        : null;
      const applied = stateSnapshot.exists
        ? normalizeAppliedContribution(stateSnapshot.data())
        : null;

      if (
        desired
        && rawNotification
        && isCommunitySocialNotificationType(rawNotification['type'])
      ) {
        const membershipRef = db
          .collection('communities')
          .doc(desired.communityId)
          .collection('members')
          .doc(desired.userId);
        const membershipSnapshot = await transaction.get(membershipRef);

        if (
          !membershipSnapshot.exists
          || !isCommunityNotificationMembershipCycleCurrent(
            membershipSnapshot.data(),
            rawNotification['membershipCycleStartedAtMs']
          )
        ) {
          desired = null;
        }
      }

      if (sameCommunityNotificationSummaryContribution(applied, desired)) {
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
      const now = Timestamp.now();

      const mutations: PreparedSummaryMutation[] = deltas.map((delta, index) => {
        const summaryRef = summaryRefs[index]!;
        const summarySnapshot = summarySnapshots[index]!;
        const before = summarySnapshot.exists
          ? normalizeCommunityNotificationSummaryItem(
              delta.communityId,
              summarySnapshot.data()
            )
          : null;
        const currentUnreadCount = before?.unreadCount ?? 0;
        const currentPriorityUnreadCount = before?.priorityUnreadCount ?? 0;
        const unreadCount = Math.max(0, currentUnreadCount + delta.unreadCount);
        const priorityUnreadCount = Math.max(
          0,
          Math.min(
            unreadCount,
            currentPriorityUnreadCount + delta.priorityUnreadCount
          )
        );
        const after = unreadCount > 0
          ? buildCommunityNotificationSummaryItem({
              communityId: delta.communityId,
              unreadCount,
              priorityUnreadCount,
              updatedAtMs: now.toMillis(),
            })
          : null;

        return {
          ref: summaryRef,
          userId: delta.userId,
          communityId: delta.communityId,
          before,
          after,
        };
      });

      const changesByUser = new Map<string, CommunityNotificationSummaryChange[]>();
      for (const mutation of mutations) {
        const changes = changesByUser.get(mutation.userId) ?? [];
        changes.push({
          before: mutation.before,
          after: mutation.after,
        });
        changesByUser.set(mutation.userId, changes);
      }

      // TODAS as leituras da projeção global acontecem antes do primeiro write.
      const globalWrites = await Promise.all(
        [...changesByUser.entries()].map(([uid, changes]) =>
          prepareCommunityNotificationGlobalSummaryWrite(transaction, {
            uid,
            changes,
            updatedAt: now,
          })
        )
      );

      for (const mutation of mutations) {
        if (!mutation.after) {
          transaction.delete(mutation.ref);
          continue;
        }

        transaction.set(mutation.ref, {
          userId: mutation.userId,
          communityId: mutation.communityId,
          unreadCount: mutation.after.unreadCount,
          priorityUnreadCount: mutation.after.priorityUnreadCount,
          hasPriorityUnread: mutation.after.hasPriorityUnread,
          attentionRank: mutation.after.attentionRank,
          updatedAt: now,
        }, { merge: true });
      }

      for (const globalWrite of globalWrites) {
        transaction.set(globalWrite.ref, globalWrite.data, { merge: true });
      }

      if (desired) {
        transaction.set(stateRef, {
          ...desired,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.delete(stateRef);
      }
    });
  }
);
