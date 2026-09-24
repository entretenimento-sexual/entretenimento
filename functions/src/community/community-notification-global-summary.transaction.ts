// functions/src/community/community-notification-global-summary.transaction.ts
// -----------------------------------------------------------------------------
// PREPARE COMMUNITY NOTIFICATION GLOBAL SUMMARY
// -----------------------------------------------------------------------------
// Faz somente leituras e devolve o write preparado. Isso permite que callers com
// múltiplos usuários façam TODAS as leituras antes do primeiro write, preservando
// as regras de transação do Firestore.
// -----------------------------------------------------------------------------

import { Timestamp } from 'firebase-admin/firestore';

import { db } from '../firebaseApp';
import {
  COMMUNITY_NOTIFICATION_ATTENTION_WINDOW_SIZE,
  buildCommunityNotificationGlobalProjection,
  normalizeCommunityNotificationSummaryItem,
  type CommunityNotificationSummaryChange,
} from './community-notification-global-summary.policy';

export interface PreparedCommunityNotificationGlobalSummaryWrite {
  readonly ref: FirebaseFirestore.DocumentReference;
  readonly data: Readonly<Record<string, unknown>>;
}

export async function prepareCommunityNotificationGlobalSummaryWrite(
  transaction: FirebaseFirestore.Transaction,
  input: {
    readonly uid: string;
    readonly changes: readonly CommunityNotificationSummaryChange[];
    readonly updatedAt: Timestamp;
  }
): Promise<PreparedCommunityNotificationGlobalSummaryWrite> {
  const globalRef = db.collection('community_notification_summaries').doc(input.uid);
  const attentionQuery = globalRef
    .collection('items')
    .orderBy('attentionRank', 'desc')
    .limit(
      COMMUNITY_NOTIFICATION_ATTENTION_WINDOW_SIZE
      + Math.max(1, input.changes.length)
    );

  const [globalSnapshot, attentionSnapshot] = await Promise.all([
    transaction.get(globalRef),
    transaction.get(attentionQuery),
  ]);

  let rawGlobal = globalSnapshot.exists ? globalSnapshot.data() : null;

  // Usuário genuinamente novo pode iniciar diretamente em v2. A leitura extra
  // só ocorre quando o pai ainda não existe; no steady state ela desaparece.
  if (!globalSnapshot.exists) {
    const firstExistingItem = await transaction.get(
      globalRef.collection('items').limit(1)
    );
    const freshInitialization =
      firstExistingItem.empty
      && input.changes.every((change) => change.before === null);

    if (freshInitialization) {
      rawGlobal = {
        projectionVersion: 2,
        requiresBackfill: false,
        unreadCount: 0,
        priorityUnreadCount: 0,
        unreadCommunityCount: 0,
        priorityCommunityCount: 0,
      };
    }
  }

  const candidates = attentionSnapshot.docs.flatMap((document) => {
    const normalized = normalizeCommunityNotificationSummaryItem(
      document.id,
      document.data()
    );
    return normalized ? [normalized] : [];
  });
  const projection = buildCommunityNotificationGlobalProjection({
    rawGlobal,
    candidates,
    changes: input.changes,
    updatedAtMs: input.updatedAt.toMillis(),
  });

  return {
    ref: globalRef,
    data: {
      projectionVersion: projection.projectionVersion,
      requiresBackfill: projection.requiresBackfill,
      unreadCount: projection.unreadCount,
      priorityUnreadCount: projection.priorityUnreadCount,
      unreadCommunityCount: projection.unreadCommunityCount,
      priorityCommunityCount: projection.priorityCommunityCount,
      hasPriorityUnread: projection.hasPriorityUnread,
      attentionWindow: projection.attentionWindow.map((item) => ({
        communityId: item.communityId,
        unreadCount: item.unreadCount,
        priorityUnreadCount: item.priorityUnreadCount,
        hasPriorityUnread: item.hasPriorityUnread,
        updatedAt: Timestamp.fromMillis(item.updatedAtMs),
      })),
      updatedAt: input.updatedAt,
    },
  };
}
